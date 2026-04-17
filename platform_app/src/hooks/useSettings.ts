import { useEffect, useMemo, useState } from "react"

export type AppSettings = {
  enableExplain: boolean
}

const KEY = "midas_dash_settings_v1"

function load(): AppSettings {
  const raw = localStorage.getItem(KEY)
  if (!raw) return { enableExplain: false }
  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      enableExplain: Boolean(parsed.enableExplain),
    }
  } catch {
    return { enableExplain: false }
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => load())

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(settings))
  }, [settings])

  const api = useMemo(
    () => ({
      settings,
      setEnableExplain: (v: boolean) =>
        setSettings((prev) => ({ ...prev, enableExplain: v })),
    }),
    [settings],
  )

  return api
}