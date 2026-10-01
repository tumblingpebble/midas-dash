# Windows local setup state

Updated: 2026-10-01 (America/Los_Angeles)
Owner: primary Codex agent (orchestrator)
Objective: run this existing project on this Windows 11 Home laptop in credential-free mock mode, with repeatable startup and verified UI/API behavior.

## Boundaries

- Do not read actual .env files or secrets.
- No live provider calls, cloud deployments, or copying from midas-research.
- Dependency/image downloads are permitted for local setup.
- Keep existing cloud configuration intact; use separate local mock configuration.
- Orchestrator owns this state file and final integration. Agents own disjoint files.

## Baseline

- Windows 11 Home build 26200; approximately 63 GiB RAM; hypervisor present.
- Docker Desktop installed; Docker CLI 29.8.1, Compose 5.5.1; engine initially stopped.
- Ubuntu and docker-desktop registered under WSL2, initially stopped.
- Node 24.19.0, npm 11.17.0 satisfy lockfile Vite requirement.
- Host Python unavailable on PATH; backend containers supply Python 3.11.
- Recommender model.joblib present (43,976 bytes); runtime load verified.
- No existing roadmap file found. This roadmap covers local setup only; broader product scope remains unspecified.
- Existing full Compose has frontend port mismatch and missing API routing, and builds heavy sentiment unnecessarily.
- Static mock analysis: context returns synthetic features with zero quote; gateway skips Yahoo options lookup.

## Roadmap and work orders

| ID | Owner | Work | Status | Acceptance evidence |
| --- | --- | --- | --- | --- |
| WO-1 | orchestrator | Read official orchestration guidance; inspect roadmap; coordinate integration | complete | Scoped tasks and disjoint file ownership |
| WO-2 | windows_startup | Standalone lightweight Compose and PowerShell startup helper | complete | No dotenv loading; fixed mock values; three healthy services |
| WO-3 | frontend_mock | Separate Vite config; install locked dependencies; build | complete | dotenv disabled; local gateway proxy; successful build |
| WO-4 | roadmap_review | Independent configuration, mock safety, CI and acceptance review | complete | Review findings incorporated |
| WO-5 | orchestrator | Start Docker engine, integrate changes, smoke-test backend and UI | complete | Health endpoints, synthetic run with explanation, browser UI |
| WO-6 | orchestrator | Record final commands, results, remaining blockers | complete | Repeatable start/stop instructions and completed state |

## Completion criteria

1. Docker Linux engine available.
2. Only context, recommender, gateway run for mock setup.
3. No actual dotenv files loaded; mock mode enforced.
4. All backend health checks pass and model loads.
5. Gateway synthetic run and explanation succeed.
6. Frontend builds and serves through localhost:5173 with working API proxy.
7. Repeatable Windows start/stop commands documented.

## Activity

- Read-only inspection completed with no modifications or secret access.
- User authorized continuation, agent dispatch, work orders, and persistent state tracking.
- Three scoped agents dispatched. Existing Docker Desktop launch requested by orchestrator.

## Current blockers

- None for local mock setup; Docker Linux engine running.
- Build, model inference, explanation, frontend proxy and browser Run verified.

## Final evidence and running state

- Three mock backend containers healthy on loopback ports 8012, 8014, 8015.
- npm ci passed (198 packages); npm run build -- --config vite.mock.config.ts passed (54 modules).
- Synthetic AAPL result: DEBIT_CALL, confidence 0.8375641303869528, model v0001; explanation includes feature importances.
- Gateway and frontend proxy semantic checks passed: quote.last=0, sentiment.warning=live_providers_disabled, explanation present, confidence within [0,1].
- Browser Run button rendered DEBIT_CALL (83.76%) and live_providers_disabled warning. Dashboard verified at http://127.0.0.1:5173/ during local validation.
- Backend Dockerfile-specific allowlist excludes dotenv files from build context.
- No actual dotenv files read, live provider calls initiated, cloud deployment performed, or midas-research content copied.
- Setup changes are packaged on codex/windows-mock-setup. The frontend was restarted on 2026-10-01 after confirming all three backend services remained healthy.

## Start and stop

Run from C:\Dev\midas-dash with Docker Desktop running:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev-mock.ps1
```

This starts backend and foreground frontend. Ctrl+C stops frontend; backend remains running. Stop backend:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev-mock.ps1 -Stop
```

Add -BackendOnly to start only backend. Stop the currently running frontend before launching another on port 5173.

## Follow-up backlog outside completed local setup

- Frontend dependency findings resolved on 2026-10-01: npm audit now reports zero vulnerabilities after compatible lockfile updates.
- CI compose-smoke now uses the isolated mock stack and verifies frontend routing plus semantic mock behavior. Full-stack Trivy/SBOM jobs remain enabled; hosted delivery results are tracked below.
- Original full Compose frontend port/routing issues remain; isolated mock path avoids them.
- Python dependencies lack a full lockfile; fresh builds may resolve differently.
- Broader product roadmap remains unspecified; this roadmap covers Windows mock setup.

## Next phase work orders

| ID | Owner | Work | Status | Acceptance |
| --- | --- | --- | --- | --- |
| WO-7 | frontend_mock | Dependency advisory audit and compatible lockfile fixes | complete | 14 findings resolved to zero; isolated build passed; package.json unchanged |
| WO-8 | windows_startup | Startup review and bounded reliability fixes | complete | Explicit Compose project name; frontend preflight; Windows PowerShell 5.1 parse passed |
| WO-9 | orchestrator | Integrate results, verify runtime, update state | complete | Compatible patch scope chosen; frontend restarted; fresh mock proxy/explanation passed |

2026-10-01 continuation: backend remained healthy; frontend restarted and proxy mock safety check passed. Setup reliability and compatible dependency patches proceeded while broader feature scope remained undefined. No cloud deployment or live provider calls were initiated.

Final dependency evidence: npm audit fix --ignore-scripts made compatible updates within existing package.json ranges. Vite 7.3.6, esbuild 0.28.2, React Router/DOM 7.18.4, PostCSS 8.5.28. npm audit reported zero vulnerabilities; isolated production build passed. Tracked edit is package-lock.json only (294 insertions, 267 deletions); existing source behavior preserved. Frontend restarted to use patched dependencies during local validation. A temporary old esbuild directory remains under ignored node_modules after a Windows file-lock cleanup warning; build and new runtime passed. These checks preceded the draft PR delivery recorded below.

## Mock CI and documentation work orders

| ID | Owner | Work | Status | Acceptance |
| --- | --- | --- | --- | --- |
| WO-10 | frontend_mock | Use isolated three-service stack for CI smoke job and validate frontend proxy | complete | YAML/structure verified; security job definitions unchanged |
| WO-11 | windows_startup | Add credential-free local smoke validator | complete | Positive mock run; missing-marker negative test rejected; non-loopback target rejected |
| WO-12 | roadmap_review | Repair README formatting and document verified Windows workflow | complete | Commands and links match config; Markdown fences repaired; cloud guidance retained |
| WO-13 | orchestrator | Integrate and verify CI/docs changes | complete | Mock smoke and Bash syntax checks passed; independent review found no actionable issues |

Scope: the compose-smoke CI job becomes lightweight. Existing full-stack security scan/SBOM jobs remain intact. These checks preceded the draft PR and hosted runs recorded below.

Validation before publishing: node scripts/mock-smoke.mjs --base-url http://127.0.0.1:5173 passed through the running frontend (AAPL DEBIT_CALL, v0001). Workflow parsed using installed js-yaml; original events retained and security definitions matched the baseline after newline normalization. All compose-smoke shell blocks parsed with Git Bash. git diff --check passed. Existing frontend build/dependency verification from WO-7 remains applicable; no application source was changed in this phase. Subsequent hosted results are recorded below.

## Final delivery work orders

| ID | Owner | Work | Status | Acceptance |
| --- | --- | --- | --- | --- |
| WO-14 | privacy_audit, roadmap_review, orchestrator | Final scope, privacy, documentation and configuration review | complete | No blocking findings; nine intended files; application source unchanged |
| WO-15 | orchestrator | Package setup changes on codex/windows-mock-setup and create draft PR | complete | Draft PR #22 attached; scoped commit; noreply author/committer; no deployment |
| WO-16 | orchestrator | Verify hosted CI and resolve setup-related failures | in progress | Hosted mock smoke and Gitleaks passed; Trivy found fixable container findings; SBOM awaits scan success |
| WO-17 | orchestrator | Final handoff and remaining-work accounting | pending | PR, startup commands, check evidence and remaining issues recorded |
| WO-18 | frontend_mock, windows_startup, privacy_audit, orchestrator | Repair verified container security findings without weakening CI | in progress | Debian/pip fixes verified locally and on three hosted backend scans; sentiment Transformers 5 compatibility repair remains |

Running-state descriptions above are historical validation evidence. Use the startup helper and smoke command to establish current availability. Broader product features and cloud deployment are outside this setup delivery.

Draft PR: https://github.com/tumblingpebble/midas-dash/pull/22. Initial setup commit: 67accdd9ab728bb13a1d4b4062f89be97b7b45a1. Initial hosted run: https://github.com/tumblingpebble/midas-dash/actions/runs/36898373147. Three delivery work orders remain (sentiment image repair, CI verification and final handoff). No merge or deployment has occurred.

First hosted result: compose-smoke passed on Ubuntu, including image builds, three healthy services, frontend npm ci/build, semantic proxy smoke and teardown. Gitleaks failed before scanning because shallow checkout omitted the parent in its requested commit range. The checkout now uses fetch-depth: 0; scanner behavior is unchanged. The original full-stack scan/SBOM remain enabled.

Replacement hosted run: https://github.com/tumblingpebble/midas-dash/actions/runs/36898762993. Mock smoke and Gitleaks passed. Trivy found 11 fixable HIGH findings in the gateway image (seven Debian records, four Python records); SBOM was skipped because its prerequisite failed. The Python findings match pip's vendored dependencies, while installed runtime urllib3 and setuptools are already patched. Local Trivy reproduction is stored only under .git; application files and security thresholds remain unchanged.

Container repair validation: both backend Dockerfiles now upgrade Debian packages and check dependencies before removing pip from the final runtime. Sentiment performs its model download before this cleanup; setuptools and wheel remain available. Docker build checks and independent review passed. The mock stack rebuilt successfully, dependency checks passed, all three services are healthy, and the frontend proxy smoke passed (AAPL DEBIT_CALL, v0001). Trivy 0.65.0 with the existing fixable HIGH/CRITICAL threshold reports zero findings in the rebuilt gateway image. Hosted full-stack scans and SBOM generation remain to verify.

Hosted image-repair run: https://github.com/tumblingpebble/midas-dash/actions/runs/36900598098 (72775dbb9524f3337577868188634b380881c870). Mock smoke, Gitleaks and gateway/context/recommender Trivy scans passed. Sentiment has three HIGH Transformers 4.57.6 findings requiring at least 5.10.0, which the existing <5 requirement forbids. Frontend scan and SBOM were skipped after that failure. A bounded major-version compatibility check is underway before any further dependency change.

Sentiment repair: transformers>=5.10.0,<6, sentence-transformers>=5.4.1,<6 and setfit==1.2.0. The first candidate failed because SetFit 1.1.3 imports a helper removed in Transformers 5; SetFit 1.2.0 supplies the compatibility fix. The local SetFit artifact uses Sentence Transformers 5.4.1 module paths. A dedicated sentiment build allowlist excludes dotenv files, and scripts/sentiment-smoke.py verifies cached FinBERT, the actual local SetFit artifact, and API fallback using synthetic text with networking disabled. Hosted CI runs the same offline acceptance with a ten-minute timeout before image scans. Local offline inference passed with Transformers 5.18.0, Sentence Transformers 5.7.0, SetFit 1.2.0, Torch 2.14.1 and scikit-learn 1.7.2 in a thin compatibility image. Docker became unavailable during the large-image scan, leaving no scan result. The engine and all three mock services have been restored, the frontend restarted, and fresh proxy smoke passed. The final image security scans will run in hosted CI. The lightweight Windows mock path still omits sentiment.
