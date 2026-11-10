# Owner-managed private access (local candidate)

This is a standalone, opt-in private deployment profile. It does not deploy anything, create users, authorize data sharing, or change existing development/Cloud Run configurations.

## Scope and current boundaries

- Jonathan approves access requests outside the application. There is no public signup or automatic approval.
- Each approved reviewer gets a distinct username and strong unique password; never share Jonathan's administrator or provider account. No operational credentials are supplied here.
- Caddy validates credentials on every request. Only the TLS gate publishes ports; the web application and four APIs remain on an internal Docker network.
- The profile deliberately fixes LIVE_PROVIDERS=0 and blank provider keys. It demonstrates synthetic context, not live market prices. Its internal network also prevents provider egress. Do not enable feeds until data permissions and a separate hosting action are approved.
- This is not a substitute for provider licensing. It is not multi-tenant storage, a full identity system, automatic expiry, MFA, rate limiting, or protection against an authorized user's automation.
- HTTP Basic authentication has browser-managed credential caching and no dependable application logout. Use a fresh private browser window and close it when finished. Removing a reviewer and successfully reloading Caddy blocks subsequent requests, not information already received or an in-flight response.
- Private frontend builds keep all browserStorage state (history, last run, ticker and settings) in page memory. Existing localStorage bytes are neither read nor erased; refreshing creates a new page-memory store. Revocation cannot erase an already-open page or saved screenshots/downloads. Do not share browser sessions between people.

## Reviewed operator setup (not performed by these instructions)

Use an owned DNS hostname with valid DNS, a permitted free host, and ordinary publicly trusted TLS. Caddy automatically obtains/renews certificates; production certificate issuance, DNS, network exposure and provisioning require their own approval. Only Caddy needs public 80/443; port 80 redirects to HTTPS. Its admin endpoint remains container loopback only.

Create the authorization directory **outside the checkout and all build contexts** with access limited to its owner. This is trusted configuration, not an upload endpoint. A file named users.caddy contains only one approved username and bcrypt password hash per line, in Caddy basic_auth syntax. Never put passwords in source, shell history, URLs, the CV, logs or reports. Obtain hashes securely using Caddy's interactive hash-password command; do not put a real password in a command argument. Production credential creation/delivery is a separate authorized action.

Do not use the public test fixture credentials in production. The test fixture is not part of the deployment profile.

Set MIDAS_PRIVATE_HOST to an owned DNS hostname in lowercase without scheme, port or path, and MIDAS_PRIVATE_AUTH_DIR to that existing outside-checkout directory. The startup guard rejects non-DNS hostname input, and Caddy's site address explicitly prefixes HTTPS; an HTTP scheme cannot disable TLS accidentally. Supply only known deployment variables, disable automatic dotenv loading (COMPOSE_DISABLE_ENV_FILE=1 and --env-file pointing to an explicit empty file), and never print an existing .env or credential environment.

Use docker-compose.private.yml **alone**, not merged with docker-compose.yml. Merging can retain host port mappings and break isolation. Its frontend build sets VITE_API_BASE_URL empty and VITE_PRIVATE_ACCESS=1. Do not substitute an old frontend image: private memory-only behavior is compiled into its assets. The Caddy runtime and Go compiler base images are pinned by digest in deploy/private/caddy/Dockerfile. The local Caddy 2.11.9 rebuild pins golang.org/x/net v0.62.0 to fix CVE-2026-78661; do not replace it with the vulnerable upstream 2.11.9 binary. Build from the locked go.mod/go.sum without disabling checksums or automatic dependency upgrades. The local image tag is a build label, not an immutable provenance claim; record and test its actual image ID before deployment.

Validate the resolved Compose configuration, Caddy configuration, credential permissions, and actual published ports before any launch. The required host/auth-directory variables fail configuration when absent. Missing/invalid users.caddy must fail closed; an empty user list must not grant anyone access.

## Approval and revocation

Approve a named review request, then add its individual username/hash through the trusted owner workflow. Deliver access only through an approved private channel; do not publish shared credentials on the CV. Keep an owner-maintained access register and manually revoke at the end of the agreed review period. Automatic expiry is not implemented.

The authorization directory is mounted, not a single file, so an atomic file replacement becomes visible inside the gate. Validate the updated file and perform a Caddy reload through docker compose exec (container loopback admin, not a public admin port). Confirm reload success, then verify the removed user's next HTTPS request returns 401 and a retained user's request still succeeds. **A failed reload leaves the previous configuration active: it is not a successful revocation.** If revocation cannot be confirmed, stop the gate through the owner-approved operational procedure rather than claiming access was removed.

Do not give reviewers Docker, SSH, Caddy admin, provider keys or source-write access. Do not forward their Basic Authorization header to application services.

## Verification expectations

Before real hosting: anonymous/wrong/removed users cannot fetch HTML, assets, deep links, health or API output; individual users can be revoked without affecting others; direct backend ports are unreachable externally; non-HTTPS requests disclose no app content; browser cross-site API requests are rejected; upstream CORS permissions and auth headers are not propagated; reload failures are recognized; private frontend storage never touches prior persisted bytes.

Local tests use an isolated internal Docker network, synthetic users/backend responses and an explicit disposable CA trust file, with no host port publication, provider calls or OS trust changes. This proves local gate behavior, not public DNS/ACME issuance, ARM runtime compatibility, network firewall configuration, production credentials, browser-native login UX, or full live-provider acceptance.

## Narrow Caddy dependency repair

The stock Caddy 2.11.9 image contains golang.org/x/net v0.60.0, flagged HIGH CVE-2026-78661 by the 2026-11-10 advisory database. This candidate rebuilds the same standard Caddy release with x/net v0.62.0. The main program comes from the official v2.11.9 module, verified by its Go module checksum. Go 1.27.3 and the original nobadger,nomysql,nopgx build tags are retained. Both base images are digest-pinned, module checksums stay enabled, final compilation uses read-only module resolution without network access, and lockfiles must remain byte-identical through build. This is a locally maintained patched binary, not a new upstream release.

The smoke harness requires MIDAS_TEST_CADDY_IMAGE to be the full sha256 image ID of the reviewed repaired build. Supply existing test Python/web image references and a fresh evidence directory as documented by the harness. Functional tests do not replace the dependency/module comparison and fresh vulnerability+secret scan. Native ARM build/runtime acceptance remains separate.

Compose sets pull_policy: build for private_gate, so the reviewed local recipe is built rather than silently pulling a same-named registry image. Record and test its exact image ID before any separately authorized deployment; a local image tag is not an immutable identity.

## Explicit JOSE migration backport

The previous x/net-only build still linked go-jose/v3 v3.0.5 (HIGH CVE-2026-116587). A scan using `--ignore-unfixed` was not adequate clearance. This candidate never uses that option.

The locally maintained build uses official crypto v0.92.0 and cli-utils v0.13.0 with JOSE v4.1.9. It keeps certificates v0.30.2 source, checksum-verified against the official module archive, and applies the bounded upstream migration from commit cddde30af36e238f156bb557bfd1f11a05ffe6f9 rather than adopting its hundreds of unrelated intervening commits. `certificates-backport.json` records exact source/result hashes and edits, omitted absent-test hunks, upstream identity and local modifications. Two EAB fixture key bindings are adapted to the old test layout, and synthetic negative audience regressions are included. No operational keys are supplied. The standard-library materializer rejects unexpected source bytes before writing its owned copy.

The binary deliberately reports certificates v0.30.2 replaced by `./certificates-midas (devel)`. This is a custom backport, NOT an unmodified upstream release. Native acceptance requires 146 linked modules, fixed JOSE v4.1.9, no linked JOSE v3, the exact allowed local replacement and lock-bound versions. The unused complete module graph still contains Caddy's upstream v3 requirement; this is distinct from linked runtime packages.

A raw binary scanner cannot identify the local replacement reliably. Therefore CI retains its raw SBOM and uses `scripts/caddy-source-sbom.py` to add the original certificates v0.30.2 identity conservatively, with commit/backport hash metadata, then scans that complement too. Both strict HIGH/CRITICAL scans must pass without exclusions; the runtime image also receives a secret scan. This reduces the identity gap, but does not certify absence of all unknown vulnerabilities or prove native ARM/full live hosting readiness. Source and runtime checks remain separate from provider licensing and hosting approval.