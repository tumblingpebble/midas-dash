export type OptionChainCandidate = {
  contract_symbol?: string
  side?: string
  expiration?: string
  dte?: number
  strike?: number
  last_price?: number | null
  bid?: number | null
  ask?: number | null
  volume?: number | null
  open_interest?: number | null
  implied_volatility?: number | null
  in_the_money?: boolean | null
  moneyness_label?: string
  role?: string
}

export type OptionChainPlan = {
  provider?: string
  available?: boolean
  reason?: string | null
  expirations?: string[]
  selected_expiration?: string | null
  candidates?: OptionChainCandidate[]
}

export type TradePlan = {
  ticker?: string
  strategy_family?: string
  confidence_bucket?: string
  instrument?: string
  instrument_label?: string
  summary?: string
  entry_plan?: {
    plain_english?: string
    timing_note?: string
  }
  option_template?: {
    dte_target?: string
    dte_label?: string
    strike_style?: string
    strike_label?: string
  }
  watch_trigger?: {
    plain_english?: string
    examples?: string[]
  }
  range_view?: {
    lower_bound?: number
    upper_bound?: number
    plain_english?: string
    derived_from?: string
  }
  target_zone?: {
    lower_bound?: number
    upper_bound?: number
    plain_english?: string
    derived_from?: string
  }
  upside_cap?: {
    upper_bound?: number
    plain_english?: string
    derived_from?: string
  }
  hold_plan?: {
    window?: string
    plain_english?: string
  }
  exit_rules?: {
    take_profit?: string
    risk_exit?: string
    time_exit?: string
  }
  watchouts?: string[]
  education?: {
    terms?: Record<string, string>
  }
  option_chain_plan?: OptionChainPlan
}

export type MidasExplain = {
  version?: string
  prediction?: {
    class?: string
    confidence?: number
    version?: string
  }
  inputs?: Record<string, unknown>
  top_importances?: Array<{ feature: string; importance: number }>
  error?: string
}

export type MidasRunResponse = {
  ticker: string
  features: Record<string, unknown>
  recommendation: {
    class: string
    confidence: number
    version?: string
  }
  one_liner?: {
    text?: string
    refs_numbers?: Array<{ n: number; url: string }>
  }
  quote?: {
    last?: number | null
    bid?: number | null
    ask?: number | null
    quality?: string
    spread_quality?: string
    last_source?: string
    ts?: string
  }
  top_headline?: {
    title?: string
    publisher?: string
    ts?: string
    url?: string
  }
  refs?: Array<{ title?: string; publisher?: string; url?: string } | null>
  refs_sources?: string[]
  ts_ctx?: string
  ts_gateway?: string
  cache_age_seconds?: number
  features_note?: string
  explain?: MidasExplain
  trade_plan?: TradePlan
}

function apiBaseUrl(): string {
  const raw = (import.meta.env.VITE_API_BASE_URL ?? "").trim()
  return raw.endsWith("/") ? raw.slice(0, -1) : raw
}

export async function runMidas(
  ticker: string,
  opts?: { explain?: boolean },
): Promise<MidasRunResponse> {
  const t = ticker.trim().toUpperCase()
  const base = apiBaseUrl()

  const path =
    opts?.explain === true
      ? `/api/run?ticker=${encodeURIComponent(t)}&explain=1`
      : `/api/run?ticker=${encodeURIComponent(t)}`

  const url = base ? `${base}${path}` : path

  const res = await fetch(url)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text}`)
  }

  return res.json()
}
