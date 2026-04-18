from __future__ import annotations

from typing import Any, Dict, List, Optional


TERM_DEFS = {
    "ATM": "At the money: close to the current stock price.",
    "OTM": "Out of the money: above the stock price for calls, or below it for puts.",
    "DTE": "Days to expiration: how many days remain before the option expires.",
    "call_spread": "A call spread buys one call and sells another higher-strike call to reduce cost and cap upside.",
    "put_spread": "A put spread buys one put and sells another lower-strike put to reduce cost and cap downside profit.",
    "covered_call": "A covered call means owning shares and selling a call against them, which generates income but caps upside.",
    "iron_condor": "An iron condor is a four-leg neutral options strategy that profits best if the stock stays in a range.",
}


def _extract_candidate(option_chain_plan: Optional[Dict[str, Any]], role: str) -> Optional[Dict[str, Any]]:
    if not option_chain_plan:
        return None
    candidates = option_chain_plan.get("candidates") or []
    return next((c for c in candidates if c.get("role") == role), None)


def _extract_iron_condor_range(option_chain_plan: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    short_call = _extract_candidate(option_chain_plan, "short_call")
    short_put = _extract_candidate(option_chain_plan, "short_put")

    if not short_call or not short_put:
        return None

    upper = short_call.get("strike")
    lower = short_put.get("strike")

    if upper is None or lower is None:
        return None

    return {
        "lower_bound": float(lower),
        "upper_bound": float(upper),
        "plain_english": f"This setup works best if the stock stays roughly between {float(lower):.2f} and {float(upper):.2f} through expiration.",
        "derived_from": "short strikes",
    }


def _extract_debit_call_zone(option_chain_plan: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    long_leg = _extract_candidate(option_chain_plan, "long_leg")
    short_leg = _extract_candidate(option_chain_plan, "short_leg")

    if not long_leg or not short_leg:
        return None

    lower = long_leg.get("strike")
    upper = short_leg.get("strike")

    if lower is None or upper is None:
        return None

    return {
        "lower_bound": float(lower),
        "upper_bound": float(upper),
        "plain_english": f"This bullish spread starts becoming more useful above roughly {float(lower):.2f} and reaches its main target zone closer to {float(upper):.2f}.",
        "derived_from": "long and short call strikes",
    }


def _extract_debit_put_zone(option_chain_plan: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    long_leg = _extract_candidate(option_chain_plan, "long_leg")
    short_leg = _extract_candidate(option_chain_plan, "short_leg")

    if not long_leg or not short_leg:
        return None

    upper = long_leg.get("strike")
    lower = short_leg.get("strike")

    if upper is None or lower is None:
        return None

    return {
        "lower_bound": float(lower),
        "upper_bound": float(upper),
        "plain_english": f"This bearish spread becomes more useful as price moves down below roughly {float(upper):.2f} and reaches its main target zone closer to {float(lower):.2f}.",
        "derived_from": "long and short put strikes",
    }


def _extract_covered_call_cap(option_chain_plan: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    short_leg = _extract_candidate(option_chain_plan, "short_leg")
    if not short_leg:
        return None

    cap = short_leg.get("strike")
    if cap is None:
        return None

    return {
        "upper_bound": float(cap),
        "plain_english": f"This covered call keeps the stock position bullish to neutral, but upside is effectively capped around {float(cap):.2f} if the shares rise through the short call strike.",
        "derived_from": "short call strike",
    }


def _confidence_bucket(conf: float) -> str:
    if conf >= 0.85:
        return "high"
    if conf >= 0.70:
        return "moderate"
    return "cautious"


def _common_watchouts(features: Dict[str, Any], quote: Dict[str, Any]) -> List[str]:
    out: List[str] = []

    if quote.get("quality") != "real":
        out.append("Last price is not a direct real-time quote, so timing should be treated more cautiously.")

    if quote.get("spread_quality") == "estimated":
        out.append("Bid/ask spread is estimated, so exact entries may be less precise than they appear.")

    if features.get("earnings_soon"):
        out.append("Earnings appear to be near, which can increase volatility and make short-term options riskier.")

    if not features.get("liquidity_flag", True):
        out.append("Liquidity looks weaker, so complex multi-leg options may be harder to enter and exit cleanly.")

    rv20 = float(features.get("rv20", 0.02) or 0.02)
    if rv20 >= 0.20:
        out.append("Recent volatility is elevated, so price can move quickly in either direction.")

    return out


def _education_terms(strategy_family: str) -> Dict[str, str]:
    out = {"DTE": TERM_DEFS["DTE"]}

    if strategy_family in {"DEBIT_CALL", "DEBIT_PUT"}:
        out["ATM"] = TERM_DEFS["ATM"]
        out["OTM"] = TERM_DEFS["OTM"]

    if strategy_family == "DEBIT_CALL":
        out["call_spread"] = TERM_DEFS["call_spread"]
    elif strategy_family == "DEBIT_PUT":
        out["put_spread"] = TERM_DEFS["put_spread"]
    elif strategy_family == "COVERED_CALL":
        out["covered_call"] = TERM_DEFS["covered_call"]
    elif strategy_family == "IRON_CONDOR":
        out["iron_condor"] = TERM_DEFS["iron_condor"]

    return out


def build_trade_plan(
    ticker: str,
    features: Dict[str, Any],
    recommendation: Dict[str, Any],
    quote: Dict[str, Any],
    option_chain_plan: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    strategy = str(recommendation.get("class", "NO_ACTION"))
    confidence = float(recommendation.get("confidence", 0.0) or 0.0)

    base = {
        "ticker": ticker,
        "strategy_family": strategy,
        "confidence_bucket": _confidence_bucket(confidence),
        "watchouts": _common_watchouts(features, quote),
        "education": {"terms": _education_terms(strategy)},
    }

    if strategy == "NO_ACTION":
        base.update({
            "instrument": "none",
            "instrument_label": "Wait / watchlist",
            "summary": "The model does not currently see enough short-term edge to justify a trade plan.",
            "entry_plan": {
                "plain_english": "Do not force a trade. Wait for stronger momentum, fresher confirmation, or a clearer signal."
            },
            "watch_trigger": {
                "plain_english": "Wait for the setup to become more directional or clearer before taking action.",
                "examples": [
                    "stronger short-term move in r_1m or r_5m",
                    "fresh relevant headlines",
                    "signal upgrade from NO_ACTION to a directional setup",
                ],
            },
            "hold_plan": {
                "window": "No active hold window",
                "plain_english": "This is a wait state, not an entry signal."
            },
            "exit_rules": {
                "take_profit": "Not applicable.",
                "risk_exit": "Not applicable.",
                "time_exit": "Re-check later instead of forcing a trade now."
            },
        })
        return base

    if strategy == "DEBIT_CALL":
        base.update({
            "instrument": "option_spread",
            "instrument_label": "Bullish call spread",
            "summary": "This setup leans bullish and aims to benefit from short-term upside with defined risk.",
            "entry_plan": {
                "plain_english": "Look for the bullish signal to remain intact and avoid chasing a sudden spike after the move has already happened."
            },
            "option_template": {
                "dte_target": "14-30",
                "dte_label": "about 2 to 4 weeks until expiration",
                "strike_style": "buy near ATM call, sell slightly OTM call",
                "strike_label": "buy a call near the stock price and sell a higher call above it",
            },
            "hold_plan": {
                "window": "2-10 trading days",
                "plain_english": "This is meant to be a shorter swing, not a trade to sit in too long."
            },
            "exit_rules": {
                "take_profit": "Take gains earlier if the move happens quickly instead of waiting for the absolute maximum possible payout.",
                "risk_exit": "Exit if short-term momentum weakens materially or the signal degrades.",
                "time_exit": "Avoid holding too close to expiration if the move has not happened."
            },
        })

        target_zone = _extract_debit_call_zone(option_chain_plan)
        if target_zone:
            base["target_zone"] = target_zone

    elif strategy == "DEBIT_PUT":
        base.update({
            "instrument": "option_spread",
            "instrument_label": "Bearish put spread",
            "summary": "This setup leans bearish and aims to benefit from short-term downside with defined risk.",
            "entry_plan": {
                "plain_english": "Look for the bearish signal to remain intact and avoid entering after a large downside flush has already happened."
            },
            "option_template": {
                "dte_target": "14-30",
                "dte_label": "about 2 to 4 weeks until expiration",
                "strike_style": "buy near ATM put, sell slightly OTM put",
                "strike_label": "buy a put near the stock price and sell a lower put below it",
            },
            "hold_plan": {
                "window": "2-10 trading days",
                "plain_english": "This is a short-term bearish setup, not something to overhold once the edge fades."
            },
            "exit_rules": {
                "take_profit": "Take gains sooner if the downside move happens quickly.",
                "risk_exit": "Exit if downside momentum weakens or the signal improves back toward neutral.",
                "time_exit": "Avoid sitting too close to expiration if the move stalls."
            },
        })

        target_zone = _extract_debit_put_zone(option_chain_plan)
        if target_zone:
            base["target_zone"] = target_zone

    elif strategy == "COVERED_CALL":
        base.update({
            "instrument": "stock_plus_option",
            "instrument_label": "Covered call",
            "summary": "This setup fits a neutral-to-mildly-bullish stock position where income is preferred over unlimited upside.",
            "entry_plan": {
                "plain_english": "This makes the most sense if you already want to own the stock or are comfortable buying shares."
            },
            "option_template": {
                "dte_target": "7-21",
                "dte_label": "about 1 to 3 weeks until expiration",
                "strike_style": "sell slightly OTM call against 100 shares",
                "strike_label": "sell a call a little above the current stock price",
            },
            "hold_plan": {
                "window": "until premium decays or the setup changes",
                "plain_english": "Monitor whether you are still comfortable owning the shares and giving up some upside."
            },
            "exit_rules": {
                "take_profit": "Take gains on the short call if most of the premium has decayed.",
                "risk_exit": "Exit if the stock thesis breaks and you no longer want the shares.",
                "time_exit": "Do not drift too close to expiration without a plan for assignment risk."
            },
        })

        upside_cap = _extract_covered_call_cap(option_chain_plan)
        if upside_cap:
            base["upside_cap"] = upside_cap

    elif strategy == "IRON_CONDOR":
        base.update({
            "instrument": "multi_leg_option",
            "instrument_label": "Iron condor",
            "summary": "This setup is for a stock expected to stay in a range, using defined-risk premium selling.",
            "entry_plan": {
                "plain_english": "This is a neutral strategy for times when the stock looks more likely to stay in a band than make a strong move up or down. The goal is to benefit if price remains inside the expected range rather than trending hard in one direction."
            },
            "option_template": {
                "dte_target": "14-30",
                "dte_label": "about 2 to 4 weeks until expiration",
                "strike_style": "short slightly OTM call and put, hedge with further OTM wings",
                "strike_label": "sell a call above price and a put below price, then buy further-out protection on both sides",
            },
            "hold_plan": {
                "window": "short swing while the stock remains range-bound",
                "plain_english": "Do not keep holding once price starts trending hard toward one side."
            },
            "exit_rules": {
                "take_profit": "Take gains once enough premium decays instead of holding for the very last dollar.",
                "risk_exit": "Exit if the stock starts breaking above the short call area or below the short put area, because that means price is leaving the expected range.",
                "time_exit": "Avoid staying too close to expiration if the stock is pressing one side."
            },
        })

        range_view = _extract_iron_condor_range(option_chain_plan)
        if range_view:
            base["range_view"] = range_view

    if option_chain_plan:
        base["option_chain_plan"] = option_chain_plan

    return base