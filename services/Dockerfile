FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN apt-get update && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends \
    curl \
  && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --no-cache-dir --upgrade pip

ARG REQ_FILE=requirements.base.txt
ARG APP_MODULE=services.context_api.app:app

COPY requirements.base.txt /app/requirements.base.txt
COPY requirements.sentiment.txt /app/requirements.sentiment.txt
COPY requirements.build.txt /app/requirements.build.txt
COPY requirements.build.lock.txt /app/requirements.build.lock.txt
COPY requirements.base.lock.txt /app/requirements.base.lock.txt
COPY requirements.sentiment.lock.txt /app/requirements.sentiment.lock.txt

RUN python -m pip install --no-cache-dir --require-hashes --only-binary=:all: -r /app/requirements.build.lock.txt

# Preserve existing manifest-name callers, while refusing unlocked or arbitrary inputs.
RUN case "$REQ_FILE" in \
      requirements.base.txt|requirements.base.lock.txt) lock_file=/app/requirements.base.lock.txt ;; \
      requirements.sentiment.txt|requirements.sentiment.lock.txt) lock_file=/app/requirements.sentiment.lock.txt ;; \
      *) echo "Unsupported REQ_FILE: use requirements.base.txt or requirements.sentiment.txt (or their lock filenames)" >&2; exit 1 ;; \
    esac \
    && python -m pip install --no-cache-dir --require-hashes --no-build-isolation -r "$lock_file"

RUN python -m pip check && python -m pip uninstall -y pip

COPY services /app/services

ENV APP_MODULE=${APP_MODULE}
ENV PORT=8080

CMD ["sh", "-c", "uvicorn \"$APP_MODULE\" --host 0.0.0.0 --port \"$PORT\""]
