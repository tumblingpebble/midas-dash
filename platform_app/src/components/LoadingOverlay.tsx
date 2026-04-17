import { useEffect, useMemo, useState } from "react"

type Props = {
  show: boolean
}

const MESSAGES = [
  "Consulting the hive mind…",
  "Stacking bananas… optimizing signal…",
  "Calibrating confidence…",
  "Cross-checking headlines…",
  "Asking the market politely…",
  "Running feature extraction…",
  "Measuring volatility…",
  "Reconciling news + price…",
]

export function LoadingOverlay({ show }: Props) {
  const [idx, setIdx] = useState(0)

  // Shuffle-ish start so it doesn't always begin the same
  const startIdx = useMemo(() => Math.floor(Math.random() * MESSAGES.length), [])

  useEffect(() => {
    if (!show) return

    setIdx(startIdx)
    const id = window.setInterval(() => {
      setIdx((prev) => (prev + 1) % MESSAGES.length)
    }, 850)

    return () => window.clearInterval(id)
  }, [show, startIdx])

  if (!show) return null

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 backdrop-blur-sm">
      <div className="w-[min(520px,92vw)] rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl">
        <div className="flex items-center gap-3">
          <Spinner />
          <div>
            <div className="text-sm font-semibold text-slate-100">MIDAS DASH</div>
            <div className="mt-1 text-sm text-slate-300">{MESSAGES[idx]}</div>
          </div>
        </div>

        <div className="mt-4 h-2 w-full overflow-hidden rounded bg-slate-800">
          <div className="h-2 w-1/2 animate-[midasbar_1.2s_ease-in-out_infinite] bg-orange-500" />
        </div>

        <div className="mt-3 text-xs text-slate-400">
          Tip: toggle ML Explain in <span className="text-slate-200">Settings</span> to see why a strategy was chosen.
        </div>
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <div
      className="h-9 w-9 animate-spin rounded-full border-2 border-slate-700 border-t-orange-500"
      aria-label="Loading"
    />
  )
}