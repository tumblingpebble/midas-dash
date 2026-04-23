from __future__ import annotations

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Tuple, Optional
from datetime import datetime, timezone
import time, math, os

from .fallback_setfit import score_with_setfit, signed_score_from_label

# -------- Optional FinBERT (HuggingFace) import --------
USE_TRANSFORMERS = True
pipe = None
try:
    if USE_TRANSFORMERS:
        from transformers import pipeline

        def get_pipe():
            global pipe
            if pipe is None:
                pipe = pipeline("text-classification", model="ProsusAI/finbert")
            return pipe
    else:
        def get_pipe():
            return None
except Exception:
    def get_pipe():
        return None

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

def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

def _finbert_signed_score(pipe, text: str) -> float:
    try:
        out = pipe(text, truncation=True)[0]
        label = (out["label"] or "").lower()
        score = float(out["score"])
        if "pos" in label:
            return +score
        if "neg" in label:
            return -score
        return 0.0
    except Exception:
        raise

@app.get("/healthz")
def healthz():
    engine = "finbert" if get_pipe() is not None else "setfit_or_lexicon"
    return {
        "status": "ok",
        "service": "sentiment",
        "version": "v2",
        "ttl_s": TTL,
        "engine": engine,
    }

@app.post("/api/sentiment", response_model=SentOut)
def analyze(x: SentIn):
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

    if pipe_inst is not None:
        engine = "finbert"
        for t in key:
            try:
                samples.append(_finbert_signed_score(pipe_inst, t))
            except Exception as e:
                # FinBERT failed mid-request -> fall back per-title to SetFit, then lexicon
                try:
                    fb = score_with_setfit(t)
                    samples.append(signed_score_from_label(fb["label"], fb["confidence"]))
                    confidence_values.append(float(fb["confidence"]))
                    engine = "setfit_fallback"
                    warning = f"finbert_failed:{type(e).__name__}"
                    model_version = fb.get("model_version")
                except Exception:
                    samples.append(lexicon_score(t))
                    engine = "lexicon_fallback"
                    warning = f"finbert_and_setfit_failed:{type(e).__name__}"
    else:
        # No FinBERT available -> SetFit fallback -> lexicon
        try:
            per_item = [score_with_setfit(t) for t in key]
            samples = [signed_score_from_label(r["label"], r["confidence"]) for r in per_item]
            confidence_values = [float(r["confidence"]) for r in per_item]
            engine = "setfit_fallback"
            model_version = per_item[0].get("model_version") if per_item else None
            warning = None
            for r in per_item:
                if r.get("warning"):
                    warning = r["warning"]
                    break
        except Exception:
            samples = [lexicon_score(t) for t in key]
            engine = "lexicon"
            warning = "setfit_unavailable"

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
    ).dict()

    _CACHE[key] = (now, out)
    return out