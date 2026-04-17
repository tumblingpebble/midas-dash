import { useRunHistory } from "../hooks/useRunHistory"

const stripBracketRefs = (text: string) =>
  text.replace(/\(\[[0-9]+\](\[[0-9]+\])*\)/g, "").trim()

export function HistoryPage() {
  const history = useRunHistory()

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

              {it.headlineUrl && (
                <a
                  href={it.headlineUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 block text-sm text-orange-200 hover:underline"
                >
                  {it.headlineTitle ?? it.headlineUrl}
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  )
}