import { useEffect, useId, useRef, useState } from "react"

type TooltipPosition = {
  top: number
  left: number
}

type InfoTooltipProps = {
  label: string
  help: string
  className?: string
}

export function InfoTooltip({ label, help, className = "" }: InfoTooltipProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<TooltipPosition>({ top: 0, left: 0 })
  const wrapRef = useRef<HTMLSpanElement | null>(null)
  const tooltipId = useId()

  function updatePosition() {
    const el = wrapRef.current
    if (!el) return

    const rect = el.getBoundingClientRect()
    const tooltipWidth = 256
    const margin = 12

    const left = Math.min(
      Math.max(margin, rect.left),
      window.innerWidth - tooltipWidth - margin,
    )

    const below = rect.bottom + 8
    const above = rect.top - 8

    setPosition({
      left,
      top: below < window.innerHeight - 90 ? below : Math.max(margin, above - 90),
    })
  }

  function openTooltip() {
    updatePosition()
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return

    updatePosition()

    function onPointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false)
      }
    }

    function onReposition() {
      updatePosition()
    }

    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    window.addEventListener("resize", onReposition)
    window.addEventListener("scroll", onReposition, true)

    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("resize", onReposition)
      window.removeEventListener("scroll", onReposition, true)
    }
  }, [open])

  return (
    <span
      ref={wrapRef}
      className={`relative inline-flex min-w-0 items-center gap-1 align-baseline ${className}`}
      onMouseEnter={openTooltip}
      onMouseLeave={() => setOpen(false)}
      onFocus={openTooltip}
      onBlur={() => setOpen(false)}
    >
      <button
        type="button"
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        className="inline-flex min-w-0 items-center gap-1 rounded-sm text-left underline decoration-slate-400 decoration-dotted underline-offset-4 outline-none transition hover:text-[#FFF4D6] focus-visible:ring-2 focus-visible:ring-[#F8D57A]"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()

          if (open) {
            setOpen(false)
          } else {
            openTooltip()
          }
        }}
      >
        <span className="min-w-0 break-words">{label}</span>
        <span
          aria-hidden="true"
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-slate-600 text-[10px] leading-none text-[#F8D57A]"
        >
          i
        </span>
      </button>

      {open && (
        <span
          id={tooltipId}
          role="tooltip"
          style={{
            top: position.top,
            left: position.left,
          }}
          className="fixed z-[9999] w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-normal leading-relaxed text-slate-200 shadow-2xl shadow-black/40"
        >
          {help}
        </span>
      )}
    </span>
  )
}
