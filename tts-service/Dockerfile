FROM python:3.12-slim

# ffmpeg needed by pocket-tts for audio preprocessing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# torch for aarch64 Linux: standard PyPI wheel is already CPU-only
# (no CUDA aarch64 wheels exist on PyPI, so no --index-url needed)
RUN pip install --no-cache-dir torch

# pocket-tts 2.1.0 + scipy for WAV encoding
RUN pip install --no-cache-dir "pocket-tts==2.1.0" "scipy>=1.5.0"

COPY main.py .

# HuggingFace model cache lives in a named volume (see docker-compose)
# so model is only downloaded once and survives container rebuilds
ENV HF_HOME=/model-cache

EXPOSE 8000
CMD ["python3", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
