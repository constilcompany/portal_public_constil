import json
import logging
import re
from typing import List, Optional
from celery.result import AsyncResult
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from auth import verify_internal_auth
from celery_app import celery_app
from config import settings
from idempotency import (
    idempotency_store,
    compute_payload_hash,
    STATE_PENDING_DISPATCH,
    STATE_DISPATCHED,
    STATE_DISPATCH_FAILED,
    STATE_DISPATCH_UNCERTAIN,
    STATE_EXECUTING,
    STATE_PUBLISHING,
    STATE_PENDING_PUBLISH,
    STATE_COMPLETED,
    STATE_CANCELLED,
)
from quote import generate_proposal_from_invoice
from supabase_client import supabase
from tasks import process_pdf_task

# Try importing broker exception types for explicit categorization
try:
    import kombu.exceptions as kombu_exc
    BROKER_OPERATIONAL_ERRORS = (kombu_exc.OperationalError, ConnectionRefusedError, ConnectionError)
except ImportError:
    BROKER_OPERATIONAL_ERRORS = (ConnectionRefusedError, ConnectionError)

try:
    import redis.exceptions as redis_exc
    BROKER_OPERATIONAL_ERRORS = BROKER_OPERATIONAL_ERRORS + (redis_exc.ConnectionError, redis_exc.TimeoutError)
except ImportError:
    pass

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("estimation_api")

ALLOWED_SCOPES = [
    "Overall",
    "Finishes",
    "Drywall",
    "Flooring",
    "Framing",
    "Roofing",
    "Insulation",
    "Cleaning",
    "Plumbing",
    "HVAC",
    "Electrical",
    "FinishCarpentry",
    "Windows",
    "Doors",
    "Siding",
    "General",
]

PDF_KEY_REGEX = re.compile(r"^(blueprints|estimates|invoices)/[a-zA-Z0-9_-]+/[0-9]+_[a-zA-Z0-9_-]+\.pdf$")

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Estimation FastAPI Service",
    description="Authenticated AI Construction Estimation Engine with Transactional Outbox & Durable Idempotency",
    version="2.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class EstimateRequest(BaseModel):
    pdf_key: str
    selected_scopes: List[str] = ["General"]
    job_id: str
    project_name: Optional[str] = None


class TaskResponse(BaseModel):
    task_id: str
    status: str
    job_id: str
    is_retry: bool = False


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/health", summary="Public Health Check")
def health():
    """Public liveness probe — returns 200 without authentication."""
    return {"status": "ok", "service": "estimation-fastapi-svc"}


@app.post(
    "/estimate",
    response_model=TaskResponse,
    summary="Trigger a background PDF construction estimate task",
    dependencies=[Depends(verify_internal_auth)],
)
def create_estimate(payload: EstimateRequest):
    """
    Triggers the estimation pipeline in the background using Celery via Transactional Outbox.
    Registration alone is NOT acceptance.
    Celery dispatch exception returns 502/504 and marks failure/uncertainty.
    """
    job_id = payload.job_id.strip()
    pdf_key = payload.pdf_key.strip()

    if not job_id:
        raise HTTPException(status_code=400, detail="Missing required field: 'job_id'")
    if not pdf_key:
        raise HTTPException(status_code=400, detail="Missing required field: 'pdf_key'")

    # 1. Validate S3 pdf_key format (disallow arbitrary / unsafe keys)
    if ".." in pdf_key or pdf_key.startswith("/") or not pdf_key.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Invalid pdf_key format. Path traversal or non-PDF not allowed.")
    if not (pdf_key.startswith("blueprints/") or pdf_key.startswith("estimates/") or pdf_key.startswith("invoices/")):
        raise HTTPException(status_code=400, detail="Disallowed S3 prefix. Key must be inside blueprints, estimates, or invoices.")

    # 2. Validate selected scopes
    raw_scopes = payload.selected_scopes or ["General"]
    selected_scopes = [s.strip() for s in raw_scopes if s.strip()]
    if not selected_scopes:
        selected_scopes = ["General"]

    for scope in selected_scopes:
        if scope not in ALLOWED_SCOPES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid scope '{scope}'. Allowed scopes: {', '.join(ALLOWED_SCOPES)}",
            )

    # 3. Verify Supabase pdf_jobs record if Supabase client is configured
    if supabase is not None:
        try:
            job_res = supabase.table("pdf_jobs").select("id, pdf_key, status").eq("id", job_id).execute()
            if job_res.data and len(job_res.data) > 0:
                record = job_res.data[0]
                if record.get("pdf_key") and record["pdf_key"] != pdf_key:
                    raise HTTPException(
                        status_code=400,
                        detail="Mismatch between request pdf_key and database job record."
                    )
        except HTTPException:
            raise
        except Exception as e:
            logger.warning(f"[DB Check] Failed to query Supabase pdf_jobs: {e}")

    # 4. Transactional Outbox Registration & Durable Idempotency
    payload_hash = compute_payload_hash(pdf_key, selected_scopes)
    payload_json = json.dumps({
        "job_id": job_id,
        "pdf_key": pdf_key,
        "selected_scopes": selected_scopes,
        "project_name": payload.project_name
    })

    job_info, is_existing, is_conflict = idempotency_store.register_job(
        job_id=job_id,
        payload_hash=payload_hash,
        payload_json=payload_json,
    )

    if is_conflict:
        logger.warning(f"[/estimate] 409 Conflict: job_id='{job_id}' reused with different payload.")
        raise HTTPException(
            status_code=409,
            detail="Conflict: job_id has already been registered with a different request payload."
        )

    if is_existing:
        status = job_info.get("status")
        if status == STATE_CANCELLED or job_info.get("is_cancelled"):
            logger.warning(f"[/estimate] 409 Conflict: job_id='{job_id}' is cancelled/fenced (tombstone). Cannot register or dispatch.")
            raise HTTPException(
                status_code=409,
                detail="Conflict: job_id has been cancelled or fenced (tombstone) and cannot be dispatched."
            )
        # If another concurrent request is currently dispatching this exact job, wait for it
        if status == STATE_PENDING_DISPATCH:
            logger.info(f"[/estimate] Concurrent request detected for in-flight job_id='{job_id}'. Awaiting in-flight dispatch...")
            resolved = idempotency_store.wait_for_dispatch(job_id, timeout=5.0)
            if resolved and resolved.get("status") in [STATE_DISPATCHED, STATE_EXECUTING, STATE_COMPLETED]:
                return TaskResponse(task_id=resolved["task_id"], status="PENDING", job_id=job_id, is_retry=True)
            elif resolved and resolved.get("status") == STATE_DISPATCH_FAILED:
                raise HTTPException(status_code=502, detail=f"Downstream task dispatch failed: {resolved.get('last_error')}")

        # Idempotent replay: if already successfully dispatched to queue
        if status in [STATE_DISPATCHED, STATE_EXECUTING, STATE_COMPLETED]:
            logger.info(f"[/estimate] Idempotent hit: returning existing task_id='{job_info['task_id']}' for job_id='{job_id}' (0 duplicate Celery execution).")
            return TaskResponse(task_id=job_info["task_id"], status="PENDING", job_id=job_id, is_retry=True)
        # If previous attempt failed, we proceed to attempt fresh dispatch below

    # 5. Queue Publish with Explicit Failure & Uncertainty Categorization
    logger.info(f"[/estimate] Publishing to queue broker for job_id='{job_id}' pdf_key='{pdf_key}' scopes={selected_scopes}")
    try:
        celery_task = process_pdf_task.delay(job_id, pdf_key, selected_scopes)
        actual_task_id = celery_task.id
        
        # Publish confirmed by broker!
        idempotency_store.mark_dispatched(job_id, actual_task_id)
        logger.info(f"[/estimate] Dispatch SUCCESS: job_id='{job_id}' task_id='{actual_task_id}'")
        return TaskResponse(task_id=actual_task_id, status="PENDING", job_id=job_id, is_retry=is_existing)

    except BROKER_OPERATIONAL_ERRORS as broker_err:
        # Confirmed dispatch failure: broker down / unreachable
        err_msg = f"Task broker unavailable: {broker_err}"
        logger.error(f"[/estimate] CONFIRMED DISPATCH FAILURE: {err_msg}")
        idempotency_store.mark_dispatch_failed(job_id, err_msg)
        raise HTTPException(
            status_code=502,
            detail=f"Downstream task queue broker is unavailable: {broker_err}"
        )

    except TimeoutError as timeout_err:
        # Uncertain dispatch state
        err_msg = f"Task broker publish timed out: {timeout_err}"
        logger.warning(f"[/estimate] DISPATCH UNCERTAIN: {err_msg}")
        idempotency_store.mark_dispatch_uncertain(job_id, err_msg)
        raise HTTPException(
            status_code=504,
            detail=f"Task dispatch state unconfirmed (timeout awaiting broker acknowledgment): {timeout_err}"
        )

    except Exception as exc:
        err_msg = f"Dispatch failed: {exc}"
        logger.error(f"[/estimate] UNEXPECTED DISPATCH FAILURE: {err_msg}")
        idempotency_store.mark_dispatch_failed(job_id, err_msg)
        raise HTTPException(
            status_code=502,
            detail=f"Downstream task dispatch failed: {str(exc)}"
        )


@app.get(
    "/estimate/status/{task_id}",
    summary="Check the status of an estimation task",
    dependencies=[Depends(verify_internal_auth)],
)
def get_task_status(task_id: str):
    """
    Check if a task is finished and get the result. Protected by server-to-server auth.
    """
    result = AsyncResult(task_id, app=celery_app)
    
    response = {
        "task_id": task_id,
        "status": result.status,
    }

    if result.ready():
        if result.successful():
            response["result"] = result.result
        else:
            response["error"] = str(result.result)
            
    return response


@app.get(
    "/estimate/reconcile/{job_id}",
    summary="Reconcile worker acceptance and actual execution state for a job_id",
    dependencies=[Depends(verify_internal_auth)],
)
def reconcile_job(job_id: str):
    """
    Called by Supabase Edge Function to resolve 'dispatch_unknown' states.
    Verifies actual broker publish and worker execution state.
    Explicit contract:
    - resolution: CONFIRMED_ACCEPTED | CONFIRMED_REJECTED | UNCERTAIN
    - accepted: bool
    """
    info = idempotency_store.get_job_info(job_id)
    if not info:
        return {
            "accepted": False,
            "resolution": "CONFIRMED_REJECTED",
            "job_id": job_id,
            "state": "NOT_FOUND",
            "message": "Job was never registered with the estimation service."
        }

    status = info["status"]
    task_id = info.get("task_id")

    # If job is cancelled or fenced
    if status == STATE_CANCELLED:
        return {
            "accepted": False,
            "resolution": "CONFIRMED_REJECTED",
            "job_id": job_id,
            "state": STATE_CANCELLED,
            "message": "Job was cancelled/fenced."
        }

    # If dispatch failed definitively
    if status == STATE_DISPATCH_FAILED:
        return {
            "accepted": False,
            "resolution": "CONFIRMED_REJECTED",
            "job_id": job_id,
            "state": STATE_DISPATCH_FAILED,
            "last_error": info.get("last_error"),
            "message": "Task dispatch to queue broker failed definitively."
        }

    # If registered but not yet dispatched (e.g. crashed before Celery publish)
    if status == STATE_PENDING_DISPATCH:
        return {
            "accepted": False,
            "resolution": "UNCERTAIN",
            "job_id": job_id,
            "state": STATE_PENDING_DISPATCH,
            "message": "Job is registered in outbox but awaiting queue dispatch recovery."
        }

    # If dispatch was uncertain (e.g. timeout during publish)
    if status == STATE_DISPATCH_UNCERTAIN:
        return {
            "accepted": False,
            "resolution": "UNCERTAIN",
            "job_id": job_id,
            "state": STATE_DISPATCH_UNCERTAIN,
            "last_error": info.get("last_error"),
            "message": "Task dispatch was uncertain awaiting broker confirmation."
        }

    # For PENDING_PUBLISH, PUBLISHING, or EXECUTING jobs:
    # Attempt to resolve committed-but-timed-out writes or publish saved results
    if status in [STATE_PENDING_PUBLISH, STATE_PUBLISHING, STATE_EXECUTING]:
        try:
            from supabase_client import supabase
            if supabase is not None:
                recovered, res_type, res_detail = idempotency_store.resolve_or_recover_publication(job_id, supabase)
                if recovered:
                    status = STATE_COMPLETED
                    info["status"] = STATE_COMPLETED
                    info["result_json"] = res_detail
        except Exception as rec_err:
            logger.warning(f"Failed publication recovery check during reconcile for {job_id}: {rec_err}")

    # If DISPATCHED, EXECUTING, PUBLISHING, PENDING_PUBLISH or COMPLETED: query Celery AsyncResult
    celery_status = "UNKNOWN"
    if task_id:
        try:
            result = AsyncResult(task_id, app=celery_app)
            celery_status = result.status if result else "UNKNOWN"
        except Exception:
            celery_status = "BROKER_UNREACHABLE"

    is_executing_or_done = (status in [STATE_DISPATCHED, STATE_EXECUTING, STATE_PUBLISHING, STATE_PENDING_PUBLISH, STATE_COMPLETED]) and (celery_status != "FAILURE")

    has_persisted_result = (status == STATE_COMPLETED) and bool(info.get("result_json"))
    return {
        "accepted": True,
        "resolution": "CONFIRMED_ACCEPTED",
        "job_id": job_id,
        "task_id": task_id,
        "outbox_status": status,
        "task_status": celery_status,
        "has_persisted_result": has_persisted_result,
        "is_executing": is_executing_or_done,
        "message": "Job confirmed dispatched and queued/executing in Celery."
    }


@app.post(
    "/estimate/fence-or-cancel/{job_id}",
    summary="Atomically cancel/fence a job to prevent post-refund execution",
    dependencies=[Depends(verify_internal_auth)],
)
def fence_or_cancel_job(job_id: str):
    """
    Called by Supabase Edge Function prior to issuing an atomic refund.
    Ensures that worker or recovery sweeper can NEVER execute this job.
    """
    can_refund, current_state, task_id = idempotency_store.fence_or_cancel_job(
        job_id=job_id,
        reason="Fenced by Supabase Edge Function prior to credit refund"
    )

    # Align endpoint behavior with the outbox decision:
    # Do NOT revoke/terminate publishing, pending_publish or completed tasks!
    # Only revoke if the job was actually transitioned to CANCELLED!
    if task_id and current_state == STATE_CANCELLED:
        try:
            celery_app.control.revoke(task_id, terminate=True)
            logger.info(f"[/estimate/fence-or-cancel] Revoked Celery task '{task_id}' for job_id '{job_id}'")
        except Exception as e:
            logger.warning(f"[/estimate/fence-or-cancel] Failed to revoke Celery task '{task_id}': {e}")

    durable_cancelled = bool(current_state == STATE_CANCELLED and can_refund)
    return {
        "can_refund": can_refund,
        "durable_cancellation": durable_cancelled,
        "job_id": job_id,
        "state": current_state,
        "task_id": task_id,
        "message": (
            "Job successfully fenced against future worker execution." if durable_cancelled else
            f"Job is in '{current_state}' state; active execution/publication cannot be refunded or revoked."
        )
    }


@app.post(
    "/estimate/recover-outbox",
    summary="Crash recovery: Sweep and re-dispatch unconfirmed outbox entries",
    dependencies=[Depends(verify_internal_auth)],
)
def recover_outbox():
    """
    Outbox recovery mechanism to handle crashes between DB registration and queue publish.
    Finds PENDING_DISPATCH or DISPATCH_UNCERTAIN jobs and publishes them.
    """
    pending = idempotency_store.get_pending_dispatches()
    recovered = []
    failed = []

    for item in pending:
        jid = item["job_id"]
        try:
            p_data = json.loads(item["payload_json"])
            celery_task = process_pdf_task.delay(jid, p_data["pdf_key"], p_data["selected_scopes"])
            idempotency_store.mark_dispatched(jid, celery_task.id)
            recovered.append({"job_id": jid, "task_id": celery_task.id})
        except Exception as exc:
            failed.append({"job_id": jid, "error": str(exc)})

    try:
        from supabase_client import supabase
        if supabase is not None:
            pub_recovered = idempotency_store.recover_pending_publications(supabase)
            recovered.extend(pub_recovered)
    except Exception as exc:
        logger.warning(f"Failed to recover pending publications in sweeper: {exc}")

    return {
        "status": "completed",
        "recovered_count": len(recovered),
        "recovered_jobs": recovered,
        "failed_count": len(failed),
        "failed_jobs": failed,
    }


@app.post(
    "/quote",
    summary="Generate a proposal from an invoice",
    dependencies=[Depends(verify_internal_auth)],
)
def generate_proposal(payload: dict):
    """
    Generate a proposal from an invoice. Protected by server-to-server auth.
    """
    try:
        proposal = generate_proposal_from_invoice(payload)
        return {"proposal": proposal}
    except Exception as e:
        logger.error(f"Failed to generate proposal: {e}")
        return {"status": "error", "message": str(e)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=False, log_level="info")
