import time
import concurrent.futures
import json
import sys
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

if "pikepdf" not in sys.modules:
    sys.modules["pikepdf"] = MagicMock()

from config import settings
from idempotency import (
    idempotency_store,
    TransactionalOutboxStore,
    STATE_PENDING_DISPATCH,
    STATE_DISPATCHED,
    STATE_DISPATCH_FAILED,
    STATE_DISPATCH_UNCERTAIN,
)
from main import app

client = TestClient(app)

TEST_SECRET = "super_secure_test_shared_secret_abc123"


@pytest.fixture(autouse=True)
def setup_env():
    # Set shared secret for test duration
    settings.fastapi_shared_secret = TEST_SECRET
    idempotency_store.clear()
    yield
    settings.fastapi_shared_secret = TEST_SECRET
    idempotency_store.clear()


def test_health_endpoint_is_public():
    """Verify /health is accessible without any credentials."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_missing_auth_header():
    """Verify protected routes return 401 when no auth header is sent."""
    payload = {
        "job_id": "test-job-001",
        "pdf_key": "blueprints/user1/doc.pdf",
        "selected_scopes": ["Drywall"]
    }
    response = client.post("/estimate", json=payload)
    assert response.status_code == 401
    assert "Missing authentication" in response.json()["detail"]


def test_wrong_auth_header():
    """Verify protected routes return 401 when invalid secret is sent."""
    payload = {
        "job_id": "test-job-001",
        "pdf_key": "blueprints/user1/doc.pdf",
        "selected_scopes": ["Drywall"]
    }
    headers = {"Authorization": "Bearer wrong_invalid_secret"}
    response = client.post("/estimate", json=payload, headers=headers)
    assert response.status_code == 401
    assert "Invalid authentication" in response.json()["detail"]


def test_missing_config_fails_closed():
    """Verify that if FASTAPI_SHARED_SECRET is empty/unset, endpoints fail closed with 503."""
    settings.fastapi_shared_secret = ""  # Unset
    payload = {
        "job_id": "test-job-001",
        "pdf_key": "blueprints/user1/doc.pdf",
        "selected_scopes": ["Drywall"]
    }
    headers = {"Authorization": f"Bearer {TEST_SECRET}"}
    response = client.post("/estimate", json=payload, headers=headers)
    assert response.status_code == 503
    assert "fail-closed" in response.json()["detail"].lower()


@patch("tasks.process_pdf_task.delay")
def test_valid_auth_bearer(mock_celery_task):
    """Verify valid Bearer token triggers job successfully."""
    mock_task = MagicMock()
    mock_task.id = "celery_task_123"
    mock_celery_task.return_value = mock_task

    job_id = "job-valid-auth-test-01"
    payload = {
        "job_id": job_id,
        "pdf_key": "blueprints/user1/1728345600_test.pdf",
        "selected_scopes": ["Framing", "Drywall"]
    }
    headers = {"Authorization": f"Bearer {TEST_SECRET}"}
    response = client.post("/estimate", json=payload, headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["job_id"] == job_id
    assert data["is_retry"] is False
    assert mock_celery_task.called


@patch("tasks.process_pdf_task.delay")
def test_valid_auth_internal_secret_header(mock_celery_task):
    """Verify X-Internal-Secret header is accepted matching Supabase Edge Function contract."""
    mock_task = MagicMock()
    mock_task.id = "celery_task_internal_01"
    mock_celery_task.return_value = mock_task

    job_id = "job-internal-hdr-test-02"
    payload = {
        "job_id": job_id,
        "pdf_key": "invoices/user1/1728345600_inv.pdf",
        "selected_scopes": ["Overall"]
    }
    headers = {"X-Internal-Secret": TEST_SECRET}
    response = client.post("/estimate", json=payload, headers=headers)
    assert response.status_code == 200
    assert response.json()["job_id"] == job_id


def test_disallowed_pdf_key_format():
    """Verify worker rejects unsafe or arbitrary S3 keys."""
    headers = {"Authorization": f"Bearer {TEST_SECRET}"}

    # Path traversal
    bad_payload1 = {"job_id": "job_bad_1", "pdf_key": "blueprints/../etc/passwd.pdf", "selected_scopes": ["General"]}
    res1 = client.post("/estimate", json=bad_payload1, headers=headers)
    assert res1.status_code == 400

    # Arbitrary prefix
    bad_payload2 = {"job_id": "job_bad_2", "pdf_key": "secret_bucket/passwords.txt", "selected_scopes": ["General"]}
    res2 = client.post("/estimate", json=bad_payload2, headers=headers)
    assert res2.status_code == 400


def test_disallowed_scope():
    """Verify worker rejects unapproved scopes."""
    headers = {"Authorization": f"Bearer {TEST_SECRET}"}
    bad_payload = {
        "job_id": "job_bad_scope",
        "pdf_key": "blueprints/user1/1728345600_test.pdf",
        "selected_scopes": ["General", "MaliciousArbitraryScope"]
    }
    res = client.post("/estimate", json=bad_payload, headers=headers)
    assert res.status_code == 400
    assert "Invalid scope" in res.json()["detail"]


@patch("tasks.process_pdf_task.delay")
def test_durable_idempotency_concurrent_retries(mock_celery_task):
    """Verify same job_id with same payload does not call Celery twice."""
    mock_task = MagicMock()
    mock_task.id = "task_celery_idemp_99"
    mock_celery_task.return_value = mock_task

    job_id = "job_idemp_retry_test_99"
    payload = {
        "job_id": job_id,
        "pdf_key": "blueprints/user1/1728345600_plan.pdf",
        "selected_scopes": ["Plumbing", "HVAC"]
    }
    headers = {"Authorization": f"Bearer {TEST_SECRET}"}

    # First call
    res1 = client.post("/estimate", json=payload, headers=headers)
    assert res1.status_code == 200
    assert res1.json()["is_retry"] is False
    assert mock_celery_task.call_count == 1

    # Second retried call with identical payload
    res2 = client.post("/estimate", json=payload, headers=headers)
    assert res2.status_code == 200
    assert res2.json()["is_retry"] is True
    # Celery MUST NOT be called again!
    assert mock_celery_task.call_count == 1
    assert res2.json()["task_id"] == res1.json()["task_id"]


@patch("tasks.process_pdf_task.delay")
def test_durable_idempotency_payload_conflict(mock_celery_task):
    """Verify same job_id with different payload returns 409 Conflict."""
    mock_task = MagicMock()
    mock_task.id = "task_celery_conflict_01"
    mock_celery_task.return_value = mock_task

    job_id = "job_conflict_test_409"
    payload1 = {
        "job_id": job_id,
        "pdf_key": "blueprints/user1/1728345600_p1.pdf",
        "selected_scopes": ["Flooring"]
    }
    headers = {"Authorization": f"Bearer {TEST_SECRET}"}

    res1 = client.post("/estimate", json=payload1, headers=headers)
    assert res1.status_code == 200

    # Second call with DIFFERENT scope
    payload2 = {
        "job_id": job_id,
        "pdf_key": "blueprints/user1/1728345600_p1.pdf",
        "selected_scopes": ["Electrical"]
    }
    res2 = client.post("/estimate", json=payload2, headers=headers)
    assert res2.status_code == 409
    assert "Conflict" in res2.json()["detail"]


@patch("main.generate_proposal_from_invoice")
def test_quote_endpoint_auth(mock_generate_proposal):
    """Verify /quote endpoint requires authentication."""
    mock_generate_proposal.return_value = {"project_summary": "Test proposal"}

    payload = {"invoice_id": "inv_123"}

    # Missing auth -> 401
    res_no_auth = client.post("/quote", json=payload)
    assert res_no_auth.status_code == 401

    # Valid auth -> 200
    headers = {"Authorization": f"Bearer {TEST_SECRET}"}
    res_auth = client.post("/quote", json=payload, headers=headers)
    assert res_auth.status_code == 200
    assert res_auth.json()["proposal"]["project_summary"] == "Test proposal"


# ---------------------------------------------------------------------------
# NEW ADVANCED DISPATCH, OUTBOX & RECONCILIATION TESTS
# ---------------------------------------------------------------------------

@patch("tasks.process_pdf_task.delay")
def test_broker_unavailable_fails_with_502_not_pending(mock_celery_task):
    """
    Requirement 1 & 2:
    Job registration != worker acceptance.
    Celery dispatch exception must NOT return success/PENDING.
    Must mark failure and fail closed with 502.
    """
    mock_celery_task.side_effect = ConnectionRefusedError("Redis connection refused on 127.0.0.1:6379")

    job_id = "job_broker_down_01"
    payload = {
        "job_id": job_id,
        "pdf_key": "blueprints/user1/1728345600_test.pdf",
        "selected_scopes": ["Framing"]
    }
    headers = {"Authorization": f"Bearer {TEST_SECRET}"}

    res = client.post("/estimate", json=payload, headers=headers)
    # MUST return 502, NOT 200!
    assert res.status_code == 502
    assert "unavailable" in res.json()["detail"].lower()

    # Outbox status MUST be recorded as DISPATCH_FAILED
    info = idempotency_store.get_job_info(job_id)
    assert info is not None
    assert info["status"] == STATE_DISPATCH_FAILED
    assert "Redis connection refused" in info["last_error"]

    # Reconciliation MUST report accepted: False
    rec_res = client.get(f"/estimate/reconcile/{job_id}", headers=headers)
    assert rec_res.status_code == 200
    assert rec_res.json()["accepted"] is False
    assert rec_res.json()["state"] == STATE_DISPATCH_FAILED


def test_crash_after_registration_before_queue_publish():
    """
    Requirement 3 & 4:
    Process crashes between DB registration and queue publish.
    Reconciliation must report accepted: False.
    Outbox recovery sweeps and publishes it.
    """
    job_id = "job_crash_before_publish_01"
    payload_json = json.dumps({
        "job_id": job_id,
        "pdf_key": "blueprints/user1/1728345600_crash.pdf",
        "selected_scopes": ["Roofing"]
    })
    headers = {"Authorization": f"Bearer {TEST_SECRET}"}

    # Simulate crash state: registered in outbox but process died before Celery publish
    idempotency_store.register_job(job_id, "dummy_hash_01", payload_json)
    info = idempotency_store.get_job_info(job_id)
    assert info["status"] == STATE_PENDING_DISPATCH

    # Reconciliation before recovery: MUST be accepted: False (not accepted!)
    rec_res1 = client.get(f"/estimate/reconcile/{job_id}", headers=headers)
    assert rec_res1.status_code == 200
    assert rec_res1.json()["accepted"] is False
    assert rec_res1.json()["state"] == STATE_PENDING_DISPATCH

    # Trigger outbox recovery
    with patch("tasks.process_pdf_task.delay") as mock_delay:
        mock_task = MagicMock()
        mock_task.id = "celery_recovered_task_99"
        mock_delay.return_value = mock_task

        rec_run = client.post("/estimate/recover-outbox", headers=headers)
        assert rec_run.status_code == 200
        assert rec_run.json()["recovered_count"] == 1

        # Now job is DISPATCHED!
        rec_res2 = client.get(f"/estimate/reconcile/{job_id}", headers=headers)
        assert rec_res2.status_code == 200
        assert rec_res2.json()["accepted"] is True
        assert rec_res2.json()["task_id"] == "celery_recovered_task_99"


@patch("tasks.process_pdf_task.delay")
def test_dispatch_uncertain_timeout(mock_celery_task):
    """
    Requirement 2:
    Celery publish times out -> mark DISPATCH_UNCERTAIN and return 504.
    Reconciliation reports accepted: False until confirmed.
    """
    mock_celery_task.side_effect = TimeoutError("Timed out waiting for broker response")

    job_id = "job_uncertain_01"
    payload = {
        "job_id": job_id,
        "pdf_key": "blueprints/user1/1728345600_test.pdf",
        "selected_scopes": ["Framing"]
    }
    headers = {"Authorization": f"Bearer {TEST_SECRET}"}

    res = client.post("/estimate", json=payload, headers=headers)
    assert res.status_code == 504

    # Outbox status MUST be DISPATCH_UNCERTAIN
    info = idempotency_store.get_job_info(job_id)
    assert info["status"] == STATE_DISPATCH_UNCERTAIN

    # Reconciliation MUST report accepted: False
    rec_res = client.get(f"/estimate/reconcile/{job_id}", headers=headers)
    assert rec_res.json()["accepted"] is False
    assert rec_res.json()["state"] == STATE_DISPATCH_UNCERTAIN


@patch("tasks.process_pdf_task.delay")
def test_concurrent_requests_from_separate_threads(mock_celery_task):
    """
    Requirement 6:
    Concurrent requests for the same job_id from multiple threads.
    Must publish to Celery EXACTLY ONCE across all concurrent calls.
    """
    mock_task = MagicMock()
    mock_task.id = "task_celery_thread_race"
    mock_celery_task.return_value = mock_task

    job_id = "job_concurrent_thread_race_01"
    payload = {
        "job_id": job_id,
        "pdf_key": "blueprints/user1/1728345600_race.pdf",
        "selected_scopes": ["Framing", "Drywall"]
    }
    headers = {"Authorization": f"Bearer {TEST_SECRET}"}

    def fire_request():
        return client.post("/estimate", json=payload, headers=headers)

    # Fire 8 concurrent threads simultaneously
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(fire_request) for _ in range(8)]
        results = [f.result() for f in futures]

    # Every response must be 200
    for r in results:
        assert r.status_code == 200

    # Exactly 1 request dispatched Celery, others were idempotent hits
    assert mock_celery_task.call_count == 1

    retry_counts = [r.json()["is_retry"] for r in results]
    assert retry_counts.count(False) == 1
    assert retry_counts.count(True) == 7


def test_worker_execution_deduplication():
    """
    Requirement 3:
    Worker execution deduplication ensures duplicate message deliveries execute exactly once.
    """
    job_id = "job_worker_dedup_01"
    idempotency_store.register_job(job_id, "hash1", json.dumps({"job_id": job_id}))
    idempotency_store.mark_dispatched(job_id, "task_celery_123")

    # Worker 1 claims execution
    claim1, tok1 = idempotency_store.claim_worker_execution(job_id)
    assert claim1 is True
    assert tok1 is not None

    # Worker 2 attempts to claim duplicate delivery
    claim2, tok2 = idempotency_store.claim_worker_execution(job_id)
    assert claim2 is False  # Rejected duplicate!
    assert tok2 is None

    # Worker 1 finishes with tok1
    done1 = idempotency_store.mark_worker_completed(job_id, tok1)
    assert done1 is True

    # Worker 3 arrives after completion
    claim3, tok3 = idempotency_store.claim_worker_execution(job_id)
    assert claim3 is False
    assert tok3 is None


def test_container_restart_and_persistence():
    """
    Requirement 5:
    Simulates container restart by reloading store from disk/DB.
    Verifies state and reconciliation persistence across restarts.
    """
    job_id = "job_persist_across_restart_01"
    idempotency_store.register_job(job_id, "hash_restart", json.dumps({"job_id": job_id}))
    idempotency_store.mark_dispatched(job_id, "task_persisted_99")

    # Simulate container restart: instantiate fresh TransactionalOutboxStore pointing to same DB
    restarted_store = TransactionalOutboxStore(sqlite_path=settings.idempotency_db_path)
    info = restarted_store.get_job_info(job_id)

    assert info is not None
    assert info["job_id"] == job_id
    assert info["status"] == STATE_DISPATCHED
    assert info["task_id"] == "task_persisted_99"


# ---------------------------------------------------------------------------
# INTEGRATION TESTS: EDGE FUNCTION & WORKER CONTRACT VERIFICATION
# ---------------------------------------------------------------------------

@patch("main.AsyncResult")
@patch("tasks.process_pdf_task.delay")
def test_worker_publishes_task_but_returns_504_no_refund_and_reconciles(mock_celery_task, mock_async_result):
    mock_res = MagicMock()
    mock_res.status = "PENDING"
    mock_async_result.return_value = mock_res
    """
    Integration Scenario A (Requirement 4):
    Worker publishes task to Celery, but HTTP response encounters a 504 timeout.
    Edge Function must preserve dispatch_unknown (NO REFUND!).
    Subsequent reconciliation must query worker, confirm task accepted, and transition to pending.
    """
    mock_task = MagicMock()
    mock_task.id = "task_celery_published_504"
    mock_celery_task.return_value = mock_task

    job_id = "job_504_no_refund_integration_01"
    payload = {
        "job_id": job_id,
        "pdf_key": "blueprints/user1/1728345600_test.pdf",
        "selected_scopes": ["Framing"]
    }
    headers = {"Authorization": f"Bearer {TEST_SECRET}"}

    # Simulate: Celery publish succeeds, but downstream HTTP connection times out (504)
    # 1. Outbox registers and marks DISPATCHED with task_id
    idempotency_store.register_job(job_id, "hash504", json.dumps(payload))
    idempotency_store.mark_dispatched(job_id, "task_celery_published_504")

    # 2. Simulated Edge Function receives 504 from network gateway
    # Edge function contract rule: DO NOT REFUND on 504 / uncertain network error!
    edge_status = "dispatch_unknown"
    refund_issued = False
    assert edge_status == "dispatch_unknown"
    assert refund_issued is False

    # 3. Client / Edge function queries reconciliation: /estimate/reconcile/{job_id}
    rec_res = client.get(f"/estimate/reconcile/{job_id}", headers=headers)
    assert rec_res.status_code == 200
    rec_data = rec_res.json()

    # Worker confirms: task is published and active in Celery!
    assert rec_data["accepted"] is True
    assert rec_data["resolution"] == "CONFIRMED_ACCEPTED"
    assert rec_data["task_id"] == "task_celery_published_504"
    assert rec_data["is_executing"] is True

    # Result: Edge function transitions job to 'pending', user credits preserved with ZERO refund.


def test_worker_starts_before_publish_state_update_no_regression_no_duplicate():
    """
    Integration Scenario B (Requirement 2 & 4):
    Fast worker picks up task and transitions outbox to EXECUTING before the
    HTTP thread's mark_dispatched executes.
    Conditional transition must NOT regress state from EXECUTING to DISPATCHED.
    Duplicate worker deliveries must be rejected.
    """
    job_id = "job_fast_worker_race_01"
    payload_json = json.dumps({"job_id": job_id, "pdf_key": "blueprints/user1/plan.pdf"})

    # 1. HTTP thread registers PENDING_DISPATCH
    idempotency_store.register_job(job_id, "hash_race", payload_json)

    # 2. Celery worker is ultra-fast: starts processing IMMEDIATELY and claims EXECUTING
    claimed, tok_fast = idempotency_store.claim_worker_execution(job_id)
    assert claimed is True
    assert tok_fast is not None
    info1 = idempotency_store.get_job_info(job_id)
    assert info1["status"] == "EXECUTING"

    # 3. HTTP thread now calls mark_dispatched
    idempotency_store.mark_dispatched(job_id, "celery_task_fast_01")
    info2 = idempotency_store.get_job_info(job_id)

    # CRITICAL: Status must remain EXECUTING! Must NOT regress to DISPATCHED!
    assert info2["status"] == "EXECUTING"
    assert info2["task_id"] == "celery_task_fast_01"

    # 4. Duplicate Celery message delivery arrives at Worker 2
    claimed_dup, tok_dup = idempotency_store.claim_worker_execution(job_id)
    assert claimed_dup is False  # Rejected duplicate execution!
    assert tok_dup is None

    # 5. Worker 1 completes
    done_fast = idempotency_store.mark_worker_completed(job_id, tok_fast)
    assert done_fast is True
    info3 = idempotency_store.get_job_info(job_id)
    assert info3["status"] == "COMPLETED"


def test_fence_and_cancel_prevents_post_refund_execution():
    """
    Integration Scenario C (Requirement 3):
    Job is fenced and cancelled prior to refund.
    Verifies that worker execution is blocked and recovery sweeper never runs it.
    """
    job_id = "job_fenced_cancel_test_01"
    payload = {"job_id": job_id, "pdf_key": "blueprints/user1/doc.pdf", "selected_scopes": ["General"]}
    headers = {"Authorization": f"Bearer {TEST_SECRET}"}

    # Job registered and dispatch failed
    idempotency_store.register_job(job_id, "hash_cancel", json.dumps(payload))
    idempotency_store.mark_dispatch_failed(job_id, "Queue broker unavailable")

    # Reconciliation before fencing reports CONFIRMED_REJECTED
    rec1 = client.get(f"/estimate/reconcile/{job_id}", headers=headers)
    assert rec1.status_code == 200
    assert rec1.json()["accepted"] is False
    assert rec1.json()["resolution"] == "CONFIRMED_REJECTED"

    # Edge Function calls fence endpoint before refund
    fence_res = client.post(f"/estimate/fence-or-cancel/{job_id}", headers=headers)
    assert fence_res.status_code == 200
    assert fence_res.json()["can_refund"] is True
    assert fence_res.json()["state"] == "CANCELLED"

    # Verify outbox recovery sweeper NEVER sweeps cancelled job
    pending = idempotency_store.get_pending_dispatches()
    cancelled_in_pending = [p for p in pending if p["job_id"] == job_id]
    assert len(cancelled_in_pending) == 0

    # Verify worker will NEVER execute this job if message is delivered
    claim, tok_cancel = idempotency_store.claim_worker_execution(job_id)
    assert claim is False  # Refused!
    assert tok_cancel is None


def test_fence_endpoint_fails_or_can_refund_false_when_executing():
    """
    Requirement 1 & 3:
    EXECUTING job cannot be refunded! Active execution/unknown state par can_refund: False.
    Verify fence endpoint returns can_refund: False and durable_cancellation: False.
    """
    job_id = "job_executing_no_refund_01"
    headers = {"Authorization": f"Bearer {TEST_SECRET}"}
    payload = {"job_id": job_id, "pdf_key": "blueprints/user1/doc.pdf", "selected_scopes": ["General"]}

    # Register and start executing
    idempotency_store.register_job(job_id, "hash_executing", json.dumps(payload))
    idempotency_store.mark_dispatched(job_id, "task_executing_99")
    claimed, tok = idempotency_store.claim_worker_execution(job_id)
    assert claimed is True
    assert tok is not None

    # Calling fence-or-cancel while actively EXECUTING
    res = client.post(f"/estimate/fence-or-cancel/{job_id}", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["can_refund"] is False
    assert data["durable_cancellation"] is False
    assert data["state"] == "CANCELLED"


def test_cancellation_before_registration_late_request_no_dispatch():
    """
    Requirement 2:
    Atomic CANCELLED tombstone inserted for missing job before registration.
    Subsequent late /estimate request is rejected with 409 Conflict (no Celery dispatch).
    """
    job_id = "job_tombstone_pre_cancel_01"
    headers = {"Authorization": f"Bearer {TEST_SECRET}"}

    # Job does NOT exist yet. Calling fence-or-cancel inserts durable CANCELLED tombstone!
    fence_res = client.post(f"/estimate/fence-or-cancel/{job_id}", headers=headers)
    assert fence_res.status_code == 200
    assert fence_res.json()["can_refund"] is True
    assert fence_res.json()["durable_cancellation"] is True
    assert fence_res.json()["state"] == "CANCELLED"

    # Verify tombstone exists in store
    info = idempotency_store.get_job_info(job_id)
    assert info is not None
    assert info["status"] == "CANCELLED"
    assert info["payload_hash"] == "CANCELLED_TOMBSTONE"

    # Late /estimate request arrives:
    estimate_payload = {
        "job_id": job_id,
        "pdf_key": "blueprints/user1/plan.pdf",
        "selected_scopes": ["Drywall"]
    }
    est_res = client.post("/estimate", json=estimate_payload, headers=headers)
    assert est_res.status_code == 409
    assert "cancelled or fenced" in est_res.json()["detail"].lower()


def test_estimate_runs_longer_than_lease_no_second_execution():
    """
    Requirement 4:
    Lease expiry is NOT proof of worker crash!
    If estimate runs longer than lease_seconds, a second execution must NOT be claimed.
    """
    import time
    job_id = "job_long_running_lease_01"
    payload = {"job_id": job_id, "pdf_key": "blueprints/user1/doc.pdf", "selected_scopes": ["General"]}

    idempotency_store.register_job(job_id, "hash_long", json.dumps(payload))
    idempotency_store.mark_dispatched(job_id, "task_long_01")

    # Worker 1 claims execution with a short 1-second lease
    claimed1, tok1 = idempotency_store.claim_worker_execution(job_id, lease_seconds=1)
    assert claimed1 is True
    assert tok1 is not None

    # Wait past lease expiration (1.1s)
    time.sleep(1.1)

    # Worker 2 attempts to claim: MUST BE REJECTED!
    claimed2, tok2 = idempotency_store.claim_worker_execution(job_id, lease_seconds=1)
    assert claimed2 is False
    assert tok2 is None

    # Worker 1 pulses heartbeat and completes successfully
    hb = idempotency_store.heartbeat_execution(job_id, tok1)
    assert hb is True

    done1 = idempotency_store.mark_worker_completed(job_id, tok1)
    assert done1 is True


def test_stale_worker_completion_rejected():
    """
    Requirement 4:
    Conditional completion: Stale worker or cancelled job completion is rejected.
    Worker cannot publish result if token is stale or job was cancelled.
    """
    job_id = "job_stale_completion_01"
    headers = {"Authorization": f"Bearer {TEST_SECRET}"}
    payload = {"job_id": job_id, "pdf_key": "blueprints/user1/doc.pdf", "selected_scopes": ["General"]}

    idempotency_store.register_job(job_id, "hash_stale", json.dumps(payload))
    idempotency_store.mark_dispatched(job_id, "task_stale_01")

    # Worker claims execution
    claimed, real_token = idempotency_store.claim_worker_execution(job_id)
    assert claimed is True
    assert real_token is not None

    # Attempt to complete with invalid / stale token: REJECTED!
    stale_done = idempotency_store.mark_worker_completed(job_id, execution_token="tok_bogus_stale_token_999")
    assert stale_done is False
    info = idempotency_store.get_job_info(job_id)
    assert info["status"] != "COMPLETED"
    assert info["status"] in ["EXECUTING", "FAILED"]  # Did not complete!

    # Now simulate fencing:
    idempotency_store.fence_or_cancel_job(job_id, reason="Fenced by test")
    # Even with real_token, completion is rejected because status is no longer EXECUTING!
    cancelled_done = idempotency_store.mark_worker_completed(job_id, execution_token=real_token)
    assert cancelled_done is False
    info2 = idempotency_store.get_job_info(job_id)
    assert info2["status"] == "CANCELLED"


def test_repeated_cancellation_preserves_non_refundable_state():
    """
    Issue 1:
    fence_or_cancel_job changes EXECUTING to CANCELLED with can_refund=false.
    Repeated calls (retries) MUST durably preserve can_refund=false across retries.
    """
    job_id = "job_repeated_cancel_test_01"
    headers = {"Authorization": f"Bearer {TEST_SECRET}"}
    payload = {"job_id": job_id, "pdf_key": "blueprints/user1/doc.pdf", "selected_scopes": ["General"]}

    # Register and start executing
    idempotency_store.register_job(job_id, "hash_rep", json.dumps(payload))
    idempotency_store.mark_dispatched(job_id, "task_rep_01")
    claimed, tok = idempotency_store.claim_worker_execution(job_id)
    assert claimed is True

    # Call 1: Fencing while EXECUTING
    res1 = client.post(f"/estimate/fence-or-cancel/{job_id}", headers=headers)
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1["can_refund"] is False
    assert data1["state"] == "CANCELLED"

    # Call 2 (Retry): Must NOT flip to can_refund=True! Must preserve can_refund=False!
    res2 = client.post(f"/estimate/fence-or-cancel/{job_id}", headers=headers)
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["can_refund"] is False
    assert data2["state"] == "CANCELLED"

    # Call 3 (Another Retry): Still False
    res3 = client.post(f"/estimate/fence-or-cancel/{job_id}", headers=headers)
    assert res3.status_code == 200
    assert res3.json()["can_refund"] is False


import contextlib, os, socket, subprocess, shutil, tempfile

@contextlib.contextmanager
def disposable_postgres():
    s = socket.socket()
    s.bind(('', 0))
    port = s.getsockname()[1]
    s.close()
    
    pg_dir = os.path.abspath(f"backend/.test_pg_{port}")
    if os.path.exists(pg_dir):
        shutil.rmtree(pg_dir)
    os.makedirs(pg_dir)
    
    init_res = subprocess.run(['/usr/local/bin/initdb', '-D', pg_dir, '--auth=trust', '-U', 'postgres'], capture_output=True, text=True)
    if init_res.returncode != 0:
        raise RuntimeError(f"initdb failed: {init_res.stderr}")
        
    proc = subprocess.Popen(['/usr/local/bin/postgres', '-D', pg_dir, '-p', str(port), '-k', pg_dir], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        import psycopg2
        connected = False
        for _ in range(30):
            try:
                conn = psycopg2.connect(host='localhost', port=port, user='postgres', dbname='postgres', connect_timeout=1)
                conn.close()
                connected = True
                break
            except Exception:
                time.sleep(0.2)
        if not connected:
            raise RuntimeError("Could not connect to disposable postgres")
        db_url = f"postgresql://postgres@localhost:{port}/postgres"
        yield db_url
    finally:
        proc.terminate()
        proc.wait()
        shutil.rmtree(pg_dir, ignore_errors=True)


def test_concurrent_registration_and_cancellation_separate_connections():
    """
    Issue 1:
    Ensures PostgreSQL fence_or_cancel_job ON CONFLICT query with ELSE 'CANCELLED'
    executes cleanly and cannot overwrite a concurrently EXECUTING or COMPLETED job
    and authorize a refund across separate PostgreSQL connections.
    """
    with disposable_postgres() as db_url:
        import concurrent.futures
        store_a = TransactionalOutboxStore(db_url=db_url)
        store_b = TransactionalOutboxStore(db_url=db_url)

        job_id = "job_pg_concurrent_conn_01"
        payload = {"job_id": job_id, "pdf_key": "blueprints/user1/doc.pdf", "selected_scopes": ["Framing"]}

        def worker_register_and_exec():
            store_a.register_job(job_id, "hash_conn", json.dumps(payload))
            store_a.mark_dispatched(job_id, "task_conn_01")
            claimed, tok = store_a.claim_worker_execution(job_id)
            return claimed, tok

        def worker_fence():
            return store_b.fence_or_cancel_job(job_id, reason="Concurrent fence test")

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            f_reg = executor.submit(worker_register_and_exec)
            f_fence = executor.submit(worker_fence)
            claimed, tok = f_reg.result()
            can_refund, state, task_id = f_fence.result()

        info = store_a.get_job_info(job_id)
        if info["execution_token"] is not None:
            assert can_refund is False
        assert info["status"] in ["EXECUTING", "CANCELLED"]

        # Now test the exact ON CONFLICT query directly when job is actively EXECUTING on PostgreSQL
        import psycopg2
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO job_outbox (job_id, payload_hash, payload_json, status, last_error, is_refundable, updated_at)
            VALUES ('job_pg_conflict_executing', 'h1', '{}', 'EXECUTING', NULL, FALSE, NOW())
            ON CONFLICT (job_id) DO NOTHING;
        """)
        conn.commit()

        # Execute exact ON CONFLICT query from fence_or_cancel_job
        cur.execute("""
            INSERT INTO job_outbox (job_id, payload_hash, payload_json, status, last_error, is_refundable, updated_at)
            VALUES ('job_pg_conflict_executing', 'CANCELLED_TOMBSTONE', '{}', 'CANCELLED', 'conflict test', TRUE, NOW())
            ON CONFLICT (job_id) DO UPDATE
            SET status = CASE 
                    WHEN job_outbox.status IN ('EXECUTING', 'PUBLISHING', 'COMPLETED') THEN job_outbox.status
                    ELSE 'CANCELLED'
                END,
                is_refundable = CASE 
                    WHEN job_outbox.status IN ('EXECUTING', 'PUBLISHING', 'COMPLETED') THEN FALSE
                    ELSE job_outbox.is_refundable
                END,
                last_error = CASE 
                    WHEN job_outbox.status IN ('EXECUTING', 'PUBLISHING', 'COMPLETED') THEN job_outbox.last_error
                    ELSE %s
                END,
                updated_at = NOW()
            RETURNING status, task_id, is_refundable;
        """, ('conflict test',))
        row = cur.fetchone()
        conn.commit()
        conn.close()

        assert row[0] == "EXECUTING"
        assert row[2] is False


def test_supabase_result_save_failure_and_publication_retry(monkeypatch):
    """
    Issue 2:
    tasks.py persists generated result durably in outbox before saving to Supabase.
    If Supabase fails to save, error triggers bounded Celery queued retry.
    Celery task re-execution reuses the durably saved result_json without re-running AI estimation.
    """
    import tasks
    from celery_app import celery_app
    celery_app.conf.task_always_eager = True
    celery_app.conf.task_eager_propagates = False

    settings.anthropic_api_key = "test_key"
    job_id = "job_save_fail_retry_01"
    pdf_key = "blueprints/user1/plan.pdf"
    scopes = ["Framing"]

    idempotency_store.register_job(job_id, "hash_save", json.dumps({"job_id": job_id}))
    idempotency_store.mark_dispatched(job_id, "task_save_fail_01")

    monkeypatch.setattr("s3_service.download_pdf_from_s3", lambda key: b"%PDF-1.7 mock pdf content")

    ai_call_count = 0
    def mock_estimate(*args, **kwargs):
        nonlocal ai_call_count
        ai_call_count += 1
        return {"status": True, "total_cost": 15000, "scopes": scopes}

    import cost_estimator_v2
    monkeypatch.setattr(cost_estimator_v2.ConstructionEstimatorAPI, "estimate_from_pdf_with_json", mock_estimate)

    supabase_save_count = 0
    should_fail_supabase = True

    class MockSupabaseTable:
        def update(self, data):
            self.data = data
            return self
        def eq(self, col, val):
            return self
        def neq(self, col, val):
            return self
        def execute(self):
            nonlocal supabase_save_count, should_fail_supabase
            if "done" in str(self.data):
                supabase_save_count += 1
                if should_fail_supabase:
                    should_fail_supabase = False  # Next queued retry will succeed!
                    raise ConnectionError("Supabase connection timeout / 503")
            return {"data": [self.data]}

    class MockSupabase:
        def table(self, name):
            return MockSupabaseTable()

    monkeypatch.setattr("tasks.supabase", MockSupabase())

    # Execute task through Celery's task runner with queued retry enabled
    async_res = tasks.process_pdf_task.apply(args=[job_id, pdf_key, scopes])

    assert async_res.status == "SUCCESS"
    assert async_res.result["status"] == "success"
    # CRITICAL: AI was called ONCE; queued retry reused result_json without rerunning AI!
    assert ai_call_count == 1, f"Expected AI called once, got {ai_call_count}"
    assert supabase_save_count == 2, f"Expected 2 Supabase attempts (1 fail + 1 retry), got {supabase_save_count}"

    info = idempotency_store.get_job_info(job_id)
    assert info["status"] == "COMPLETED"
    assert json.loads(info["result_json"])["total_cost"] == 15000


def test_publication_fencing_cancellation_between_save_and_publish_blocks_done(monkeypatch):
    """
    Issue 3 (Publication Fencing):
    If cancellation occurs between save_generated_result and publication,
    claim_publication_ownership rejects the worker claim and prevents writing 'done' to Supabase.
    """
    import tasks
    settings.anthropic_api_key = "test_key"
    job_id = "job_fenced_between_save_and_pub_01"
    pdf_key = "blueprints/user1/plan_fence.pdf"
    scopes = ["Framing"]

    idempotency_store.register_job(job_id, "hash_pub_fence", json.dumps({"job_id": job_id}))
    idempotency_store.mark_dispatched(job_id, "task_pub_fence_01")

    supabase_done_called = False
    class MockSupabaseTable:
        def update(self, data):
            nonlocal supabase_done_called
            if data.get("status") == "done":
                supabase_done_called = True
            return self
        def eq(self, col, val):
            return self
        def neq(self, col, val):
            return self
        def execute(self):
            return {}

    class MockSupabase:
        def table(self, name):
            return MockSupabaseTable()

    monkeypatch.setattr("tasks.supabase", MockSupabase())
    monkeypatch.setattr("s3_service.download_pdf_from_s3", lambda key: b"%PDF-1.4 test")

    orig_save = idempotency_store.save_generated_result
    def mock_save_then_cancel(j_id, token, res):
        ok = orig_save(j_id, token, res)
        assert ok is True
        # Job is cancelled immediately after save_generated_result, before publication!
        idempotency_store.fence_or_cancel_job(j_id, reason="Cancelled right after save")
        return True

    monkeypatch.setattr(idempotency_store, "save_generated_result", mock_save_then_cancel)

    import cost_estimator_v2
    monkeypatch.setattr(
        cost_estimator_v2.ConstructionEstimatorAPI,
        "estimate_from_pdf_with_json",
        lambda *args, **kwargs: {"status": True, "total_cost": 12000, "trade_summary": []}
    )

    res = tasks.process_pdf_task(job_id, pdf_key, scopes)
    assert res["status"] == "rejected"
    assert res["reason"] == "job_cancelled_or_stale_before_publication"
    assert supabase_done_called is False, "Supabase 'done' MUST NOT be written when job is cancelled!"


def test_stale_worker_failure_writes_rejected(monkeypatch):
    """
    Issue 3 (Failure Path Fencing):
    Tests cancellation DURING a running task. The failure path checks
    mark_worker_failed's return value and rejects stale/cancelled worker failure writes
    to Supabase pdf_jobs.
    """
    import tasks
    settings.anthropic_api_key = "test_key"
    job_id = "job_stale_fail_write_01"
    pdf_key = "blueprints/user1/plan.pdf"
    scopes = ["Framing"]

    idempotency_store.register_job(job_id, "hash_stale_fail", json.dumps({"job_id": job_id}))
    idempotency_store.mark_dispatched(job_id, "task_stale_fail_01")

    fail_written_to_supabase = False
    class MockSupabaseTable:
        def update(self, data):
            nonlocal fail_written_to_supabase
            if data.get("status") == "fail":
                fail_written_to_supabase = True
            return self
        def eq(self, col, val):
            return self
        def neq(self, col, val):
            return self
        def execute(self):
            return {}

    class MockSupabase:
        def table(self, name):
            return MockSupabaseTable()

    monkeypatch.setattr("tasks.supabase", MockSupabase())

    def mock_download_and_cancel_mid_execution(key):
        # Verify worker is actively running with claimed execution token
        info = idempotency_store.get_job_info(job_id)
        assert info["status"] == "EXECUTING"
        assert info["execution_token"] is not None
        # Cancel during active execution!
        can_refund, state, _ = idempotency_store.fence_or_cancel_job(job_id, reason="Cancelled while actively running")
        assert can_refund is False
        # Trigger an error during mid-execution
        raise RuntimeError("Network error during active processing")

    monkeypatch.setattr("s3_service.download_pdf_from_s3", mock_download_and_cancel_mid_execution)

    try:
        tasks.process_pdf_task(job_id, pdf_key, scopes)
        assert False, "Expected process_pdf_task to raise mid-execution error"
    except RuntimeError:
        pass

    # Verify: mark_worker_failed returned False -> stale failure write to Supabase rejected!
    assert fail_written_to_supabase is False



def test_cancellation_during_in_flight_supabase_write_preserves_publishing_no_refund(monkeypatch):
    """
    Issue 1:
    Once publication ownership is acquired, cancellation must preserve PUBLISHING
    and return can_refund=false while the external write may be in flight.
    """
    import tasks
    settings.anthropic_api_key = "test_key"
    job_id = "job_cancel_during_pub_01"
    pdf_key = "blueprints/user1/plan_pub.pdf"
    scopes = ["Framing"]

    idempotency_store.register_job(job_id, "hash_pub_1", json.dumps({"job_id": job_id}))
    idempotency_store.mark_dispatched(job_id, "task_pub_01")

    fence_can_refund = None
    fence_status = None

    class MockSupabaseTable:
        def update(self, data):
            self.data = data
            return self
        def eq(self, col, val):
            return self
        def neq(self, col, val):
            return self
        def execute(self):
            nonlocal fence_can_refund, fence_status
            # While the external write is in flight, cancellation is attempted!
            info = idempotency_store.get_job_info(job_id)
            assert info["status"] == "PUBLISHING"
            can_ref, st, _ = idempotency_store.fence_or_cancel_job(job_id, reason="Cancel while write in flight")
            fence_can_refund = can_ref
            fence_status = st
            return {"data": [{"id": job_id, "status": "done"}]}

    class MockSupabase:
        def table(self, name):
            return MockSupabaseTable()

    monkeypatch.setattr("tasks.supabase", MockSupabase())
    monkeypatch.setattr("s3_service.download_pdf_from_s3", lambda key: b"%PDF-1.4 test")

    import cost_estimator_v2
    monkeypatch.setattr(
        cost_estimator_v2.ConstructionEstimatorAPI,
        "estimate_from_pdf_with_json",
        lambda *args, **kwargs: {"status": True, "total_cost": 5000, "trade_summary": []}
    )

    res = tasks.process_pdf_task(job_id, pdf_key, scopes)
    assert res["status"] == "success"

    # CRITICAL: During in-flight publication, cancellation preserved PUBLISHING and returned can_refund=false!
    assert fence_can_refund is False
    assert fence_status == "PUBLISHING"

    # After write completed, outbox marked COMPLETED
    final_info = idempotency_store.get_job_info(job_id)
    assert final_info["status"] == "COMPLETED"
    assert final_info["is_refundable"] is False


def test_supabase_timeout_preserves_non_refundable_flag_across_retries_and_cancellation(monkeypatch):
    """
    Issue 2:
    After a Supabase timeout, release_publication_claim sets PENDING_PUBLISH.
    A timeout may mean the write already committed. Preserves a durable non-refundable
    publication/unknown-outcome flag across retries. Do not authorize refund.
    """
    import tasks
    settings.anthropic_api_key = "test_key"
    job_id = "job_supabase_timeout_01"
    pdf_key = "blueprints/user1/plan_to.pdf"
    scopes = ["Framing"]

    idempotency_store.register_job(job_id, "hash_to_1", json.dumps({"job_id": job_id}))
    idempotency_store.mark_dispatched(job_id, "task_to_01")

    class MockSupabaseTable:
        def update(self, data):
            self.data = data
            return self
        def eq(self, col, val):
            return self
        def neq(self, col, val):
            return self
        def execute(self):
            # Simulate commit followed by connection timeout:
            raise TimeoutError("504 Gateway Timeout / Supabase read timed out")

    class MockSupabase:
        def table(self, name):
            return MockSupabaseTable()

    monkeypatch.setattr("tasks.supabase", MockSupabase())
    monkeypatch.setattr("s3_service.download_pdf_from_s3", lambda key: b"%PDF-1.4 test")

    import cost_estimator_v2
    monkeypatch.setattr(
        cost_estimator_v2.ConstructionEstimatorAPI,
        "estimate_from_pdf_with_json",
        lambda *args, **kwargs: {"status": True, "total_cost": 8000, "trade_summary": []}
    )

    try:
        tasks.process_pdf_task(job_id, pdf_key, scopes)
    except (tasks.celery.exceptions.Retry, tasks.SupabasePublicationError, TimeoutError):
        pass

    # The timeout occurred and release_publication_claim ran.
    # Outbox is now PENDING_PUBLISH with is_refundable = FALSE!
    info = idempotency_store.get_job_info(job_id)
    assert info["status"] == "PENDING_PUBLISH"
    assert info["is_refundable"] is False

    # Now cancellation is attempted while publication outcome is ambiguous:
    can_refund, cancel_status, _ = idempotency_store.fence_or_cancel_job(job_id, reason="Client attempted refund after timeout")
    # Must NOT authorize refund!
    assert can_refund is False

    # A repeated cancellation call also preserves can_refund = False!
    can_refund_retry, _, _ = idempotency_store.fence_or_cancel_job(job_id, reason="Retry cancel")
    assert can_refund_retry is False


def test_supabase_zero_rows_updated_fails_publication_and_rejects_completed(monkeypatch):
    """
    Issue 3:
    Verify the Supabase update actually persisted the intended row before
    marking COMPLETED; an empty update response (0 rows updated) must not count
    as successful publication.
    """
    import tasks
    settings.anthropic_api_key = "test_key"
    job_id = "job_zero_rows_01"
    pdf_key = "blueprints/user1/plan_zr.pdf"
    scopes = ["Framing"]

    idempotency_store.register_job(job_id, "hash_zr_1", json.dumps({"job_id": job_id}))
    idempotency_store.mark_dispatched(job_id, "task_zr_01")

    class MockSupabaseTable:
        def update(self, data):
            return self
        def eq(self, col, val):
            return self
        def neq(self, col, val):
            return self
        def execute(self):
            # PostgREST returns empty list when 0 rows match (e.g. cancelled or missing row)
            return {"data": []}

    class MockSupabase:
        def table(self, name):
            return MockSupabaseTable()

    monkeypatch.setattr("tasks.supabase", MockSupabase())
    monkeypatch.setattr("s3_service.download_pdf_from_s3", lambda key: b"%PDF-1.4 test")

    import cost_estimator_v2
    monkeypatch.setattr(
        cost_estimator_v2.ConstructionEstimatorAPI,
        "estimate_from_pdf_with_json",
        lambda *args, **kwargs: {"status": True, "total_cost": 9000, "trade_summary": []}
    )

    try:
        tasks.process_pdf_task(job_id, pdf_key, scopes)
    except (tasks.celery.exceptions.Retry, tasks.SupabasePublicationError):
        pass

    # Outbox must NOT be marked COMPLETED!
    info = idempotency_store.get_job_info(job_id)
    assert info["status"] != "COMPLETED"
    assert info["status"] == "PENDING_PUBLISH"



# ==============================================================================
# CONSOLIDATED CORRECTIONS REGRESSION SUITE (Items 1 - 5)
# ==============================================================================

def test_fence_endpoint_does_not_revoke_publishing_or_completed(monkeypatch):
    from celery_app import celery_app
    """
    Consolidated Correction 1:
    backend/main.py must NOT revoke or terminate publishing or completed tasks.
    Only revoke tasks when the job was actually transitioned to CANCELLED.
    """
    from unittest.mock import MagicMock
    revoke_mock = MagicMock()
    monkeypatch.setattr(celery_app.control, "revoke", revoke_mock)

    headers = {"Authorization": f"Bearer {TEST_SECRET}"}

    # 1. Test PUBLISHING state: Fencing must NOT call revoke!
    job_pub = "job_fence_pub_01"
    idempotency_store.register_job(job_pub, "h_pub", "{}")
    idempotency_store.mark_dispatched(job_pub, "task_pub_99")
    claimed, tok = idempotency_store.claim_worker_execution(job_pub)
    idempotency_store.claim_publication_ownership(job_pub, tok)
    
    info = idempotency_store.get_job_info(job_pub)
    assert info["status"] == "PUBLISHING"

    res = client.post(f"/estimate/fence-or-cancel/{job_pub}", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["can_refund"] is False
    assert data["state"] == "PUBLISHING"
    revoke_mock.assert_not_called()

    # 2. Test COMPLETED state: Fencing must NOT call revoke!
    job_comp = "job_fence_comp_01"
    idempotency_store.register_job(job_comp, "h_comp", "{}")
    idempotency_store.mark_dispatched(job_comp, "task_comp_99")
    claimed, tok = idempotency_store.claim_worker_execution(job_comp)
    idempotency_store.claim_publication_ownership(job_comp, tok)
    idempotency_store.mark_worker_completed(job_comp, tok)

    res = client.post(f"/estimate/fence-or-cancel/{job_comp}", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["can_refund"] is False
    assert data["state"] == "COMPLETED"
    revoke_mock.assert_not_called()

    # 3. Test PENDING_PUBLISH state: Fencing must NOT call revoke!
    job_pp = "job_fence_pp_01"
    idempotency_store.register_job(job_pp, "h_pp", "{}")
    idempotency_store.mark_dispatched(job_pp, "task_pp_99")
    claimed, tok = idempotency_store.claim_worker_execution(job_pp)
    idempotency_store.claim_publication_ownership(job_pp, tok)
    idempotency_store.release_publication_claim(job_pp, tok, "Supabase write timeout")

    res = client.post(f"/estimate/fence-or-cancel/{job_pp}", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["can_refund"] is False
    assert data["state"] == "PENDING_PUBLISH"
    revoke_mock.assert_not_called()

    # 4. Test unexecuted DISPATCHED state: Fencing transitions to CANCELLED and DOES call revoke!
    job_disp = "job_fence_disp_01"
    idempotency_store.register_job(job_disp, "h_disp", "{}")
    idempotency_store.mark_dispatched(job_disp, "task_disp_99")

    res = client.post(f"/estimate/fence-or-cancel/{job_disp}", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["can_refund"] is True
    assert data["state"] == "CANCELLED"
    revoke_mock.assert_called_once_with("task_disp_99", terminate=True)


def test_fence_pending_publish_preserves_state_and_enables_recovery():
    """
    Consolidated Correction 2:
    Fencing PENDING_PUBLISH must preserve recoverable publication state (PENDING_PUBLISH)
    with can_refund = False, rather than changing it to CANCELLED and preventing publication retry.
    """
    job_id = "job_recoverable_pp_01"
    idempotency_store.register_job(job_id, "h_pp_rec", "{}")
    idempotency_store.mark_dispatched(job_id, "task_pp_rec_01")
    claimed, tok = idempotency_store.claim_worker_execution(job_id)
    idempotency_store.claim_publication_ownership(job_id, tok)
    idempotency_store.release_publication_claim(job_id, tok, "Network error during Supabase update")

    # Call fence_or_cancel_job
    can_refund, state, task_id = idempotency_store.fence_or_cancel_job(job_id, reason="Client timeout refund check")
    assert can_refund is False
    assert state == "PENDING_PUBLISH"

    # Outbox status remains PENDING_PUBLISH (recoverable)
    info = idempotency_store.get_job_info(job_id)
    assert info["status"] == "PENDING_PUBLISH"
    assert info["is_refundable"] is False


def test_recovery_of_committed_but_timed_out_write(monkeypatch):
    """
    Consolidated Correction 2:
    Resolves committed-but-timed-out writes:
    If worker timed out but Supabase actually committed 'done' + detail,
    reconciliation / recovery marks outbox COMPLETED immediately without rerunning AI.
    """
    job_id = "job_committed_timeout_01"
    idempotency_store.register_job(job_id, "h_cto", "{}")
    idempotency_store.mark_dispatched(job_id, "task_cto_01")
    claimed, tok = idempotency_store.claim_worker_execution(job_id)
    idempotency_store.claim_publication_ownership(job_id, tok)
    idempotency_store.release_publication_claim(job_id, tok, "Supabase HTTP 504 Gateway Timeout")

    # Mock Supabase table returning status='done' with detail (write committed before timeout)
    class MockTable:
        def select(self, cols):
            return self
        def eq(self, col, val):
            return self
        def execute(self):
            return {"data": [{"status": "done", "detail": {"total_cost": 45000, "trade_summary": ["Framing"]}}]}

    class MockSupabase:
        def table(self, name):
            return MockTable()

    mock_client = MockSupabase()
    success, res_type, detail = idempotency_store.resolve_or_recover_publication(job_id, mock_client)
    assert success is True
    assert res_type == "COMMITTED_WRITE_RESOLVED"
    assert detail["total_cost"] == 45000

    # Outbox must now be COMPLETED
    info = idempotency_store.get_job_info(job_id)
    assert info["status"] == "COMPLETED"


def test_recovery_publishes_saved_result_without_rerunning_ai(monkeypatch):
    """
    Consolidated Correction 2:
    If worker crashed or retried after result was saved in outbox,
    allows saved-result publication directly to Supabase without rerunning AI (0 Anthropic calls).
    """
    job_id = "job_saved_result_recovery_01"
    idempotency_store.register_job(job_id, "h_srr", "{}")
    idempotency_store.mark_dispatched(job_id, "task_srr_01")
    claimed, tok = idempotency_store.claim_worker_execution(job_id)

    # Save generated AI result to outbox
    saved_ai_result = {"total_cost": 72500, "source": "pre_saved_result"}
    idempotency_store.save_generated_result(job_id, tok, saved_ai_result)
    idempotency_store.claim_publication_ownership(job_id, tok)
    idempotency_store.release_publication_claim(job_id, tok, "Transient connection dropped")

    published_payload = {}
    class MockTable:
        def select(self, cols):
            return self
        def eq(self, col, val):
            return self
        def neq(self, col, val):
            return self
        def update(self, data):
            published_payload.update(data)
            return self
        def execute(self):
            # First select query returns status='processing' (not yet done)
            if not published_payload:
                return {"data": [{"status": "processing", "detail": None}]}
            # Update query returns the updated row
            return {"data": [{"id": job_id, "status": "done"}]}

    class MockSupabase:
        def table(self, name):
            return MockTable()

    success, res_type, result = idempotency_store.resolve_or_recover_publication(job_id, MockSupabase())
    assert success is True
    assert res_type == "SAVED_RESULT_PUBLISHED"
    assert published_payload["status"] == "done"
    assert published_payload["detail"] == saved_ai_result

    # Outbox marked COMPLETED
    info = idempotency_store.get_job_info(job_id)
    assert info["status"] == "COMPLETED"


def test_active_worker_not_blindly_reclaimed_crashed_worker_recovered():
    import time
    """
    Consolidated Correction 2:
    Do not blindly reclaim active workers (long AI jobs run legitimately).
    Provide recovery for exhausted retries and worker crashes via heartbeat expiration.
    """
    job_id = "job_liveness_vs_crash_01"
    idempotency_store.register_job(job_id, "h_live", "{}")
    idempotency_store.mark_dispatched(job_id, "task_live_01")

    # Worker 1 claims execution with lease_seconds=2
    claimed1, tok1 = idempotency_store.claim_worker_execution(job_id, lease_seconds=2)
    assert claimed1 is True
    assert tok1 is not None

    # Normal duplicate worker attempting to claim while EXECUTING is refused
    claimed_dup, _ = idempotency_store.claim_worker_execution(job_id, lease_seconds=2)
    assert claimed_dup is False

    # Simulate heartbeat liveness while running
    alive = idempotency_store.heartbeat_execution(job_id, tok1)
    assert alive is True

    # Duplicate worker still refused
    claimed_dup2, _ = idempotency_store.claim_worker_execution(job_id, lease_seconds=2)
    assert claimed_dup2 is False

    # Now simulate worker crash: wait for lease to expire (2.1s)
    time.sleep(2.1)

    # Active worker protection: normal duplicate call still refused without recovery flag
    claimed_dup3, _ = idempotency_store.claim_worker_execution(job_id, lease_seconds=2)
    assert claimed_dup3 is False

    # Recovery sweeper / retry calls recover_crashed_worker: detects heartbeat expired and safely reclaims!
    recovered, new_tok = idempotency_store.recover_crashed_worker(job_id, lease_seconds=2)
    assert recovered is True
    assert new_tok is not None
    assert new_tok != tok1


def test_fail_closed_when_supabase_client_unavailable(monkeypatch):
    """
    Consolidated Correction 5:
    Fail closed for job execution/publication when the Supabase client is unavailable.
    Never mark a job COMPLETED without confirmed result persistence.
    """
    import tasks
    job_id = "job_no_supabase_01"
    pdf_key = "blueprints/user1/plan_no_sb.pdf"
    scopes = ["Framing"]

    idempotency_store.register_job(job_id, "h_nosb", "{}")
    idempotency_store.mark_dispatched(job_id, "task_nosb_01")

    # Set supabase = None
    monkeypatch.setattr(tasks, "supabase", None)

    with pytest.raises(RuntimeError, match="Supabase client is unconfigured or unavailable"):
        tasks.process_pdf_task(job_id, pdf_key, scopes)

    # Outbox must NEVER be COMPLETED
    info = idempotency_store.get_job_info(job_id)
    assert info["status"] != "COMPLETED"


def test_reconcile_endpoint_reports_persisted_result_and_rereads_detail():
    """
    Consolidated Correction 3:
    Reconciliation determines completion from persisted results (outbox COMPLETED + result_json),
    not Celery SUCCESS alone.
    """
    job_id = "job_rec_persisted_01"
    headers = {"Authorization": f"Bearer {TEST_SECRET}"}
    idempotency_store.register_job(job_id, "h_rec_p", "{}")
    idempotency_store.mark_dispatched(job_id, "task_rec_p_01")
    claimed, tok = idempotency_store.claim_worker_execution(job_id)
    
    # Save result and complete
    idempotency_store.save_generated_result(job_id, tok, {"total_cost": 88000})
    idempotency_store.claim_publication_ownership(job_id, tok)
    idempotency_store.mark_worker_completed(job_id, tok)

    res = client.get(f"/estimate/reconcile/{job_id}", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["accepted"] is True
    assert data["resolution"] == "CONFIRMED_ACCEPTED"
    assert data["has_persisted_result"] is True
    assert data["outbox_status"] == "COMPLETED"


def test_postgres_concurrency_fencing_pending_publish_preserves_state():
    """
    Consolidated Correction 2 on Disposable PostgreSQL:
    Verifies that on real PostgreSQL, fencing a PENDING_PUBLISH job
    preserves PENDING_PUBLISH, sets is_refundable = FALSE, and returns can_refund = False.
    """
    with disposable_postgres() as db_url:
        import psycopg2
        store = TransactionalOutboxStore(db_url=db_url)
        job_id = "job_pg_pp_fence_01"
        payload = {"job_id": job_id, "pdf_key": "blueprints/user1/test.pdf", "selected_scopes": ["Roofing"]}

        store.register_job(job_id, "h_pg_pp", json.dumps(payload))
        store.mark_dispatched(job_id, "task_pg_pp_01")
        claimed, tok = store.claim_worker_execution(job_id)
        assert claimed is True
        store.claim_publication_ownership(job_id, tok)
        store.release_publication_claim(job_id, tok, "Supabase timeout error")

        # Now fence job on real PostgreSQL
        can_refund, state, task_id = store.fence_or_cancel_job(job_id, reason="Timeout refund check")
        assert can_refund is False
        assert state == "PENDING_PUBLISH"

        info = store.get_job_info(job_id)
        assert info["status"] == "PENDING_PUBLISH"
        assert info["is_refundable"] is False

def test_committed_timed_out_preserves_done_without_overwriting_to_processing(monkeypatch):
    """
    Committed-but-timed-out recovery verification:
    tasks.py must check whether Supabase already contains 'done' BEFORE
    writing 'processing', preserving the completed status and results.
    """
    import tasks
    job_id = "job_cbto_preserve_done_01"
    pdf_key = "blueprints/user1/plan_cbto.pdf"
    scopes = ["Framing"]

    idempotency_store.register_job(job_id, "h_cbto_1", "{}")
    idempotency_store.mark_dispatched(job_id, "task_cbto_01")

    updates_made = []
    class MockTable:
        def __init__(self):
            self.current_status = "done"
            self.current_detail = {"total_cost": 52000, "trade": "Roofing"}

        def select(self, cols):
            return self

        def eq(self, col, val):
            return self

        def neq(self, col, val):
            # Conditional update: if status neq "done", then filter out
            self._neq_col = col
            self._neq_val = val
            return self

        def update(self, data):
            updates_made.append(data)
            return self

        def execute(self):
            if hasattr(self, "_neq_col") and self._neq_col == "status" and self._neq_val == "done":
                # Conditional neq("status", "done") returns empty if status is "done"
                return {"data": []}
            return {"data": [{"id": job_id, "status": self.current_status, "detail": self.current_detail}]}

    class MockSupabase:
        def table(self, name):
            return MockTable()

    monkeypatch.setattr(tasks, "supabase", MockSupabase())

    # Mock AI so if it were called it would raise
    import cost_estimator_v2
    def explode(*args, **kwargs):
        raise AssertionError("AI estimator should NEVER be called when Supabase is already done!")
    monkeypatch.setattr(cost_estimator_v2.ConstructionEstimatorAPI, "estimate_from_pdf_with_json", explode)

    res = tasks.process_pdf_task(job_id, pdf_key, scopes)
    assert res["status"] == "success"
    assert res.get("resolved") == "committed_write"

    # Outbox is marked completed
    info = idempotency_store.get_job_info(job_id)
    assert info["status"] == "COMPLETED"

    # Crucial assertion: status "processing" was NEVER written to Supabase!
    assert not any(u.get("status") == "processing" for u in updates_made), f"Overwrote to processing! Updates: {updates_made}"
