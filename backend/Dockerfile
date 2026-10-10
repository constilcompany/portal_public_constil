FROM python:3.11-slim

# Install system dependencies (Ghostscript is likely needed by pikepdf/cost estimator based on typical setups, plus git just in case)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ghostscript \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:0.4.15 /uv /bin/uv

WORKDIR /app

# Copy dependency files first to leverage Docker layer caching
COPY pyproject.toml uv.lock ./

# Set the uv environment path outside /app so the volume mount doesn't overwrite it
ENV UV_PROJECT_ENVIRONMENT="/opt/venv"

# Install dependencies using uv
RUN uv sync --frozen --no-dev

# Copy the rest of the application
COPY . .

# Ensure the virtual environment is used
ENV PATH="/opt/venv/bin:$PATH"
