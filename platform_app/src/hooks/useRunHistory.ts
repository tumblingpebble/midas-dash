import { useMemo, useState } from "react"
import type { MidasRunResponse } from "../api/midas"
import { browserStorage } from "../lib/browserStorage"
import { isRecord, isRunSnapshot } from "../lib/storedRun"

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
  snapshot: MidasRunResponse
}

const KEY = "midas_dash_history_v1"
const MAX_ITEMS = 25

function optionalText(value: unknown): boolean {
  return value == null || typeof value === "string"
}

function isHistoryItem(item: unknown): item is RunHistoryItem {
  if (!isRecord(item)) return false
  return (
    typeof item.id === "string" &&
    typeof item.ts === "string" &&
    typeof item.ticker === "string" &&
    typeof item.recommendationClass === "string" &&
    typeof item.confidence === "number" &&
    Number.isFinite(item.confidence) &&
    isRunSnapshot(item.snapshot) &&
    optionalText(item.oneLiner) &&
    optionalText(item.headlineTitle) &&
    optionalText(item.headlineUrl) &&
    (item.refsNumbers == null ||
      (Array.isArray(item.refsNumbers) &&
        item.refsNumbers.every((ref: unknown) =>
          isRecord(ref) &&
          typeof ref.n === "number" && Number.isFinite(ref.n) &&
          typeof ref.url === "string",
        )))
  )
}

function safeParse(raw: string | null): RunHistoryItem[] {
  if (!raw) return []
  try {
    const x: unknown = JSON.parse(raw)
    if (!Array.isArray(x)) return []

    return x.filter(isHistoryItem)
  } catch {
    return []
  }
}

// This bounded summary composes without retaining an operation per add. With
// 25 distinct newer IDs, no older row could survive the final history limit.
export function mergeHistory(newer: string, older: string | null): string {
  const seen = new Set<string>()
  const result: RunHistoryItem[] = []
  for (const row of [...safeParse(newer), ...safeParse(older)]) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    result.push(row)
    if (result.length === MAX_ITEMS) break
  }
  return JSON.stringify(result)
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
    snapshot: run,
  }
}

export function useRunHistory() {
  const [items, setItems] = useState<RunHistoryItem[]>(() =>
    safeParse(browserStorage.getItem(KEY)),
  )
  const api = useMemo(
    () => ({
      items,
      add: (item: RunHistoryItem) => {
        const value = browserStorage.mergeItem(KEY, JSON.stringify([item]), mergeHistory)
        setItems(safeParse(value))
      },
      clear: () => {
        // Explicit clear supersedes deferred adds, including unread durable rows.
        browserStorage.setJson(KEY, [])
        setItems([])
      },
    }),
    [items],
  )

  return api
}
