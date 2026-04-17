# MIDAS DASH

MIDAS DASH is a responsive web application backed by Dockerized FastAPI microservices and deployed to Google Cloud Run.

## Architecture

Services:

- `context-api`
  - `/healthz`
  - `/api/features`
  - `/api/features/v2`
  - `/api/one_liner`
- `recommender-api`
  - `/healthz`
  - `/api/recommend`
  - `/api/explain`
- `gateway-api`
  - `/healthz`
  - `/api/run?ticker=...&explain=1`
- `sentiment-api`
  - `/healthz`
  - `/api/sentiment`
- `midas-dash-web`
  - Vite frontend served by nginx on Cloud Run

## Purpose

The project demonstrates a production-style path from local multi-container development to secure, repeatable cloud deployment using:

- Docker
- FastAPI microservices
- GitHub Actions
- Artifact Registry
- Google Cloud Run
- GitHub OIDC / Workload Identity Federation

## Local development

Repo path used during development:

```bash
~/dev/midas-dash

Docker Compose

Use Docker Compose for local multi-service development.

Mock/lightweight mode:

use the lighter services without requiring live provider credentials

Live mode:

requires provider tokens for context-api
requires sentiment-api to be available

Recommended local untracked environment variables:

LIVE_PROVIDERS=1
FINNHUB_TOKEN=your_token_here
TIINGO_TOKEN=your_token_here
SENT_URL=http://sentiment_api:8080

Cloud deployment
Authentication

GitHub Actions authenticates to Google Cloud using OIDC / Workload Identity Federation.

This avoids storing long-lived JSON service account keys in GitHub.

Manual deploy workflow

The repository includes a manual GitHub Actions deploy workflow:

.github/workflows/deploy-manual-cloud-run.yml

It:

builds images
pushes to Artifact Registry
deploys Cloud Run services in dependency order
performs smoke tests
deploys the frontend with the correct build-time API base URL
Deployment order

Live mode deployment order:

sentiment-api
context-api
recommender-api
gateway-api
midas-dash-web
Secrets

Provider tokens are stored in Google Secret Manager and injected into Cloud Run for context-api.

Current live provider variables used by the code:

FINNHUB_TOKEN
TIINGO_TOKEN

Additional runtime variables:

LIVE_PROVIDERS=1
SENT_URL=<sentiment-api-url>
Current status

Completed:

frontend reconciled into the new midas-dash repo
Cloud Run deployment working
GitHub Actions manual deploy working
live mode working through context-api + sentiment-api
sentiment-api running with FinBERT in Cloud Run
secure keyless GitHub-to-GCP auth enabled
Known lessons learned
Docker Compose command overrides do not carry into Cloud Run
Cloud Run failures should be debugged with CLI-first inspection
image size is not the same as runtime memory use
a browser JSON parse error like Unexpected token '<' often means the frontend hit HTML instead of the API
nginx SPA config and build-time API base URL wiring both matter
exact env var names and actual module import paths matter for CI/CD correctness
a failing edge health path does not always mean the service is broken; verifying /openapi.json was a stronger FastAPI smoke test in this project
separating heavy and light dependencies helped unblock cloud success


---




