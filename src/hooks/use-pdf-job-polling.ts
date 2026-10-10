import { useEffect, useRef } from "react";
import axios from "axios";

/**
 * usePdfJobPolling hook
 * Polls the blueprint-estimate Edge Function status endpoint until the status is 'done' or 'fail'.
 * If the job is in 'dispatch_unknown', the endpoint triggers active reconciliation with the worker.
 *
 * @param jobId - The UUID of the job to poll
 * @param onDone - Callback when status is 'done', receives the 'detail' JSON payload
 * @param onFail - Callback when status is 'fail', receives the error message
 */
export function usePdfJobPolling(
  jobId: string | null,
  onDone: (detail: any) => void,
  onFail: (message: string) => void,
) {
  const intervalRef = useRef<number | null>(null);
  const onDoneRef = useRef(onDone);
  const onFailRef = useRef(onFail);

  // Keep refs updated to avoid re-running the effect when callbacks change
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    onFailRef.current = onFail;
  }, [onFail]);

  useEffect(() => {
    if (!jobId) return;

    const poll = async () => {
      try {
        const token = localStorage.getItem("access_token");
        const edgeFunctionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/blueprint-estimate/job-status?job_id=${jobId}`;

        const response = await axios.get(edgeFunctionUrl, {
          headers: {
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
        });

        const data = response.data;
        if (!data || !data.status) {
          console.warn(`[Polling] Job ID ${jobId} status not yet available...`);
          return;
        }

        console.log(`[Polling] Job ${jobId} status: ${data.status} (reconciled: ${data.reconciled})`);

        if (data.status === "done") {
          console.log(`[Polling] Job ${jobId} finished successfully!`);
          if (intervalRef.current) window.clearInterval(intervalRef.current);
          onDoneRef.current(data.detail);
        } else if (data.status === "fail") {
          console.error(`[Polling] Job ${jobId} failed with message: ${data.message}`);
          if (intervalRef.current) window.clearInterval(intervalRef.current);
          onFailRef.current(data.message || "Processing failed.");
        }
      } catch (error: any) {
        // Fallback to direct table read if edge function returned temporary 5xx
        try {
          const fallbackRes = await axios.get(
            `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/pdf_jobs?id=eq.${jobId}&select=status,detail,message`,
            {
              headers: {
                Authorization: `Bearer ${localStorage.getItem("access_token")}`,
                apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
              },
            }
          );
          const fbData = fallbackRes.data?.[0];
          if (fbData?.status === "done") {
            if (intervalRef.current) window.clearInterval(intervalRef.current);
            onDoneRef.current(fbData.detail);
          } else if (fbData?.status === "fail") {
            if (intervalRef.current) window.clearInterval(intervalRef.current);
            onFailRef.current(fbData.message || "Processing failed.");
          }
        } catch {
          console.warn("[Polling] Transient error during status check. Retrying...");
        }
      }
    };

    poll(); // immediate first call
    intervalRef.current = window.setInterval(poll, 4000);

    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [jobId]); 
}
