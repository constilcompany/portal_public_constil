// Supabase Edge Function: blueprint-estimate
// Secure Blueprint/Invoice/Estimate file upload, ownership verification, atomic credit transactions,
// protected accounting ledger, and AI estimation job orchestration for Constil & ChatGPT Plugin.

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

const ALLOWED_UPLOAD_FOLDERS = ["blueprints", "invoices", "estimates", "logos", "signatures"];

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


async function reconcileJobStatus(
  serviceClient: any,
  userId: string,
  job: any,
  fastApiUrl: string,
  fastApiSecret: string | undefined
) {
  if (!fastApiSecret) {
    return {
      status: job.status,
      message: job.message,
      detail: job.detail,
      reconciled: false,
    };
  }

  try {
    const recController = new AbortController();
    const recTimeout = setTimeout(() => recController.abort(), 8000);

    const recRes = await fetch(`${fastApiUrl}/estimate/reconcile/${job.id}`, {
      headers: {
        "Authorization": `Bearer ${fastApiSecret}`,
        "X-Internal-Secret": fastApiSecret,
        "ngrok-skip-browser-warning": "true",
      },
      signal: recController.signal,
    });
    clearTimeout(recTimeout);

    if (recRes.ok) {
      const recData = await recRes.json();
      const resolution = recData.resolution || (recData.accepted ? "CONFIRMED_ACCEPTED" : "UNCERTAIN");

      if (resolution === "CONFIRMED_ACCEPTED" || recData.accepted === true) {
        // Worker CONFIRMED acceptance and execution state!
        // Determine completion from persisted results, NOT Celery SUCCESS alone
        // (skipped/rejected tasks also return successfully in Celery AsyncResult).
        const hasPersistedResult = Boolean(recData.has_persisted_result || recData.outbox_status === "COMPLETED");

        if (hasPersistedResult) {
          // Conditional transition: only update if not already finalized
          await serviceClient
            .from("pdf_jobs")
            .update({
              status: "done",
              message: `Confirmed accepted and completed by worker. Celery task: ${recData.task_id || "active"}`,
            })
            .eq("id", job.id)
            .in("status", ["pending", "dispatch_unknown", "processing"]);
        } else {
          // Prevent reconciliation from overwriting processing, done or fail with pending/dispatch_unknown.
          // Use conditional transitions: only update if currently pending or dispatch_unknown.
          const targetStatus = recData.is_executing ? "processing" : "pending";
          await serviceClient
            .from("pdf_jobs")
            .update({
              status: targetStatus,
              message: `Confirmed accepted by worker. Celery task: ${recData.task_id || "active"}`,
            })
            .eq("id", job.id)
            .in("status", ["pending", "dispatch_unknown"]);
        }

        // Re-read pdf_jobs after reconciliation and return its current detail and status
        const { data: latestJob } = await serviceClient
          .from("pdf_jobs")
          .select("id, status, message, detail")
          .eq("id", job.id)
          .single();

        return {
          status: latestJob?.status || (hasPersistedResult ? "done" : "processing"),
          message: latestJob?.message || "Worker accepted and confirmed task execution.",
          detail: latestJob?.detail || null,
          reconciled: true,
          task_id: recData.task_id,
        };
      } else if (resolution === "CONFIRMED_REJECTED") {
        // Worker confirms task was rejected and will NEVER execute!
        // Step 1: Atomically fence / cancel the job in the worker outbox before refunding
        let fenceConfirmed = false;
        let fenceFailMessage = "";
        try {
          const fenceRes = await fetch(`${fastApiUrl}/estimate/fence-or-cancel/${job.id}`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${fastApiSecret}`,
              "X-Internal-Secret": fastApiSecret,
              "ngrok-skip-browser-warning": "true",
            },
          });
          if (fenceRes.ok) {
            const fenceData = await fenceRes.json();
            if (fenceData && fenceData.can_refund === true && fenceData.durable_cancellation === true) {
              fenceConfirmed = true;
            } else {
              fenceFailMessage = fenceData?.message || "Worker reported task cannot be refunded or cancellation unconfirmed";
            }
          } else {
            fenceFailMessage = `Fencing endpoint returned HTTP ${fenceRes.status}`;
          }
        } catch (fenceErr: any) {
          fenceFailMessage = `Worker fencing unreachable: ${fenceErr.message}`;
        }

        if (!fenceConfirmed) {
          console.warn("[Fence Warning]:", fenceFailMessage);
          // Fencing failed, can_refund is false, or unconfirmed: DO NOT refund! Preserve dispatch_unknown!
          const { data: latestJob } = await serviceClient
            .from("pdf_jobs")
            .select("id, status, message, detail")
            .eq("id", job.id)
            .single();

          return {
            status: latestJob?.status || job.status,
            message: `Worker fencing unconfirmed (${fenceFailMessage}). Preserving dispatch_unknown without refund.`,
            detail: latestJob?.detail || job.detail,
            reconciled: false,
          };
        }

        // Step 2: Now that job is fenced, issue atomic transactional refund via protected ledger
        const { error: refundErr } = await serviceClient.rpc("refund_pdf_estimation_atomic", {
          p_user_id: userId,
          p_job_id: job.id,
          p_reason: `Reconciliation confirmed rejection: ${recData.message || "Task rejected by worker"}`,
        });

        if (refundErr) {
          console.error("[Refund RPC Error]:", refundErr);
          const { data: latestJob } = await serviceClient
            .from("pdf_jobs")
            .select("id, status, message, detail")
            .eq("id", job.id)
            .single();

          return {
            status: latestJob?.status || "dispatch_unknown",
            message: `Reconciliation confirmed rejection, but credit refund failed: ${refundErr.message}. Retaining without refund.`,
            detail: latestJob?.detail || job.detail,
            reconciled: false,
          };
        }

        // Conditional transition: only mark fail if not already done
        await serviceClient
          .from("pdf_jobs")
          .update({
            status: "fail",
            message: "Reconciliation confirmed task rejected by worker. Credits refunded.",
          })
          .eq("id", job.id)
          .in("status", ["pending", "dispatch_unknown"]);

        const { data: latestJob } = await serviceClient
          .from("pdf_jobs")
          .select("id, status, message, detail")
          .eq("id", job.id)
          .single();

        return {
          status: latestJob?.status || "fail",
          message: "Worker confirmed task was rejected. Credits refunded.",
          detail: latestJob?.detail || null,
          reconciled: true,
          refunded: true,
        };
      } else {
        // resolution is "UNCERTAIN" (e.g. pending outbox recovery):
        // DO NOT REFUND! Preserve dispatch_unknown for future polling/sweeper
        const { data: latestJob } = await serviceClient
          .from("pdf_jobs")
          .select("id, status, message, detail")
          .eq("id", job.id)
          .single();

        return {
          status: latestJob?.status || job.status,
          message: `Worker state is uncertain (${recData.state || "PENDING_RECOVERY"}). Preserving dispatch_unknown.`,
          detail: latestJob?.detail || job.detail,
          reconciled: false,
        };
      }
    }
  } catch (err: any) {
    console.warn("[Reconciliation Check Pending]:", err?.message);
  }

  // Re-read latest state from Supabase
  const { data: latestJob } = await serviceClient
    .from("pdf_jobs")
    .select("id, status, message, detail")
    .eq("id", job.id)
    .single();

  return {
    status: latestJob?.status || job.status,
    message: latestJob?.message || job.message,
    detail: latestJob?.detail || job.detail,
    reconciled: false,
  };
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
    // Supports: blueprints, invoices, estimates, logos, signatures
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
      const rawContentType = String(body.content_type || "").trim().toLowerCase();
      const targetFolder = String(body.folder || "blueprints").trim().toLowerCase();

      // Validate Folder
      if (!ALLOWED_UPLOAD_FOLDERS.includes(targetFolder)) {
        return jsonResponse({
          error: `Invalid upload folder: '${targetFolder}'. Allowed folders: ${ALLOWED_UPLOAD_FOLDERS.join(", ")}.`,
          allowed_folders: ALLOWED_UPLOAD_FOLDERS,
        }, 400);
      }

      // Validate Content-Type based on folder
      let validatedContentType = rawContentType;
      if (targetFolder === "blueprints" || targetFolder === "invoices" || targetFolder === "estimates") {
        if (rawContentType !== "application/pdf" && !filename.toLowerCase().endsWith(".pdf")) {
          return jsonResponse({
            error: `Invalid file type for ${targetFolder}. Only PDF documents ('application/pdf') are supported.`,
          }, 400);
        }
        validatedContentType = "application/pdf";
      } else if (targetFolder === "logos" || targetFolder === "signatures") {
        const allowedImageTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml", "application/pdf"];
        if (!allowedImageTypes.includes(rawContentType)) {
          return jsonResponse({
            error: `Invalid file type for ${targetFolder}. Allowed: ${allowedImageTypes.join(", ")}.`,
          }, 400);
        }
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

      // Extract file extension cleanly
      const nameParts = filename.split(".");
      const ext = nameParts.length > 1 ? nameParts.pop()!.toLowerCase().replace(/[^a-z0-9]/g, "") : (validatedContentType.includes("pdf") ? "pdf" : "png");

      // Generate isolated S3 key scoped strictly to authenticated user's prefix: folder/userId/timestamp_rand.ext
      const randomSuffix = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
      const s3Key = `${targetFolder}/${userId}/${Date.now()}_${randomSuffix}.${ext}`;

      const { s3, bucket } = getS3Client();

      const putCommand = new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        ContentType: validatedContentType,
        Metadata: {
          uploaded_by: userId,
          folder: targetFolder,
          original_filename: encodeURIComponent(filename.slice(0, 100)),
        },
      });

      const uploadUrl = await getSignedUrl(s3, putCommand, {
        expiresIn: PRESIGNED_URL_EXPIRES_IN,
      });

      return jsonResponse({
        success: true,
        upload_url: uploadUrl,
        s3_key: s3Key,
        pdf_key: s3Key, // backwards compatibility
        folder: targetFolder,
        method: "PUT",
        required_headers: {
          "Content-Type": validatedContentType,
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

      // Step 2.7: Atomic Job Creation, Credit Deduction & Protected Ledger via Service-Role RPC
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

      // If this is an idempotent replay of an already-queued or finished job, return immediately
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
          console.warn(`[FastAPI Worker Response ${fastApiRes.status}]:`, errText);

          // If status is 5xx (500, 502, 503, 504), this is UNCERTAIN dispatch:
          // DO NOT REFUND! Preserve dispatch_unknown.
          if (fastApiRes.status >= 500) {
            console.warn(`[FastAPI 5xx Uncertain Dispatch ${fastApiRes.status}]: Preserving dispatch_unknown for job ${jobId}`);
            await serviceClient
              .from("pdf_jobs")
              .update({
                status: "dispatch_unknown",
                message: `Worker returned status ${fastApiRes.status}. Awaiting reconciliation.`,
              })
              .eq("id", jobId);

            return jsonResponse({
              success: true,
              job_id: jobId,
              status: "dispatch_unknown",
              message: `AI worker returned status ${fastApiRes.status}. Acceptance unconfirmed (dispatch_unknown). Reconciliation required.`,
              credits_deducted: atomicRes.credits_deducted,
              remaining_credits: atomicRes.remaining_credits,
              reconciliation_required: true,
            }, 202);
          }

          // If status is 4xx (client validation error, e.g. 400 Bad Request, 409 Conflict):
          // Requirement 1: Verify fencing response: response.ok AND can_refund === true AND durable cancellation confirmed.
          // Catch-and-ignore mat karo. Failure/unknown par dispatch_unknown preserve karo.
          let fenceOk = false;
          let fenceFailReason = "";
          try {
            const fenceRes = await fetch(`${fastApiUrl}/estimate/fence-or-cancel/${jobId}`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${fastApiSecret}`,
                "X-Internal-Secret": fastApiSecret,
                "ngrok-skip-browser-warning": "true",
              },
            });

            if (fenceRes.ok) {
              const fenceData = await fenceRes.json();
              if (fenceData && fenceData.can_refund === true && fenceData.durable_cancellation === true) {
                fenceOk = true;
              } else {
                fenceFailReason = fenceData?.message || "Worker reported cannot refund or unconfirmed cancellation";
              }
            } else {
              fenceFailReason = `Fencing endpoint returned HTTP ${fenceRes.status}`;
            }
          } catch (fenceErr: any) {
            fenceFailReason = `Fencing call failed or timed out: ${fenceErr.message}`;
          }

          if (!fenceOk) {
            // Failure or unknown fencing: PRESERVE dispatch_unknown, DO NOT refund!
            console.warn(`[Fencing Failed on 4xx]: ${fenceFailReason}. Preserving dispatch_unknown.`);
            await serviceClient
              .from("pdf_jobs")
              .update({
                status: "dispatch_unknown",
                message: `Worker returned status ${fastApiRes.status}, but fencing unconfirmed: ${fenceFailReason}. Preserving dispatch_unknown without refund.`,
              })
              .eq("id", jobId);

            return jsonResponse({
              success: false,
              job_id: jobId,
              status: "dispatch_unknown",
              message: `Downstream service returned ${fastApiRes.status}, but durable cancellation was not confirmed (${fenceFailReason}). Credits NOT refunded to prevent double spend.`,
              credits_deducted: atomicRes.credits_deducted,
              remaining_credits: atomicRes.remaining_credits,
              reconciliation_required: true,
            }, 202);
          }

          // Fencing confirmed! Issue atomic refund via protected ledger
          const { error: refundErr } = await serviceClient.rpc("refund_pdf_estimation_atomic", {
            p_user_id: userId,
            p_job_id: jobId,
            p_reason: `Downstream worker rejected task with status ${fastApiRes.status}: ${errText.slice(0, 150)}`,
          });

          if (refundErr) {
            console.error(`[Refund RPC Error on 4xx]: ${refundErr.message}`);
            await serviceClient
              .from("pdf_jobs")
              .update({
                status: "fail",
                message: `Worker rejected request (${fastApiRes.status}), but credit refund RPC failed: ${refundErr.message}.`,
              })
              .eq("id", jobId);

            return jsonResponse({
              error: `Downstream service rejected request (${fastApiRes.status}), but credit refund failed: ${refundErr.message}. Credits NOT refunded.`,
              job_id: jobId,
              status: "fail",
              refund_status: "failed",
            }, 500);
          }

          // Refund succeeded
          await serviceClient
            .from("pdf_jobs")
            .update({
              status: "fail",
              message: `Downstream worker rejected request: ${errText.slice(0, 150)}. Credits refunded.`,
            })
            .eq("id", jobId);

          return jsonResponse({
            error: `Downstream estimation service rejected request: ${errText.slice(0, 150)}. Credits refunded.`,
            job_id: jobId,
            status: "fail",
            refund_status: "refunded",
          }, fastApiRes.status);
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
        // Any timeout, network error, or abort MUST NOT refund! Preserve dispatch_unknown!
        console.warn(`[FastAPI Dispatch Network Error / Timeout]: Preserving dispatch_unknown for job ${jobId}: ${dispatchErr.message}`);
        await serviceClient
          .from("pdf_jobs")
          .update({
            status: "dispatch_unknown",
            message: `Dispatch network error: ${dispatchErr.message || "Timeout"}. Acceptance unconfirmed.`,
          })
          .eq("id", jobId);

        return jsonResponse({
          success: true,
          job_id: jobId,
          status: "dispatch_unknown",
          message: "AI worker dispatch encountered network error/timeout. Job state is unconfirmed (dispatch_unknown). Reconciliation required.",
          credits_deducted: atomicRes.credits_deducted,
          remaining_credits: atomicRes.remaining_credits,
          warning: "WORKER_DISPATCH_UNCERTAIN",
          reconciliation_required: true,
        }, 202);
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

      let currentStatus = job.status;
      let currentMessage = job.message;
      let currentDetail = job.detail;
      let reconciled = false;

      // dispatch_unknown reconciliation: do NOT refund on timeout blindly; verify worker acceptance first
      if (job.status === "dispatch_unknown") {
        const fastApiUrl = Deno.env.get("FASTAPI_URL") || "https://paybue-quee.hnhsofttechsolutions.com";
        const fastApiSecret = Deno.env.get("FASTAPI_SHARED_SECRET") || Deno.env.get("FASTAPI_AUTH_TOKEN");
        const recResult = await reconcileJobStatus(serviceClient, userId, job, fastApiUrl, fastApiSecret);
        currentStatus = recResult.status;
        currentMessage = recResult.message;
        currentDetail = recResult.detail ?? job.detail;
        reconciled = recResult.reconciled;
      }

      return jsonResponse({
        success: true,
        job_id: job.id,
        status: currentStatus,
        message: currentMessage,
        reconciled,
        created_at: job.created_at,
        filename: job.filename,
        pdf_key: job.pdf_key,
        detail: currentStatus === "done" ? currentDetail : null,
      });
    }

    // -------------------------------------------------------------------------
    // ENDPOINT 4: PROXY SECURE QUOTE GENERATION
    // POST /blueprint-estimate/quote OR action: "quote"
    // -------------------------------------------------------------------------
    if (
      (req.method === "POST" && (path === "quote" || path === "generate-quote")) ||
      (req.method === "POST" && path === "" && (await cloneBody(req)).action === "quote")
    ) {
      const fastApiUrl = Deno.env.get("FASTAPI_URL") || "https://paybue-quee.hnhsofttechsolutions.com";
      const fastApiSecret = Deno.env.get("FASTAPI_SHARED_SECRET") || Deno.env.get("FASTAPI_AUTH_TOKEN");

      if (!fastApiSecret) {
        return jsonResponse({
          error: "AI estimation worker authentication secret is not configured on the server (fail-closed).",
          code: "WORKER_AUTH_NOT_CONFIGURED",
        }, 503);
      }

      let quoteBody: any = {};
      try {
        quoteBody = await req.json();
      } catch {
        return jsonResponse({ error: "Invalid JSON body for quote request." }, 400);
      }

      const quoteController = new AbortController();
      const quoteTimeout = setTimeout(() => quoteController.abort(), 30000);

      try {
        const quoteRes = await fetch(`${fastApiUrl}/quote`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${fastApiSecret}`,
            "X-Internal-Secret": fastApiSecret,
            "ngrok-skip-browser-warning": "true",
          },
          body: JSON.stringify(quoteBody),
          signal: quoteController.signal,
        });

        clearTimeout(quoteTimeout);

        if (!quoteRes.ok) {
          const errText = await quoteRes.text();
          return jsonResponse({ error: `Quote backend returned ${quoteRes.status}: ${errText}` }, quoteRes.status);
        }

        const quoteData = await quoteRes.json();
        return jsonResponse(quoteData);
      } catch (err: any) {
        clearTimeout(quoteTimeout);
        return jsonResponse({ error: `Failed to communicate with quote service: ${err?.message || "Service unavailable"}` }, 502);
      }
    }

    // -------------------------------------------------------------------------
    // ENDPOINT 5: RECONCILE DISPATCH_UNKNOWN ON DEMAND
    // GET/POST /blueprint-estimate/reconcile?job_id=... OR action: "reconcile"
    // -------------------------------------------------------------------------
    if (
      path === "reconcile" || path === "reconcile-job" ||
      (req.method === "POST" && path === "" && (await cloneBody(req)).action === "reconcile")
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

      if (job.userid !== userId && job.user_id !== userId) {
        return jsonResponse({ error: "Job not found or access denied." }, 404);
      }

      const fastApiUrl = Deno.env.get("FASTAPI_URL") || "https://paybue-quee.hnhsofttechsolutions.com";
      const fastApiSecret = Deno.env.get("FASTAPI_SHARED_SECRET") || Deno.env.get("FASTAPI_AUTH_TOKEN");
      const recResult = await reconcileJobStatus(serviceClient, userId, job, fastApiUrl, fastApiSecret);

      return jsonResponse({
        success: true,
        job_id: jobId,
        ...recResult,
      });
    }

    return jsonResponse({
      error: "Unrecognized route. Supported: POST /upload-url, POST /start-estimate, GET /job-status, POST /quote, GET/POST /reconcile",
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
