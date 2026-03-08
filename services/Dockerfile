FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
  && rm -rf /var/lib/apt/lists/*

# choose which requirements file to install
ARG REQ_FILE=requirements.base.txt

# copy both the selected file and base file
COPY requirements.base.txt /app/requirements.base.txt
COPY requirements.sentiment.txt /app/requirements.sentiment.txt
COPY ${REQ_FILE} /app/requirements.txt

RUN pip install --no-cache-dir -r /app/requirements.txt

COPY services /app/services
