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

- None for Windows mock setup or the verified code CI run.
- Docker Linux engine running; three healthy mock services and frontend proxy verified after recovery.
- Hosted offline sentiment inference, all five image scans and five-file SBOM upload passed.

## Final evidence and running state

- Three mock backend containers healthy on loopback ports 8012, 8014, 8015.
- npm ci passed (198 packages); npm run build -- --config vite.mock.config.ts passed (54 modules).
- Synthetic AAPL result: DEBIT_CALL, confidence 0.8375641303869528, model v0001; explanation includes feature importances.
- Gateway and frontend proxy semantic checks passed: quote.last=0, sentiment.warning=live_providers_disabled, explanation present, confidence within [0,1].
- Browser Run button rendered DEBIT_CALL (83.76%) and live_providers_disabled warning. Dashboard verified at http://127.0.0.1:5173/ during local validation.
- Backend Dockerfile-specific allowlist excludes dotenv files from build context.
- No actual dotenv files read, live provider calls initiated, cloud deployment performed, or midas-research content copied.
- Setup changes were delivered through PR #22 and integrated into main. The frontend was restarted on 2026-10-01 after confirming all three backend services remained healthy.

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
- Original full Compose frontend port/routing repair is tracked in the follow-up section below; the isolated mock path remains available.
- Python dependency locking is complete; delivery evidence is recorded in the follow-up section below.
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
| WO-16 | orchestrator | Verify hosted CI and resolve setup-related failures | complete | Hosted mock smoke, Gitleaks, offline model gate, all five Trivy scans and five-file SBOM upload passed |
| WO-17 | orchestrator | Final handoff and remaining-work accounting | complete | PR, startup commands, verified code SHA/run, remaining scope and zero remaining setup orders recorded |
| WO-18 | frontend_mock, windows_startup, privacy_audit, orchestrator | Repair verified container security findings without weakening CI | complete | Patched Debian/pip and compatible sentiment dependencies; LFS hydration fixed; hosted offline inference and all five Trivy scans passed |

Running-state descriptions above are historical validation evidence. Use the startup helper and smoke command to establish current availability. Broader product features and cloud deployment are outside this setup delivery.

PR: https://github.com/tumblingpebble/midas-dash/pull/22. Initial setup commit: 67accdd9ab728bb13a1d4b4062f89be97b7b45a1. Initial hosted run: https://github.com/tumblingpebble/midas-dash/actions/runs/36898373147. All 18 setup work orders are complete; zero remain. PR #22 was merged on 2026-10-01 by advancing main to the tested head without generating a merge commit. No deployment has occurred.

## Historical hosted CI attempts

First hosted result: compose-smoke passed on Ubuntu, including image builds, three healthy services, frontend npm ci/build, semantic proxy smoke and teardown. Gitleaks failed before scanning because shallow checkout omitted the parent in its requested commit range. The checkout now uses fetch-depth: 0; scanner behavior is unchanged. The original full-stack scan/SBOM remain enabled.

Replacement hosted run: https://github.com/tumblingpebble/midas-dash/actions/runs/36898762993. Mock smoke and Gitleaks passed. Trivy found 11 fixable HIGH findings in the gateway image (seven Debian records, four Python records); SBOM was skipped because its prerequisite failed. The Python findings match pip's vendored dependencies, while installed runtime urllib3 and setuptools are already patched. Local Trivy reproduction is stored only under .git; application files and security thresholds remain unchanged.

Container repair validation: both backend Dockerfiles now upgrade Debian packages and check dependencies before removing pip from the final runtime. Sentiment performs its model download before this cleanup; setuptools and wheel remain available. Docker build checks and independent review passed. The mock stack rebuilt successfully, dependency checks passed, all three services are healthy, and the frontend proxy smoke passed (AAPL DEBIT_CALL, v0001). Trivy 0.65.0 with the existing fixable HIGH/CRITICAL threshold reports zero findings in the rebuilt gateway image. Hosted full-stack scans and SBOM generation remain to verify.

Hosted image-repair run: https://github.com/tumblingpebble/midas-dash/actions/runs/36900598098 (72775dbb9524f3337577868188634b380881c870). Mock smoke, Gitleaks and gateway/context/recommender Trivy scans passed. Sentiment has three HIGH Transformers 4.57.6 findings requiring at least 5.10.0, which the existing <5 requirement forbids. Frontend scan and SBOM were skipped after that failure. A bounded major-version compatibility check is underway before any further dependency change.

Sentiment repair: transformers>=5.10.0,<6, sentence-transformers>=5.4.1,<6 and setfit==1.2.0. The first candidate failed because SetFit 1.1.3 imports a helper removed in Transformers 5; SetFit 1.2.0 supplies the compatibility fix. The local SetFit artifact uses Sentence Transformers 5.4.1 module paths. A dedicated sentiment build allowlist excludes dotenv files, and scripts/sentiment-smoke.py verifies cached FinBERT, the actual local SetFit artifact, and API fallback using synthetic text with networking disabled. Hosted CI runs the same offline acceptance with a ten-minute timeout before image scans. Local offline inference passed with Transformers 5.18.0, Sentence Transformers 5.7.0, SetFit 1.2.0, Torch 2.14.1 and scikit-learn 1.7.2 in a thin compatibility image. Docker became unavailable during the large-image scan, leaving no scan result. The engine and all three mock services have been restored, the frontend restarted, and fresh proxy smoke passed. The final image security scans will run in hosted CI. The lightweight Windows mock path still omits sentiment.

Hosted dependency run: https://github.com/tumblingpebble/midas-dash/actions/runs/36909140050 (1db96e61f3a88a9593654afae91f249a9565c175). Mock smoke and Gitleaks passed; image builds and offline FinBERT inference passed. Offline SetFit loading failed because the full-image CI checkout lacked LFS hydration and copied pointer files. Both full-image jobs now enable LFS checkout, matching the existing manual deployment configuration. The smoke helper explicitly rejects pointer files before inference. No model artifact or application source is changed by this fix.

Hosted LFS repair run: https://github.com/tumblingpebble/midas-dash/actions/runs/36910343715 (5651d24c03594a59a43dc6ecc5649bfedcac0c15). All four jobs passed: mock smoke, Gitleaks, Trivy (including offline FinBERT/SetFit/API fallback acceptance and all five image scans), and SBOM. Five SBOM files were uploaded: https://github.com/tumblingpebble/midas-dash/actions/runs/36910343715/artifacts/11187545725.

## Delivery result

- Verified code commit: 5651d24c03594a59a43dc6ecc5649bfedcac0c15; merged head 947a0ecab9b8cf7a725ef486b1092015cd98b70a differs only in this state file. All four checks passed on the merged head: https://github.com/tumblingpebble/midas-dash/actions/runs/36912110874.
- Application source and model assets were unchanged by this delivery; 14 files cover setup, dependencies, image builds, CI and documentation.
- The original setup delivery is integrated into main. PR #22 is merged; GitHub's mergeCommit field records the tested head 947a0ecab9b8cf7a725ef486b1092015cd98b70a at 2026-10-01T20:16:01Z. No deployment occurred.
- Reproducible startup/stop commands are above and in README. The local dashboard is http://127.0.0.1:5173/ while its terminal is running.
- Original delivery backlog: full-Compose frontend routing/port repair (now tracked below), a full Python lockfile and broader product features.

## Integration work orders

| ID | Owner | Work | Status | Acceptance |
| --- | --- | --- | --- | --- |
| WO-19 | privacy_audit, orchestrator | Verify and integrate the approved PR without changing commit identities | complete | Six setup commits use the configured noreply identity; main advanced with an explicit lease; PR reports merged; local and remote main match the tested head |
| WO-20 | roadmap_review, orchestrator | Record integration and preserve setup handoff | complete | Merged PR and current branch recorded; historical CI attempts labelled; startup instructions and delivery boundaries preserved |

All 18 setup orders and both integration orders are complete for the original mock delivery. The main-branch push triggered verification CI, not deployment. Follow-up work is tracked below.

## Full Compose frontend follow-up

Delivery branch: codex/compose-frontend-routing, based on main at 5c0b3de654a265278bb3be57515750fe08a40b1b.

Scope: repair the original full-Compose frontend's port and API routing, preserving the shared Cloud Run configuration and application source. Verification uses synthetic backend services and temporary loopback frontend containers. Actual dotenv files, live providers, cloud deployment and unrelated repositories remain outside scope.

| ID | Owner | Work | Status | Acceptance |
| --- | --- | --- | --- | --- |
| WO-21 | frontend_mock | Correct Compose frontend configuration and isolate frontend build inputs | complete | Port 8080 matches nginx; local API proxy preserves paths/query strings; cloud configuration retained; dotenv excluded |
| WO-22 | windows_startup, orchestrator | Add and run frontend container acceptance checks | complete | Synthetic recommendation, SPA links, real assets, missing routes and unavailable-upstream behavior verified |
| WO-23 | roadmap_review | Independently review configuration, CI and documentation | complete | No blocking scope, startup or safety findings |
| WO-24 | orchestrator | Integrate results, update state and publish the reviewed change | complete | Scoped noreply commit, PR #23, expanded smoke, all five image scans and five-file SBOM upload verified |

All four frontend follow-up orders are complete; 24 work orders were complete at this frontend delivery. Zero remain for those scopes. The later Python dependency work is tracked below; broader product work remains unspecified.

PR: https://github.com/tumblingpebble/midas-dash/pull/23. Verified repair commit: 43234648738eb00fefee3057056abc854becdd4f. All four hosted jobs passed: https://github.com/tumblingpebble/midas-dash/actions/runs/36924816619. Expanded nginx/frontend acceptance, offline sentiment inference and all five image scans passed. Five SBOM files were uploaded: https://github.com/tumblingpebble/midas-dash/actions/runs/36924816619/artifacts/11194141272. The final delivery update changes only this state file. All four jobs also passed on final head 2846aa22c9b8629b14d3571ad9909153f0757cab: https://github.com/tumblingpebble/midas-dash/actions/runs/36926478279. PR #23 merged at 2026-10-01T22:03:06Z by advancing main to that exact tested head with an explicit lease. Local and remote main matched. No deployment occurred.

Local acceptance on 2026-10-01: full Compose's frontend build succeeded from a 1.32 MB allowlisted context, with zero npm audit findings. Shared nginx passed `nginx -t` with networking disabled. Temporary loopback frontend containers passed gateway health, synthetic AAPL recommendation/explanation, SPA deep links, built JS/CSS, missing asset/API 404s and unavailable-upstream 502 checks. Ports 8081/8082 were occupied locally, so Docker assigned temporary ports 63695/59489; both test containers were removed. Fresh Vite proxy smoke on port 5173 still passed. Application source/assets, shared nginx, the manual cloud workflow and the lightweight mock configuration remain unchanged. The complete five-service stack was not started.

## Python dependency locking follow-up

Delivery branch: codex/python-dependency-locks, based on merged main at 2846aa22c9b8629b14d3571ad9909153f0757cab.

Scope: lock existing Python 3.11/Linux amd64 runtime and packaging versions, enforce hashes in backend builds, and provide portable maintenance and CI freshness checks. Existing source, models, startup behavior, cloud workflow and provider boundaries remain unchanged. Docker base images, Debian packages, bootstrap pip and downloaded model artifacts are outside these Python locks.

| ID | Owner | Work | Status | Acceptance |
| --- | --- | --- | --- | --- |
| WO-25 | privacy_audit, orchestrator | Verify and integrate approved PR #23 | complete | Clean worktree; noreply identities; tested main advanced with explicit lease; GitHub reports merged |
| WO-26 | orchestrator | Generate hashed locks from accepted image versions | complete | Build/base/sentiment locks contain 3/48/107 packages; overlapping versions match accepted SBOM baseline |
| WO-27 | windows_startup | Enforce locked Docker installs and safe input mapping | complete | Hash-required packaging/runtime installs, no build isolation, known REQ_FILE mapping, allowlists updated |
| WO-28 | frontend_mock | Add portable lock maintenance and freshness helper | complete | Disposable compiler, fixed target and uv version, bounded temporary cleanup, no host Python requirement |
| WO-29 | roadmap_review | Independently review dependencies, CI and documentation | complete | No blocking implementation or scope findings; reproducibility limits documented |
| WO-30 | orchestrator | Verify builds and runtime; publish and track hosted CI | complete | PR #24; all four hosted jobs, offline sentiment, five image scans and five-file SBOM upload passed; every Python image matches its lock |

The initial locks were seeded from the five-file SBOM artifact of accepted CI run 36926478279: https://github.com/tumblingpebble/midas-dash/actions/runs/36926478279/artifacts/11194024394. Only top-level Python distributions were used; vendored packaging records were excluded. No dependency versions changed. All thirty defined setup/follow-up orders are complete; zero remain for the scopes delivered so far. Broader product work remains unspecified.

Local acceptance on 2026-10-01: the lock freshness check passed with 3/48/107 packages. Base Docker build passed hash-required installation and dependency consistency checking; a network-disabled inspection confirmed all 48 installed versions match the lock and pip is removed. A cached negative build rejected unlocked `requirements.txt` as REQ_FILE. The three mock services rebuilt from the locks, became healthy, and the existing Vite proxy passed synthetic AAPL recommendation/explanation smoke at http://127.0.0.1:5173. Workflow parsing, helper syntax and whitespace checks passed.

PR: https://github.com/tumblingpebble/midas-dash/pull/24. Verified code commit: dad987aef28c1a7879953c81eb1ca7aef5c3d4be. All four jobs passed: https://github.com/tumblingpebble/midas-dash/actions/runs/36935062978. Hosted mock/Vite/nginx acceptance, offline FinBERT/SetFit/API fallback, and all five image scans passed. Five SBOM files were uploaded: https://github.com/tumblingpebble/midas-dash/actions/runs/36935062978/artifacts/11198535582. Direct distribution inspection confirmed exact lock matches in context, gateway and recommender (48 packages each) and sentiment (107 packages). The final delivery update changes only this state file. All four checks also passed on final head 6b0d8a74b8d6d4420c071e969bb38ee45d965c35: https://github.com/tumblingpebble/midas-dash/actions/runs/36936380564, with five SBOMs at https://github.com/tumblingpebble/midas-dash/actions/runs/36936380564/artifacts/11198935330 and exact installed lock matches. PR #24 merged at 2026-10-02T00:37:20Z by advancing main to that exact tested head with an explicit lease. No deployment occurred.

## GitHub Actions reliability and resource follow-up

Current branch: codex/actions-efficiency, based on merged main at 6b0d8a74b8d6d4420c071e969bb38ee45d965c35.

Scope: inspect active GitHub failures, retire obsolete conflicting update batches, and reduce duplicate builds, overlapping work and artifact retention. Application source, assets, model files, dependency versions and the manual deployment workflow remain unchanged. No provider calls or deployment are authorized in this follow-up.

| ID | Owner | Work | Status | Acceptance |
| --- | --- | --- | --- | --- |
| WO-31 | orchestrator | Safely integrate PR #24 | complete | Exact tested head; noreply identities; explicit main lease; local/remote match; GitHub confirms merge |
| WO-32 | orchestrator | Audit GitHub failures and stale dependency batches | complete | Main/PR24 verified green; historical checkout/image failures already repaired; conflicting PR20/21 closed with branches preserved |
| WO-33 | frontend_mock | Add conservative documentation-only CI classifier | complete | Six tests and actual commit-range checks; full PR scope; unknown paths/history require full CI |
| WO-34 | orchestrator | Reduce duplicate builds and routine update rate | complete | Serialized builds; superseded-run cancellation; SBOMs reuse scanned images; seven-day retention; monthly grouped Dependabot |
| WO-35 | roadmap_review | Independently review CI gates and resource changes | complete | No blockers; required check names, scan thresholds, offline acceptance and fail-closed scope retained |
| WO-36 | orchestrator | Publish and verify the full new CI path, then integrate | in progress | Full source-triggered mock/offline/security/SBOM acceptance must pass before integration |
| WO-37 | orchestrator | Record final evidence and verify lightweight docs path | pending | Documentation-only main update must keep all four checks green without rebuilding images |

Audit: the newest relevant main and PR checks passed. Old Dependabot PR20/21 failed because of shallow Gitleaks history and old unpatched image builds; current main already fixes both. The batches also contain untested major upgrades (including scikit-learn/model compatibility and Vite/TypeScript/ESLint changes) and conflict with main. They were closed, preserving both branches; those migrations remain separate work rather than being silently merged. Historical failed runs remain as audit evidence.

After PR24 integration, duplicate main CI run 36946909356 was intentionally canceled because that exact SHA had already passed all four PR checks. The automatic Dependency Graph run 36946912599 passed. Repository artifact metadata showed about 10.58 MiB retained and 81.43 MiB of caches at inspection. Public standard-runner minutes are free ([GitHub billing documentation](https://docs.github.com/en/actions/concepts/billing-and-usage)); artifacts/caches and other account usage are separate resources. Dependabot alerts could not be audited through the API: it reported disabled alerts and insufficient admin scope, so no zero-alert claim is made.

Local validation: six scope tests passed. A real state-only range classified as lightweight; the full Python-lock delivery range correctly required full CI. Workflow YAML and all 26 Bash blocks parse, all four check names and existing fixable HIGH/CRITICAL scan thresholds are retained, and the SBOM job has no image build. Independent review found no blocking issues. Hosted validation is pending. Thirty-five of thirty-seven defined orders are complete; two remain in this follow-up.
