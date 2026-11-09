# MIDAS Dash public demo restoration

Status: **root cause diagnosed; public demo remains unavailable; billing action requires the human owner.** No application repair or deployment is claimed.

## Scope and preserved work

- Repository: `C:/Dev/midas-dash`, `tumblingpebble/midas-dash` only.
- Started on `main` at `4a0f82baed37c86677e51e259ae412795aae8725`.
- No `AGENTS.md` was present in this checkout or its filesystem ancestors.
- Read README, DEPLOYMENT, SETUP_STATE and deployment/frontend/backend configuration.
- Existing dirty frontend, CI, state, tests and prior audit files remain separate and uncommitted. They were not staged or deployed.
- Restoration branch: `codex/restore-public-demo`.
- Diagnostic commit: `f517cfec17396c22c998e9cffc335141362d2bb6` (three files only).
- No Research repository access, integration, data publication or messaging.
- No dotenv or credential contents read or printed; no new credentials, permissions, billing changes or resources.

## Reproduction before diagnosis

Checks on 2026-11-08 Pacific time (2026-11-09 07:07–07:10 UTC):

| Public path | Observed HTTP status |
| --- | --- |
| `https://midasdash.app/` | 500; a separate Edge navigation showed a 503 error page |
| `/history` | 503 |
| `/settings` | 503 |
| `/healthz` | 404 (this path is not a health endpoint in the cloud frontend nginx config) |

The 500 response was Google Frontend HTML headed “Error: Server Error,” trace ID `045d939c0a4d83c91218f59596ecd342`. The Edge 503 page said the service was not available yet. Saved browser evidence: [public-error.png](public-error.png).

The web tool's failed access and the initial sandbox DNS restriction were not treated as proof of the fault. These results came from independently permitted public HTTP checks and Edge.

DNS: apex A records `216.239.32.21`, `216.239.34.21`, `216.239.36.21`, `216.239.38.21`, with corresponding Google IPv6 records. Authoritative nameservers: `dns1.registrar-servers.com`, `dns2.registrar-servers.com`. No apex CNAME. No DNS changes made.

TLS: hostname `midasdash.app`, issuer Google Trust Services WR3, validity 2026-10-02 08:02:09 UTC through 2026-12-31 08:53:01 UTC. Native certificate validation and TLS 1.3 succeeded; curl reported verification result 0. Certificate bypasses were not used.

## Deployment topology and access

Repository configuration identifies five Cloud Run services in `us-central1`: sentiment-api → context-api; context-api and recommender-api → gateway-api; midas-dash-web is nginx serving a Vite/React bundle with a build-time gateway origin. The existing manual workflow uses GitHub OIDC / Workload Identity Federation and Artifact Registry. It deploys live providers by default. It is not appropriate to redeploy all five services speculatively.

The latest recorded deployment workflow succeeded on 2026-04-28, source `0aaafc5b4d66155a1e422f4ceacd1e48f2bd0cca`, run [25037136524](https://github.com/tumblingpebble/midas-dash/actions/runs/25037136524). Its expired job logs returned HTTP 410; this is historical evidence, not present service health.

The initially selected Cloud Console account displayed a legal Terms of Service dialog; no terms were accepted. Switching through the normal visible account chooser to the other existing personal Google session provided project access without a terms dialog. The earlier terms-approval request is obsolete. The local machine has no gcloud CLI on PATH. Existing GitHub keyless access is available without extracting tokens.

## Focused diagnostic change

The existing manual deployment workflow now accepts `diagnose_only=true`. This selects a separate read-only job and skips the deployment job. It inspects only the five existing services, their health/schema paths, the existing apex domain mapping and billing-enabled state. Logs are reduced to timestamps, revision names, HTTP status and recognized error categories; raw messages, environment values and private URLs are never emitted. No provider requests or recommendations are performed by this mode.

First diagnostic run [42578003415](https://github.com/tumblingpebble/midas-dash/actions/runs/42578003415) failed at checkout because a short SHA was interpreted as a branch. It never authenticated to Google. The corrected full-SHA run [42578132344](https://github.com/tumblingpebble/midas-dash/actions/runs/42578132344) completed successfully; the deployment job was skipped. Success means diagnostic collection completed, not that the services are healthy.

All services have control-plane Ready/ConfigurationsReady/RoutesReady conditions set True and 100% traffic on their latest ready revisions. Direct serving probes nevertheless fail:

| Existing service | Deployed revision (100% traffic) | Direct probe |
| --- | --- | --- |
| sentiment-api | `sentiment-api-00032-dk5` | `/openapi.json` 500 |
| context-api | `context-api-00031-fvh` | `/openapi.json` 500 |
| recommender-api | `recommender-api-00026-qfj` | `/openapi.json` 500 |
| gateway-api | `gateway-api-00027-dzw` | `/openapi.json` 500 |
| midas-dash-web | `midas-dash-web-00027-mcs` | `/` 500, `/history` 503, `/settings` 503 |

The `midasdash.app` mapping reports Ready, CertificateProvisioned and DomainRoutable True and targets `midas-dash-web`. The context service is configured with `LIVE_PROVIDERS=1`; the public deployment is live-mode configuration, not a mock demo. No live recommendation/provider calls were made, and no accuracy or research-result claim is made. Source dependencies are the existing Dash services/providers; Research integration was neither needed nor authorized.

The existing deployment identity can describe services/domain mappings but cannot read application logs. Its billing query was unavailable (permission/API-disabled categories), not evidence that billing was enabled or disabled. The first classifier was too broad for an API-disabled error; follow-up tests narrow it so a disabled Billing API is not labelled as a disabled project/account.

## Confirmed root cause and request trace

Using the existing owner browser session, opened the frontend's Observability → Logs and expanded the exact request at `2026-11-09T07:07:50.644670Z` (2026-11-08 23:07:50.644 Pacific). Its HTTP 500, zero reported request latency, and trace `045d939c0a4d83c91218f59596ecd342` match the original public curl response. Cloud Run's text payload states:

> The request failed because billing is disabled for this project.

Log insert ID: `6af17146000a46961efe50d2`. The owner console also displays that the free trial is over. Billing → linked account → Account management explicitly states that the linked account is closed and must be reopened to continue using linked projects; the project table includes midas-dash. The Reopen control is disabled in this session and the Upgrade control is present. Neither was activated.

Screenshots [billing-disabled-trace.png](billing-disabled-trace.png) and [billing-closed.png](billing-closed.png) are cropped to the relevant fields, excluding billing account identifiers and service URLs. No raw log export, client IPs or unrelated request evidence is retained.

This is a project billing/serving restriction before application execution. A frontend patch, domain replacement or speculative five-service redeployment would not resolve it. No application change is justified by the observed fault.

## Local verification

- Existing 85 offline storage, lifecycle/API/History and CI-scope tests passed on the preserved working tree.
- Zero-warning ESLint and TypeScript/mock production build passed (56 modules).
- Four diagnostic tests passed: fixed read-only command/route scope, no secret/URL/raw-log output, safe permission-failure handling, API-disabled versus billing-disabled distinction and the observed platform error text.
- Diagnostic script syntax, workflow YAML, mutually exclusive diagnosis/deployment gates and whitespace checks passed.
- These local checks do not establish public repair, deployed-code acceptance or current provider accuracy.

## Deployment and rollback

No application deployment, traffic update, domain change or billing change has occurred. Existing service revisions and traffic are untouched. The diagnostic mode can be removed by reverting its isolated commit; the original deployment path and default input remain available. Concrete service rollback information will be recorded if an actual service change is required and authorized.

## Single remaining human action and continuation

The owner must **restore active billing for the existing midas-dash GCP project through its closed linked billing account**. The console reports an ended free trial and a closed account. Upgrading/reopening/choosing a paid billing account can incur charges and is explicitly outside the authorized scope; no upgrade control was activated and no payment or billing setting was changed. The account-management page is retained in Edge for the owner.

After the owner restores billing, allow Google serving-state recovery, then verify the existing URL and direct health/schema paths before considering deployment. Google documents that recovery after billing restoration can take up to 30 minutes: [Cloud Run known issues](https://docs.cloud.google.com/run/docs/known-issues). Then verify landing, History and Settings in a browser, inspect a reviewer run with truthful live/demo labels and sanitized output, and validate request/retry/Explain behavior. Those public acceptance steps remain **unverified** while serving is disabled. Do not publish Research data or silently substitute synthetic recommendations.

State distinctions: diagnosed **yes**; application fixed locally **not applicable to confirmed billing fault**; diagnostic tooling tested **yes**; application deployed **no**; public restoration verified **no**.
