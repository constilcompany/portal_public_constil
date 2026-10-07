# Constil ChatGPT Plugin: Secure Blueprint Upload & AI Estimation API Contract

## 1. Overview & Security Architecture
This specification defines the production integration between the **ChatGPT Plugin**, the **Supabase Edge Function (`blueprint-estimate`)**, **AWS S3 Storage**, and the downstream **FastAPI Estimation Engine**.

### Security Guardrails
1. **Zero Client Secrets**: AWS IAM credentials (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) are maintained **exclusively** within server-side secrets in the Supabase environment. No AWS keys exist in the frontend or browser bundle.
2. **Tenant Isolation**: Uploads are restricted to isolated prefixes:
   `blueprints/{userId}/{timestamp}_{random}.pdf`.
   The `userId` is extracted strictly from the validated Supabase JWT token. Client-supplied `user_id` values in request bodies are ignored.
3. **Multi-layer S3 Validation**:
   - File extension must be `.pdf`
   - Object `Content-Length` must be $> 0$ and $\le 52,428,800$ bytes (50 MB)
   - Object `Content-Type` must be `application/pdf`
   - Object magic byte signature must match `%PDF-` (`0x25, 0x50, 0x44, 0x46, 0x2D`) via byte-range check
4. **Atomic Transactions & Idempotency**:
   - Job creation, credit check, credit deduction, and idempotency tracking execute within a single PostgreSQL stored procedure (`start_pdf_estimation_atomic`) with row-level locking (`FOR UPDATE`).
   - Duplicate concurrent requests with the same `(user_id, idempotency_key)` and identical payload return the existing job with zero duplicate deduction.
   - Same `(user_id, idempotency_key)` with differing payloads is rejected with HTTP `409 Conflict`.
5. **Transactional Incremental Refunds**:
   - Refunds execute via `refund_pdf_estimation_atomic`, atomically incrementing the wallet balance (`remaining = remaining + cost`). Stale previous balances are never restored.
   - Exactly-once execution: duplicate refund calls return `already_refunded` without duplicate credits.
   - Downstream worker request timeouts are **not** treated as confirmed failures; the job remains `processing` to prevent premature refunds while the worker is actively computing.
6. **Worker Authentication & Fail-Closed Guard**:
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
    "content_type": "application/pdf"
  }
  ```
- **Response (200 OK)**:
  ```json
  {
    "success": true,
    "upload_url": "https://paybue-invoice-estimation.s3.us-east-1.amazonaws.com/blueprints/usr_987.../1728345600_a1b2c3d4e5.pdf?AWSAccessKeyId=...&Signature=...",
    "pdf_key": "blueprints/usr_987.../1728345600_a1b2c3d4e5.pdf",
    "method": "PUT",
    "required_headers": {
      "Content-Type": "application/pdf"
    },
    "expires_in_seconds": 900,
    "max_file_size_bytes": 52428800
  }
  ```
- **Errors**:
  - `400 Bad Request`: Invalid file extension, non-PDF content type, or file size $> 50$ MB.
  - `401 Unauthorized`: Missing or invalid Bearer token.

---

### 2.2 Upload Blueprint File to S3
Direct HTTP PUT to the presigned URL returned from 2.1.

- **URL**: `<upload_url>`
- **Method**: `PUT`
- **Headers**:
  ```http
  Content-Type: application/pdf
  ```
- **Body**: Binary PDF content
- **Response (200 OK)**: Empty body with `ETag` header.

---

### 2.3 Start AI Estimation Job
Verifies S3 object ownership, size, and `%PDF-` signature; atomically checks and deducts credits; registers job and idempotency record; and dispatches to FastAPI.

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
  *(Defaults to `["Overall"]` if omitted).*

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
- **Response (202 Accepted - Worker Timeout / Async Enqueued)**:
  ```json
  {
    "success": true,
    "job_id": "c8a4192b-8a1e-453f-91df-c0b7ec55a901",
    "status": "processing",
    "message": "Job dispatched to AI worker. The synchronous worker acknowledgment timed out, but the background task is queued. Please poll status.",
    "credits_deducted": 3,
    "warning": "DOWNSTREAM_TIMEOUT"
  }
  ```
- **Errors**:
  - `400 Bad Request`: Invalid S3 key format, non-PDF signature, file size $> 50$ MB, or unallowed scope.
  - `402 Payment Required`: Insufficient AI estimate credits in wallet.
  - `403 Forbidden`: `pdf_key` does not match authenticated user prefix (`blueprints/{userId}/`).
  - `409 Conflict`: `idempotency_key` reused with different request payload.
  - `502 Bad Gateway`: Downstream worker confirmed rejection (credits atomically refunded).
  - `503 Service Unavailable`: `FASTAPI_SHARED_SECRET` not configured (fail-closed).

---

### 2.4 Get Estimation Job Status & Results
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

> **Security Rule**: Secret values must never be output, committed to git, or sent to browser clients.

---

## 4. Frontend S3 Migration Requirements

Client-side direct AWS SDK credentials have been completely removed from `src/components/data/s3-data.tsx`.
Existing non-blueprint features that previously uploaded directly to `paybue-invoice-estimation` must be migrated:

1. **Invoices**:
   - `src/components/formnewinvoice/forminvoice.tsx`
   - `src/components/modal/invoice-template-modal.tsx`
   - *Migration*: Route PDF upload through a presigned endpoint or upload to Supabase Storage bucket `invoices`.
2. **Estimate PDF Exports**:
   - `src/components/modal/estimate-template-modal.tsx`
   - `src/pages/ai-estimate-pages/File.tsx`
   - *Migration*: Route PDF export upload through presigned endpoint or Supabase Storage bucket `estimates`.
3. **Logos & Signatures**:
   - Already support Supabase Storage (`document-logos`), no AWS secrets required.
