import { useNavigate } from "react-router-dom"
import { useRunHistory } from "../hooks/useRunHistory"

const LS_LAST_RUN = "midas_dash_last_run_v1"

const stripBracketRefs = (text: string) =>
  text.replace(/\(\[[0-9]+\](\[[0-9]+\])*\)/g, "").trim()

export function HistoryPage() {
  const history = useRunHistory()
  const navigate = useNavigate()

  function openSnapshot(raw: unknown) {
    localStorage.setItem(LS_LAST_RUN, JSON.stringify(raw))
    navigate("/")
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-100">History</h2>
        <button
          onClick={history.clear}
          className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:border-slate-500"
        >
          Clear
        </button>
      </div>

      {history.items.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-slate-300">
          No runs yet. Go to <span className="text-orange-200">Run</span> and fetch a ticker.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {history.items.map((it) => (
            <div
              key={it.id}
              className="rounded-2xl border border-slate-800 bg-slate-900 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-100">
                  {it.ticker} • {it.recommendationClass} •{" "}
                  {(it.confidence * 100).toFixed(2)}%
                </div>
                <div className="text-xs text-slate-400">{it.ts}</div>
              </div>

              {it.oneLiner && (
                <div className="mt-2 text-sm text-slate-200">
                  {stripBracketRefs(it.oneLiner)}
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => openSnapshot(it.snapshot)}
                  className="rounded-lg bg-orange-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-orange-400"
                >
                  Open snapshot
                </button>

                {it.headlineUrl && (
                  <a
                    href={it.headlineUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-orange-200 hover:border-slate-600"
                  >
                    Open headline
                  </a>
                )}
              </div>

              {it.refsNumbers && it.refsNumbers.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {it.refsNumbers.map((r) => (
                    <a
                      key={`${it.id}-${r.n}`}
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-orange-200 hover:border-slate-600"
                    >
                      [{r.n}]
                    </a>
                  ))}
                </div>
              )}

              {it.headlineUrl && !it.headlineTitle && (
                <div className="mt-2 text-xs text-slate-500">{it.headlineUrl}</div>
              )}

              {it.headlineTitle && (
                <div className="mt-2 text-sm text-slate-300">{it.headlineTitle}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  )
}