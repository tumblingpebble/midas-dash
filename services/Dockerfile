FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/app/.hf_cache \
    TRANSFORMERS_CACHE=/app/.hf_cache \
    HF_HUB_DISABLE_XET=1 \
    SETFIT_MODEL_DIR=/app/audit_logs/sentiment_audit/setfit_model_hpc_full

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
  && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir --upgrade pip setuptools wheel

ARG REQ_FILE=requirements.base.txt
ARG APP_MODULE=services.context_api.app:app

COPY requirements.base.txt /app/requirements.base.txt
COPY requirements.sentiment.txt /app/requirements.sentiment.txt
COPY ${REQ_FILE} /app/requirements.txt

RUN pip install --no-cache-dir -r /app/requirements.txt

COPY services /app/services
COPY audit_logs/sentiment_audit/setfit_model_hpc_full /app/audit_logs/sentiment_audit/setfit_model_hpc_full

# Pre-bake FinBERT only for the sentiment image build
RUN if [ "$REQ_FILE" = "requirements.sentiment.txt" ]; then \
      python -c "from transformers import pipeline; pipeline('text-classification', model='ProsusAI/finbert'); print('FinBERT cached into image')" ; \
    fi

ENV APP_MODULE=${APP_MODULE}
ENV PORT=8080

CMD ["sh", "-c", "uvicorn \"$APP_MODULE\" --host 0.0.0.0 --port \"$PORT\""]