# MIDAS DASH

MIDAS DASH is a responsive web application backed by Dockerized FastAPI microservices and deployed to Google Cloud Run.

## Architecture

| Service | Endpoints |
| --- | --- |
| `context-api` | `/healthz`, `/api/features`, `/api/features/v2`, `/api/one_liner` |
| `recommender-api` | `/healthz`, `/api/recommend`, `/api/explain` |
| `gateway-api` | `/healthz`, `/api/run?ticker=...&explain=1` |
| `sentiment-api` | `/healthz`, `/api/sentiment` |
| `midas-dash-web` | Vite frontend served by nginx on Cloud Run |

## Purpose

The project demonstrates a production-style path from local multi-container development to secure, repeatable cloud deployment using Docker, FastAPI microservices, GitHub Actions, Artifact Registry, Google Cloud Run, and GitHub OIDC / Workload Identity Federation.

## Windows local development: mock mode

The verified lightweight path uses three Docker backend services and the Vite frontend. Setup progress, verification evidence, and outstanding work are tracked in [SETUP_STATE.md](SETUP_STATE.md).

Prerequisites:

- Docker Desktop running its Linux container engine through WSL2. This works on Windows 11 Home.
- Node.js and npm. Locked Vite 7.3.6 requires Node `^20.19.0 || >=22.12.0`; this laptop was verified with Node 24.19.0.
- Free loopback ports 5173, 8012, 8014, and 8015.

Host Python is unnecessary: backend containers supply Python 3.11. The first startup downloads container images and Python dependencies; the helper runs `npm ci` if the frontend Vite executable is missing.

Start Docker Desktop, then run these commands from the repository root in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev-mock.ps1
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173) (`localhost:5173`). The frontend runs in the foreground; keep its terminal open. Ctrl+C stops the frontend while backend containers remain running. Stop an existing frontend before starting another, since Vite requires port 5173.

To start only the backend:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev-mock.ps1 -BackendOnly
```

To stop the mock backend:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev-mock.ps1 -Stop
```

The [startup helper](scripts/dev-mock.ps1) uses the standalone [mock Compose configuration](docker-compose.mock.yml), with project name `midas-dash-mock`. Do not merge it with the full `docker-compose.yml`. Backend ports are bound to loopback:

| Service | Local address |
| --- | --- |
| Context | `http://127.0.0.1:8012` |
| Recommender | `http://127.0.0.1:8014` |
| Gateway | `http://127.0.0.1:8015` |

The [mock Vite configuration](platform_app/vite.mock.config.ts) proxies `/api` and `/healthz` to the local gateway. Compose dotenv loading and Vite dotenv loading are disabled for this path; provider credentials are blank and `LIVE_PROVIDERS=0` is fixed. No actual `.env` file or provider credential is required. Sentiment is omitted, and synthetic requests do not call live providers or Yahoo option chains.

Mock data demonstrates application wiring and model inference. Tickers use the same synthetic features, quotes are zero, news is absent, and sentiment reports `live_providers_disabled`. These are not current market signals or executable trade prices.

### Verify the running stack

With the frontend running, use the [mock smoke check](scripts/mock-smoke.mjs) to verify its HTML, gateway health, and synthetic recommendation with explanation through the Vite proxy:

```powershell
node scripts/mock-smoke.mjs --base-url http://127.0.0.1:5173
```

### Live mode

The original `docker-compose.yml` describes the full stack. Live context requires provider tokens, `LIVE_PROVIDERS=1`, and an available sentiment service. Its local sentiment address is `http://sentiment_api:8016`. The full Compose frontend needs its container port and API routing corrected before it is usable locally; the verified Windows setup above uses Vite.

Live provider variables used by the code are `FINNHUB_TOKEN` and `TIINGO_TOKEN`. Keep credentials outside tracked files. Live mode and cloud deployment are separate from the credential-free mock setup.

## Cloud deployment

### Authentication

GitHub Actions authenticates to Google Cloud using OIDC / Workload Identity Federation. This avoids storing long-lived JSON service account keys in GitHub.

### Manual deploy workflow

The repository includes [.github/workflows/deploy-manual-cloud-run.yml](.github/workflows/deploy-manual-cloud-run.yml). It builds images, pushes to Artifact Registry, deploys Cloud Run services in dependency order, performs smoke tests, and deploys the frontend with the correct build-time API base URL.

Live deployment order:

1. `sentiment-api`
2. `context-api`
3. `recommender-api`
4. `gateway-api`
5. `midas-dash-web`

### Secrets

Provider tokens are stored in Google Secret Manager and injected into Cloud Run for context-api. Current live provider variables are `FINNHUB_TOKEN` and `TIINGO_TOKEN`. Additional runtime variables are `LIVE_PROVIDERS=1` and `SENT_URL=<sentiment-api-url>`.

## Current status

Previously completed:

- Frontend reconciled into the new midas-dash repo.
- Cloud Run deployment and GitHub Actions manual deploy working.
- Live mode working through context-api and sentiment-api.
- Sentiment-api running with FinBERT in Cloud Run.
- Secure keyless GitHub-to-GCP authentication enabled.

Current local setup evidence is recorded in [SETUP_STATE.md](SETUP_STATE.md).

## Known lessons learned

- Docker Compose command overrides do not carry into Cloud Run.
- Cloud Run failures should be debugged with CLI-first inspection.
- Image size is not the same as runtime memory use.
- A browser JSON parse error like `Unexpected token '<'` often means the frontend hit HTML instead of the API.
- nginx SPA configuration and build-time API base URL wiring both matter.
- Exact environment variable names and module import paths matter for CI/CD correctness.
- A failing edge health path does not always mean the service is broken; verifying `/openapi.json` was a stronger FastAPI smoke test in this project.
- Separating heavy and light dependencies helped unblock cloud success.
