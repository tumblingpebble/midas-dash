# Sentiment liveness and model readiness

- `GET /healthz` is cheap process liveness (HTTP 200), not model certification. It retains service/version/TTL/engine/disabled-reason metadata and adds `check: liveness`. An untouched process reports `engine: uninitialized`. It does not load or execute either model.
- `GET /readyz` is an explicit, uncached inference probe using a fixed non-rule-gated synthetic sentence. It returns HTTP 200 / `status: ready` for working FinBERT, HTTP 200 / `status: degraded` for working SetFit after FinBERT failure, or HTTP 503 / `status: unavailable` when only lexicon fallback remains. It returns engine/model-version/warning metadata. A successful primary probe does not certify or initialize the backup.
- Startup remains lazy. Initialization is serialized once per model per process, including failed attempts. Restart the process to retry a failed model load. Runtime FinBERT failures disable that primary for subsequent requests, as before.
- Readiness can take model-load/inference time, unlike liveness. Callers must budget a suitable timeout. No startup, Docker, Compose, orchestration, or deployment gate is changed here. Existing liveness checks alone are not evidence that ML inference works.
- Keeping SetFit lazy avoids forcing both models into RAM under a healthy primary. Explicit readiness probes repeat inference rather than trusting a stale cached response. Multiple workers each own their own model instances and memory.
- `/api/sentiment` keeps the original per-item values and fallback behavior. New aligned `sample_engines` and `sample_model_versions` arrays describe each sample. Homogeneous batches keep existing aggregate metadata. A batch mixing engines reports `engine: mixed`, null aggregate model version, and a mixed-engine warning. Existing confidence aggregation is retained; it is the average of available model confidences, not a confidence for lexicon samples.

## Local validation

Run `PYTHONPATH=. python scripts/sentiment-readiness-test.py` with base service dependencies. This suite stubs ML dependencies before import and needs no model downloads or network.

The existing `scripts/sentiment-smoke.py` remains the real FinBERT/SetFit/offline acceptance check. Run it inside the sentiment image with networking disabled. Its additive assertions check lazy health and primary/degraded readiness alongside the existing real-model inference checks. Fast stub tests do not certify the image's actual model artifacts or dependencies.
