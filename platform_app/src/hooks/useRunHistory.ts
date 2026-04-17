import { useEffect, useMemo, useState } from "react"
import type { MidasRunResponse } from "../api/midas"

export type RunHistoryItem = {
  id: string
  ts: string
  ticker: string
  recommendationClass: string
  confidence: number
  headlineTitle?: string
  headlineUrl?: string
  oneLiner?: string
  refsNumbers?: Array<{ n: number; url: string }>
}

const KEY = "midas_dash_history_v1"
const MAX_ITEMS = 25

function safeParse(raw: string | null): RunHistoryItem[] {
  if (!raw) return []
  try {
    const x = JSON.parse(raw)
    return Array.isArray(x) ? (x as RunHistoryItem[]) : []
  } catch {
    return []
  }
}

export function toHistoryItem(run: MidasRunResponse): RunHistoryItem {
  const ts = run.ts_gateway ?? new Date().toISOString()
  return {
    id: `${run.ticker}-${ts}`,
    ts,
    ticker: run.ticker,
    recommendationClass: run.recommendation.class,
    confidence: run.recommendation.confidence,
    headlineTitle: run.top_headline?.title,
    headlineUrl: run.top_headline?.url,
    oneLiner: run.one_liner?.text,
    refsNumbers: run.one_liner?.refs_numbers ?? [],
  }
}

export function useRunHistory() {
  const [items, setItems] = useState<RunHistoryItem[]>(() =>
    safeParse(localStorage.getItem(KEY)),
  )

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(items))
  }, [items])

  const api = useMemo(
    () => ({
      items,
      add: (item: RunHistoryItem) =>
        setItems((prev) => [item, ...prev].slice(0, MAX_ITEMS)),
      clear: () => setItems([]),
    }),
    [items],
  )

  return api
}