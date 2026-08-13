FROM python:3.12-slim

# Install system deps: FFmpeg for audio conversion
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml .
RUN pip install --no-cache-dir .

# Pre-download faster-whisper base model at build time so first request is fast
RUN python3 -c "from faster_whisper import WhisperModel; WhisperModel('base', device='cpu', compute_type='int8')"

# Download spaCy English model
RUN python3 -m spacy download en_core_web_sm

COPY app/ app/
COPY tests/ tests/

# Run tests as part of the build — fail fast if anything breaks.
# Dummy secrets are scoped to this RUN layer only; real values come from env_file at runtime.
RUN pip install --no-cache-dir ".[dev]" && \
    SECRET_KEY=build-test-only-placeholder-32x AUTH_USER=fadil AUTH_PASS=fadil123 \
    python -m pytest tests/ -q

# Note: running as root because mounted host volumes (/data, /recordings) are
# owned by the host user. Switch to a non-root user only if you chown the volumes
# on the host first: sudo chown -R 1001:1001 toefl.db grammar_content.db recordings/

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
