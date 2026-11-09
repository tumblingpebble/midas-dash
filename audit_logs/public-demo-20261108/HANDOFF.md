# Reviewer demo handoff — 2026-11-08 Pacific

**URL remains down. Root cause confirmed: billing disabled because the linked Google Cloud billing account is closed; free trial has ended.**

- Reproduced public `/` HTTP 500 and Edge 503 before diagnosis; History/Settings also fail.
- DNS, TLS and the existing domain mapping are valid. All five Cloud Run services fail direct serving probes despite Ready control-plane conditions.
- The exact original request trace `045d939c0a4d83c91218f59596ecd342` states: “The request failed because billing is disabled for this project.”
- **Human action:** restore active billing for the existing midas-dash project through its linked account. Billing changes and possible charges are outside this task's authority. Edge is left on account management; no billing/upgrade action was taken.
- Application repair/deployment: none; a code redeploy will not remove the confirmed billing restriction. No domain, IAM, data or Research changes.
- Reviewable diagnostic tooling: branch `codex/restore-public-demo`; read-only mode added to the existing keyless deployment workflow. Original human edits remain uncommitted and separate.
- Verification: 85 existing offline tests, four diagnostic tests, zero-warning lint and TypeScript/mock production build passed. Public live/demo behavior remains unverified while serving is disabled.
- After billing restoration: allow up to 30 minutes for Cloud Run recovery, then verify public landing, History, Settings and one truthful live/demo run with Explain/retry before claiming restoration.
- Rollback: no service traffic changed. Existing revision IDs and diagnostic rollback details are in [REPORT.md](REPORT.md).

Detailed reproduction, sanitized screenshots, workflow runs and scope: [REPORT.md](REPORT.md).
