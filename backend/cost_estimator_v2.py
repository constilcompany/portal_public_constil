import os
import io
import json
import time
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional, Dict, Any, List
import anthropic
import pikepdf
from dotenv import load_dotenv
from config import settings

load_dotenv()

# ==================== CONFIGURATION ====================
CHUNK_SIZE = 15  # pages per chunk

MAX_API_CONCURRENCY = 15  # Tier 3 can handle more, but 15 is stable
CPU_CORES = os.cpu_count() or 4
DEFAULT_WORKERS = min(MAX_API_CONCURRENCY, 12) # Cap at 12 to save laptop RAM

# ==================== PDF COMPRESSION (Ghostscript) ====================
def compress_pdf_ghostscript(pdf_bytes: bytes, quality: str = "screen") -> tuple:
    """
    Compress PDF using Ghostscript (similar to iLovePDF).
    quality: 'screen' (lowest), 'ebook' (medium), 'printer' (high), 'prepress' (very high)
    Returns (compressed_bytes, original_mb, compressed_mb, strategy_str).
    """
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as inp:
        inp.write(pdf_bytes)
        input_path = inp.name

    output_path = input_path.replace(".pdf", "_compressed.pdf")
    cmd = [
        "gs",
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.4",
        f"-dPDFSETTINGS=/{quality}",
        "-dNOPAUSE",
        "-dQUIET",
        "-dBATCH",
        f"-sOutputFile={output_path}",
        input_path,
    ]
    subprocess.run(cmd, check=True)

    with open(output_path, "rb") as f:
        result = f.read()

    os.remove(input_path)
    os.remove(output_path)

    original_mb = len(pdf_bytes) / (1024 * 1024)
    result_mb = len(result) / (1024 * 1024)
    return result, original_mb, result_mb, f"ghostscript ({quality})"

# ==================== PDF CHUNKING ====================
def split_pdf_into_chunks(pdf_bytes: bytes, chunk_size: int = CHUNK_SIZE) -> tuple:
    """
    Split PDF into chunks using pikepdf (preserves all resources).
    Returns (list[chunk_bytes], total_pages).
    """
    chunks = []
    with pikepdf.open(io.BytesIO(pdf_bytes), suppress_warnings=True) as orig:
        total_pages = len(orig.pages)
        for start in range(0, total_pages, chunk_size):
            end = min(start + chunk_size, total_pages)
            chunk_pdf = pikepdf.Pdf.new()
            for i in range(start, end):
                chunk_pdf.pages.append(orig.pages[i])

            out = io.BytesIO()
            chunk_pdf.save(
                out,
                compress_streams=True,
                object_stream_mode=pikepdf.ObjectStreamMode.generate,
                recompress_flate=True,
            )
            chunks.append(out.getvalue())
    return chunks, total_pages

# ==================== RATE LIMIT RETRY (console version) ====================
def api_call_with_retry(api_func, *args, max_retries=5, label="", **kwargs):
    """
    Wraps Anthropic API calls with smart rate‑limit retry.
    Prints progress and countdown to console.
    """
    total_start = time.time()
    for attempt in range(max_retries):
        try:
            call_start = time.time()
            res = api_func(*args, **kwargs)
            call_duration = time.time() - call_start
            print(f"⏱️ [API: {label}] Success in {call_duration:.2f}s (Attempt {attempt+1}/{max_retries})")
            return res

        except (anthropic.RateLimitError, anthropic.APIStatusError) as e:
            call_duration = time.time() - call_start
            print(f"⏱️ [API: {label}] Failed in {call_duration:.2f}s (Attempt {attempt+1}/{max_retries}) - Error: {e}")
            is_rate_limit = isinstance(e, anthropic.RateLimitError)
            if isinstance(e, anthropic.APIStatusError):
                is_rate_limit = (e.status_code == 429)

            if not is_rate_limit:
                raise

            if attempt == max_retries - 1:
                raise

            # Try to read exact wait time from headers
            wait_seconds = 61
            try:
                headers = e.response.headers
                retry_after = headers.get("retry-after")
                if retry_after:
                    wait_seconds = int(float(retry_after)) + 3
            except Exception:
                pass

            print(f"⏱️ Rate limit hit{f' ({label})' if label else ''} – "
                  f"attempt {attempt+1}/{max_retries}. Waiting {wait_seconds}s...")
            for remaining in range(wait_seconds, 0, -1):
                print(f"⏳ Retrying in {remaining}s...", end="\r")
                time.sleep(1)
            print()  # newline
            print(f"🔄 Retrying now (attempt {attempt+2}/{max_retries})...")

# ==================== MAIN ESTIMATOR CLASS ====================
class ConstructionEstimatorAPI:
    """
    Professional construction estimator using Claude API.
    Pipeline: compress → chunk (15 pages) → estimate each → merge → extract JSON.
    """

    def __init__(self, api_key: str, estimation_prompt: str = "", json_extraction_prompt: str = ""):
        if not api_key:
            raise ValueError("API key required")
        self.client = anthropic.Anthropic(api_key=api_key)
        self.estimation_prompt = estimation_prompt
        self.json_extraction_prompt = json_extraction_prompt

    def _upload_chunk(self, chunk_bytes: bytes, filename: str) -> str:
        """Upload a chunk PDF to Anthropic Files API and return file_id."""
        file_upload = api_call_with_retry(
            self.client.beta.files.upload,
            file=(filename, io.BytesIO(chunk_bytes), "application/pdf"),
            label=f"upload {filename}"
        )
        return file_upload.id

    def _estimate_chunk(
        self,
        file_id: str,
        chunk_index: int,
        total_chunks: int,
        project_info: Optional[Dict] = None,
    ) -> Dict[str, Any]:
        """Process one chunk with the estimation prompt."""
        chunk_note = (
            f"\n\nNOTE: This is page chunk {chunk_index + 1} of {total_chunks} "
            f"from the same floor plan PDF. Analyze only the pages visible here."
        )
        content = [
            {"type": "document", "source": {"type": "file", "file_id": file_id}},
            {"type": "text", "text": self.estimation_prompt + chunk_note},
        ]

        if project_info:
            supplement = "\n\nADDITIONAL PROJECT INFORMATION:\n" + "".join(
                f"• {k}: {v}\n" for k, v in project_info.items() if v
            )
            content.append({"type": "text", "text": supplement})

        message = api_call_with_retry(
            self.client.beta.messages.create,
            model=settings.anthropic_model,
            max_tokens=16000,
            betas=["files-api-2025-04-14"],
            messages=[{"role": "user", "content": content}],
            # temperature=0.2,
            label=f"chunk {chunk_index + 1}/{total_chunks}"
        )

        text = "".join(b.text for b in message.content if hasattr(b, "text"))
        return {
            "estimate_text": text,
            "usage": {
                "input_tokens": message.usage.input_tokens,
                "output_tokens": message.usage.output_tokens,
            }
        }
    
    def _process_single_chunk(self, args):
        """
        Worker function for parallel chunk processing.
        """
        i, chunk_bytes_i, total_chunks, total_pages, original_filename, project_info = args

        page_start = i * CHUNK_SIZE + 1
        page_end = min((i + 1) * CHUNK_SIZE, total_pages)

        print(f"📄 Processing chunk {i+1}/{total_chunks} (pages {page_start}–{page_end})...")

        fname = f"{os.path.splitext(original_filename)[0]}_chunk{i+1}.pdf"

        file_id = self._upload_chunk(chunk_bytes_i, fname)
        result = self._estimate_chunk(file_id, i, total_chunks, project_info)

        return {
            "index": i,
            "text": result["estimate_text"],
            "usage": result["usage"]
        }

    def _merge_chunks(self, chunk_texts: List[str]) -> tuple:
        """Merge all chunk estimates into one unified estimate."""
        if len(chunk_texts) == 1:
            return chunk_texts[0], {"input_tokens": 0, "output_tokens": 0}

        numbered = "\n\n".join(
            f"=== CHUNK {i+1} ESTIMATE ===\n{t}" for i, t in enumerate(chunk_texts)
        )
        merge_prompt = f"""You are a Senior Construction Estimator.
Below are partial CSI-format cost estimates from different page ranges of the SAME floor plan PDF.
Merge them into ONE unified, non-duplicate estimate.

Rules:
1. Combine quantities for identical line items (sum them up).
2. Remove duplicate line items completely.
3. Recalculate all division subtotals and the Financial Summary accurately.
4. Keep all division sections present.
5. Return ONLY the final merged markdown estimate — no commentary.

{numbered}

Produce the final merged estimate now:"""

        message = api_call_with_retry(
            self.client.messages.create,
            model=settings.anthropic_model,
            max_tokens=16000,
            messages=[{"role": "user", "content": merge_prompt}],
            # temperature=0,
            label="merge"
        )

        text = "".join(b.text for b in message.content if hasattr(b, "text"))
        return text, {
            "input_tokens": message.usage.input_tokens,
            "output_tokens": message.usage.output_tokens,
        }

    

    def extract_tables_as_json(self, estimate_text: str) -> Dict[str, Any]:
        """Extract tables from estimate text into validated JSON with retry."""

        max_retries = 3
        last_json_text = ""

        for attempt in range(max_retries):

            message = api_call_with_retry(
                self.client.messages.create,
                model=settings.anthropic_model,
                max_tokens=16000,
                messages=[
                    {"role": "user", "content": f"Here is a construction estimate:\n\n{estimate_text}"},
                    {"role": "assistant", "content": "I'll analyze this estimate and extract the tables in JSON format."},
                    {"role": "user", "content": self.json_extraction_prompt},
                ],
                #temperature=0,
                label=f"json extraction attempt {attempt+1}"
            )

            parse_start = time.time()

            json_text = "".join(b.text for b in message.content if hasattr(b, "text"))
            last_json_text = json_text

            try:
                json_text = json_text.strip()

                # Remove markdown code block if present
                if json_text.startswith("```"):
                    lines = json_text.split("\n")
                    json_text = "\n".join(lines[1:-1]).strip()

                tables_json = json.loads(json_text)

            except json.JSONDecodeError as e:
                print(f"❌ JSON Decode Error on attempt {attempt+1}: {e}")
                tables_json = None
                
            parse_duration = time.time() - parse_start
            print(f"⏱️ [JSON Parse & Validation] Took {parse_duration:.2f}s")

            # ---- VALIDATION ----
            valid = True

            if not tables_json or "tables" not in tables_json:
                valid = False
            else:
                for table in tables_json["tables"]:
                    required_keys = ["table_name", "description", "headers", "rows"]

                    for key in required_keys:
                        if key not in table:
                            valid = False
                            break

                    if not valid:
                        break

            if valid:
                return {
                    "status": True,
                    "tables_json": tables_json,
                    "usage": {
                        "input_tokens": message.usage.input_tokens,
                        "output_tokens": message.usage.output_tokens,
                    }
                }

            # retry warning
            if attempt < max_retries - 1:
                print(f"⚠️ Validation failed for JSON extraction (attempt {attempt + 1}/{max_retries}). Retrying...")
                time.sleep(3)
        # ---- FAIL SAFE ----
        return {
            "status": False,
            "message": "Failed to produce valid table JSON after retries",
            "tables_json": {
                "error": "Failed to produce valid table JSON after retries",
                "raw_text": last_json_text[:1000],
                "tables": []
            },
            "usage": {
                "input_tokens": message.usage.input_tokens,
                "output_tokens": message.usage.output_tokens,
            }
        }

    def estimate_from_pdf_with_json(
        self,
        pdf_path: str,
        project_info: Optional[Dict] = None,
        ghostscript_quality: str = "screen",
    ) -> Dict[str, Any]:
        """
        Full pipeline:
          1. Compress PDF with Ghostscript.
          2. Split into 15‑page chunks.
          3. Process each chunk (upload + estimate).
          4. Merge chunk estimates.
          5. Extract JSON tables.
        Returns a dictionary with estimate_text, tables_json, usage stats, and compression info.
        """
        # Read the PDF file
        with open(pdf_path, "rb") as f:
            pdf_bytes = f.read()
        original_filename = os.path.basename(pdf_path)

        pipeline_start = time.time()

        # Step 1: Compress
        print("🔧 Compressing PDF with Ghostscript...")
        step1_start = time.time()
        compressed_bytes, original_mb, compressed_mb, repair_strategy = compress_pdf_ghostscript(
            pdf_bytes, quality=ghostscript_quality
        )
        saved_mb = original_mb - compressed_mb
        print(f"⏱️ [Step 1: Compression] Took {time.time() - step1_start:.2f}s")

        # Step 2: Split into chunks
        print("✂️ Splitting PDF into 15‑page chunks...")
        step2_start = time.time()
        chunks, total_pages = split_pdf_into_chunks(compressed_bytes, CHUNK_SIZE)
        total_chunks = len(chunks)
        print(f"⏱️ [Step 2: Splitting] Took {time.time() - step2_start:.2f}s (Total pages: {total_pages}, Chunks: {total_chunks})")

        usage_totals = {
            "estimate_input": 0, "estimate_output": 0,
            "merge_input": 0,    "merge_output": 0,
            "json_input": 0,     "json_output": 0,
        }
        chunk_texts = []

        print(f"⚡ Processing {total_chunks} chunks in parallel...")
        step3_start = time.time()

        tasks = [
            (i, chunk_bytes_i, total_chunks, total_pages, original_filename, project_info)
            for i, chunk_bytes_i in enumerate(chunks)
        ]

        results = []

        #max_workers = min(4, total_chunks)  # optimized for 2-core server
        max_workers = min(total_chunks, DEFAULT_WORKERS)

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [
                executor.submit(self._process_single_chunk, task)
                for task in tasks
            ]

            for future in as_completed(futures):
                results.append(future.result())
                
        print(f"⏱️ [Step 3: Chunk Processing (Parallel)] Took {time.time() - step3_start:.2f}s")
        
        results.sort(key=lambda x: x["index"])

        for r in results:
            chunk_texts.append(r["text"])
            usage_totals["estimate_input"] += r["usage"]["input_tokens"]
            usage_totals["estimate_output"] += r["usage"]["output_tokens"]

        # Step 4: Merge
        print(f"🔗 Merging {total_chunks} chunk estimate(s)...")
        step4_start = time.time()
        merged_text, merge_usage = self._merge_chunks(chunk_texts)
        usage_totals["merge_input"] = merge_usage["input_tokens"]
        usage_totals["merge_output"] = merge_usage["output_tokens"]
        print(f"⏱️ [Step 4: Merging] Took {time.time() - step4_start:.2f}s")

        # Step 5: JSON extraction
        print("📊 Extracting structured tables as JSON...")
        step5_start = time.time()
        json_result = self.extract_tables_as_json(merged_text)
        usage_totals["json_input"] = json_result["usage"]["input_tokens"]
        usage_totals["json_output"] = json_result["usage"]["output_tokens"]
        print(f"⏱️ [Step 5: JSON Extraction] Took {time.time() - step5_start:.2f}s")
        
        print(f"⏱️ [Total Pipeline Time] Took {time.time() - pipeline_start:.2f}s")

        # Cost calculation (Sonnet: $3/M input, $15/M output)
        total_in = usage_totals["estimate_input"] + usage_totals["merge_input"] + usage_totals["json_input"]
        total_out = usage_totals["estimate_output"] + usage_totals["merge_output"] + usage_totals["json_output"]
        total_cost = total_in / 1_000_000 * 3 + total_out / 1_000_000 * 15

        return {
            "status": True,
            "estimate_text": merged_text,
            "tables_json": json_result["tables_json"],
            "chunk_texts": chunk_texts,
            "compression": {
                "original_mb": round(original_mb, 2),
                "compressed_mb": round(compressed_mb, 2),
                "saved_mb": round(saved_mb, 2),
                "ratio_pct": round((1 - compressed_mb / original_mb) * 100, 1) if original_mb > 0 else 0,
                "repair_strategy": repair_strategy,
            },
            "usage": {
                **usage_totals,
                "total_input_tokens": total_in,
                "total_output_tokens": total_out,
                "total_tokens": total_in + total_out,
                "total_cost_usd": round(total_cost, 4),
                "total_pages": total_pages,
                "total_chunks": total_chunks,
            },
        }


# # ==================== USAGE EXAMPLE ====================
# if __name__ == "__main__":
#     # Load API key from environment
#     API_KEY = os.getenv("ANTHROPIC_API_KEY")
#     if not API_KEY:
#         raise ValueError("ANTHROPIC_API_KEY not found in environment variables.")

#     # Define scope (e.g., Overall, Framing, etc.)
#     selected_scopes =  ["Framing", "Drywall"]  # or ["Framing", "Drywall"] ["Overall"]

#     # Build prompts (adjust import if needed)
#     CONSTRUCTION_ESTIMATOR_PROMPT = build_estimation_prompt(selected_scopes)
#     JSON_TABLES_EXTRACTION_PROMPT = build_json_extraction_prompt()

#     # Create estimator instance
#     estimator = ConstructionEstimatorAPI(
#         api_key=API_KEY,
#         estimation_prompt=CONSTRUCTION_ESTIMATOR_PROMPT,
#         json_extraction_prompt=JSON_TABLES_EXTRACTION_PROMPT
#     )

#     # Path to your PDF file
#     pdf_path = "260121_Permit Set_UA Danvers MA.pdf"
#     project_info = None  # optional dictionary

#     # Run the full pipeline
#     result = estimator.estimate_from_pdf_with_json(
#         pdf_path,
#         project_info=project_info,
#         ghostscript_quality="screen"   # or "ebook", "printer", etc.
#     )

#     # Save result to JSON
#     with open("output_v2.json", "w") as f:
#         json.dump(result, f, indent=2)

#     print(f"\n✅ Estimate generated. Total API cost: ${result['usage']['total_cost_usd']:.4f}")
#     print(f"   Pages: {result['usage']['total_pages']}, Chunks: {result['usage']['total_chunks']}")

