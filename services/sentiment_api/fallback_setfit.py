from __future__ import annotations

import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from setfit import SetFitModel


BEST_THRESHOLD = float(os.getenv("SETFIT_THRESHOLD", "0.80"))
MODEL_VERSION = os.getenv("SETFIT_MODEL_VERSION", "setfit_hpc_full_v1")


def _repo_root() -> Path:
    # services/sentiment_api/fallback_setfit.py -> repo root is two parents up from services/
    return Path(__file__).resolve().parents[2]


def _default_model_dir() -> Path:
    return _repo_root() / "audit_logs" / "sentiment_audit" / "setfit_model_hpc_full"


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def _matches_any(text: str, patterns: List[str]) -> bool:
    return any(re.search(p, text) for p in patterns)


ROUNDUP_PATTERNS = [
    r"\bfinal trade\b",
    r"\bstocks making the biggest moves\b",
    r"\bwhat'?s moving markets\b",
    r"\bmarket wrap\b",
    r"\bbulls and bears\b",
    r"\bmorning call sheet\b",
    r"\bwall street hits new records\b",
]

ANALYST_PATTERNS = [
    r"\bmaintains\b",
    r"\binitiates coverage\b",
    r"\blowers price target\b",
    r"\braises price target\b",
    r"\bprice target\b",
    r"\bmarket perform recommendation\b",
    r"\bneutral recommendation\b",
    r"\boutperform recommendation\b",
    r"\boverweight\b",
    r"\bbuy recommendation\b",
]

PREVIEW_PATTERNS = [
    r"\bearnings preview\b",
    r"\bwhat to expect\b",
    r"\bwhat to watch\b",
    r"\bq[1-4] preview\b",
    r"\bahead of earnings\b",
    r"\beverything you need to know\b",
    r"\bkey metrics\b",
    r"\bdeep dive\b",
    r"\bportfolio review\b",
    r"\bvaluation check\b",
]

PRESENTATION_PATTERNS = [
    r"\bpresents at\b",
    r"\bslideshow\b",
    r"\bconference\b",
    r"\bannual meeting\b",
    r"\bforum\b",
]

LEGAL_NEG_PATTERNS = [
    r"\bclass action\b",
    r"\binvestigation notice\b",
    r"\binvestor notice\b",
    r"\blawsuit\b",
    r"\bprobe\b",
    r"\binvestigation\b",
]

MIXED_UNCLEAR_PATTERNS = [
    r"\bdespite\b",
    r"\bwhile\b",
]

QUESTIONY_PATTERNS = [
    r"\bshould you\b",
    r"\bworth betting on\b",
    r"\bfacts to know before betting\b",
    r"\btrending stock\b",
]


def rule_gate(text: str, publisher: str = "") -> Tuple[Optional[str], Optional[str]]:
    t = _norm(text)
    pub = (publisher or "").strip().lower()

    if _matches_any(t, LEGAL_NEG_PATTERNS):
        return "negative", "rule_legal_negative"
    if _matches_any(t, ROUNDUP_PATTERNS):
        return "neutral", "rule_roundup_neutral"
    if _matches_any(t, PRESENTATION_PATTERNS):
        return "neutral", "rule_presentation_neutral"
    if _matches_any(t, ANALYST_PATTERNS):
        return "neutral", "rule_analyst_neutral"
    if _matches_any(t, PREVIEW_PATTERNS):
        return "neutral", "rule_preview_neutral"
    if _matches_any(t, MIXED_UNCLEAR_PATTERNS):
        return "neutral", "rule_mixed_soft_neutral"
    if _matches_any(t, QUESTIONY_PATTERNS):
        return "neutral", "rule_unclear_to_neutral"

    if pub == "cnbc" and "final trade" in t:
        return "neutral", "rule_cnbc_final_trade"
    if pub == "fintel" and ("initiates coverage" in t or "maintains" in t):
        return "neutral", "rule_fintel_analyst"
    if pub == "benzinga" and ("what's moving markets" in t or "bulls and bears" in t):
        return "neutral", "rule_benzinga_marketwrap"

    return None, None


@lru_cache(maxsize=1)
def get_setfit_model() -> Optional[SetFitModel]:
    model_dir = os.getenv("SETFIT_MODEL_DIR", "").strip()
    path = Path(model_dir) if model_dir else _default_model_dir()

    if not path.exists():
        return None

    try:
        return SetFitModel.from_pretrained(str(path))
    except Exception:
        return None


def score_with_setfit(text: str, publisher: str = "") -> Dict[str, Any]:
    gated_label, gated_reason = rule_gate(text, publisher)
    if gated_label is not None:
        return {
            "engine": "setfit_rule_gate",
            "label": gated_label,
            "confidence": 1.0,
            "warning": gated_reason,
            "model_version": MODEL_VERSION,
            "probs": {
                "positive": 1.0 if gated_label == "positive" else 0.0,
                "neutral": 1.0 if gated_label == "neutral" else 0.0,
                "negative": 1.0 if gated_label == "negative" else 0.0,
            },
        }

    model = get_setfit_model()
    if model is None:
        raise RuntimeError("SetFit model unavailable")

    probs_raw = model.predict_proba([text])[0]
    labels = list(model.labels)
    probs = {label: float(p) for label, p in zip(labels, probs_raw)}

    # make sure 3 keys are always present
    for key in ("positive", "neutral", "negative"):
        probs.setdefault(key, 0.0)

    label = max(probs, key=probs.get)
    confidence = float(probs[label])

    if confidence < BEST_THRESHOLD:
        return {
            "engine": "setfit_thresholded",
            "label": "neutral",
            "confidence": confidence,
            "warning": f"threshold_to_neutral_{BEST_THRESHOLD:.2f}",
            "model_version": MODEL_VERSION,
            "probs": probs,
        }

    return {
        "engine": "setfit",
        "label": label,
        "confidence": confidence,
        "warning": None,
        "model_version": MODEL_VERSION,
        "probs": probs,
    }


def signed_score_from_label(label: str, confidence: float) -> float:
    label = (label or "").strip().lower()
    c = max(0.0, min(1.0, float(confidence)))
    if label == "positive":
        return c
    if label == "negative":
        return -c
    return 0.0