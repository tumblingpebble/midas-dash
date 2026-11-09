from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from threading import Lock
from pydantic import BaseModel
from typing import List, Dict, Tuple, Optional
from datetime import datetime, timezone
import time, math, os

from .fallback_setfit import score_with_setfit, signed_score_from_label, validate_model_probabilities

# -------- Optional FinBERT (HuggingFace) import --------
USE_TRANSFORMERS = True
pipe = None
pipe_disabled_reason: Optional[str] = None
FINBERT_MODEL_VERSION = "ProsusAI/finbert"

_pipe_lock = Lock()
try:
    from transformers import pipeline
except Exception as e:
    pipeline = None
    pipe_disabled_reason = f"transformers_import_failed:{type(e).__name__}"


def get_pipe():
    """Initialize once per process, including a sticky failure until restart."""
    global pipe, pipe_disabled_reason
    with _pipe_lock:
        if pipe_disabled_reason is not None or not USE_TRANSFORMERS:
            return None
        if pipe is None:
            try:
                pipe = pipeline("text-classification", model=FINBERT_MODEL_VERSION)
            except Exception as e:
                pipe_disabled_reason = f"finbert_load_failed:{type(e).__name__}"
        return pipe


def _disable_pipe(error):
    global pipe, pipe_disabled_reason
    with _pipe_lock:
        pipe_disabled_reason = f"finbert_runtime_failed:{type(error).__name__}"
        pipe = None


# -------- Lightweight tertiary fallback scorer (lexicon-based) --------
POS = {"beat", "beats", "beating", "outperform", "surge", "surges", "record", "upgrade", "upgrades", "bullish", "rally", "rallies", "strength"}
NEG = {"miss", "misses", "warning", "downgrade", "downgrades", "bearish", "plunge", "plunges", "fall", "falls", "lawsuit", "probe", "investigation"}


def lexicon_score(s: str) -> float:
    if not s:
        return 0.0
    t = s.lower()
    pos = sum(1 for w in POS if w in t)
    neg = sum(1 for w in NEG if w in t)
    raw = pos - neg
    if raw == 0:
        return 0.0
    return max(-1.0, min(1.0, raw / 3.0))


# -------- API --------
app = FastAPI(title="MIDAS Sentiment API", version="v2")
TTL = float(os.getenv("SENT_TTL_S", "90"))
_CACHE: Dict[Tuple[str, ...], Tuple[float, dict]] = {}


class SentIn(BaseModel):
    texts: List[str]


class SentOut(BaseModel):
    ts: str
    n: int
    mean: float
    std: float
    samples: List[float]
    engine: str
    confidence: Optional[float] = None
    warning: Optional[str] = None
    model_version: Optional[str] = None
    sample_engines: List[str]
    sample_model_versions: List[Optional[str]]


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _finbert_prob_score(pipe_inst, text: str, *, validate: bool = False) -> tuple[float, float]:
    """
    Use FinBERT class probabilities instead of top-label-only scoring.

    signed_score = P(positive) - P(negative)
    confidence   = max class probability
    """
    out = pipe_inst(text, truncation=True, top_k=None)

    # pipeline may return:
    # - list[dict] for one text
    # - list[list[dict]] in some versions/shapes
    if isinstance(out, list) and out and isinstance(out[0], list):
        out = out[0]

    if validate:
        validate_model_probabilities(
            [str(item.get("label", "")).lower() for item in out],
            [item["score"] for item in out],
        )

    probs = {"positive": 0.0, "negative": 0.0, "neutral": 0.0}

    for item in out:
        label = str(item.get("label", "")).lower()
        score = float(item.get("score", 0.0))
        if "pos" in label:
            probs["positive"] = score
        elif "neg" in label:
            probs["negative"] = score
        elif "neu" in label:
            probs["neutral"] = score

    signed = float(probs["positive"] - probs["negative"])
    confidence = float(max(probs.values())) if probs else 0.0
    return signed, confidence


@app.get("/healthz")
def healthz():
    # Liveness only: never load or run either model here.
    return {
        "status": "ok",
        "service": "sentiment",
        "version": "v2",
        "ttl_s": TTL,
        "engine": "finbert" if pipe is not None else "setfit_or_lexicon" if pipe_disabled_reason else "uninitialized",
        "pipe_disabled_reason": pipe_disabled_reason,
        "check": "liveness",
    }


@app.get("/readyz")
def readyz():
    """Verify a usable ML path, not merely a lexicon or a rule-gated answer.

    Probe primary first; do not load the backup when primary works. This is an
    explicit inference check, unlike liveness. It bypasses the response cache.
    """
    probe = "The company published its quarterly financial report today."
    pipe_inst = get_pipe()
    if pipe_inst is not None:
        try:
            _finbert_prob_score(pipe_inst, probe, validate=True)
            return {"status": "ready", "engine": "finbert", "model_version": FINBERT_MODEL_VERSION, "warning": None}
        except Exception as e:
            _disable_pipe(e)
    try:
        result = score_with_setfit(probe, validate=True)
        return {"status": "degraded", "engine": "setfit_fallback", "model_version": result["model_version"], "warning": pipe_disabled_reason or "finbert_unavailable"}
    except Exception as e:
        return JSONResponse(status_code=503, content={
            "status": "unavailable", "engine": "lexicon", "model_version": None,
            "warning": f"{pipe_disabled_reason or 'finbert_unavailable'};setfit_unavailable:{type(e).__name__}",
        })


@app.post("/api/sentiment", response_model=SentOut)
def analyze(x: SentIn):
    global pipe, pipe_disabled_reason

    if not x.texts or not isinstance(x.texts, list):
        raise HTTPException(400, "texts required")

    key = tuple(t.strip() for t in x.texts if isinstance(t, str) and t.strip())
    if not key:
        raise HTTPException(400, "texts required")

    now = time.time()
    hit = _CACHE.get(key)
    if hit and (now - hit[0]) < TTL:
        return hit[1]

    samples: List[float] = []
    engine = "unknown"
    warning = None
    model_version = None
    confidence_values: List[float] = []

    pipe_inst = get_pipe()
    warning = pipe_disabled_reason
    sample_engines = []
    sample_model_versions = []

    if pipe_inst is not None:
        engine = "finbert"
        model_version = FINBERT_MODEL_VERSION
        for t in key:
            try:
                signed, conf = _finbert_prob_score(pipe_inst, t)
                samples.append(signed)
                confidence_values.append(conf)
                sample_engines.append("finbert")
                sample_model_versions.append(FINBERT_MODEL_VERSION)
            except Exception as e:
                _disable_pipe(e)
                try:
                    fb = score_with_setfit(t)
                    samples.append(signed_score_from_label(fb["label"], fb["confidence"]))
                    confidence_values.append(float(fb["confidence"]))
                    engine = "setfit_fallback"
                    warning = pipe_disabled_reason
                    model_version = fb.get("model_version")
                    sample_engines.append(engine)
                    sample_model_versions.append(model_version)
                except Exception as inner_e:
                    samples.append(lexicon_score(t))
                    engine = "lexicon_fallback"
                    warning = f"{pipe_disabled_reason};setfit_failed:{type(inner_e).__name__}"
                    model_version = None
                    sample_engines.append(engine)
                    sample_model_versions.append(None)
    else:
        try:
            per_item = [score_with_setfit(t) for t in key]
            samples = [signed_score_from_label(r["label"], r["confidence"]) for r in per_item]
            confidence_values = [float(r["confidence"]) for r in per_item]
            engine = "setfit_fallback"
            model_version = per_item[0].get("model_version") if per_item else None
            if warning is None:
                for r in per_item:
                    if r.get("warning"):
                        warning = r["warning"]
                        break
        except Exception as e:
            samples = [lexicon_score(t) for t in key]
            engine = "lexicon"
            warning = f"{warning or 'finbert_unavailable'};setfit_unavailable:{type(e).__name__}"
            model_version = None

    if not sample_engines:
        sample_engines = [engine] * len(samples)
        sample_model_versions = [model_version] * len(samples)
    if len(set(sample_engines)) > 1:
        engine = "mixed"
        model_version = None
        warning = f"{warning or 'fallback_used'};mixed_engines:{','.join(dict.fromkeys(sample_engines))}"

    n = len(samples)
    mean = sum(samples) / n if n else 0.0
    var = sum((v - mean) ** 2 for v in samples) / n if n else 0.0
    std = math.sqrt(var)
    avg_conf = sum(confidence_values) / len(confidence_values) if confidence_values else None

    out = SentOut(
        ts=_iso_now(),
        n=n,
        mean=float(mean),
        std=float(std),
        samples=[float(v) for v in samples],
        engine=engine,
        confidence=float(avg_conf) if avg_conf is not None else None,
        warning=warning,
        model_version=model_version,
        sample_engines=sample_engines,
        sample_model_versions=sample_model_versions,
    ).model_dump()

    _CACHE[key] = (now, out)
    return out