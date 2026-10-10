import logging
import tempfile
import threading
from typing import List, Optional
import celery.exceptions
from celery_app import celery_app
from config import settings
from supabase_client import supabase

logger = logging.getLogger(__name__)


class SupabasePublicationError(Exception):
    """Raised when Supabase fails to persist the generated result."""
    pass

@celery_app.task(
    bind=True,
    name="tasks.process_pdf_task",
    max_retries=3,
)
def process_pdf_task(self, job_id: Optional[str], pdf_key: str, selected_scopes: List[str]):
    """
    Background task to process a PDF and generate an estimate.
    Guaranteed exactly-once execution via transactional outbox worker deduplication,
    owner token validation, active heartbeats, durable pre-save result persistence,
    and conditional completion.
    """
    from cost_estimator_v2 import ConstructionEstimatorAPI
    from prompt_builders import build_estimation_prompt, build_json_extraction_prompt
    from s3_service import download_pdf_from_s3
    from idempotency import idempotency_store

    logger.info(f"Starting task for job_id={job_id} pdf_key={pdf_key} with scopes={selected_scopes} using model={settings.anthropic_model}")
    
    # Fail closed for job execution/publication when the Supabase client is unavailable.
    if job_id and supabase is None:
        logger.error(f"Cannot process job {job_id}: Supabase client is unconfigured or unavailable. Failing closed!")
        raise RuntimeError("Supabase client is unconfigured or unavailable. Execution failed closed.")

    execution_token = None
    # 1. Worker-side Execution Deduplication & Token Claim
    if job_id:
        claimed, execution_token = idempotency_store.claim_worker_execution(job_id)
        if not claimed or not execution_token:
            logger.warning(f"Task for job_id {job_id} could not be claimed (already executing, completed, or cancelled). Skipping duplicate/cancelled execution.")
            return {"status": "skipped", "job_id": job_id, "reason": "duplicate_execution_prevented"}

    # 2. Pre-check: Check if this job was already committed to Supabase from a prior timed-out write!
    # MUST run BEFORE touching the status in Supabase so we never overwrite 'done'!
    if job_id and supabase is not None:
        try:
            s_check = supabase.table("pdf_jobs").select("status, detail").eq("id", job_id).execute()
            s_rows = getattr(s_check, "data", None) or (s_check.get("data") if isinstance(s_check, dict) else None) or []
            if s_rows and s_rows[0].get("status") == "done" and s_rows[0].get("detail"):
                logger.info(f"Job {job_id} was already committed to Supabase ('done'). Resolving outbox to COMPLETED without rerunning AI.")
                idempotency_store.mark_worker_completed(job_id, execution_token)
                return {"status": "success", "job_id": job_id, "resolved": "committed_write"}
        except Exception as c_err:
            logger.warning(f"Pre-check of Supabase job status failed for {job_id}: {c_err}")

    # 3. Only transition to 'processing' if job is not already finalized (conditional transition)
    # NEVER overwrite 'done', 'cancelled', or 'fail'!
    if supabase is not None and job_id:
        try:
            supabase.table("pdf_jobs").update({
                "status": "processing",
                "message": "Processing started"
            }).eq("id", job_id).neq("status", "done").neq("status", "cancelled").execute()
            logger.info(f"Supabase UPDATE SUCCESS: job_id={job_id} is now processing")
        except Exception as e:
            logger.error(f"Supabase UPDATE ERROR (processing): Failed to update job_id={job_id}. Details: {str(e)}")

    # 4. Start Active Heartbeat Thread to prove worker liveness during long execution
    stop_heartbeat = threading.Event()
    def _pulse_heartbeat():
        while not stop_heartbeat.wait(15.0):
            try:
                alive = idempotency_store.heartbeat_execution(job_id, execution_token)
                if not alive:
                    logger.warning(f"Heartbeat failed for job_id {job_id} token {execution_token}. Job was cancelled or fenced.")
                    break
            except Exception as hb_err:
                logger.warning(f"Heartbeat error for job_id {job_id}: {hb_err}")

    if job_id and execution_token:
        hb_thread = threading.Thread(target=_pulse_heartbeat, daemon=True)
        hb_thread.start()

    try:
        # 3. Check if result was already durably generated and saved in outbox (e.g. prior retry where Supabase save failed)
        result = None
        if job_id:
            result = idempotency_store.get_generated_result(job_id)
            if result is not None:
                logger.info(f"Found pre-generated result in outbox for job_id {job_id}. Skipping AI re-computation (0 Anthropic API calls).")

        # 4. If result not already present, run AI estimation
        if result is None:
            import time
            s3_start = time.time()
            logger.info(f"Downloading PDF from S3: {pdf_key}")
            pdf_bytes = download_pdf_from_s3(pdf_key)
            logger.info(f"S3 Download took {time.time() - s3_start:.2f}s")
            
            construction_estimator_prompt = build_estimation_prompt(selected_scopes)
            json_tables_extraction_prompt = build_json_extraction_prompt()
            
            with tempfile.NamedTemporaryFile(delete=True, suffix=".pdf") as tmp_pdf:
                tmp_pdf.write(pdf_bytes)
                tmp_pdf.flush()

                estimator = ConstructionEstimatorAPI(
                    api_key=settings.anthropic_api_key,
                    estimation_prompt=construction_estimator_prompt,
                    json_extraction_prompt=json_tables_extraction_prompt,
                )

                result = estimator.estimate_from_pdf_with_json(
                    tmp_pdf.name,
                    project_info=None,
                    ghostscript_quality="screen",
                )
                
                if not result.get("status"):
                    error_msg = result.get("message", "Unknown AI error")
                    logger.error(f"AI returned non-OK status: {error_msg}")
                    raise Exception(error_msg)
                
                logger.info(f"Task AI estimation completed successfully for {pdf_key}")

                # Persist generated result durably in outbox BEFORE attempting Supabase save
                if job_id:
                    saved_durable = idempotency_store.save_generated_result(job_id, execution_token, result)
                    if not saved_durable:
                        logger.error(f"Failed to persist result for job {job_id} (job cancelled or token stale). Stale worker result rejected.")
                        return {"status": "rejected", "job_id": job_id, "reason": "stale_worker_completion_rejected"}

        # 5. Publication fencing & coordination:
        # Check ownership and transition EXECUTING -> PUBLISHING before touching Supabase.
        # If job was cancelled between result generation and publication, claim_publication_ownership
        # will return False, preventing a cancelled worker from writing "done" to Supabase!
        if job_id:
            can_publish = idempotency_store.claim_publication_ownership(job_id, execution_token)
            if not can_publish:
                logger.warning(
                    f"Job {job_id} is no longer active (cancelled/fenced or token mismatch). "
                    f"Rejecting Supabase publication of 'done'."
                )
                return {"status": "rejected", "job_id": job_id, "reason": "job_cancelled_or_stale_before_publication"}

        if job_id:
            if supabase is None:
                logger.error(f"Cannot publish job {job_id}: Supabase client is unavailable. Failing closed!")
                raise SupabasePublicationError("Supabase client is unavailable. Confirmed persistence impossible.")

            try:
                res = supabase.table("pdf_jobs").update({
                    "status": "done",
                    "message": "Success",
                    "detail": result
                }).eq("id", job_id).neq("status", "cancelled").execute()

                # Verify the Supabase update actually persisted the intended row before marking COMPLETED;
                # an empty update response (0 rows updated) must not count as successful publication.
                updated_rows = getattr(res, "data", None) or (res.get("data") if isinstance(res, dict) else None) or []
                if not updated_rows:
                    logger.error(
                        f"Supabase UPDATE returned zero updated rows for job_id={job_id} "
                        f"(job row missing or status already cancelled). Failing publication!"
                    )
                    raise SupabasePublicationError(f"Zero rows updated in Supabase for job_id={job_id}")

                logger.info(f"Supabase UPDATE SUCCESS: job_id={job_id} is now done with details saved.")
            except Exception as e:
                logger.error(f"Supabase UPDATE ERROR (done): Failed to save result to Supabase for job_id={job_id}: {str(e)}")
                if job_id and execution_token:
                    idempotency_store.release_publication_claim(job_id, execution_token, str(e))
                # Trigger bounded publication retry without re-running AI
                raise self.retry(exc=SupabasePublicationError(str(e)), countdown=1, max_retries=3)

        # 6. Only mark outbox COMPLETED after Supabase save has succeeded!
        if job_id:
            completed = idempotency_store.mark_worker_completed(job_id, execution_token)
            if not completed:
                logger.error(f"Failed to mark job {job_id} completed with token {execution_token}. Stale worker result publish rejected!")
                return {"status": "rejected", "job_id": job_id, "reason": "stale_worker_completion_rejected"}

        return {"status": "success", "job_id": job_id, "pdf_key": pdf_key}

    except celery.exceptions.Retry:
        # Bounded publication retry in progress; allow Celery retry mechanism to schedule retry
        raise
    except Exception as exc:
        logger.error(f"Task failed for {pdf_key}: {exc}", exc_info=True)
        
        # 7. Check return value of mark_worker_failed; reject stale/cancelled worker failure writes!
        failed_recorded = True
        if job_id:
            failed_recorded = idempotency_store.mark_worker_failed(job_id, str(exc), execution_token)
            if not failed_recorded:
                logger.warning(
                    f"Rejecting stale/cancelled worker failure write to Supabase for job_id {job_id} "
                    f"with token {execution_token}."
                )

        if supabase is not None and job_id and failed_recorded:
            try:
                supabase.table("pdf_jobs").update({
                    "status": "fail",
                    "message": f"Failed: {str(exc)}",
                    "detail": {"error": str(exc)}
                }).eq("id", job_id).neq("status", "cancelled").execute()
                logger.info(f"Supabase UPDATE SUCCESS: job_id={job_id} is now fail with error saved.")
            except Exception as e:
                logger.error(f"Supabase UPDATE ERROR (fail): Failed to update job_id={job_id}. Details: {str(e)}")

        raise exc
    finally:
        stop_heartbeat.set()
