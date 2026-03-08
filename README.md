# MIDAS DASH

MIDAS DASH is a cross-platform web application and cloud-ready deployment of a market insight system. It extends prior MIDAS concepts into a responsive web interface with Dockerized FastAPI services, CI smoke testing, model explainability, and multi-environment deployment workflows.

## What this repo includes

- `platform_app/` — React + TypeScript + Tailwind web app
- `services/` — FastAPI microservices:
  - `context_api`
  - `recommender_api`
  - `gateway_api`
  - `sentiment_api`
- `docker-compose.yml` — local full-stack orchestration
- `.github/workflows/ci.yml` — GitHub Actions compose smoke tests
- `.github/dependabot.yml` — dependency update automation

## Run modes

### Mock mode
Safe for CI and offline development.

```bash
docker compose up --build

Live mode
Requires provider tokens in .env.
Example:
LIVE_PROVIDERS=1
FINNHUB_TOKEN=...
TIINGO_TOKEN=...

Local URLs
Web App: http://localhost:8080
Gateway: http://localhost:8015/healthz

Explainability
Gateway supports:
GET /api/run?ticker=NVDA&explain=1

This returns:
prediction class + confidence
model version
top global feature importances
input feature values used for inference

Notes
This repo re-scopes earlier MIDAS concepts into a platform/web deployment project.  The web app, Dockerization, CI/CD, explainability surfacing, and deployment-oriented work in this repository are part of the MIDAS DASH productization effort.
