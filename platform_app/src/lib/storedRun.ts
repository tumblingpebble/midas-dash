import type {
  MidasExplain, MidasRunResponse, OptionChainCandidate, OptionChainPlan,
  SentimentMeta, TradePlan,
} from "../api/midas"

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

type Check = (value: unknown) => boolean
const text: Check = (value) => typeof value === "string"
const number: Check = (value) => typeof value === "number" && Number.isFinite(value)
const boolean: Check = (value) => typeof value === "boolean"
const arrayOf = (check: Check): Check => (value) =>
  Array.isArray(value) && value.every(check)

// Optional fields may be absent or null in older snapshots. Validate known
// fields without stripping unknown fields or changing the original response.
function optionalFields(fields: Record<string, Check>): Check {
  return (value) => isRecord(value) && Object.entries(fields).every(
    ([key, check]) => value[key] == null || check(value[key]),
  )
}

const numberedRef: Check = (value) =>
  isRecord(value) && number(value.n) && text(value.url)
const headlineRef = optionalFields({ title: text, publisher: text, url: text })
const importance: Check = (value) =>
  isRecord(value) && text(value.feature) && number(value.importance)

const candidate = optionalFields({
  contract_symbol: text, side: text, expiration: text, dte: number,
  strike: number, last_price: number, bid: number, ask: number,
  volume: number, open_interest: number, implied_volatility: number,
  in_the_money: boolean, moneyness_label: text, role: text,
} satisfies Record<keyof OptionChainCandidate, Check>)

const optionChain = optionalFields({
  provider: text, available: boolean, reason: text,
  expirations: arrayOf(text), selected_expiration: text,
  candidates: arrayOf(candidate),
} satisfies Record<keyof OptionChainPlan, Check>)

const range = optionalFields({
  lower_bound: number, upper_bound: number, plain_english: text, derived_from: text,
})
const tradePlan = optionalFields({
  ticker: text, strategy_family: text, confidence_bucket: text,
  instrument: text, instrument_label: text, summary: text,
  entry_plan: optionalFields({ plain_english: text, timing_note: text }),
  option_template: optionalFields({
    dte_target: text, dte_label: text, strike_style: text, strike_label: text,
  }),
  watch_trigger: optionalFields({ plain_english: text, examples: arrayOf(text) }),
  range_view: range,
  target_zone: range,
  upside_cap: optionalFields({ upper_bound: number, plain_english: text, derived_from: text }),
  hold_plan: optionalFields({ window: text, plain_english: text }),
  exit_rules: optionalFields({ take_profit: text, risk_exit: text, time_exit: text }),
  watchouts: arrayOf(text),
  education: optionalFields({
    terms: (value) => isRecord(value) && Object.values(value).every(text),
  }),
  option_chain_plan: optionChain,
} satisfies Record<keyof TradePlan, Check>)

const explain = optionalFields({
  version: text,
  prediction: optionalFields({ class: text, confidence: number, version: text }),
  inputs: isRecord,
  top_importances: arrayOf(importance),
  error: text,
} satisfies Record<keyof MidasExplain, Check>)

const sentiment = optionalFields({
  engine: text, warning: text, confidence: number, model_version: text,
} satisfies Record<keyof SentimentMeta, Check>)

const optionalRunFields = optionalFields({
  company_name: text,
  one_liner: optionalFields({ text, refs_numbers: arrayOf(numberedRef) }),
  quote: optionalFields({
    last: number, bid: number, ask: number, quality: text,
    spread_quality: text, last_source: text, ts: text,
  }),
  top_headline: optionalFields({ title: text, publisher: text, ts: text, url: text }),
  refs: arrayOf((value) => value === null || headlineRef(value)),
  refs_sources: arrayOf(text),
  sentiment, ts_ctx: text, ts_gateway: text, cache_age_seconds: number,
  features_note: text, explain, trade_plan: tradePlan,
} satisfies Record<Exclude<keyof MidasRunResponse, "ticker" | "features" | "recommendation">, Check>)

// JSON parsing does not establish the shapes consumed by the results view.
// Shared by saved snapshots and the API boundary; arbitrary feature data is not validated.
export function isRunSnapshot(value: unknown): value is MidasRunResponse {
  if (!isRecord(value) || !isRecord(value.recommendation)) return false
  return (
    typeof value.ticker === "string" &&
    isRecord(value.features) &&
    typeof value.recommendation.class === "string" &&
    number(value.recommendation.confidence) &&
    (value.recommendation.version == null || text(value.recommendation.version)) &&
    optionalRunFields(value)
  )
}

export function parseStoredRun(raw: string | null): MidasRunResponse | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    return isRunSnapshot(value) ? value : null
  } catch {
    return null
  }
}
