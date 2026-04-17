export type MidasExplain = {
  version?: string
  prediction?: { class: string; confidence: number; version?: string }
  inputs?: Record<string, unknown>
  top_importances?: Array<{ feature: string; importance: number }>
  error?: string
}

export type MidasRunResponse = {
  ticker: string
  features: {
    sent_mean: number
    sent_std: number
    r_1m: number
    r_5m: number
    above_sma20: boolean
    mins_since_news: number
    rv20: number
    earnings_soon: boolean
    liquidity_flag: boolean
    [k: string]: unknown
  }
  recommendation: { class: string; confidence: number; version?: string }
  one_liner: { text: string; refs_numbers?: Array<{ n: number; url: string }> }
  quote?: { last?: number; bid?: number; ask?: number; quality?: string }
  top_headline?: { title: string; publisher?: string; ts?: string; url?: string }
  refs?: Array<{ title: string; publisher?: string; url: string } | null>
  refs_sources?: string[]
  ts_ctx?: string
  ts_gateway?: string
  cache_age_seconds?: number
  explain?: MidasExplain
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