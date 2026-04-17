# MIDAS DASH Deployment

## GCP project settings

- Project ID: `project-bbb56a4c-09f6-4fad-a46`
- Region: `us-central1`
- Artifact Registry repo: `midas-dash`

## GitHub Actions repository variables

Configure these in:

GitHub → Settings → Secrets and variables → Actions → Variables

```text
GCP_PROJECT_ID=project-bbb56a4c-09f6-4fad-a46
GCP_REGION=us-central1
GCP_ARTIFACT_REPO=midas-dash
WIF_PROVIDER=projects/332530014479/locations/global/workloadIdentityPools/github/providers/midas-dash
WIF_SERVICE_ACCOUNT=github-deployer@project-bbb56a4c-09f6-4fad-a46.iam.gserviceaccount.com

Authentication model

The deploy workflow uses:

GitHub OIDC
Google Workload Identity Federation
no long-lived JSON service account key
Secret Manager

Create and maintain:

FINNHUB_TOKEN
TIINGO_TOKEN

Grant roles/secretmanager.secretAccessor to the runtime service account used by context-api.

Manual deploy workflow

Workflow file:

.github/workflows/deploy-manual-cloud-run.yml

Trigger from:

GitHub → Actions → Deploy MIDAS DASH to Cloud Run (Manual) → Run workflow

Input:

main

Live-mode deploy order
sentiment-api
context-api
recommender-api
gateway-api
midas-dash-web
Cloud Run runtime settings
sentiment-api

Build args:

REQ_FILE=requirements.sentiment.txt
APP_MODULE=services.sentiment_api.app:app

Recommended Cloud Run settings:

--memory 2Gi
--cpu 1
--timeout 300
SENT_TTL_S=90
context-api

Build args:

REQ_FILE=requirements.base.txt
APP_MODULE=services.context_api.app:app

Required live-mode runtime config:

LIVE_PROVIDERS=1
SENT_URL=<sentiment-api-url>

Secrets:

FINNHUB_TOKEN=FINNHUB_TOKEN:1
TIINGO_TOKEN=TIINGO_TOKEN:1
recommender-api

Build args:

REQ_FILE=requirements.base.txt
APP_MODULE=services.recommender_api.app:app
gateway-api

Build args:

REQ_FILE=requirements.base.txt
APP_MODULE=services.gateway_api.app:app

Runtime config:

CTX_URL=<context-api-url>
REC_URL=<recommender-api-url>
ALLOW_ORIGINS=*
midas-dash-web

Build arg:

VITE_API_BASE_URL=<gateway-api-url>
Verification

Recommended smoke tests:

sentiment-api
/openapi.json
POST /api/sentiment
context-api
/openapi.json
/api/features/v2?ticker=AAPL
recommender-api
/openapi.json
gateway-api
/openapi.json
/api/run?ticker=AAPL&explain=1
midas-dash-web
load the Cloud Run URL
perform a live run from the UI
Rollback

Rollback by redeploying the last known-good image tag for the affected service.

Troubleshooting
Cloud Run does not honor Docker Compose command overrides
verify Cloud Run state with:
gcloud run services describe
gcloud run revisions describe
gcloud logging read
do not assume env var names; inspect the code
do not assume module paths; inspect the repo structure
use /openapi.json as a reliable FastAPI smoke test when an edge path behaves unexpectedly
image size is not the same as runtime memory use
keep CI green before merging dependency changes