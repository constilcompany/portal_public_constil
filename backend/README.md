# estimation-fastapi-svc

A standalone FastAPI microservice that replicates the PDF-processing pipeline
from Django's `process_ai_estimate_v2_task` (Celery task) as a pure HTTP service.

**No Django ORM. No credit deduction. No DB writes.**  
Input: S3 PDF key + selected scopes → Output: full construction estimate JSON.

---

## Setup (using `uv`)

```bash
# 1. Create virtual environment and install deps
uv sync

# 2. Copy and fill in env vars
cp .env.example .env   # then edit with your actual keys
```

---

## Environment Variables (`.env`)

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Claude API key |
| `AWS_ACCESS_KEY_ID` | AWS access key (same bucket as Django) |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key |
| `AWS_S3_REGION_NAME` | S3 bucket region (e.g. `us-east-1`) |
| `AWS_STORAGE_BUCKET_NAME` | S3 bucket name |
| `HOST` | Server bind host (default `0.0.0.0`) |
| `PORT` | Server port (default `8001`) |

---

## Running the service

```bash
# With uv
uv run uvicorn main:app --host 0.0.0.0 --port 8001 --reload

# Or directly
uv run python main.py
```

---

## API

### `POST /estimate`

**Request body:**
```json
{
  "pdf_key": "estimates/pdfs/input/floor_plan.pdf",
  "selected_scopes": ["Framing", "Drywall", "Electrical"]
}
```

| Field | Type | Description |
|---|---|---|
| `pdf_key` | `string` | S3 object key of the input PDF (same as `AIEstimateV2.input_pdf` name in Django) |
| `selected_scopes` | `string[]` | Construction scope names. Defaults to `["General"]` |

**Valid scope values:**
`Overall`, `Finishes`, `Drywall`, `Flooring`, `Framing`, `Roofing`,
`Insulation`, `Cleaning`, `Plumbing`, `HVAC`, `Electrical`,
`FinishCarpentry`, `Windows`, `Doors`, `Siding`, `General`

**Success response (200):**
```json
{
  "status": true,
  "estimate_text": "# ESTIMATE OF MATERIALS...",
  "tables_json": { "tables": [...] },
  "chunk_texts": ["...", "..."],
  "compression": {
    "original_mb": 12.5,
    "compressed_mb": 3.2,
    "saved_mb": 9.3,
    "ratio_pct": 74.4,
    "repair_strategy": "ghostscript (screen)"
  },
  "usage": {
    "total_pages": 24,
    "total_chunks": 2,
    "total_cost_usd": 0.85
  }
}
```

**Error responses:**
| Code | Meaning |
|---|---|
| `404` | PDF key not found in S3 |
| `422` | AI pipeline returned a failure |
| `500` | Internal estimator error |
| `502` | S3 connectivity error |

---

### `GET /health`

```json
{ "status": "ok", "service": "estimation-fastapi-svc" }
```

---

### Interactive docs

Visit `http://localhost:8001/docs` (Swagger UI) or `http://localhost:8001/redoc`

---

## Pipeline (identical to Django Celery task)

```
pdf_key
  │
  ▼
S3 Download (boto3)
  │
  ▼
Write to temp file
  │
  ▼
ConstructionEstimatorAPI.estimate_from_pdf_with_json()
  ├── 1. Ghostscript PDF compression (screen quality)
  ├── 2. Split into 15-page chunks (pikepdf)
  ├── 3. Parallel upload + estimate each chunk (Anthropic Files API)
  ├── 4. Merge all chunk estimates (Claude)
  └── 5. Extract structured JSON tables (Claude)
  │
  ▼
Return JSON response
```

## Project Structure

```
estimation-fastapi-svc/
├── main.py              # FastAPI app + endpoint
├── config.py            # Pydantic settings (reads .env)
├── s3_service.py        # boto3 S3 download helper
├── cost_estimator_v2.py # ConstructionEstimatorAPI (copied from Django)
├── prompt_builders.py   # Prompt builder functions (copied from Django)
├── pyproject.toml       # uv project config + deps
├── .env                 # Secrets (not committed)
└── .gitignore
```
