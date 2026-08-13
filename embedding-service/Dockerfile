FROM python:3.12-slim

WORKDIR /app

# Install dependencies directly
RUN pip install --no-cache-dir \
    "fastapi==0.115.12" \
    "uvicorn[standard]==0.34.2" \
    "sentence-transformers==4.1.0" \
    "peft" \
    "numpy==1.26.4"

# Pre-download model at build time
RUN python3 -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('ManiacLabs/miniac-embed')"

COPY main.py .

EXPOSE 8100

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8100"]
