from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import date, datetime
from typing import Any, Dict, List, Optional

import math
import yfinance as yf


@dataclass
class OptionCandidate:
    contract_symbol: str
    side: str                 # "call" or "put"
    expiration: str
    dte: int
    strike: float
    last_price: Optional[float]
    bid: Optional[float]
    ask: Optional[float]
    volume: Optional[int]
    open_interest: Optional[int]
    implied_volatility: Optional[float]
    in_the_money: Optional[bool]
    moneyness_label: str      # "ATM", "slightly OTM", etc.
    role: str                 # "long_leg", "short_leg", "single"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def _safe_float(x: Any) -> Optional[float]:
    try:
        if x is None or (isinstance(x, float) and math.isnan(x)):
            return None
        return float(x)
    except Exception:
        return None


def _safe_int(x: Any) -> Optional[int]:
    try:
        if x is None:
            return None
        return int(x)
    except Exception:
        return None


def _dte(expiration_yyyy_mm_dd: str) -> int:
    exp = date.fromisoformat(expiration_yyyy_mm_dd)
    return max(0, (exp - date.today()).days)


def _pick_expiration(expirations: List[str], min_dte: int, max_dte: int) -> Optional[str]:
    if not expirations:
        return None

    ranked: List[tuple[int, str]] = []
    target = (min_dte + max_dte) // 2

    for exp in expirations:
        d = _dte(exp)
        if min_dte <= d <= max_dte:
            ranked.append((abs(d - target), exp))

    if ranked:
        ranked.sort(key=lambda x: x[0])
        return ranked[0][1]

    # fallback: nearest future expiration
    fallback: List[tuple[int, str]] = []
    for exp in expirations:
        d = _dte(exp)
        if d >= 0:
            fallback.append((d, exp))

    if not fallback:
        return None

    fallback.sort(key=lambda x: x[0])
    return fallback[0][1]


def _moneyness_label(side: str, strike: float, spot: float) -> str:
    if spot <= 0:
        return "unknown"

    diff_pct = (strike - spot) / spot

    if abs(diff_pct) <= 0.01:
        return "ATM"

    if side == "call":
        if 0.01 < diff_pct <= 0.05:
            return "slightly OTM"
        if diff_pct > 0.05:
            return "far OTM"
        return "ITM"

    if side == "put":
        if -0.05 <= diff_pct < -0.01:
            return "slightly OTM"
        if diff_pct < -0.05:
            return "far OTM"
        return "ITM"

    return "unknown"


def _choose_strike(rows: List[Dict[str, Any]], spot: float, side: str, target: str) -> Optional[Dict[str, Any]]:
    if not rows:
        return None

    scored: List[tuple[float, Dict[str, Any]]] = []

    for row in rows:
        strike = _safe_float(row.get("strike"))
        if strike is None:
            continue

        vol = _safe_int(row.get("volume")) or 0
        oi = _safe_int(row.get("openInterest")) or 0
        bid = _safe_float(row.get("bid"))
        ask = _safe_float(row.get("ask"))

        liquidity_penalty = 0.0
        if vol <= 0:
            liquidity_penalty += 5.0
        if oi <= 0:
            liquidity_penalty += 5.0
        if bid is None or ask is None or ask <= bid:
            liquidity_penalty += 2.0

        if target == "ATM":
            dist = abs(strike - spot)
        elif target == "slightly_OTM":
            if side == "call":
                dist = abs(strike - (spot * 1.03))
            else:
                dist = abs(strike - (spot * 0.97))
        elif target == "further_OTM":
            if side == "call":
                dist = abs(strike - (spot * 1.06))
            else:
                dist = abs(strike - (spot * 0.94))
        else:
            dist = abs(strike - spot)

        score = dist + liquidity_penalty
        scored.append((score, row))

    if not scored:
        return None

    scored.sort(key=lambda x: x[0])
    return scored[0][1]


def _frame_to_rows(df) -> List[Dict[str, Any]]:
    if df is None or getattr(df, "empty", True):
        return []
    return df.to_dict("records")


def get_option_chain_candidates(
    ticker: str,
    spot: float,
    strategy_family: str,
) -> Dict[str, Any]:
    tk = yf.Ticker(ticker)
    expirations = list(tk.options or [])

    if not expirations:
        return {
            "provider": "yfinance",
            "available": False,
            "reason": "No option expirations returned.",
            "expirations": [],
            "selected_expiration": None,
            "candidates": [],
        }

    if strategy_family in {"DEBIT_CALL", "DEBIT_PUT"}:
        min_dte, max_dte = 14, 30
    elif strategy_family == "COVERED_CALL":
        min_dte, max_dte = 7, 21
    elif strategy_family == "IRON_CONDOR":
        min_dte, max_dte = 14, 30
    else:
        min_dte, max_dte = 14, 30

    selected_exp = _pick_expiration(expirations, min_dte, max_dte)
    if not selected_exp:
        return {
            "provider": "yfinance",
            "available": False,
            "reason": "Could not choose an expiration.",
            "expirations": expirations,
            "selected_expiration": None,
            "candidates": [],
        }

    chain = tk.option_chain(selected_exp)
    calls = _frame_to_rows(chain.calls)
    puts = _frame_to_rows(chain.puts)

    out: List[OptionCandidate] = []
    dte_val = _dte(selected_exp)

    if strategy_family == "DEBIT_CALL":
        long_row = _choose_strike(calls, spot, "call", "ATM")
        short_row = _choose_strike(calls, spot, "call", "slightly_OTM")

        for role, row in [("long_leg", long_row), ("short_leg", short_row)]:
            if not row:
                continue
            strike = _safe_float(row.get("strike")) or 0.0
            out.append(
                OptionCandidate(
                    contract_symbol=str(row.get("contractSymbol") or ""),
                    side="call",
                    expiration=selected_exp,
                    dte=dte_val,
                    strike=strike,
                    last_price=_safe_float(row.get("lastPrice")),
                    bid=_safe_float(row.get("bid")),
                    ask=_safe_float(row.get("ask")),
                    volume=_safe_int(row.get("volume")),
                    open_interest=_safe_int(row.get("openInterest")),
                    implied_volatility=_safe_float(row.get("impliedVolatility")),
                    in_the_money=row.get("inTheMoney"),
                    moneyness_label=_moneyness_label("call", strike, spot),
                    role=role,
                )
            )

    elif strategy_family == "DEBIT_PUT":
        long_row = _choose_strike(puts, spot, "put", "ATM")
        short_row = _choose_strike(puts, spot, "put", "slightly_OTM")

        for role, row in [("long_leg", long_row), ("short_leg", short_row)]:
            if not row:
                continue
            strike = _safe_float(row.get("strike")) or 0.0
            out.append(
                OptionCandidate(
                    contract_symbol=str(row.get("contractSymbol") or ""),
                    side="put",
                    expiration=selected_exp,
                    dte=dte_val,
                    strike=strike,
                    last_price=_safe_float(row.get("lastPrice")),
                    bid=_safe_float(row.get("bid")),
                    ask=_safe_float(row.get("ask")),
                    volume=_safe_int(row.get("volume")),
                    open_interest=_safe_int(row.get("openInterest")),
                    implied_volatility=_safe_float(row.get("impliedVolatility")),
                    in_the_money=row.get("inTheMoney"),
                    moneyness_label=_moneyness_label("put", strike, spot),
                    role=role,
                )
            )

    elif strategy_family == "COVERED_CALL":
        short_row = _choose_strike(calls, spot, "call", "slightly_OTM")
        if short_row:
            strike = _safe_float(short_row.get("strike")) or 0.0
            out.append(
                OptionCandidate(
                    contract_symbol=str(short_row.get("contractSymbol") or ""),
                    side="call",
                    expiration=selected_exp,
                    dte=dte_val,
                    strike=strike,
                    last_price=_safe_float(short_row.get("lastPrice")),
                    bid=_safe_float(short_row.get("bid")),
                    ask=_safe_float(short_row.get("ask")),
                    volume=_safe_int(short_row.get("volume")),
                    open_interest=_safe_int(short_row.get("openInterest")),
                    implied_volatility=_safe_float(short_row.get("impliedVolatility")),
                    in_the_money=short_row.get("inTheMoney"),
                    moneyness_label=_moneyness_label("call", strike, spot),
                    role="short_leg",
                )
            )

    elif strategy_family == "IRON_CONDOR":
        short_call = _choose_strike(calls, spot, "call", "slightly_OTM")
        long_call = _choose_strike(calls, spot, "call", "further_OTM")
        short_put = _choose_strike(puts, spot, "put", "slightly_OTM")
        long_put = _choose_strike(puts, spot, "put", "further_OTM")

        for role, side, row in [
            ("short_call", "call", short_call),
            ("long_call", "call", long_call),
            ("short_put", "put", short_put),
            ("long_put", "put", long_put),
        ]:
            if not row:
                continue
            strike = _safe_float(row.get("strike")) or 0.0
            out.append(
                OptionCandidate(
                    contract_symbol=str(row.get("contractSymbol") or ""),
                    side=side,
                    expiration=selected_exp,
                    dte=dte_val,
                    strike=strike,
                    last_price=_safe_float(row.get("lastPrice")),
                    bid=_safe_float(row.get("bid")),
                    ask=_safe_float(row.get("ask")),
                    volume=_safe_int(row.get("volume")),
                    open_interest=_safe_int(row.get("openInterest")),
                    implied_volatility=_safe_float(row.get("impliedVolatility")),
                    in_the_money=row.get("inTheMoney"),
                    moneyness_label=_moneyness_label(side, strike, spot),
                    role=role,
                )
            )

    return {
        "provider": "yfinance",
        "available": len(out) > 0,
        "reason": None if out else "No candidate contracts were selected.",
        "expirations": expirations[:12],
        "selected_expiration": selected_exp,
        "candidates": [x.to_dict() for x in out],
    }