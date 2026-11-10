type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">

// Optional persistence must not prevent using the app. Keep failed writes and
// removals authoritative for this tab instead of reading an older disk value.
export function createBrowserStorage(getStorage: () => StorageLike) {
  const values = new Map<string, string | null>()
  const pending = new Set<string>()

  // Retry deferred merges against durable data before replacing any unseen rows.
  type Merge = (newer: string, older: string | null) => string
  const updates = new Map<string, { value: string; merge: Merge }>()

  function readItem(key: string): { value: string | null; readable: boolean } {
    const queued = updates.get(key)
    if (queued) {
      try {
        const value = queued.merge(queued.value, getStorage().getItem(key))
        setItem(key, value)
        return { value, readable: true }
      } catch {
        return { value: values.get(key) ?? null, readable: false }
      }
    }
    if (pending.has(key)) return { value: values.get(key) ?? null, readable: true }
    try {
      const value = getStorage().getItem(key)
      values.set(key, value)
      return { value, readable: true }
    } catch {
      return { value: values.get(key) ?? null, readable: false }
    }
  }

  // merge must compact newer changes with older changes associatively. History
  // supplies a bounded newest-first, distinct-ID merge, not arbitrary operations.
  function mergeItem(key: string, newer: string, merge: Merge): string {
    const current = readItem(key)
    const value = merge(newer, current.value)
    if (current.readable) {
      setItem(key, value)
    } else {
      updates.set(key, { value: merge(newer, updates.get(key)?.value ?? null), merge })
      values.set(key, value)
    }
    return value
  }

  function getItem(key: string): string | null {
    return readItem(key).value
  }

  function setItem(key: string, value: string) {
    updates.delete(key)
    values.set(key, value)
    pending.add(key)
    try {
      getStorage().setItem(key, value)
      pending.delete(key)
    } catch {
      // The latest value remains available while this tab is open.
    }
  }

  function removeItem(key: string) {
    updates.delete(key)
    values.set(key, null)
    pending.add(key)
    try {
      getStorage().removeItem(key)
      pending.delete(key)
    } catch {
      // Retain the removal so an older persisted value cannot reappear here.
    }
  }

  function setJson(key: string, value: unknown) {
    try {
      const serialized = JSON.stringify(value)
      if (serialized !== undefined) setItem(key, serialized)
    } catch {
      // A value that cannot be serialized is also an optional persistence miss.
    }
  }

  return { getItem, setItem, removeItem, setJson, mergeItem }
}

// Access the browser property inside the guarded operation: its getter can throw.
// An opt-in private build never reads, writes or deletes existing durable data.
// This store lasts only for this page instance, not a browser account/session.
export const privateAccessMode = import.meta.env?.VITE_PRIVATE_ACCESS === "1"
const privateValues = new Map<string, string>()
const privateStorage: StorageLike = {
  getItem: (key) => privateValues.get(key) ?? null,
  setItem: (key, value) => { privateValues.set(key, value) },
  removeItem: (key) => { privateValues.delete(key) },
}

export const browserStorage = createBrowserStorage(
  () => privateAccessMode ? privateStorage : globalThis.localStorage,
)
