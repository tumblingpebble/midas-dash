import { useState } from "react"
import { runMidas, type MidasRunResponse } from "../api/midas"
import { toHistoryItem, useRunHistory } from "../hooks/useRunHistory"
import { useNow } from "../hooks/useNow"
import { useSettings } from "../hooks/useSettings"
import { LoadingOverlay } from "../components/LoadingOverlay"
import { MidasCanvas } from "../components/MidasCanvas"

const LS_TICKER = "midas_dash_last_ticker_v1"
const LS_LAST_RUN = "midas_dash_last_run_v1"

const FEATURE_TOOLTIPS: Record<string, { label: string; help: string }> = {
  sent_mean: {
    label: "sent_mean",
    help: "Average sentiment score from recent headlines. Negative values lean bearish, near 0 is neutral, and positive values lean bullish.",
  },
  sent_std: {
    label: "sent_std",
    help: "Variation in sentiment across recent headlines. Lower values mean the headlines agree more; higher values mean sentiment is mixed or noisy.",
  },
  r_1m: {
    label: "r_1m",
    help: "Very short-horizon return over roughly 1 minute. Positive values mean price moved up; negative values mean price moved down.",
  },
  r_5m: {
    label: "r_5m",
    help: "Short-horizon return over roughly 5 minutes. Positive values suggest recent upward momentum; negative values suggest recent weakness.",
  },
  above_sma20: {
    label: "above_sma20",
    help: "Whether the latest price is above the 20-period simple moving average. True can suggest near-term strength; false can suggest weaker short-term trend.",
  },
  mins_since_news: {
    label: "mins_since_news",
    help: "Minutes since the most recent relevant headline. Smaller numbers mean fresher news; larger numbers mean the news signal is older.",
  },
  rv20: {
    label: "rv20",
    help: "Normalized recent volatility proxy based on recent price movement range. Higher values mean more volatility; lower values mean calmer trading.",
  },
  earnings_soon: {
    label: "earnings_soon",
    help: "Whether earnings are expected soon. True means an earnings event is near, which can increase uncertainty and volatility.",
  },
  liquidity_flag: {
    label: "liquidity_flag",
    help: "Simple liquidity check using spread and volume heuristics. True suggests trading conditions look more liquid; false suggests thinner trading conditions.",
  },
}

function loadTicker(): string {
  return localStorage.getItem(LS_TICKER) ?? "AAPL"
}

function loadLastRun(): MidasRunResponse | null {
  const raw = localStorage.getItem(LS_LAST_RUN)
  if (!raw) return null
  try {
    return JSON.parse(raw) as MidasRunResponse
  } catch {
    return null
  }
}

function stripBracketRefs(text: string): string {
  return text.replace(/\(\[[0-9]+\](\[[0-9]+\])*\)/g, "").trim()
}

function validLast(run: MidasRunResponse): number | null {
  const last = Number(run.quote?.last ?? 0)
  if (!Number.isFinite(last) || last <= 0) return null
  return last
}

function headlineItems(run: MidasRunResponse) {
  const refs = (run.refs ?? []).filter(Boolean) as Array<{
    title?: string
    publisher?: string
    url?: string
  }>

  if (refs.length > 0) return refs

  if (run.top_headline?.url) {
    return [
      {
        title: run.top_headline.title,
        publisher: run.top_headline.publisher,
        url: run.top_headline.url,
      },
    ]
  }

  return []
}

function RefLinks({ run }: { run: MidasRunResponse }) {
  const refs = run.one_liner?.refs_numbers ?? []
  if (!refs.length) return null

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {refs.map((r) => (
        <a
          key={`${run.ticker}-${r.n}-${r.url}`}
          href={r.url}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-orange-200 hover:border-slate-600"
        >
          [{r.n}]
        </a>
      ))}
    </div>
  )
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0
  return Math.max(0, Math.min(1, x))
}

function SentimentPill({ run }: { run: MidasRunResponse }) {
  const mean = Number(run.features?.sent_mean ?? 0)
  const std = Number(run.features?.sent_std ?? 0)

  let label = "Neutral"
  if (mean > 0.15) label = "Positive"
  if (mean < -0.15) label = "Negative"

  const magnitude = Math.min(1, Math.abs(mean))
  const stability = 1 - clamp01(std)
  const score = clamp01(0.6 * magnitude + 0.4 * stability)

  return (
    <div className="rounded-xl bg-slate-950 px-3 py-3">
      <div className="text-xs text-slate-400">Sentiment</div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-slate-100">{label}</span>
        <span className="text-slate-400">
          mean {mean.toFixed(3)} • std {std.toFixed(3)}
        </span>
        <span className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-0.5 text-xs text-slate-200">
          stability {Math.round(score * 100)}%
        </span>
      </div>
    </div>
  )
}

function minutesBetween(laterIso?: string, earlierIso?: string): number | null {
  if (!laterIso || !earlierIso) return null
  const later = Date.parse(laterIso)
  const earlier = Date.parse(earlierIso)
  if (Number.isNaN(later) || Number.isNaN(earlier)) return null
  return Math.max(0, Math.round((later - earlier) / 60000))
}

function secondsSince(iso?: string, nowMs?: number): number | null {
  if (!iso || !nowMs) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const s = Math.floor((nowMs - t) / 1000)
  return Math.max(0, s)
}

function FeatureLabel({ feature }: { feature: string }) {
  const meta = FEATURE_TOOLTIPS[feature]
  return (
    <span
      title={meta?.help ?? feature}
      style={{ textDecoration: "underline dotted", cursor: "help" }}
      className="text-slate-200"
    >
      {meta?.label ?? feature}
    </span>
  )
}

function ContextBanner({ run, nowMs }: { run: MidasRunResponse; nowMs: number }) {
  const quality = String(run.quote?.quality ?? "unknown")
  const spreadQuality = String(run.quote?.spread_quality ?? "unknown")
  const lastSource = String(run.quote?.last_source ?? "unknown")

  const r1 = Number(run.features?.r_1m ?? 0)
  const r5 = Number(run.features?.r_5m ?? 0)

  const isNoAction = run.recommendation?.class === "NO_ACTION"
  const lowIntradaySignal = Math.abs(r1) < 0.0005 && Math.abs(r5) < 0.0005

  let msg = ""

  if (quality === "estimated") {
    msg =
      "Last price is marked as estimated. Short-horizon signals may be less reliable."
  } else if (quality === "derived") {
    msg =
      "Last price is derived from a fallback source rather than a direct live quote."
  } else if (quality === "unknown") {
    msg =
      "Quote quality is unknown. Treat short-horizon signals cautiously."
  } else if (quality === "real" && spreadQuality === "estimated") {
    msg =
      "Last price appears valid; bid/ask spread is estimated because provider bid/ask was unavailable."
  } else if (isNoAction && lowIntradaySignal) {
    msg =
      "No actionable setup detected from current short-horizon price movement. Try again after a price move or new headlines."
  } else if (isNoAction) {
    msg =
      "No actionable setup detected from current features. Consider re-checking later."
  } else {
    msg = "Actionable setup detected based on current price/news features."
  }

  const headlineAgeMin = minutesBetween(run.ts_gateway, run.top_headline?.ts)
  const cacheAgeSec =
    typeof run.cache_age_seconds === "number" ? run.cache_age_seconds : null
  const responseAgeSec = secondsSince(run.ts_gateway, nowMs)

  let hint = ""
  if (lastSource !== "unknown") {
    hint += ` Last source: ${lastSource}.`
  }
  if (headlineAgeMin !== null) hint += ` Headline age: ${headlineAgeMin} min.`
  if (cacheAgeSec !== null) hint += ` Cache age (at fetch): ${cacheAgeSec}s.`
  if (responseAgeSec !== null) hint += ` Response age: ${responseAgeSec}s.`

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300">
      {msg}
      {hint}
    </div>
  )
}

function ExplainPanel({ run }: { run: MidasRunResponse }) {
  const ex = run.explain
  if (!ex) return null

  return (
    <details className="rounded-xl bg-slate-950 px-3 py-3">
      <summary className="cursor-pointer text-sm text-slate-200">Explain (ML)</summary>

      {ex.error && (
        <div className="mt-2 rounded-lg border border-red-800 bg-red-950 px-2 py-2 text-xs text-red-200">
          {ex.error}
        </div>
      )}

      {!ex.error && (
        <div className="mt-3 space-y-3">
          <div className="text-xs text-slate-400">
            Model version: <span className="text-slate-200">{ex.version ?? "unknown"}</span>
          </div>

          {ex.top_importances && ex.top_importances.length > 0 && (
            <div>
              <div className="text-xs text-slate-400">Top feature importances (global)</div>
              <div className="mt-2 space-y-2">
                {ex.top_importances.map((it) => (
                  <div key={it.feature} className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1 text-xs break-words">
                      <FeatureLabel feature={it.feature} />
                    </div>
                    <div className="h-2 flex-1 overflow-hidden rounded bg-slate-800">
                      <div
                        className="h-2 bg-orange-500"
                        style={{ width: `${Math.round(it.importance * 100)}%` }}
                      />
                    </div>
                    <div className="text-right text-xs text-slate-400 sm:w-12">
                      {(it.importance * 100).toFixed(1)}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {ex.inputs && (
            <div>
              <div className="text-xs text-slate-400">Inputs used for prediction</div>

              <div className="mt-2 space-y-1 rounded-lg bg-slate-900 p-2 text-xs">
                {Object.entries(ex.inputs).map(([key, value]) => (
                  <div key={key} className="flex flex-wrap gap-2">
                    <FeatureLabel feature={key} />
                    <span className="text-slate-400">:</span>
                    <span className="text-slate-200">{String(value)}</span>
                  </div>
                ))}
              </div>

              <pre className="mt-2 overflow-auto rounded-lg bg-slate-900 p-2 text-xs text-slate-200">
                {JSON.stringify(ex.inputs, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </details>
  )
}

function CandidateContracts({ optionChainPlan }: { optionChainPlan: any }) {
  if (!optionChainPlan?.available || !optionChainPlan?.candidates?.length) {
    return (
      <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-400">
        No candidate contracts available for this setup.
      </div>
    )
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead className="text-slate-400">
          <tr className="border-b border-slate-800">
            <th className="px-2 py-2 text-left">Role</th>
            <th className="px-2 py-2 text-left">Side</th>
            <th className="px-2 py-2 text-left">Strike</th>
            <th className="px-2 py-2 text-left">Exp</th>
            <th className="px-2 py-2 text-left">DTE</th>
            <th className="px-2 py-2 text-left">Moneyness</th>
            <th className="px-2 py-2 text-left">Bid</th>
            <th className="px-2 py-2 text-left">Ask</th>
            <th className="px-2 py-2 text-left">OI</th>
            <th className="px-2 py-2 text-left">Vol</th>
          </tr>
        </thead>
        <tbody>
          {optionChainPlan.candidates.map((c: any) => (
            <tr key={c.contract_symbol} className="border-b border-slate-900 text-slate-200">
              <td className="px-2 py-2">{c.role}</td>
              <td className="px-2 py-2">{c.side}</td>
              <td className="px-2 py-2">{c.strike}</td>
              <td className="px-2 py-2">{c.expiration}</td>
              <td className="px-2 py-2">{c.dte}</td>
              <td className="px-2 py-2">{c.moneyness_label}</td>
              <td className="px-2 py-2">{c.bid ?? "—"}</td>
              <td className="px-2 py-2">{c.ask ?? "—"}</td>
              <td className="px-2 py-2">{c.open_interest ?? "—"}</td>
              <td className="px-2 py-2">{c.volume ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TradePlanPanel({ run }: { run: MidasRunResponse }) {
  const plan = run.trade_plan
  if (!plan) return null

  const optionChainPlan = plan.option_chain_plan

  return (
    <details className="rounded-xl bg-slate-950 px-3 py-3" open>
      <summary className="cursor-pointer text-sm text-slate-200">Suggested trade plan</summary>

      <div className="mt-3 space-y-4">
        <div className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-3">
          <div className="text-xs text-slate-400">Setup</div>
          <div className="mt-1 text-sm text-slate-100">
            <span className="font-semibold">{plan.instrument_label ?? "Plan"}</span>
            {plan.confidence_bucket ? (
              <span className="ml-2 text-slate-400">({plan.confidence_bucket} confidence bucket)</span>
            ) : null}
          </div>
          {plan.summary && <div className="mt-2 text-sm text-slate-300">{plan.summary}</div>}
        </div>

        {plan.entry_plan && (
          <div className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-3">
            <div className="text-xs text-slate-400">Entry idea</div>
            <div className="mt-1 text-sm text-slate-200">
              {plan.entry_plan.plain_english ?? "—"}
            </div>
          </div>
        )}

        {plan.watch_trigger && (
          <div className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-3">
            <div className="text-xs text-slate-400">What to wait for</div>
            <div className="mt-1 text-sm text-slate-200">
              {plan.watch_trigger.plain_english ?? "—"}
            </div>
            {plan.watch_trigger.examples && plan.watch_trigger.examples.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-300">
                {plan.watch_trigger.examples.map((x, i) => (
                  <li key={`${x}-${i}`}>{x}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {plan.range_view && (
          <div className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-3">
            <div className="text-xs text-slate-400">Expected range</div>
            <div className="mt-1 text-sm text-slate-200">
              {plan.range_view.plain_english}
            </div>
            <div className="mt-2 text-xs text-slate-400">
              Lower bound: <span className="text-slate-200">{plan.range_view.lower_bound}</span>{" "}
              • Upper bound: <span className="text-slate-200">{plan.range_view.upper_bound}</span>
            </div>
          </div>
        )}

        {plan.target_zone && (
          <div className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-3">
            <div className="text-xs text-slate-400">Target zone</div>
            <div className="mt-1 text-sm text-slate-200">
              {plan.target_zone.plain_english}
            </div>
            <div className="mt-2 text-xs text-slate-400">
              Lower bound: <span className="text-slate-200">{plan.target_zone.lower_bound}</span>{" "}
              • Upper bound: <span className="text-slate-200">{plan.target_zone.upper_bound}</span>
            </div>
          </div>
        )}

        {plan.upside_cap && (
          <div className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-3">
            <div className="text-xs text-slate-400">Upside cap</div>
            <div className="mt-1 text-sm text-slate-200">
              {plan.upside_cap.plain_english}
            </div>
            <div className="mt-2 text-xs text-slate-400">
              Cap area: <span className="text-slate-200">{plan.upside_cap.upper_bound}</span>
            </div>
          </div>
        )}

        {plan.option_template && (
          <div className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-3">
            <div className="text-xs text-slate-400">Option template</div>
            <div className="mt-2 grid gap-3 lg:grid-cols-2 text-sm">
              <div>
                <div className="text-slate-400">Expiration</div>
                <div className="text-slate-200">
                  {plan.option_template.dte_label ?? plan.option_template.dte_target ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-slate-400">Strike style</div>
                <div className="text-slate-200">
                  {plan.option_template.strike_label ?? plan.option_template.strike_style ?? "—"}
                </div>
              </div>
            </div>
          </div>
        )}

        {plan.hold_plan && (
          <div className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-3">
            <div className="text-xs text-slate-400">Hold window</div>
            <div className="mt-1 text-sm text-slate-200">{plan.hold_plan.window ?? "—"}</div>
            {plan.hold_plan.plain_english && (
              <div className="mt-2 text-sm text-slate-300">{plan.hold_plan.plain_english}</div>
            )}
          </div>
        )}

        {plan.exit_rules && (
          <div className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-3">
            <div className="text-xs text-slate-400">Exit rules</div>
            <div className="mt-2 space-y-2 text-sm">
              <div>
                <span className="text-slate-400">Take profit: </span>
                <span className="text-slate-200">{plan.exit_rules.take_profit ?? "—"}</span>
              </div>
              <div>
                <span className="text-slate-400">Risk exit: </span>
                <span className="text-slate-200">{plan.exit_rules.risk_exit ?? "—"}</span>
              </div>
              <div>
                <span className="text-slate-400">Time exit: </span>
                <span className="text-slate-200">{plan.exit_rules.time_exit ?? "—"}</span>
              </div>
            </div>
          </div>
        )}

        {plan.watchouts && plan.watchouts.length > 0 && (
          <div className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-3">
            <div className="text-xs text-slate-400">Watchouts</div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-200">
              {plan.watchouts.map((w, i) => (
                <li key={`${w}-${i}`}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {plan.education?.terms && (
          <div className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-3">
            <div className="text-xs text-slate-400">Beginner terms</div>
            <div className="mt-2 space-y-2 text-sm">
              {Object.entries(plan.education.terms).map(([k, v]) => (
                <div key={k}>
                  <span className="font-semibold text-slate-200">{k}: </span>
                  <span className="text-slate-300">{String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-xs text-slate-400">Candidate contracts</div>
            <span className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-0.5 text-[11px] text-slate-300">
              Prototype chain lookup
            </span>
            <span className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-0.5 text-[11px] text-slate-300">
              Yahoo / yfinance
            </span>
          </div>

          {optionChainPlan?.selected_expiration && (
            <div className="mt-2 text-xs text-slate-400">
              Selected expiration: <span className="text-slate-200">{optionChainPlan.selected_expiration}</span>
            </div>
          )}

          <div className="mt-2 text-xs text-slate-400">
            These are candidate contracts for learning and prototyping, not guaranteed best execution choices.
          </div>

          <CandidateContracts optionChainPlan={optionChainPlan} />
        </div>
      </div>
    </details>
  )
}

export function RunPage() {
  const [ticker, setTicker] = useState(loadTicker)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [data, setData] = useState<MidasRunResponse | null>(loadLastRun)

  const history = useRunHistory()
  const nowMs = useNow(1000)
  const { settings } = useSettings()

  async function onRun() {
    const t = ticker.trim().toUpperCase()
    localStorage.setItem(LS_TICKER, t)

    if (!/^[A-Z.\-]{1,10}$/.test(t)) {
      setErr("Ticker should look like AAPL, MSFT, BRK.B, etc.")
      return
    }

    setErr(null)
    setLoading(true)

    try {
      const out = await runMidas(t, { explain: settings.enableExplain })
      setData(out)
      localStorage.setItem(LS_LAST_RUN, JSON.stringify(out))
      history.add(toHistoryItem(out))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <LoadingOverlay show={loading} />

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 lg:col-span-1">
          <h2 className="text-sm font-semibold text-slate-200">Run</h2>
          <p className="mt-1 text-sm text-slate-400">
            Calls <code className="text-slate-200">GET /api/run?ticker=...</code>
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <input
              value={ticker}
              onChange={(e) => {
                const v = e.target.value
                setTicker(v)
                localStorage.setItem(LS_TICKER, v.trim().toUpperCase())
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") onRun()
              }}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-500"
              placeholder="AAPL"
            />
            <button
              className="w-full rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-orange-400 disabled:opacity-60 sm:w-auto"
              onClick={onRun}
              disabled={loading}
            >
              {loading ? "Running..." : "Run"}
            </button>
          </div>

          {err && (
            <div className="mt-3 rounded-xl border border-red-800 bg-red-950 px-3 py-2 text-xs text-red-200">
              {err}
            </div>
          )}

          <div className="mt-3 text-xs text-slate-400">
            ML Explain:{" "}
            <span className="text-slate-200">
              {settings.enableExplain ? "enabled" : "disabled"}
            </span>{" "}
            (toggle in Settings)
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-200">Results</h2>

          {!data && !err && (
            <div className="mt-3 rounded-xl bg-slate-950 px-3 py-3 text-sm text-slate-400">
              Ready. Run a ticker to fetch a snapshot.
            </div>
          )}

          {data && (
            <div className="mt-3 space-y-3">
              <ContextBanner run={data} nowMs={nowMs} />

              {data.features_note && (
                <div className="rounded-xl border border-amber-800 bg-amber-950/50 px-3 py-3 text-sm text-amber-200">
                  <div className="font-semibold">Data warning</div>
                  <div className="mt-1">{data.features_note}</div>
                </div>
              )}

              <div className="rounded-xl bg-slate-950 px-3 py-3">
                <div className="text-xs text-slate-400">One-liner</div>
                <div className="mt-1 text-sm text-slate-100">
                  {stripBracketRefs(data.one_liner?.text ?? "")}
                </div>
                <RefLinks run={data} />
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-3">
                <MidasCanvas run={data} />
              </div>

              {headlineItems(data).length === 0 && data.top_headline?.url && (
                <a
                  href={data.top_headline.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 hover:border-slate-600"
                >
                  <div className="text-xs text-slate-400">Top headline</div>
                  <div className="mt-1 text-sm text-orange-200">
                    {data.top_headline.title}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {data.top_headline.publisher ?? "Source"} •{" "}
                    {data.top_headline.ts ?? ""}
                  </div>
                </a>
              )}

              {headlineItems(data).length > 0 && (
                <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-3">
                  <div className="text-xs text-slate-400">Top headlines</div>
                  <div className="mt-2 space-y-3">
                    {headlineItems(data).slice(0, 3).map((h, idx) => (
                      <a
                        key={`${h.url ?? "headline"}-${idx}`}
                        href={h.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-lg border border-slate-800 bg-slate-900 px-3 py-3 hover:border-slate-600"
                      >
                        <div className="text-sm text-orange-200">
                          {h.title ?? h.url ?? "Untitled headline"}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {h.publisher ?? "Source"}
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-xl bg-slate-950 px-3 py-3">
                  <div className="text-xs text-slate-400">Recommendation</div>
                  <div className="mt-1 text-sm">
                    <span className="font-semibold">{data.recommendation.class}</span>{" "}
                    <span className="text-slate-400">
                      ({(data.recommendation.confidence * 100).toFixed(2)}%)
                    </span>
                  </div>
                </div>

                <div className="rounded-xl bg-slate-950 px-3 py-3">
                  <div className="text-xs text-slate-400">Quote</div>
                  <div className="mt-1 text-sm">
                    {validLast(data) !== null ? (
                      <>
                        Last: {validLast(data)?.toFixed(2)}{" "}
                        <span className="text-slate-400">
                          ({data.quote?.quality ?? "unknown"}
                          {data.quote?.spread_quality
                            ? ` / spread: ${data.quote.spread_quality}`
                            : ""}
                          )
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="font-semibold text-amber-200">Last unavailable</span>{" "}
                        <span className="text-slate-400">
                          ({data.quote?.quality ?? "unknown"})
                        </span>
                      </>
                    )}
                  </div>
                  {data.quote?.last_source && data.quote.last_source !== "unknown" && (
                    <div className="mt-1 text-xs text-slate-500">
                      Source: {data.quote.last_source}
                    </div>
                  )}
                </div>
              </div>

              <SentimentPill run={data} />

              <TradePlanPanel run={data} />

              {settings.enableExplain && <ExplainPanel run={data} />}

              <details className="rounded-xl bg-slate-950 px-3 py-3">
                <summary className="cursor-pointer text-sm text-slate-200">
                  Raw JSON (debug)
                </summary>
                <pre className="mt-2 overflow-auto text-xs text-slate-300">
                  {JSON.stringify(data, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}