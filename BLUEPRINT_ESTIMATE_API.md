# Constil ChatGPT Plugin & Portal: Secure Blueprint & Storage API Contract

## 1. Overview & Security Architecture
This specification defines the production integration between the **ChatGPT Plugin**, the **Constil Portal**, the **Supabase Edge Function (`blueprint-estimate`)**, **AWS S3 Storage**, and the downstream **FastAPI Estimation Engine**.

### Security Guardrails
1. **Zero Client Secrets**: AWS IAM credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) are maintained **exclusively** within server-side secrets in the Supabase environment. No AWS keys exist in the frontend or browser bundle.
2. **Unified Presigned Uploads for All Features**:
   - Blueprint uploads, invoice PDFs, estimate exports, signatures, and logos all route through server-generated presigned S3 PUT URLs.
   - Files are stored in tenant-isolated paths:
     `{folder}/{userId}/{timestamp}_{random}.{ext}`
   - The `userId` is extracted strictly from the validated Supabase JWT token. Client-supplied `user_id` values in request bodies are ignored.
3. **Multi-layer S3 Validation**:
   - For document folders (`blueprints`, `invoices`, `estimates`): File must be `.pdf` and `Content-Type: application/pdf`.
   - Object `Content-Length` must be $> 0$ and $\le 52,428,800$ bytes (50 MB).
   - Magic byte signature must match `%PDF-` (`0x25, 0x50, 0x44, 0x46, 0x2D`) via byte-range check.
4. **Protected Accounting Ledger & Atomic Transactions**:
   - Job creation, credit check, credit deduction, and idempotency tracking execute within a single PostgreSQL stored procedure (`start_pdf_estimation_atomic`) with row-level locking (`FOR UPDATE`).
   - Accounting is maintained in a dedicated table `pdf_job_accounting_ledger` (decoupled from worker-overwritable `pdf_jobs.detail`).
   - Execution permissions on RPCs are **strictly revoked from PUBLIC, anon, and authenticated**; only `service_role` is granted execute privilege.
   - Duplicate concurrent requests with the same `(user_id, idempotency_key)` and identical payload return the existing job with zero duplicate deduction.
   - Same `(user_id, idempotency_key)` with differing payloads is rejected with HTTP `409 Conflict`.
5. **Transactional Incremental Refunds**:
   - Refunds execute via `refund_pdf_estimation_atomic`, atomically incrementing the wallet balance (`remaining = remaining + cost`). Stale previous balances are never restored.
   - Exactly-once execution: protected ledger flag `is_refunded` prevents duplicate refunds.
6. **Worker Dispatch Timeout & Unconfirmed State (`dispatch_unknown`)**:
   - Downstream worker request timeouts are **not** treated as confirmed failures and do **not** claim "task queued" without acknowledgment.
   - Job status is set to `dispatch_unknown` and HTTP `202 Accepted` is returned with `reconciliation_required: true`.
7. **Worker Authentication & Fail-Closed Guard**:
   - If `FASTAPI_SHARED_SECRET` is unset, estimation dispatch fails closed (`503 Service Unavailable`).

---

## 2. API Endpoints

### 2.1 Request Short-Lived S3 Presigned Upload URL
Generates an authenticated, short-lived presigned S3 PUT URL for client-side direct upload.

- **URL**: `POST /functions/v1/blueprint-estimate/upload-url`
- **Headers**:
  ```http
  Authorization: Bearer <SUPABASE_USER_JWT>
  apikey: <SUPABASE_ANON_KEY>
  Content-Type: application/json
  ```
- **Request Body**:
  ```json
  {
    "filename": "architectural_blueprint.pdf",
    "file_size": 15420300,
    "content_type": "application/pdf",
    "folder": "blueprints"
  }
  ```
- **Supported `folder` values**:
  `"blueprints"`, `"invoices"`, `"estimates"`, `"logos"`, `"signatures"`
- **Response (200 OK)**:
  ```json
  {
    "success": true,
    "upload_url": "https://paybue-invoice-estimation.s3.us-east-1.amazonaws.com/blueprints/usr_987.../1728345600_a1b2c3d4e5.pdf?AWSAccessKeyId=...&Signature=...",
    "s3_key": "blueprints/usr_987.../1728345600_a1b2c3d4e5.pdf",
    "pdf_key": "blueprints/usr_987.../1728345600_a1b2c3d4e5.pdf",
    "folder": "blueprints",
    "method": "PUT",
    "required_headers": {
      "Content-Type": "application/pdf"
    },
    "expires_in_seconds": 900,
    "max_file_size_bytes": 52428800
  }
  ```
- **Errors**:
  - `400 Bad Request`: Invalid file extension, non-PDF content type for documents, or file size $> 50$ MB.
  - `401 Unauthorized`: Missing or invalid Bearer token.

---

### 2.2 Upload File to S3
Direct HTTP PUT to the presigned URL returned from 2.1.

- **URL**: `<upload_url>`
- **Method**: `PUT`
- **Headers**:
  ```http
  Content-Type: application/pdf
  ```
- **Body**: Binary file content
- **Response (200 OK)**: Empty body with `ETag` header.

---

### 2.3 Start AI Estimation Job
Verifies S3 object ownership, size, and `%PDF-` signature; atomically checks and deducts credits; registers job, ledger, and idempotency record; and dispatches to FastAPI.

- **URL**: `POST /functions/v1/blueprint-estimate/start-estimate`
- **Headers**:
  ```http
  Authorization: Bearer <SUPABASE_USER_JWT>
  apikey: <SUPABASE_ANON_KEY>
  Content-Type: application/json
  ```
- **Request Body**:
  ```json
  {
    "pdf_key": "blueprints/usr_987.../1728345600_a1b2c3d4e5.pdf",
    "project_name": "Commercial Plaza Phase 1",
    "selected_scopes": ["Drywall", "Flooring", "Electrical"],
    "idempotency_key": "chatgpt_req_89f02c61-34a1-4322-9214-41bdf0"
  }
  ```
- **Allowed `selected_scopes`**:
  `["Overall", "Finishes", "Drywall", "Flooring", "Framing", "Roofing", "Insulation", "Cleaning", "Plumbing", "HVAC", "Electrical", "FinishCarpentry", "Windows", "Doors", "Siding", "General"]`

- **Response (200 OK - Job Created)**:
  ```json
  {
    "success": true,
    "job_id": "c8a4192b-8a1e-453f-91df-c0b7ec55a901",
    "task_id": "fastapi_task_90812",
    "status": "pending",
    "pdf_key": "blueprints/usr_987.../1728345600_a1b2c3d4e5.pdf",
    "selected_scopes": ["Drywall", "Flooring", "Electrical"],
    "project_name": "Commercial Plaza Phase 1",
    "credits_deducted": 3,
    "remaining_credits": 27
  }
  ```
- **Response (200 OK - Idempotent Replay)**:
  ```json
  {
    "success": true,
    "job_id": "c8a4192b-8a1e-453f-91df-c0b7ec55a901",
    "status": "pending",
    "message": "Existing active estimation job returned (idempotent replay). No duplicate credits deducted.",
    "is_retry": true,
    "credits_deducted": 0
  }
  ```
- **Response (202 Accepted - Worker Dispatch Timeout)**:
  ```json
  {
    "success": true,
    "job_id": "c8a4192b-8a1e-453f-91df-c0b7ec55a901",
    "status": "dispatch_unknown",
    "message": "AI worker dispatch timed out awaiting synchronous acknowledgment. Job state is unconfirmed (dispatch_unknown). Reconciliation or polling required.",
    "credits_deducted": 3,
    "remaining_credits": 27,
    "warning": "WORKER_DISPATCH_TIMEOUT",
    "reconciliation_required": true
  }
  ```

---

### 2.4 Reconciliation & Recovery Flow (`dispatch_unknown`)
When worker dispatch times out without HTTP acknowledgment:
1. **Initial State**: Job status is set to `dispatch_unknown`. User credits remain reserved in the protected ledger.
2. **Client Polling**: Client polls `GET /functions/v1/blueprint-estimate/job-status?job_id=<id>`.
   - If the worker asynchronously processed the job, `pdf_jobs.status` transitions to `processing` $\rightarrow$ `done`.
3. **Reconciliation Cron / Recovery**:
   - If the job remains in `dispatch_unknown` after the reconciliation window (e.g., 10 minutes), a reconciliation worker calls `refund_pdf_estimation_atomic(user_id, job_id, 'Dispatch timeout: worker unacknowledged')`.
   - The user's credits are incremented back into their wallet via the protected ledger, and `pdf_jobs.status` is marked as `fail`.

---

### 2.5 Get Estimation Job Status & Results
Polls progress and retrieves completed estimate JSON. Access is restricted strictly to the job owner.

- **URL**: `GET /functions/v1/blueprint-estimate/job-status?job_id=<job_id>`
- **Headers**:
  ```http
  Authorization: Bearer <SUPABASE_USER_JWT>
  apikey: <SUPABASE_ANON_KEY>
  ```
- **Response (200 OK - Processing)**:
  ```json
  {
    "success": true,
    "job_id": "c8a4192b-8a1e-453f-91df-c0b7ec55a901",
    "status": "processing",
    "message": "Analyzing architectural floor plans and takeoff quantities...",
    "created_at": "2026-10-07T21:40:00Z",
    "filename": "Commercial Plaza Phase 1",
    "pdf_key": "blueprints/usr_987.../1728345600_a1b2c3d4e5.pdf",
    "detail": null
  }
  ```
- **Response (200 OK - Completed)**:
  ```json
  {
    "success": true,
    "job_id": "c8a4192b-8a1e-453f-91df-c0b7ec55a901",
    "status": "done",
    "message": "Estimation complete",
    "created_at": "2026-10-07T21:40:00Z",
    "filename": "Commercial Plaza Phase 1",
    "pdf_key": "blueprints/usr_987.../1728345600_a1b2c3d4e5.pdf",
    "detail": {
      "items": [
        {
          "scope": "Drywall",
          "description": "5/8 in Type X Drywall",
          "quantity": 1420,
          "unit": "sq ft",
          "unit_cost": 2.85,
          "total_cost": 4047.00
        }
      ],
      "total_estimate": 4047.00
    }
  }
  ```
- **Errors**:
  - `404 Not Found`: Job does not exist or belongs to another user (never leaks job presence).

---

## 3. Required Server Secrets (Supabase Vault / Edge Secrets)

| Secret Name | Purpose | Production Status |
| :--- | :--- | :--- |
| `SUPABASE_URL` | Supabase API URL | Configured in Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin client for RPC and table operations | Configured in Supabase |
| `AWS_ACCESS_KEY_ID` | Server-side IAM access key for S3 presigning | Configured in Supabase |
| `AWS_SECRET_ACCESS_KEY` | Server-side IAM secret for S3 presigning | Configured in Supabase |
| `AWS_REGION` | S3 bucket region (default: `us-east-1`) | Configured in Supabase |
| `AWS_STORAGE_BUCKET_NAME` | S3 bucket name (default: `paybue-invoice-estimation`) | Configured in Supabase |
| `FASTAPI_URL` | Upstream AI engine endpoint (`https://paybue-quee.hnhsofttechsolutions.com`) | Configured in Supabase |
| `FASTAPI_SHARED_SECRET` | Shared secret token for worker inbound auth | **Active Blocker (Must be set)** |
