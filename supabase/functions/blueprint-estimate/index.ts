// Supabase Edge Function: blueprint-estimate
// Secure Blueprint PDF upload, ownership verification, atomic credit transactions,
// and AI estimation job orchestration for Constil & ChatGPT Plugin.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } from "npm:@aws-sdk/client-s3@3.740.0";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3.740.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, ngrok-skip-browser-warning",
};

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const PRESIGNED_URL_EXPIRES_IN = 900; // 15 minutes (900 seconds)

const ALLOWED_SCOPES = [
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
];

function getS3Client(): { s3: S3Client; bucket: string; region: string } {
  const region = Deno.env.get("AWS_REGION") || Deno.env.get("VITE_AWS_REGION") || "us-east-1";
  const accessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID") || Deno.env.get("VITE_AWS_ACCESS_KEY_ID") || "";
  const secretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY") || Deno.env.get("VITE_AWS_SECRET_ACCESS_KEY") || "";
  const bucket = Deno.env.get("AWS_STORAGE_BUCKET_NAME") || Deno.env.get("VITE_AWS_STORAGE_BUCKET_NAME") || "paybue-invoice-estimation";

  if (!accessKeyId || !secretAccessKey) {
    throw new Error("AWS credentials not configured in server environment secrets.");
  }

  const s3 = new S3Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  return { s3, bucket, region };
}

async function computePayloadHash(payload: Record<string, unknown>): Promise<string> {
  const encoder = new TextEncoder();
  const sortedKeys = Object.keys(payload).sort();
  const normalized = JSON.stringify(sortedKeys.map((k) => [k, payload[k]]));
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(normalized));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceKey) {
    return jsonResponse({ error: "Server configuration missing: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY." }, 500);
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

  // 1. Authenticate user strictly from Bearer Token (Ignore any client-supplied user_id)
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing Authorization header." }, 401);
  }

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return jsonResponse({ error: "Invalid Authorization token." }, 401);
  }

  const { data: authData, error: authError } = await serviceClient.auth.getUser(token);
  if (authError || !authData?.user) {
    return jsonResponse({ error: "Unauthorized: Invalid or expired session token." }, 401);
  }

  const userId = authData.user.id;
  const url = new URL(req.url);
  const path = url.pathname
    .replace(/^\/blueprint-estimate\/?/, "")
    .replace(/^\/functions\/v1\/blueprint-estimate\/?/, "");

  try {
    // -------------------------------------------------------------------------
    // ENDPOINT 1: CREATE PRESIGNED S3 UPLOAD URL
    // POST /blueprint-estimate/upload-url OR action: "create-upload-url"
    // -------------------------------------------------------------------------
    if (
      (req.method === "POST" && (path === "upload-url" || path === "create-upload-url")) ||
      (req.method === "POST" && path === "" && (await cloneBody(req)).action === "create-upload-url")
    ) {
      let body: any = {};
      try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON body." }, 400); }

      const filename = String(body.filename || "").trim();
      const fileSize = Number(body.file_size || 0);
      const contentType = String(body.content_type || "").trim().toLowerCase();

      // Validate Content-Type
      if (contentType !== "application/pdf") {
        return jsonResponse({
          error: "Invalid file type. Only PDF documents ('application/pdf') are supported.",
        }, 400);
      }

      // Validate Filename extension
      if (!filename.toLowerCase().endsWith(".pdf")) {
        return jsonResponse({
          error: "Invalid filename. File must have a .pdf extension.",
        }, 400);
      }

      // Validate File Size
      if (fileSize <= 0 || isNaN(fileSize)) {
        return jsonResponse({
          error: "Invalid file size. 'file_size' in bytes is required and must be greater than 0.",
        }, 400);
      }

      if (fileSize > MAX_FILE_SIZE) {
        return jsonResponse({
          error: `File size exceeds the limit of ${MAX_FILE_SIZE / (1024 * 1024)}MB.`,
          max_file_size_bytes: MAX_FILE_SIZE,
        }, 400);
      }

      // Generate isolated S3 key scoped strictly to authenticated user's prefix
      const randomSuffix = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
      const s3Key = `blueprints/${userId}/${Date.now()}_${randomSuffix}.pdf`;

      const { s3, bucket } = getS3Client();

      const putCommand = new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        ContentType: "application/pdf",
        Metadata: {
          uploaded_by: userId,
          original_filename: encodeURIComponent(filename.slice(0, 100)),
        },
      });

      const uploadUrl = await getSignedUrl(s3, putCommand, {
        expiresIn: PRESIGNED_URL_EXPIRES_IN,
      });

      return jsonResponse({
        success: true,
        upload_url: uploadUrl,
        pdf_key: s3Key,
        method: "PUT",
        required_headers: {
          "Content-Type": "application/pdf",
        },
        expires_in_seconds: PRESIGNED_URL_EXPIRES_IN,
        max_file_size_bytes: MAX_FILE_SIZE,
      });
    }

    // -------------------------------------------------------------------------
    // ENDPOINT 2: START AI ESTIMATION JOB
    // POST /blueprint-estimate/start-estimate OR action: "start-estimate"
    // -------------------------------------------------------------------------
    if (
      (req.method === "POST" && (path === "start-estimate" || path === "estimate")) ||
      (req.method === "POST" && path === "" && (await cloneBody(req)).action === "start-estimate")
    ) {
      let body: any = {};
      try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON body." }, 400); }

      const rawPdfKey = String(body.pdf_key || "").trim();
      const rawScopes = Array.isArray(body.selected_scopes) ? body.selected_scopes : [];
      const projectName = String(body.project_name || "Blueprint Project").trim().slice(0, 120);
      const idempotencyKey = body.idempotency_key ? String(body.idempotency_key).trim().slice(0, 100) : null;

      if (!rawPdfKey) {
        return jsonResponse({ error: "Missing required field: 'pdf_key'." }, 400);
      }

      // Step 2.1: Strict S3 Object Ownership Verification
      // Object key MUST strictly belong to this user's folder: blueprints/<userId>/...
      const expectedPrefix = `blueprints/${userId}/`;
      if (!rawPdfKey.startsWith(expectedPrefix)) {
        return jsonResponse({
          error: "Forbidden: You do not own this blueprint key. The object key must match the authenticated user prefix.",
        }, 403);
      }

      // Disallow path traversal attempts
      if (rawPdfKey.includes("..") || rawPdfKey.includes("//")) {
        return jsonResponse({ error: "Invalid S3 object key format." }, 400);
      }

      // Step 2.2: Verify S3 Object Existence, Size, and Content Type
      const { s3, bucket } = getS3Client();
      let actualSize = 0;
      try {
        const headCmd = new HeadObjectCommand({
          Bucket: bucket,
          Key: rawPdfKey,
        });
        const headRes = await s3.send(headCmd);
        actualSize = headRes.ContentLength || 0;

        if (actualSize <= 0) {
          return jsonResponse({ error: "Uploaded blueprint file is empty." }, 400);
        }

        if (actualSize > MAX_FILE_SIZE) {
          return jsonResponse({
            error: `Uploaded blueprint file size (${actualSize} bytes) exceeds maximum limit of ${MAX_FILE_SIZE} bytes (50MB).`,
            max_file_size_bytes: MAX_FILE_SIZE,
          }, 400);
        }

        if (headRes.ContentType && !headRes.ContentType.toLowerCase().includes("pdf")) {
          return jsonResponse({
            error: `Uploaded object Content-Type '${headRes.ContentType}' is not a valid PDF.`,
          }, 400);
        }
      } catch (headErr: any) {
        if (headErr?.name === "NotFound" || headErr?.$metadata?.httpStatusCode === 404) {
          return jsonResponse({
            error: "Uploaded blueprint not found in S3 storage. Please upload the PDF file before starting estimation.",
          }, 400);
        }
        console.error("[S3 HeadObject Error]:", headErr);
        return jsonResponse({ error: "Storage verification failed." }, 500);
      }

      // Step 2.3: Verify Magic Bytes / PDF Signature (%PDF-)
      try {
        const getCmd = new GetObjectCommand({
          Bucket: bucket,
          Key: rawPdfKey,
          Range: "bytes=0-7",
        });
        const getRes = await s3.send(getCmd);
        const headerBytes = await getRes.Body?.transformToByteArray();

        const isPdfMagic =
          headerBytes &&
          headerBytes.length >= 5 &&
          headerBytes[0] === 0x25 && // %
          headerBytes[1] === 0x50 && // P
          headerBytes[2] === 0x44 && // D
          headerBytes[3] === 0x46 && // F
          headerBytes[4] === 0x2d;   // -

        if (!isPdfMagic) {
          return jsonResponse({
            error: "Invalid file signature: uploaded file is not a valid PDF document (magic bytes mismatch).",
          }, 400);
        }
      } catch (sigErr: any) {
        console.warn("[PDF Signature Check Warning]:", sigErr);
        // If range read fails due to storage permissions or configuration, report error
        return jsonResponse({ error: "Failed to verify PDF file signature." }, 400);
      }

      // Step 2.4: Validate Selected Scopes
      let selectedScopes = rawScopes.map((s: any) => String(s).trim());
      if (selectedScopes.length === 0) {
        selectedScopes = ["Overall"];
      } else {
        for (const scope of selectedScopes) {
          if (!ALLOWED_SCOPES.includes(scope)) {
            return jsonResponse({
              error: `Invalid scope: '${scope}'. Allowed scopes: ${ALLOWED_SCOPES.join(", ")}.`,
              allowed_scopes: ALLOWED_SCOPES,
            }, 400);
          }
        }
      }

      // Step 2.5: Compute Normalized Request Payload Hash for Idempotency
      const payloadHash = await computePayloadHash({
        pdf_key: rawPdfKey,
        selected_scopes: [...selectedScopes].sort(),
        project_name: projectName,
      });

      // Step 2.6: Enforce Downstream Worker Authentication (Fail-Closed)
      const fastApiUrl = Deno.env.get("FASTAPI_URL") || "https://paybue-quee.hnhsofttechsolutions.com";
      const fastApiSecret = Deno.env.get("FASTAPI_SHARED_SECRET") || Deno.env.get("FASTAPI_AUTH_TOKEN");

      if (!fastApiSecret) {
        return jsonResponse({
          error: "AI estimation worker authentication secret (FASTAPI_SHARED_SECRET) is not configured on the server. Estimation dispatch is blocked to prevent unauthenticated upstream worker execution (fail-closed).",
          code: "WORKER_AUTH_NOT_CONFIGURED",
        }, 503);
      }

      // Step 2.7: Atomic Job Creation, Credit Deduction & Idempotency via Database Transaction RPC
      const { data: atomicRes, error: atomicErr } = await serviceClient.rpc(
        "start_pdf_estimation_atomic",
        {
          p_user_id: userId,
          p_pdf_key: rawPdfKey,
          p_filename: projectName,
          p_idempotency_key: idempotencyKey,
          p_payload_hash: payloadHash,
          p_scopes: selectedScopes,
          p_plan_name: projectName,
        }
      );

      if (atomicErr) {
        console.error("[start_pdf_estimation_atomic RPC Error]:", atomicErr);

        if (atomicErr.message?.includes("IDEMPOTENCY_PAYLOAD_MISMATCH") || atomicErr.code === "P0001") {
          return jsonResponse({
            error: "Conflict: Idempotency key reused with different request payload.",
            code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
          }, 409);
        }

        if (atomicErr.message?.includes("INSUFFICIENT_CREDITS") || atomicErr.code === "P0003") {
          return jsonResponse({
            error: "Insufficient credits to perform AI Estimation.",
            code: "INSUFFICIENT_CREDITS",
          }, 402);
        }

        if (atomicErr.message?.includes("ACTION_DISABLED") || atomicErr.code === "P0002") {
          return jsonResponse({
            error: "AI Estimate action is currently disabled by administrator.",
            code: "ACTION_DISABLED",
          }, 403);
        }

        return jsonResponse({ error: atomicErr.message || "Failed to initialize estimation job transaction." }, 500);
      }

      const jobId = atomicRes.job_id;
      const isRetry = atomicRes.is_retry === true;

      // If this is an idempotent replay of an already-queued or finished job, return immediately without duplicate deduction or worker re-dispatch
      if (isRetry) {
        return jsonResponse({
          success: true,
          job_id: jobId,
          status: atomicRes.job_status || "pending",
          message: "Existing active estimation job returned (idempotent replay). No duplicate credits deducted.",
          is_retry: true,
          credits_deducted: 0,
        });
      }

      // Step 2.8: Dispatch to Downstream FastAPI Estimation Worker
      const fastApiPayload = {
        job_id: jobId,
        pdf_key: rawPdfKey,
        selected_scopes: selectedScopes,
        project_name: projectName,
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s synchronous dispatch timeout

      try {
        const fastApiRes = await fetch(`${fastApiUrl}/estimate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${fastApiSecret}`,
            "X-Internal-Secret": fastApiSecret,
            "ngrok-skip-browser-warning": "true",
          },
          body: JSON.stringify(fastApiPayload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!fastApiRes.ok) {
          const errText = await fastApiRes.text();
          console.error(`[FastAPI Worker Rejected ${fastApiRes.status}]:`, errText);

          // Confirmed worker rejection -> Atomic transactional refund
          await serviceClient.rpc("refund_pdf_estimation_atomic", {
            p_user_id: userId,
            p_job_id: jobId,
            p_reason: `Downstream AI worker rejected task with status ${fastApiRes.status}: ${errText.slice(0, 150)}`,
          });

          return jsonResponse({
            error: "Downstream AI estimation service rejected the task. Your credits have been transactionally refunded.",
            job_id: jobId,
            status: "fail",
          }, 502);
        }

        const fastApiData = await fastApiRes.json();

        return jsonResponse({
          success: true,
          job_id: jobId,
          task_id: fastApiData?.task_id || null,
          status: "pending",
          pdf_key: rawPdfKey,
          selected_scopes: selectedScopes,
          project_name: projectName,
          credits_deducted: atomicRes.credits_deducted,
          remaining_credits: atomicRes.remaining_credits,
        });
      } catch (dispatchErr: any) {
        clearTimeout(timeoutId);
        const isTimeout = dispatchErr.name === "AbortError" || dispatchErr.code === 20;

        if (isTimeout) {
          // Worker timeout: NOT confirmed failure!
          // Worker may have received the payload and queued the task.
          // Do NOT refund and do NOT mark job failed.
          console.warn(`[FastAPI Dispatch Timeout]: Awaiting async worker completion for job ${jobId}. Preserving credits.`);
          await serviceClient
            .from("pdf_jobs")
            .update({
              status: "processing",
              message: "Job dispatched to AI worker; awaiting asynchronous completion.",
            })
            .eq("id", jobId);

          return jsonResponse({
            success: true,
            job_id: jobId,
            status: "processing",
            message: "Job dispatched to AI worker. The synchronous worker acknowledgment timed out, but the background task is queued. Please poll status.",
            credits_deducted: atomicRes.credits_deducted,
            remaining_credits: atomicRes.remaining_credits,
            warning: "DOWNSTREAM_TIMEOUT",
          }, 202);
        }

        // Connection failure before reaching worker -> Atomic transactional refund
        console.error("[FastAPI Connection Error]:", dispatchErr);
        await serviceClient.rpc("refund_pdf_estimation_atomic", {
          p_user_id: userId,
          p_job_id: jobId,
          p_reason: `Downstream AI worker connection failure: ${dispatchErr.message || "Connection refused"}`,
        });

        return jsonResponse({
          error: "Downstream AI estimation worker is currently unreachable. Your credits have been transactionally refunded.",
          job_id: jobId,
          status: "fail",
        }, 502);
      }
    }

    // -------------------------------------------------------------------------
    // ENDPOINT 3: GET JOB STATUS & RESULTS
    // GET /blueprint-estimate/job-status?job_id=... OR action: "get-job-status"
    // -------------------------------------------------------------------------
    if (
      (req.method === "GET" && (path === "job-status" || path === "status")) ||
      (req.method === "POST" && path === "" && (await cloneBody(req)).action === "get-job-status")
    ) {
      let jobId = url.searchParams.get("job_id");
      if (!jobId && req.method === "POST") {
        try {
          const b = await req.json();
          jobId = b.job_id;
        } catch { }
      }

      if (!jobId) {
        return jsonResponse({ error: "Missing 'job_id' parameter." }, 400);
      }

      const { data: job, error: jobErr } = await serviceClient
        .from("pdf_jobs")
        .select("id, userid, user_id, pdf_key, status, detail, message, created_at, filename")
        .eq("id", jobId)
        .single();

      if (jobErr || !job) {
        return jsonResponse({ error: "Job not found." }, 404);
      }

      // Strict Ownership Enforcement: Only the job owner can access results
      if (job.userid !== userId && job.user_id !== userId) {
        return jsonResponse({ error: "Job not found or access denied." }, 404);
      }

      return jsonResponse({
        success: true,
        job_id: job.id,
        status: job.status,
        message: job.message,
        created_at: job.created_at,
        filename: job.filename,
        pdf_key: job.pdf_key,
        detail: job.status === "done" ? job.detail : null,
      });
    }

    return jsonResponse({
      error: "Unrecognized route. Supported: POST /upload-url, POST /start-estimate, GET /job-status",
    }, 404);
  } catch (err: any) {
    console.error("[Unhandled Blueprint Estimate Function Error]:", err);
    return jsonResponse({ error: err?.message || "Internal server error." }, 500);
  }
});

async function cloneBody(req: Request): Promise<any> {
  try {
    const clone = req.clone();
    return await clone.json();
  } catch {
    return {};
  }
}
