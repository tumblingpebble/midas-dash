"""Offline synthetic inference acceptance; run in the sentiment image without networking."""
import importlib.metadata as metadata
import math
from pathlib import Path

model_dir = Path("/app/audit_logs/sentiment_audit/setfit_model_hpc_full")
for artifact in ("model.safetensors", "model_head.pkl", "config_setfit.json", "modules.json"):
    with (model_dir / artifact).open("rb") as file:
        assert not file.read(128).startswith(b"version https://git-lfs.github.com/spec/v1"), (
            f"{artifact} is a Git LFS pointer; enable LFS checkout before building"
        )

from services.sentiment_api import app as sentiment
from services.sentiment_api.fallback_setfit import get_setfit_model

for package in ("transformers", "sentence-transformers", "setfit", "torch", "scikit-learn"):
    print(f"{package}={metadata.version(package)}", flush=True)

texts = [
    "The company reported strong profits and record revenue growth.",
    "The company reported weak earnings and a decline in revenue.",
    "The company published its quarterly financial report today.",
]

def bounded(value, lower, upper, label):
    value = float(value)
    assert math.isfinite(value) and lower <= value <= upper, f"Invalid {label}"
    return value

assert sentiment.get_pipe() is not None, f"FinBERT failed to load: {sentiment.pipe_disabled_reason}"
result = sentiment.analyze(sentiment.SentIn(texts=texts))
assert result["engine"] == "finbert", "FinBERT inference silently fell back"
assert result["model_version"] == "ProsusAI/finbert"
assert result["n"] == len(texts) and len(result["samples"]) == len(texts)
for sample in result["samples"]:
    bounded(sample, -1, 1, "FinBERT sample")
assert result["samples"][0] > result["samples"][1], "FinBERT did not distinguish positive and negative synthetic text"
bounded(result["confidence"], 0, 1, "FinBERT confidence")
bounded(result["mean"], -1, 1, "FinBERT mean")
bounded(result["std"], 0, 1, "FinBERT standard deviation")
assert result["warning"] is None, "Unexpected FinBERT warning"
print("PASS: cached FinBERT synthetic inference", flush=True)

model = get_setfit_model()
assert model is not None, "Local SetFit artifact failed to load"
labels = list(model.labels)
assert len(labels) == 3 and set(labels) == {"negative", "neutral", "positive"}
probabilities = model.predict_proba(texts)
assert len(probabilities) == len(texts)
for row in probabilities:
    assert len(row) == len(labels)
    scores = [bounded(value, 0, 1, "SetFit probability") for value in row]
    assert math.isclose(sum(scores), 1.0, abs_tol=1e-5), "SetFit probabilities are not normalized"
predictions = model.predict(texts)
assert len(predictions) == len(texts)
assert all(str(label) in labels for label in predictions), "Unexpected SetFit prediction label"
print("PASS: local SetFit artifact loaded and synthetic inference completed", flush=True)

# Exercise the API fallback explicitly, bypassing cached primary results.
sentiment._CACHE.clear()
sentiment.pipe = None
sentiment.pipe_disabled_reason = "acceptance_forced_finbert_unavailable"
fallback = sentiment.analyze(sentiment.SentIn(texts=texts))
assert fallback["engine"] == "setfit_fallback", "API fallback did not use SetFit"
assert fallback["model_version"] == "setfit_hpc_full_v1"
assert fallback["n"] == len(texts) and len(fallback["samples"]) == len(texts)
for sample in fallback["samples"]:
    bounded(sample, -1, 1, "SetFit fallback sample")
bounded(fallback["confidence"], 0, 1, "SetFit fallback confidence")
print("PASS: sentiment API SetFit fallback synthetic inference", flush=True)
