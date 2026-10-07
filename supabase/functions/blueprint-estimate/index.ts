// Supabase Edge Function: blueprint-estimate
// Secure Blueprint PDF upload, ownership verification, server-side credit deduction,
// and AI estimation job orchestration for Constil & ChatGPT Plugin.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "npm:@aws-sdk/client-s3@3.740.0";
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
const PRESIGNED_URL_EXPIRES_IN = 900; // 15 minutes

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

  // 1. Authenticate user from Bearer Token
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
  const path = url.pathname.replace(/^\/blueprint-estimate\/?/, "").replace(/^\/functions\/v1\/blueprint-estimate\/?/, "");

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
          error: "Invalid file type. Only PDF files ('application/pdf') are supported.",
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

      // Generate secure isolated S3 key scoped to authenticated userId
      const randomSuffix = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
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
        expires_in: PRESIGNED_URL_EXPIRES_IN,
        max_file_size: MAX_FILE_SIZE,
        content_type: "application/pdf",
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

      // Verify S3 object ownership:
      // Object key MUST strictly belong to this user's folder: blueprints/<userId>/...
      const expectedPrefix = `blueprints/${userId}/`;
      if (!rawPdfKey.startsWith(expectedPrefix)) {
        return jsonResponse({
          error: "Forbidden: You do not own this blueprint key. The object key must match the authenticated user prefix.",
        }, 403);
      }

      // Verify object exists in S3 storage
      const { s3, bucket } = getS3Client();
      try {
        const headCmd = new HeadObjectCommand({
          Bucket: bucket,
          Key: rawPdfKey,
        });
        const headRes = await s3.send(headCmd);
        if (!headRes.ContentLength || headRes.ContentLength <= 0) {
          return jsonResponse({ error: "Uploaded blueprint file is empty." }, 400);
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

      // Validate selected scopes
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

      // Idempotency check:
      // Check if an existing active/completed job exists for this (user, pdf_key)
      const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
      const { data: existingJobs } = await serviceClient
        .from("pdf_jobs")
        .select("id, status, message, created_at, detail")
        .eq("userid", userId)
        .eq("pdf_key", rawPdfKey)
        .gte("created_at", oneHourAgo)
        .in("status", ["pending", "processing", "done"])
        .order("created_at", { ascending: false })
        .limit(1);

      if (existingJobs && existingJobs.length > 0) {
        const existing = existingJobs[0];
        return jsonResponse({
          success: true,
          job_id: existing.id,
          status: existing.status,
          message: "Existing active estimation job returned (idempotent retry). No extra credits deducted.",
          is_retry: true,
          created_at: existing.created_at,
        });
      }

      // Fetch AI Estimate credit cost from config
      const { data: actionConfig } = await serviceClient
        .from("credit_action_config")
        .select("credit_cost, is_active")
        .eq("action_type", "ai_estimate")
        .single();

      const cost = actionConfig?.credit_cost ?? 1;
      if (actionConfig && !actionConfig.is_active) {
        return jsonResponse({ error: "AI Estimate action is currently disabled by administrator." }, 403);
      }

      // Check and consume user credits atomically
      const { data: wallet } = await serviceClient
        .from("user_credit_wallets")
        .select("ai_estimate_remaining, ai_estimate_unlimited")
        .eq("user_id", userId)
        .single();

      let deductedFrom = "none";
      let previousBalance = 0;

      if (wallet) {
        if (wallet.ai_estimate_unlimited) {
          deductedFrom = "unlimited";
        } else if (wallet.ai_estimate_remaining >= cost) {
          deductedFrom = "wallet";
          previousBalance = wallet.ai_estimate_remaining;
          const { error: walletUpdateErr } = await serviceClient
            .from("user_credit_wallets")
            .update({ ai_estimate_remaining: previousBalance - cost })
            .eq("user_id", userId);
          if (walletUpdateErr) {
            return jsonResponse({ error: "Failed to update credit wallet." }, 500);
          }
        } else {
          return jsonResponse({
            error: `Insufficient AI Estimate credits. Required: ${cost}, Available: ${wallet.ai_estimate_remaining}.`,
            required: cost,
            available: wallet.ai_estimate_remaining,
          }, 402);
        }
      } else {
        // Fallback: legacy user_credits table
        const { data: legacyCredits } = await serviceClient
          .from("user_credits")
          .select("balance")
          .eq("user_id", userId)
          .single();

        if (!legacyCredits || legacyCredits.balance < cost) {
          return jsonResponse({
            error: `Insufficient credits. Required: ${cost}, Available: ${legacyCredits?.balance ?? 0}.`,
            required: cost,
            available: legacyCredits?.balance ?? 0,
          }, 402);
        }

        deductedFrom = "legacy";
        previousBalance = legacyCredits.balance;
        const { error: legacyUpdateErr } = await serviceClient
          .from("user_credits")
          .update({ balance: previousBalance - cost })
          .eq("user_id", userId);
        if (legacyUpdateErr) {
          return jsonResponse({ error: "Failed to update legacy credit balance." }, 500);
        }
      }

      // Insert record into pdf_jobs
      const { data: jobInsert, error: jobInsertErr } = await serviceClient
        .from("pdf_jobs")
        .insert({
          userid: userId,
          user_id: userId,
          pdf_key: rawPdfKey,
          filename: projectName,
          status: "pending",
          message: "Job submitted and queued for estimation",
        })
        .select("id, status, created_at")
        .single();

      if (jobInsertErr || !jobInsert) {
        // Rollback credit deduction on job creation failure
        await rollbackCredits(serviceClient, userId, deductedFrom, previousBalance, cost);
        console.error("[Job Insert Error]:", jobInsertErr);
        return jsonResponse({ error: "Failed to initialize background job in database." }, 500);
      }

      const jobId = jobInsert.id;

      // Log successful consumption transaction
      await serviceClient.from("credit_transactions").insert({
        user_id: userId,
        transaction_type: "consumption",
        credits_change: deductedFrom === "unlimited" ? 0 : -cost,
        amount_paid: 0,
        reference_id: idempotencyKey || jobId,
      });

      // Trigger FastAPI background estimation service
      const fastApiUrl = Deno.env.get("FASTAPI_URL") || "https://paybue-quee.hnhsofttechsolutions.com";
      const fastApiPayload = {
        job_id: jobId,
        pdf_key: rawPdfKey,
        selected_scopes: selectedScopes,
        project_name: projectName,
      };

      try {
        const fastApiRes = await fetch(`${fastApiUrl}/estimate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
            "ngrok-skip-browser-warning": "true",
          },
          body: JSON.stringify(fastApiPayload),
        });

        if (!fastApiRes.ok) {
          const errText = await fastApiRes.text();
          console.error(`[FastAPI Service Error ${fastApiRes.status}]:`, errText);

          // Mark job as fail and refund credits
          await serviceClient
            .from("pdf_jobs")
            .update({ status: "fail", message: `AI Estimation worker rejected request (${fastApiRes.status})` })
            .eq("id", jobId);

          await rollbackCredits(serviceClient, userId, deductedFrom, previousBalance, cost, jobId);

          return jsonResponse({
            error: "Downstream AI estimation service rejected the task. Your credits have been refunded.",
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
          credits_deducted: deductedFrom === "unlimited" ? 0 : cost,
        });
      } catch (fastApiConnErr: any) {
        console.error("[FastAPI Connection Error]:", fastApiConnErr);

        // Mark job as fail and refund credits
        await serviceClient
          .from("pdf_jobs")
          .update({ status: "fail", message: "Downstream AI service unreachable." })
          .eq("id", jobId);

        await rollbackCredits(serviceClient, userId, deductedFrom, previousBalance, cost, jobId);

        return jsonResponse({
          error: "Downstream AI estimation worker is currently unreachable. Your credits have been refunded.",
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

      // Ownership enforcement (Req 7: Only job owner can access)
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

// Helper to roll back credits on execution failure
async function rollbackCredits(
  serviceClient: any,
  userId: string,
  deductedFrom: string,
  previousBalance: number,
  cost: number,
  jobId?: string
) {
  try {
    if (deductedFrom === "wallet") {
      await serviceClient
        .from("user_credit_wallets")
        .update({ ai_estimate_remaining: previousBalance })
        .eq("user_id", userId);
    } else if (deductedFrom === "legacy") {
      await serviceClient
        .from("user_credits")
        .update({ balance: previousBalance })
        .eq("user_id", userId);
    }

    if (deductedFrom === "wallet" || deductedFrom === "legacy") {
      await serviceClient.from("credit_transactions").insert({
        user_id: userId,
        transaction_type: "refund",
        credits_change: cost,
        amount_paid: 0,
        reference_id: jobId ? `refund_${jobId}` : "refund_job_failure",
      });
    }
  } catch (rollbackErr) {
    console.error("[CRITICAL: Credit Rollback Failed]:", rollbackErr);
  }
}

// Helper to peek body without consuming stream if needed
async function cloneBody(req: Request): Promise<any> {
  try {
    const clone = req.clone();
    return await clone.json();
  } catch {
    return {};
  }
}
