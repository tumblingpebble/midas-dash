import { useState } from "react"
import { runMidas, type MidasRunResponse } from "../api/midas"
import { toHistoryItem, useRunHistory } from "../hooks/useRunHistory"
import { useNow } from "../hooks/useNow"
import { useSettings } from "../hooks/useSettings"
import { LoadingOverlay } from "../components/LoadingOverlay"
import { MidasCanvas } from "../components/MidasCanvas"

const LS_TICKER = "midas_dash_last_ticker_v1"
const LS_LAST_RUN = "midas_dash_last_run_v1"

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

function ContextBanner({ run, nowMs }: { run: MidasRunResponse; nowMs: number }) {
  const quality = String(run.quote?.quality ?? "unknown")
  const r1 = Number(run.features?.r_1m ?? 0)
  const r5 = Number(run.features?.r_5m ?? 0)

  const isNoAction = run.recommendation?.class === "NO_ACTION"
  const lowIntradaySignal = Math.abs(r1) < 0.0005 && Math.abs(r5) < 0.0005

  let msg = ""
  if (quality === "estimated") {
    msg =
      "Quote quality is marked as “estimated.” Short-horizon signals may be less reliable; consider re-checking during active market conditions."
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
                  <div key={it.feature} className="flex items-center gap-3">
                    <div className="w-40 truncate text-xs text-slate-200">{it.feature}</div>
                    <div className="h-2 flex-1 overflow-hidden rounded bg-slate-800">
                      <div
                        className="h-2 bg-orange-500"
                        style={{ width: `${Math.round(it.importance * 100)}%` }}
                      />
                    </div>
                    <div className="w-12 text-right text-xs text-slate-400">
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

          <div className="mt-4 flex gap-2">
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
              className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-orange-400 disabled:opacity-60"
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
              {data.top_headline?.url && (
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

              <div className="grid gap-3 md:grid-cols-2">
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
                    Last: {data.quote?.last ?? "—"}{" "}
                    <span className="text-slate-400">
                      ({data.quote?.quality ?? "unknown"})
                    </span>
                  </div>
                </div>
              </div>

              <SentimentPill run={data} />

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