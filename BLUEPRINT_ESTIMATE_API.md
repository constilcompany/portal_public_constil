# Constil Blueprint Upload & AI Estimation API Contract

## 1. Overview & Architecture
This API provides a secure, zero-trust mechanism for uploading architectural/engineering blueprint PDFs and generating automated construction cost estimates. It serves both the **ChatGPT Plugin** (via Supabase Native OAuth 2.1 access tokens) and the **Constil Web Portal** (via Supabase Auth JWTs).

```
[ChatGPT Plugin / Web Portal]
        |
        | 1. POST /upload-url (Bearer Token)
        v
[Supabase Edge Function: blueprint-estimate]
        |
        | 2. Validates JWT, verifies limits, generates S3 presigned URL
        v
[Client directly uploads PDF bytes to AWS S3 via Presigned PUT URL]
        |
        | 3. POST /start-estimate (Bearer Token, pdf_key, scopes)
        v
[Supabase Edge Function: blueprint-estimate]
        |
        |-- Verifies S3 object ownership (prefix: blueprints/{user_id}/...)
        |-- Verifies S3 object existence via HeadObject
        |-- Validates construction scopes
        |-- Performs atomic server-side credit check & deduction
        |-- Inserts job into `pdf_jobs` (status: "pending")
        |-- Triggers FastAPI `/estimate` background worker (server-to-server)
        v
[FastAPI / Celery Estimator Engine] (Processes PDF in background)
        |
        | Updates `pdf_jobs` in Supabase (status: "done", detail: { ... })
        v
[Client polls: GET /job-status?job_id={job_id}]
        |
        v Returns estimate & material takeoff (strictly owner-restricted)
```

---

## 2. Authentication
All requests to the Edge Function require a Bearer token in the `Authorization` header:
```http
Authorization: Bearer <SUPABASE_ACCESS_TOKEN>
```
- **ChatGPT Plugin:** Uses the access token issued by Constil OAuth 2.1 Server (`/oauth/consent`).
- **Web Portal:** Uses the user's active session JWT from Supabase Auth (`access_token`).
- **User Identity:** The server dynamically derives the user ID via `supabase.auth.getUser(token)`. The API rejects any user ID passed in request payloads.

---

## 3. Endpoints

### 3.1. Request S3 Presigned Upload URL
Generates a short-lived, pre-signed AWS S3 URL for direct client-to-storage upload. No AWS credentials are ever exposed to the client.

- **Method:** `POST`
- **Path:** `/functions/v1/blueprint-estimate/upload-url` (or action: `create-upload-url`)
- **Headers:**
  - `Authorization: Bearer <TOKEN>`
  - `Content-Type: application/json`

#### Request Body
```json
{
  "filename": "rumery_lofts_plans.pdf",
  "file_size": 15728640,
  "content_type": "application/pdf"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `filename` | string | Yes | Name of the file. Must end with `.pdf`. |
| `file_size` | number | Yes | File size in bytes. Must be > 0 and <= 52,428,800 (50 MB). |
| `content_type` | string | Yes | Must be `"application/pdf"`. Other types are rejected. |

#### Response (200 OK)
```json
{
  "success": true,
  "upload_url": "https://paybue-invoice-estimation.s3.us-east-1.amazonaws.com/blueprints/47f3d024-2cd0-4dc9-b2ef-3a2301618667/1790720000000_a1b2c3d4e5.pdf?X-Amz-Algorithm=...",
  "pdf_key": "blueprints/47f3d024-2cd0-4dc9-b2ef-3a2301618667/1790720000000_a1b2c3d4e5.pdf",
  "expires_in": 900,
  "max_file_size": 52428800,
  "content_type": "application/pdf"
}
```

---

### 3.2. Upload File Bytes to S3 (Direct Upload)
The client sends the binary PDF directly to AWS S3 using standard HTTP `PUT`.

- **Method:** `PUT`
- **URL:** `<upload_url>` (from step 3.1)
- **Headers:**
  - `Content-Type: application/pdf`
- **Body:** Binary file bytes (`ArrayBuffer` / `Blob` / `File`)
- **Response:** `200 OK` (from S3)

---

### 3.3. Start AI Estimation Job
Initiates background takeoff generation. The server verifies file ownership in S3, checks and deducts credits, logs the job in `pdf_jobs`, and triggers the worker.

- **Method:** `POST`
- **Path:** `/functions/v1/blueprint-estimate/start-estimate` (or action: `start-estimate`)
- **Headers:**
  - `Authorization: Bearer <TOKEN>`
  - `Content-Type: application/json`

#### Request Body
```json
{
  "pdf_key": "blueprints/47f3d024-2cd0-4dc9-b2ef-3a2301618667/1790720000000_a1b2c3d4e5.pdf",
  "selected_scopes": ["Finishes", "Drywall", "Electrical"],
  "project_name": "Rumery Lofts Tenant Finish-Out",
  "idempotency_key": "uuid-optional-client-request-id"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `pdf_key` | string | Yes | The key returned from step 3.1. Must match authenticated user's prefix. |
| `selected_scopes` | array of strings | No | Construction divisions to estimate. Defaults to `["Overall"]`. |
| `project_name` | string | No | Descriptive project title (max 120 chars). |
| `idempotency_key` | string | No | Client token for safe retries without duplicate credit consumption. |

#### Allowed `selected_scopes`
- `Overall`
- `Finishes`
- `Drywall`
- `Flooring`
- `Framing`
- `Roofing`
- `Insulation`
- `Cleaning`
- `Plumbing`
- `HVAC`
- `Electrical`
- `FinishCarpentry`
- `Windows`
- `Doors`
- `Siding`
- `General`

#### Response (200 OK)
```json
{
  "success": true,
  "job_id": "7f8b9a10-2345-4b67-89ab-cdef01234567",
  "task_id": "celery-task-uuid-8899",
  "status": "pending",
  "pdf_key": "blueprints/47f3d024-2cd0-4dc9-b2ef-3a2301618667/1790720000000_a1b2c3d4e5.pdf",
  "selected_scopes": ["Finishes", "Drywall", "Electrical"],
  "project_name": "Rumery Lofts Tenant Finish-Out",
  "credits_deducted": 1
}
```

#### Idempotent Retry Response (200 OK)
If called again for an already active/completed job:
```json
{
  "success": true,
  "job_id": "7f8b9a10-2345-4b67-89ab-cdef01234567",
  "status": "pending",
  "message": "Existing active estimation job returned (idempotent retry). No extra credits deducted.",
  "is_retry": true,
  "created_at": "2026-10-07T21:40:00.000Z"
}
```

---

### 3.4. Get Estimation Job Status & Results
Retrieves job progress and the generated material takeoff / cost estimate. Strictly restricted to the job owner.

- **Method:** `GET` (or `POST` with action `get-job-status`)
- **Path:** `/functions/v1/blueprint-estimate/job-status?job_id=<JOB_UUID>`
- **Headers:**
  - `Authorization: Bearer <TOKEN>`

#### Response (While Processing - 200 OK)
```json
{
  "success": true,
  "job_id": "7f8b9a10-2345-4b67-89ab-cdef01234567",
  "status": "pending",
  "message": "Job submitted and queued for estimation",
  "created_at": "2026-10-07T21:40:00.000Z",
  "filename": "Rumery Lofts Tenant Finish-Out",
  "pdf_key": "blueprints/47f3d024-2cd0-4dc9-b2ef-3a2301618667/1790720000000_a1b2c3d4e5.pdf",
  "detail": null
}
```

#### Response (When Complete - 200 OK)
```json
{
  "success": true,
  "job_id": "7f8b9a10-2345-4b67-89ab-cdef01234567",
  "status": "done",
  "message": "Success",
  "created_at": "2026-10-07T21:40:00.000Z",
  "filename": "Rumery Lofts Tenant Finish-Out",
  "pdf_key": "blueprints/47f3d024-2cd0-4dc9-b2ef-3a2301618667/1790720000000_a1b2c3d4e5.pdf",
  "detail": {
    "project_data": {
      "project_name": "Rumery Lofts Tenant Finish-Out",
      "address": "509 Forest Avenue, Unit #2, Portland, ME 04101"
    },
    "takeoff": [
      {
        "item_no": "2.01",
        "csi_code": "09 91 23",
        "description": "Wall Paint - Interior (2 Coats)",
        "unit": "SF",
        "quantity": 10717.55,
        "total_cost": 21381.51
      }
    ],
    "financial_summary": {
      "subtotal": 32569.86,
      "total": 42340.81
    },
    "estimate_text": "# ESTIMATE OF MATERIALS AND COST OF CONSTRUCTION..."
  }
}
```

---

## 4. Error Handling & HTTP Status Codes

| Status Code | Code / Meaning | Reason |
|---|---|---|
| **400 Bad Request** | `Invalid file type` / `Missing field` | Non-PDF file, file size <= 0 or > 50MB, invalid construction scope, or file not found in storage. |
| **401 Unauthorized** | `Unauthorized` | Missing or invalid Supabase Bearer token. |
| **402 Payment Required**| `Insufficient credits` | User credit balance or wallet has insufficient `ai_estimate` credits. |
| **403 Forbidden** | `Access denied` | Attempted to submit a `pdf_key` outside the authenticated user's prefix. |
| **404 Not Found** | `Job not found` | Job does not exist, or belongs to another user (owner isolation). |
| **502 Bad Gateway** | `Downstream worker error` | FastAPI background service unreachable or returned error. **Deducted credits are automatically refunded.** |
| **500 Server Error** | `Internal error` | Database or AWS S3 service failure. |

---

## 5. Security Invariants
1. **User Storage Isolation:** Object keys are formatted as `blueprints/{user_id}/{timestamp}_{random}.pdf`. User A cannot read, start estimates on, or claim files in User B's folder.
2. **Token Bound Identity:** User ID is extracted exclusively from the validated JWT claims.
3. **Short-Lived URLs:** Presigned PUT URLs expire in 15 minutes (900 seconds).
4. **Zero Client Secrets:** No AWS IAM access keys or secrets are stored in client bundles or browser code.
5. **Atomic Credit Transactions:** Credits are checked and deducted server-side before job execution; if the downstream pipeline fails to schedule, credits are rolled back atomically with audit records in `credit_transactions`.

---

## 6. Required Server Secrets (Names Only)
Configure in Supabase Edge Functions (`supabase secrets set`):

| Secret Name | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase API URL (automatic in Edge Functions) |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin client for table operations & user verification |
| `AWS_ACCESS_KEY_ID` | AWS IAM Access Key ID for S3 operations |
| `AWS_SECRET_ACCESS_KEY` | AWS IAM Secret Access Key for S3 operations |
| `AWS_REGION` | AWS S3 Region (e.g. `us-east-1`) |
| `AWS_STORAGE_BUCKET_NAME` | AWS S3 Bucket Name (`paybue-invoice-estimation`) |
| `FASTAPI_URL` | Base URL for FastAPI estimation engine (`https://paybue-quee.hnhsofttechsolutions.com`) |

---

## 7. Architectural Security Advisory (FastAPI Worker)
- **Finding:** The external FastAPI service (`https://paybue-quee.hnhsofttechsolutions.com/estimate`) currently does **not** enforce an incoming authentication header (API Key, HMAC, or mTLS).
- **Mitigation implemented:** The Supabase Edge Function serves as the secure public gateway. The client (ChatGPT plugin or browser) only interacts with the authenticated Supabase Edge Function; the FastAPI URL is kept server-side.
- **Recommended Action for Backend Team:** Add a shared secret header or mutual API key (e.g. `X-Internal-API-Key`) to the FastAPI container to reject any direct requests not originating from the Supabase Edge Function.
