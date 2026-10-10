from datetime import datetime, timezone, timedelta
import hashlib
import json
import logging
import sqlite3
import threading
import time
import uuid
from typing import Dict, Any, Optional, Tuple, List
from config import settings

logger = logging.getLogger("estimation_outbox")

# Outbox / Idempotency Job States
STATE_PENDING_DISPATCH = "PENDING_DISPATCH"
STATE_DISPATCHED = "DISPATCHED"
STATE_DISPATCH_FAILED = "DISPATCH_FAILED"
STATE_DISPATCH_UNCERTAIN = "DISPATCH_UNCERTAIN"
STATE_EXECUTING = "EXECUTING"
STATE_PUBLISHING = "PUBLISHING"
STATE_PENDING_PUBLISH = "PENDING_PUBLISH"
STATE_COMPLETED = "COMPLETED"
STATE_FAILED = "FAILED"
STATE_CANCELLED = "CANCELLED"



def _parse_timestamp(val) -> Optional[datetime]:
    if val is None:
        return None
    if isinstance(val, datetime):
        if val.tzinfo is None:
            return val.replace(tzinfo=timezone.utc)
        return val
    if isinstance(val, str):
        try:
            dt = datetime.fromisoformat(val.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except Exception:
            try:
                dt = datetime.strptime(val, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
                return dt
            except Exception:
                return None
    return None

def compute_payload_hash(pdf_key: str, scopes: List[str]) -> str:
    sorted_scopes = sorted([s.strip() for s in scopes])
    norm = json.dumps({"pdf_key": pdf_key.strip(), "scopes": sorted_scopes}, sort_keys=True)
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()


class TransactionalOutboxStore:
    """
    Durable Transactional Outbox and Idempotency Store.
    Supports:
    1. Shared PostgreSQL database for multi-replica containerized deployments.
    2. Local SQLite database for single-instance or standalone testing.
    3. Conditional state transitions (never overwrite EXECUTING or COMPLETED).
    4. Worker lease management with execution-owner tokens and heartbeats.
    5. Atomic job fencing, durable cancellation tombstones, and pre-refund protection.
    6. Durable persistence of generated AI results and retryable Supabase publication.
    """
    def __init__(self, db_url: Optional[str] = None, sqlite_path: Optional[str] = None):
        self.db_url = db_url or settings.database_url
        self.sqlite_path = sqlite_path or settings.idempotency_db_path
        self._is_postgres = bool(self.db_url and (self.db_url.startswith("postgresql://") or self.db_url.startswith("postgres://")))
        self._lock = threading.Lock()
        self._init_db()

    def _get_connection(self):
        if self._is_postgres:
            import psycopg2
            return psycopg2.connect(self.db_url)
        else:
            conn = sqlite3.connect(self.sqlite_path, timeout=30.0)
            conn.row_factory = sqlite3.Row
            return conn

    def _init_db(self):
        with self._lock:
            conn = self._get_connection()
            try:
                cursor = conn.cursor()
                if self._is_postgres:
                    cursor.execute("""
                        CREATE TABLE IF NOT EXISTS job_outbox (
                            job_id TEXT PRIMARY KEY,
                            payload_hash TEXT NOT NULL,
                            payload_json TEXT NOT NULL,
                            task_id TEXT,
                            status TEXT NOT NULL,
                            retry_count INT DEFAULT 0,
                            last_error TEXT,
                            execution_token TEXT,
                            heartbeat_at TIMESTAMPTZ,
                            lease_expires_at TIMESTAMPTZ,
                            is_refundable BOOLEAN DEFAULT TRUE,
                            result_json TEXT,
                            created_at TIMESTAMPTZ DEFAULT NOW(),
                            dispatched_at TIMESTAMPTZ,
                            updated_at TIMESTAMPTZ DEFAULT NOW()
                        );
                        CREATE INDEX IF NOT EXISTS idx_job_outbox_status ON job_outbox(status);
                    """)
                    cursor.execute("ALTER TABLE job_outbox ADD COLUMN IF NOT EXISTS execution_token TEXT;")
                    cursor.execute("ALTER TABLE job_outbox ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;")
                    cursor.execute("ALTER TABLE job_outbox ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;")
                    cursor.execute("ALTER TABLE job_outbox ADD COLUMN IF NOT EXISTS is_refundable BOOLEAN DEFAULT TRUE;")
                    cursor.execute("ALTER TABLE job_outbox ADD COLUMN IF NOT EXISTS result_json TEXT;")
                else:
                    cursor.executescript("""
                        CREATE TABLE IF NOT EXISTS job_outbox (
                            job_id TEXT PRIMARY KEY,
                            payload_hash TEXT NOT NULL,
                            payload_json TEXT NOT NULL,
                            task_id TEXT,
                            status TEXT NOT NULL,
                            retry_count INTEGER DEFAULT 0,
                            last_error TEXT,
                            execution_token TEXT,
                            heartbeat_at TIMESTAMP,
                            lease_expires_at TIMESTAMP,
                            is_refundable INTEGER DEFAULT 1,
                            result_json TEXT,
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            dispatched_at TIMESTAMP,
                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        );
                        CREATE INDEX IF NOT EXISTS idx_job_outbox_status ON job_outbox(status);
                    """)
                    cursor.execute("PRAGMA table_info(job_outbox)")
                    existing_cols = {col[1] for col in cursor.fetchall()}
                    if "execution_token" not in existing_cols:
                        cursor.execute("ALTER TABLE job_outbox ADD COLUMN execution_token TEXT")
                    if "heartbeat_at" not in existing_cols:
                        cursor.execute("ALTER TABLE job_outbox ADD COLUMN heartbeat_at TIMESTAMP")
                    if "lease_expires_at" not in existing_cols:
                        cursor.execute("ALTER TABLE job_outbox ADD COLUMN lease_expires_at TIMESTAMP")
                    if "is_refundable" not in existing_cols:
                        cursor.execute("ALTER TABLE job_outbox ADD COLUMN is_refundable INTEGER DEFAULT 1")
                    if "result_json" not in existing_cols:
                        cursor.execute("ALTER TABLE job_outbox ADD COLUMN result_json TEXT")
                conn.commit()
            finally:
                conn.close()

    def register_job(
        self,
        job_id: str,
        payload_hash: str,
        payload_json: str
    ) -> Tuple[Optional[Dict[str, Any]], bool, bool]:
        """
        Atomically registers a job in the Outbox.
        Returns: (job_info, is_existing, is_conflict)
        - If existing and payload_hash matches: returns (existing_info, True, False)
        - If existing and payload_hash differs: returns (existing_info, True, True) -> 409 Conflict
        - If cancelled/tombstoned: returns (existing_info, True, False) with is_cancelled=True
        - If new: creates row with status=PENDING_DISPATCH, returns (new_info, False, False)
        """
        with self._lock:
            conn = self._get_connection()
            try:
                cursor = conn.cursor()
                if self._is_postgres:
                    cursor.execute(
                        "SELECT job_id, payload_hash, task_id, status, last_error FROM job_outbox WHERE job_id = %s FOR UPDATE",
                        (job_id,)
                    )
                else:
                    cursor.execute(
                        "SELECT job_id, payload_hash, task_id, status, last_error FROM job_outbox WHERE job_id = ?",
                        (job_id,)
                    )
                row = cursor.fetchone()
                if row:
                    stored_id, stored_hash, task_id, status, last_error = row[0], row[1], row[2], row[3], row[4]
                    is_tombstone_or_cancelled = (status == STATE_CANCELLED or stored_hash == "CANCELLED_TOMBSTONE")
                    job_info = {
                        "job_id": stored_id,
                        "task_id": task_id,
                        "status": status,
                        "last_error": last_error,
                        "is_cancelled": is_tombstone_or_cancelled,
                    }
                    if is_tombstone_or_cancelled:
                        return (job_info, True, False)
                    if stored_hash != payload_hash:
                        return (job_info, True, True)  # 409 Conflict!
                    return (job_info, True, False)  # Idempotent match

                # Insert new PENDING_DISPATCH outbox entry
                if self._is_postgres:
                    cursor.execute("""
                        INSERT INTO job_outbox (job_id, payload_hash, payload_json, status, is_refundable)
                        VALUES (%s, %s, %s, %s, TRUE)
                    """, (job_id, payload_hash, payload_json, STATE_PENDING_DISPATCH))
                else:
                    cursor.execute("""
                        INSERT INTO job_outbox (job_id, payload_hash, payload_json, status, is_refundable)
                        VALUES (?, ?, ?, ?, 1)
                    """, (job_id, payload_hash, payload_json, STATE_PENDING_DISPATCH))
                conn.commit()

                new_info = {
                    "job_id": job_id,
                    "task_id": None,
                    "status": STATE_PENDING_DISPATCH,
                    "last_error": None,
                    "is_cancelled": False,
                }
                return (new_info, False, False)
            finally:
                conn.close()

    def mark_dispatched(self, job_id: str, task_id: str) -> bool:
        """
        Conditional state transition:
        Only updates status to DISPATCHED if current status is NOT EXECUTING, COMPLETED, or CANCELLED.
        This prevents race conditions where worker started fast before publish-state update.
        """
        with self._lock:
            conn = self._get_connection()
            try:
                cursor = conn.cursor()
                if self._is_postgres:
                    cursor.execute("""
                        UPDATE job_outbox
                        SET status = CASE 
                                WHEN status IN ('EXECUTING', 'COMPLETED', 'FAILED', 'CANCELLED') THEN status
                                ELSE 'DISPATCHED'
                            END,
                            task_id = COALESCE(task_id, %s),
                            dispatched_at = COALESCE(dispatched_at, NOW()),
                            updated_at = NOW()
                        WHERE job_id = %s
                    """, (task_id, job_id))
                else:
                    cursor.execute("""
                        UPDATE job_outbox
                        SET status = CASE 
                                WHEN status IN ('EXECUTING', 'COMPLETED', 'FAILED', 'CANCELLED') THEN status
                                ELSE 'DISPATCHED'
                            END,
                            task_id = COALESCE(task_id, ?),
                            dispatched_at = COALESCE(dispatched_at, CURRENT_TIMESTAMP),
                            updated_at = CURRENT_TIMESTAMP
                        WHERE job_id = ?
                    """, (task_id, job_id))
                conn.commit()
                return cursor.rowcount > 0
            finally:
                conn.close()

    def mark_dispatch_failed(self, job_id: str, error: str) -> bool:
        """
        Conditional transition: Never overwrite if job already started executing or completed.
        """
        with self._lock:
            conn = self._get_connection()
            try:
                cursor = conn.cursor()
                if self._is_postgres:
                    cursor.execute("""
                        UPDATE job_outbox
                        SET status = CASE 
                                WHEN status IN ('EXECUTING', 'COMPLETED', 'CANCELLED') THEN status
                                ELSE 'DISPATCH_FAILED'
                            END,
                            last_error = %s,
                            updated_at = NOW()
                        WHERE job_id = %s
                    """, (error, job_id))
                else:
                    cursor.execute("""
                        UPDATE job_outbox
                        SET status = CASE 
                                WHEN status IN ('EXECUTING', 'COMPLETED', 'CANCELLED') THEN status
                                ELSE 'DISPATCH_FAILED'
                            END,
                            last_error = ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE job_id = ?
                    """, (error, job_id))
                conn.commit()
                return cursor.rowcount > 0
            finally:
                conn.close()

    def mark_dispatch_uncertain(self, job_id: str, error: str) -> bool:
        """
        Conditional transition: Never overwrite if job already started executing or completed.
        """
        with self._lock:
            conn = self._get_connection()
            try:
                cursor = conn.cursor()
                if self._is_postgres:
                    cursor.execute("""
                        UPDATE job_outbox
                        SET status = CASE 
                                WHEN status IN ('EXECUTING', 'COMPLETED', 'CANCELLED') THEN status
                                ELSE 'DISPATCH_UNCERTAIN'
                            END,
                            last_error = %s,
                            updated_at = NOW()
                        WHERE job_id = %s
                    """, (error, job_id))
                else:
                    cursor.execute("""
                        UPDATE job_outbox
                        SET status = CASE 
                                WHEN status IN ('EXECUTING', 'COMPLETED', 'CANCELLED') THEN status
                                ELSE 'DISPATCH_UNCERTAIN'
                            END,
                            last_error = ?,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE job_id = ?
                    """, (error, job_id))
                conn.commit()
                return cursor.rowcount > 0
            finally:
                conn.close()

    def claim_worker_execution(self, job_id: str, lease_seconds: int = 600, allow_crashed_recovery: bool = False) -> Tuple[bool, Optional[str]]:
        """
        Worker-side execution deduplication with execution-owner token:
        1. If status is CANCELLED: returns (False, None) (job was fenced/refunded; worker must NOT execute!).
        2. If status is COMPLETED: returns (False, None) (already finished).
        3. If status is EXECUTING or PUBLISHING:
           - Lease expiry alone is NOT proof of worker crash (long AI jobs run legitimately).
           - Do not blindly reclaim active workers! Duplicate execution refused unless allow_crashed_recovery=True and heartbeat expired.
        4. If status is DISPATCHED, PENDING_DISPATCH, FAILED, or PENDING_PUBLISH:
           - Claims execution lease, creates cryptographically random execution_token.
           - Sets status to EXECUTING, records token and heartbeat.
           - Returns (True, execution_token).
        """
        token = f"tok_{uuid.uuid4().hex}"
        with self._lock:
            conn = self._get_connection()
            try:
                cursor = conn.cursor()
                if self._is_postgres:
                    cursor.execute("SELECT status, execution_token, heartbeat_at FROM job_outbox WHERE job_id = %s FOR UPDATE", (job_id,))
                else:
                    cursor.execute("SELECT status, execution_token, heartbeat_at FROM job_outbox WHERE job_id = ?", (job_id,))
                row = cursor.fetchone()
                if not row:
                    return (False, None)
                status, existing_token, heartbeat_raw = row[0], row[1], row[2]

                # If job was cancelled or fenced before refund, worker must abort immediately
                if status == STATE_CANCELLED:
                    logger.warning(f"[Outbox] Job {job_id} is CANCELLED/FENCED. Worker aborting execution.")
                    return (False, None)

                if status == STATE_COMPLETED:
                    return (False, None)  # Already finished

                # If status is EXECUTING or PUBLISHING:
                if status in (STATE_EXECUTING, STATE_PUBLISHING):
                    if not allow_crashed_recovery:
                        # Lease expiry alone is NOT proof of worker crash (long AI jobs run legitimately).
                        # Do NOT blindly reclaim active workers!
                        logger.warning(f"[Outbox] Job {job_id} is currently {status}. Duplicate/second execution refused.")
                        return (False, None)

                    # When recovery is requested, check heartbeat liveness:
                    heartbeat_dt = _parse_timestamp(heartbeat_raw)
                    now_utc = datetime.now(timezone.utc)
                    is_active = (heartbeat_dt is not None) and ((now_utc - heartbeat_dt).total_seconds() < lease_seconds)
                    if is_active:
                        elapsed = (now_utc - heartbeat_dt).total_seconds()
                        logger.warning(
                            f"[Outbox] Job {job_id} is currently {status} with active worker heartbeat "
                            f"({elapsed:.1f}s ago < {lease_seconds}s). Duplicate execution refused."
                        )
                        return (False, None)
                    logger.info(
                        f"[Outbox] Job {job_id} was {status} but worker heartbeat expired. "
                        f"Reclaiming execution lease for crashed worker recovery."
                    )

                # Claim execution lease with unique owner token
                if self._is_postgres:
                    cursor.execute("""
                        UPDATE job_outbox
                        SET status = %s,
                            execution_token = %s,
                            heartbeat_at = NOW(),
                            updated_at = NOW()
                        WHERE job_id = %s AND (
                            status IN ('DISPATCHED', 'PENDING_DISPATCH', 'FAILED', 'PENDING_PUBLISH')
                            OR (status IN ('EXECUTING', 'PUBLISHING') AND (heartbeat_at IS NULL OR heartbeat_at < NOW() - INTERVAL '%s second'))
                        )
                    """, (STATE_EXECUTING, token, job_id, lease_seconds))
                else:
                    cursor.execute("""
                        UPDATE job_outbox
                        SET status = ?,
                            execution_token = ?,
                            heartbeat_at = CURRENT_TIMESTAMP,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE job_id = ?
                    """, (STATE_EXECUTING, token, job_id))
                conn.commit()
                if cursor.rowcount > 0:
                    return (True, token)
                return (False, None)
            finally:
                conn.close()

    def recover_crashed_worker(self, job_id: str, lease_seconds: int = 600) -> Tuple[bool, Optional[str]]:
        """
        Explicit recovery for crashed workers and exhausted retries:
        Does not blindly reclaim active workers. Checks heartbeat liveness first.
        """
        return self.claim_worker_execution(job_id, lease_seconds=lease_seconds, allow_crashed_recovery=True)

    def heartbeat_execution(self, job_id: str, execution_token: str) -> bool:
        """
        Worker pulses heartbeat to prove it is still alive and extend its lease.
        Fails if job was cancelled or execution token does not match.
        """
        with self._lock:
            conn = self._get_connection()
            try:
                cursor = conn.cursor()
                if self._is_postgres:
                    cursor.execute("""
                        UPDATE job_outbox
                        SET heartbeat_at = NOW(), updated_at = NOW()
                        WHERE job_id = %s AND execution_token = %s AND status IN (%s, %s)
                    """, (job_id, execution_token, STATE_EXECUTING, STATE_PUBLISHING))
                else:
                    cursor.execute("""
                        UPDATE job_outbox
                        SET heartbeat_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                        WHERE job_id = ? AND execution_token = ? AND status IN (?, ?)
                    """, (job_id, execution_token, STATE_EXECUTING, STATE_PUBLISHING))
                conn.commit()
                return cursor.rowcount > 0
            finally:
                conn.close()

    def save_generated_result(self, job_id: str, execution_token: str, result: Dict[str, Any]) -> bool:
        """
        Persists generated AI estimate result durably in the outbox before saving to Supabase.
        Guarantees that publication can be retried without rerunning AI.
        Requires status == EXECUTING and matching execution_token.
        """
        result_json = json.dumps(result)
        with self._lock:
            conn = self._get_connection()
            try:
                cursor = conn.cursor()
                if self._is_postgres:
                    cursor.execute("""
                        UPDATE job_outbox
                        SET result_json = %s, updated_at = NOW()
                        WHERE job_id = %s AND execution_token = %s AND status = %s
                    """, (result_json, job_id, execution_token, STATE_EXECUTING))
                else:
                    cursor.execute("""
                        UPDATE job_outbox
                        SET result_json = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE job_id = ? AND execution_token = ? AND status = ?
                    """, (result_json, job_id, execution_token, STATE_EXECUTING))
                conn.commit()
                return cursor.rowcount > 0
            finally:
                conn.close()

    def get_generated_result(self, job_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieves pre-generated AI estimate result from outbox if previously persisted.
        """
        with self._lock:
            conn = self._get_connection()
            try:
                cursor = conn.cursor()
                if self._is_postgres:
                    cursor.execute("SELECT result_json FROM job_outbox WHERE job_id = %s", (job_id,))
                else:
                    cursor.execute("SELECT result_json FROM job_outbox WHERE job_id = ?", (job_id,))
                row = cursor.fetchone()
                if row and row[0]:
                    try:
                        return json.loads(row[0])
                    except Exception:
                        return None
                return None
            finally:
                conn.close()

    def fence_or_cancel_job(self, job_id: str, reason: str = "Refunded by client") -> Tuple[bool, str, Optional[str]]:
        """
        Atomically cancels/fences a job so that:
        1. Missing job: atomically inserts durable CANCELLED tombstone so late requests are rejected.
           Guarantees ON CONFLICT cannot overwrite a concurrently EXECUTING or COMPLETED job and authorize refund.
        2. EXECUTING job: marks CANCELLED and is_refundable = FALSE. Returns can_refund = False.
           Repeated calls durably preserve can_refund = False across retries.
        3. COMPLETED job: returns can_refund = False.
        4. Unexecuted/dispatched job: atomically fences to CANCELLED and is_refundable = TRUE. Returns can_refund = True.
        Returns: (can_refund, current_state, task_id)
        """
        with self._lock:
            conn = self._get_connection()
            try:
                cursor = conn.cursor()
                if self._is_postgres:
                    cursor.execute("SELECT status, task_id, is_refundable FROM job_outbox WHERE job_id = %s FOR UPDATE", (job_id,))
                else:
                    cursor.execute("SELECT status, task_id, is_refundable FROM job_outbox WHERE job_id = ?", (job_id,))
                row = cursor.fetchone()
                if not row:
                    # Missing job: insert durable CANCELLED tombstone
                    # Must ensure ON CONFLICT cannot overwrite concurrently EXECUTING or COMPLETED job
                    if self._is_postgres:
                        cursor.execute("""
                            INSERT INTO job_outbox (job_id, payload_hash, payload_json, status, last_error, is_refundable, updated_at)
                            VALUES (%s, 'CANCELLED_TOMBSTONE', '{}', 'CANCELLED', %s, TRUE, NOW())
                            ON CONFLICT (job_id) DO UPDATE
                            SET status = CASE 
                                    WHEN job_outbox.status IN ('EXECUTING', 'PUBLISHING', 'PENDING_PUBLISH', 'COMPLETED') THEN job_outbox.status
                                    ELSE 'CANCELLED'
                                END,
                                is_refundable = CASE 
                                    WHEN job_outbox.status IN ('EXECUTING', 'PUBLISHING', 'PENDING_PUBLISH', 'COMPLETED') THEN FALSE
                                    ELSE job_outbox.is_refundable
                                END,
                                last_error = CASE 
                                    WHEN job_outbox.status IN ('EXECUTING', 'PUBLISHING', 'COMPLETED') THEN job_outbox.last_error
                                    ELSE %s
                                END,
                                updated_at = NOW()
                            RETURNING status, task_id, is_refundable;
                        """, (job_id, reason, reason))
                        res_row = cursor.fetchone()
                        conn.commit()
                        ret_status, ret_task_id, ret_refundable = res_row[0], res_row[1], bool(res_row[2])
                        if ret_status in (STATE_COMPLETED, STATE_EXECUTING, STATE_PUBLISHING, STATE_PENDING_PUBLISH):
                            return (False, ret_status, ret_task_id)
                        return (ret_refundable, STATE_CANCELLED, ret_task_id)
                    else:
                        try:
                            cursor.execute("""
                                INSERT INTO job_outbox (job_id, payload_hash, payload_json, status, last_error, is_refundable, updated_at)
                                VALUES (?, 'CANCELLED_TOMBSTONE', '{}', 'CANCELLED', ?, 1, CURRENT_TIMESTAMP)
                            """, (job_id, reason))
                            conn.commit()
                            return (True, STATE_CANCELLED, None)
                        except sqlite3.IntegrityError:
                            # Concurrent insert occurred! Fetch the concurrent row:
                            cursor.execute("SELECT status, task_id, is_refundable FROM job_outbox WHERE job_id = ?", (job_id,))
                            row = cursor.fetchone()
                            if not row:
                                return (False, "UNKNOWN", None)

                status, task_id = row[0], row[1]
                is_refundable = bool(row[2]) if row[2] is not None else True

                # COMPLETED jobs cannot be cancelled or refunded!
                if status == STATE_COMPLETED:
                    return (False, STATE_COMPLETED, task_id)

                # If already CANCELLED, durably preserve the existing is_refundable decision across retries!
                if status == STATE_CANCELLED:
                    return (is_refundable, STATE_CANCELLED, task_id)

                # Requirement 1: Once publication ownership is acquired, cancellation must preserve
                # PUBLISHING and return can_refund=false while external write may be in flight.
                if status == STATE_PUBLISHING:
                    logger.warning(f"[Outbox] Job {job_id} is PUBLISHING (external write may be in-flight). Preserving PUBLISHING and non-refundable.")
                    if self._is_postgres:
                        cursor.execute("""
                            UPDATE job_outbox
                            SET is_refundable = FALSE, last_error = %s, updated_at = NOW()
                            WHERE job_id = %s AND status = %s
                        """, (reason, job_id, STATE_PUBLISHING))
                    else:
                        cursor.execute("""
                            UPDATE job_outbox
                            SET is_refundable = 0, last_error = ?, updated_at = CURRENT_TIMESTAMP
                            WHERE job_id = ? AND status = ?
                        """, (reason, job_id, STATE_PUBLISHING))
                    conn.commit()
                    return (False, STATE_PUBLISHING, task_id)

                # Active execution is NON-REFUNDABLE!
                if status == STATE_EXECUTING:
                    logger.warning(f"[Outbox] Job {job_id} is EXECUTING. Marking CANCELLED and non-refundable.")
                    if self._is_postgres:
                        cursor.execute("""
                            UPDATE job_outbox
                            SET status = %s, is_refundable = FALSE, last_error = %s, updated_at = NOW()
                            WHERE job_id = %s
                        """, (STATE_CANCELLED, reason, job_id))
                    else:
                        cursor.execute("""
                            UPDATE job_outbox
                            SET status = ?, is_refundable = 0, last_error = ?, updated_at = CURRENT_TIMESTAMP
                            WHERE job_id = ?
                        """, (STATE_CANCELLED, reason, job_id))
                    conn.commit()
                    return (False, STATE_CANCELLED, task_id)

                # Requirement 2: Publication recovery:
                # Fencing PENDING_PUBLISH must preserve recoverable publication state (PENDING_PUBLISH)
                # while outcome is unresolved, rather than cancelling and preventing publication retry.
                if status == STATE_PENDING_PUBLISH:
                    logger.warning(f"[Outbox] Job {job_id} is PENDING_PUBLISH (publication outcome unresolved). Preserving recoverable state and non-refundable.")
                    if self._is_postgres:
                        cursor.execute("""
                            UPDATE job_outbox
                            SET is_refundable = FALSE, last_error = %s, updated_at = NOW()
                            WHERE job_id = %s AND status = %s
                        """, (reason, job_id, STATE_PENDING_PUBLISH))
                    else:
                        cursor.execute("""
                            UPDATE job_outbox
                            SET is_refundable = 0, last_error = ?, updated_at = CURRENT_TIMESTAMP
                            WHERE job_id = ? AND status = ?
                        """, (reason, job_id, STATE_PENDING_PUBLISH))
                    conn.commit()
                    return (False, STATE_PENDING_PUBLISH, task_id)

                # For unexecuted jobs (DISPATCHED, PENDING_DISPATCH, DISPATCH_FAILED, DISPATCH_UNCERTAIN):
                can_refund_val = False if is_refundable is False else True
                if self._is_postgres:
                    cursor.execute("""
                        UPDATE job_outbox
                        SET status = %s, is_refundable = %s, last_error = %s, updated_at = NOW()
                        WHERE job_id = %s
                    """, (STATE_CANCELLED, can_refund_val, reason, job_id))
                else:
                    cursor.execute("""
                        UPDATE job_outbox
                        SET status = ?, is_refundable = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE job_id = ?
                    """, (STATE_CANCELLED, 1 if can_refund_val else 0, reason, job_id))
                conn.commit()
                return (can_refund_val, STATE_CANCELLED, task_id)
            finally:
                conn.close()

    def claim_publication_ownership(self, job_id: str, execution_token: str) -> bool:
        """
        Coordinates publication and cancellation:
        Ensures that only an active, non-cancelled worker holding the valid execution_token
        can proceed to write the final estimate result to Supabase.
        Transitions status: EXECUTING -> PUBLISHING.
        If the job was cancelled or fenced, returns False, preventing any write of 'done' to Supabase.
        """
        with self._lock:
            conn = self._get_connection()
            try:
                cursor = conn.cursor()
                if self._is_postgres:
                    cursor.execute("""
                        UPDATE job_outbox
                        SET status = %s, updated_at = NOW()
                        WHERE job_id = %s AND execution_token = %s AND status = %s
                    """, (STATE_PUBLISHING, job_id, execution_token, STATE_EXECUTING))
                else:
                    cursor.execute("""
                        UPDATE job_outbox
                        SET status = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE job_id = ? AND execution_token = ? AND status = ?
                    """, (STATE_PUBLISHING, job_id, execution_token, STATE_EXECUTING))
                conn.commit()
                return cursor.rowcount > 0
            finally:
                conn.close()

    def release_publication_claim(self, job_id: str, execution_token: str, error_msg: str) -> bool:
        """
        Called when Supabase publication fails with a network or server error (e.g. timeout).
        A timeout may mean the write already committed externally.
        Preserves a durable non-refundable publication/unknown-outcome flag (is_refundable = FALSE)
        so that subsequent cancellation attempts cannot authorize a refund while the outcome is unknown.
        Transitions status: PUBLISHING -> PENDING_PUBLISH.
        """
        with self._lock:
            conn = self._get_connection()
            try:
                cursor = conn.cursor()
                if self._is_postgres:
                    cursor.execute("""
                        UPDATE job_outbox
                        SET status = %s, is_refundable = FALSE, last_error = %s, updated_at = NOW()
                        WHERE job_id = %s AND execution_token = %s AND status = %s
                    """, (STATE_PENDING_PUBLISH, error_msg, job_id, execution_token, STATE_PUBLISHING))
                else:
                    cursor.execute("""
                        UPDATE job_outbox
                        SET status = ?, is_refundable = 0, last_error = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE job_id = ? AND execution_token = ? AND status = ?
                    """, (STATE_PENDING_PUBLISH, error_msg, job_id, execution_token, STATE_PUBLISHING))
                conn.commit()
                return cursor.rowcount > 0
            finally:
                conn.close()

    def mark_worker_completed(self, job_id: str, execution_token: Optional[str] = None) -> bool:
        """
        Conditional completion:
        Requires status == EXECUTING and matching execution_token (if provided).
        If job was cancelled or token is stale, returns False (stale worker completion rejected).
        """
        with self._lock:
            conn = self._get_connection()
            try:
                cursor = conn.cursor()
                if execution_token:
                    if self._is_postgres:
                        cursor.execute("""
                            UPDATE job_outbox
                            SET status = %s, updated_at = NOW()
                            WHERE job_id = %s AND execution_token = %s AND status IN (%s, %s)
                        """, (STATE_COMPLETED, job_id, execution_token, STATE_PUBLISHING, STATE_EXECUTING))
                    else:
                        cursor.execute("""
                            UPDATE job_outbox
                            SET status = ?, updated_at = CURRENT_TIMESTAMP
                            WHERE job_id = ? AND execution_token = ? AND status IN (?, ?)
                        """, (STATE_COMPLETED, job_id, execution_token, STATE_PUBLISHING, STATE_EXECUTING))
                else:
                    if self._is_postgres:
                        cursor.execute("""
                            UPDATE job_outbox
                            SET status = %s, updated_at = NOW()
                            WHERE job_id = %s AND status IN (%s, %s)
                        """, (STATE_COMPLETED, job_id, STATE_PUBLISHING, STATE_EXECUTING))
                    else:
                        cursor.execute("""
                            UPDATE job_outbox
                            SET status = ?, updated_at = CURRENT_TIMESTAMP
                            WHERE job_id = ? AND status IN (?, ?)
                        """, (STATE_COMPLETED, job_id, STATE_PUBLISHING, STATE_EXECUTING))
                conn.commit()
                return cursor.rowcount > 0
            finally:
                conn.close()

    def mark_worker_failed(self, job_id: str, error: str, execution_token: Optional[str] = None) -> bool:
        """
        Conditional failure transition.
        Requires status == EXECUTING and matching execution_token (if provided).
        """
        with self._lock:
            conn = self._get_connection()
            try:
                cursor = conn.cursor()
                if execution_token:
                    if self._is_postgres:
                        cursor.execute("""
                            UPDATE job_outbox
                            SET status = %s, last_error = %s, updated_at = NOW()
                            WHERE job_id = %s AND execution_token = %s AND status IN (%s, %s)
                        """, (STATE_FAILED, error, job_id, execution_token, STATE_EXECUTING, STATE_PUBLISHING))
                    else:
                        cursor.execute("""
                            UPDATE job_outbox
                            SET status = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP
                            WHERE job_id = ? AND execution_token = ? AND status IN (?, ?)
                        """, (STATE_FAILED, error, job_id, execution_token, STATE_EXECUTING, STATE_PUBLISHING))
                else:
                    if self._is_postgres:
                        cursor.execute("""
                            UPDATE job_outbox
                            SET status = %s, last_error = %s, updated_at = NOW()
                            WHERE job_id = %s AND status IN (%s, %s)
                        """, (STATE_FAILED, error, job_id, STATE_EXECUTING, STATE_PUBLISHING))
                    else:
                        cursor.execute("""
                            UPDATE job_outbox
                            SET status = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP
                            WHERE job_id = ? AND status IN (?, ?)
                        """, (STATE_FAILED, error, job_id, STATE_EXECUTING, STATE_PUBLISHING))
                conn.commit()
                return cursor.rowcount > 0
            finally:
                conn.close()

    def get_job_info(self, job_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            conn = self._get_connection()
            try:
                cursor = conn.cursor()
                if self._is_postgres:
                    cursor.execute(
                        "SELECT job_id, payload_hash, payload_json, task_id, status, last_error, created_at, dispatched_at, updated_at, execution_token, is_refundable, result_json FROM job_outbox WHERE job_id = %s",
                        (job_id,)
                    )
                else:
                    cursor.execute(
                        "SELECT job_id, payload_hash, payload_json, task_id, status, last_error, created_at, dispatched_at, updated_at, execution_token, is_refundable, result_json FROM job_outbox WHERE job_id = ?",
                        (job_id,)
                    )
                row = cursor.fetchone()
                if row:
                    return {
                        "job_id": row[0],
                        "payload_hash": row[1],
                        "payload_json": row[2],
                        "task_id": row[3],
                        "status": row[4],
                        "last_error": row[5],
                        "created_at": str(row[6]),
                        "dispatched_at": str(row[7]) if row[7] else None,
                        "updated_at": str(row[8]) if row[8] else None,
                        "execution_token": row[9] if len(row) > 9 else None,
                        "is_refundable": bool(row[10]) if len(row) > 10 and row[10] is not None else True,
                        "result_json": row[11] if len(row) > 11 else None,
                    }
                return None
            finally:
                conn.close()

    def resolve_or_recover_publication(self, job_id: str, supabase_client: Any = None) -> Tuple[bool, str, Optional[dict]]:
        """
        Publication recovery:
        1. Checks if a committed-but-timed-out write succeeded in Supabase (status == 'done' with detail).
           If so, transitions outbox to COMPLETED immediately.
        2. If not yet done in Supabase, but result_json was saved in outbox, publishes the saved
           result directly to Supabase without rerunning AI (0 Anthropic API calls).
           Upon confirmed Supabase persistence, transitions outbox to COMPLETED.
        Returns: (success, resolution_status, result_data)
        """
        with self._lock:
            conn = self._get_connection()
            try:
                cursor = conn.cursor()
                if self._is_postgres:
                    cursor.execute("SELECT status, result_json, task_id FROM job_outbox WHERE job_id = %s FOR UPDATE", (job_id,))
                else:
                    cursor.execute("SELECT status, result_json, task_id FROM job_outbox WHERE job_id = ?", (job_id,))
                row = cursor.fetchone()
                if not row:
                    return (False, "NOT_FOUND", None)
                status, result_json_raw, task_id = row[0], row[1], row[2]
                
                result_data = None
                if result_json_raw:
                    try:
                        result_data = json.loads(result_json_raw) if isinstance(result_json_raw, str) else result_json_raw
                    except Exception:
                        pass

                if status == STATE_COMPLETED:
                    return (True, "ALREADY_COMPLETED", result_data)

                if status == STATE_CANCELLED:
                    return (False, "CANCELLED", None)

                if not supabase_client:
                    return (False, "SUPABASE_UNAVAILABLE", result_data)

                # Check if write was already committed to Supabase (e.g. timeout on worker response)
                try:
                    s_res = supabase_client.table("pdf_jobs").select("status, detail").eq("id", job_id).execute()
                    s_data = getattr(s_res, "data", None) or (s_res.get("data") if isinstance(s_res, dict) else None) or []
                    if s_data and s_data[0].get("status") == "done" and s_data[0].get("detail"):
                        logger.info(f"[Outbox Recovery] Confirmed Supabase already committed 'done' for job {job_id}. Marking COMPLETED.")
                        if self._is_postgres:
                            cursor.execute("UPDATE job_outbox SET status = %s, updated_at = NOW() WHERE job_id = %s", (STATE_COMPLETED, job_id))
                        else:
                            cursor.execute("UPDATE job_outbox SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE job_id = ?", (STATE_COMPLETED, job_id))
                        conn.commit()
                        return (True, "COMMITTED_WRITE_RESOLVED", s_data[0]["detail"])
                except Exception as e:
                    logger.warning(f"[Outbox Recovery] Supabase check query failed for {job_id}: {e}")

                # If Supabase not yet done, but we have the saved result: publish without rerunning AI
                if result_data:
                    try:
                        up_res = supabase_client.table("pdf_jobs").update({
                            "status": "done",
                            "message": "Success (recovered)",
                            "detail": result_data
                        }).eq("id", job_id).neq("status", "cancelled").execute()

                        updated = getattr(up_res, "data", None) or (up_res.get("data") if isinstance(up_res, dict) else None) or []
                        if updated:
                            logger.info(f"[Outbox Recovery] Successfully published saved result to Supabase for job {job_id} without rerunning AI. Marking COMPLETED.")
                            if self._is_postgres:
                                cursor.execute("UPDATE job_outbox SET status = %s, updated_at = NOW() WHERE job_id = %s", (STATE_COMPLETED, job_id))
                            else:
                                cursor.execute("UPDATE job_outbox SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE job_id = ?", (STATE_COMPLETED, job_id))
                            conn.commit()
                            return (True, "SAVED_RESULT_PUBLISHED", result_data)
                    except Exception as pub_err:
                        logger.error(f"[Outbox Recovery] Failed to publish saved result for {job_id}: {pub_err}")

                return (False, status, result_data)
            finally:
                conn.close()

    def recover_pending_publications(self, supabase_client: Any) -> List[Dict[str, Any]]:
        """
        Sweeper for jobs in PENDING_PUBLISH state to resolve committed writes or publish saved results.
        """
        recovered = []
        with self._lock:
            conn = self._get_connection()
            try:
                cursor = conn.cursor()
                if self._is_postgres:
                    cursor.execute("SELECT job_id FROM job_outbox WHERE status = 'PENDING_PUBLISH'")
                else:
                    cursor.execute("SELECT job_id FROM job_outbox WHERE status = 'PENDING_PUBLISH'")
                rows = cursor.fetchall()
            finally:
                conn.close()

        for r in rows:
            jid = r[0]
            ok, res_type, _ = self.resolve_or_recover_publication(jid, supabase_client)
            if ok:
                recovered.append({"job_id": jid, "resolution": res_type})
        return recovered

    def get_pending_dispatches(self) -> List[Dict[str, Any]]:
        """Used by outbox recovery process to sweep un-dispatched jobs after crash."""
        with self._lock:
            conn = self._get_connection()
            try:
                cursor = conn.cursor()
                # Never sweep CANCELLED, COMPLETED, or EXECUTING jobs
                if self._is_postgres:
                    cursor.execute(
                        "SELECT job_id, payload_hash, payload_json, status FROM job_outbox WHERE status IN (%s, %s)",
                        (STATE_PENDING_DISPATCH, STATE_DISPATCH_UNCERTAIN)
                    )
                else:
                    cursor.execute(
                        "SELECT job_id, payload_hash, payload_json, status FROM job_outbox WHERE status IN (?, ?)",
                        (STATE_PENDING_DISPATCH, STATE_DISPATCH_UNCERTAIN)
                    )
                rows = cursor.fetchall()
                results = []
                for r in rows:
                    results.append({
                        "job_id": r[0],
                        "payload_hash": r[1],
                        "payload_json": r[2],
                        "status": r[3]
                    })
                return results
            finally:
                conn.close()

    def wait_for_dispatch(self, job_id: str, timeout: float = 5.0) -> Optional[Dict[str, Any]]:
        """Waits for an in-flight concurrent dispatch of the same job_id to complete."""
        start = time.time()
        while time.time() - start < timeout:
            info = self.get_job_info(job_id)
            if info and info.get("status") in (
                STATE_DISPATCHED,
                STATE_EXECUTING,
                STATE_COMPLETED,
                STATE_DISPATCH_FAILED,
                STATE_DISPATCH_UNCERTAIN,
                STATE_CANCELLED
            ):
                return info
            time.sleep(0.02)
        return self.get_job_info(job_id)

    def clear(self):
        with self._lock:
            conn = self._get_connection()
            try:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM job_outbox")
                conn.commit()
            finally:
                conn.close()


# Global instance initialized from configuration
idempotency_store = TransactionalOutboxStore()
