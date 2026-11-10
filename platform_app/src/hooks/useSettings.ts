import { useEffect, useMemo, useRef, useState } from "react"
import { browserStorage } from "../lib/browserStorage"

export type AppSettings = {
  enableExplain: boolean
}

const KEY = "midas_dash_settings_v1"

function load(): AppSettings {
  const raw = browserStorage.getItem(KEY)
  if (!raw) return { enableExplain: false }
  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      enableExplain: parsed.enableExplain === true,
    }
  } catch {
    return { enableExplain: false }
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => load())
  const lastHandled = useRef(settings)

  useEffect(() => {
    // Preserve unread saved preferences until the user actually changes them.
    if (lastHandled.current === settings) return
    browserStorage.setJson(KEY, settings)
    lastHandled.current = settings
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
