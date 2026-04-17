import { useEffect, useMemo, useRef, useState } from "react"
import type { MidasRunResponse } from "../api/midas"

type Props = {
  run: MidasRunResponse
  height?: number
}

function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x))
}

function round(n: number) {
  return Math.round(n)
}

export function MidasCanvas({ run, height = 200 }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [w, setW] = useState<number>(680)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const next = Math.max(320, Math.floor(el.clientWidth))
      setW(next)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const data = useMemo(() => {
    const conf = clamp(Number(run.recommendation?.confidence ?? 0), 0, 1)
    const sent = clamp(Number(run.features?.sent_mean ?? 0), -1, 1)
    const rv20 = clamp(Number(run.features?.rv20 ?? 0.02), 0.02, 0.8)

    return {
      ticker: String(run.ticker ?? ""),
      rec: String(run.recommendation?.class ?? ""),
      conf,
      sent,
      rv20,
      quote: Number(run.quote?.last ?? 0),
      quality: String(run.quote?.quality ?? "unknown"),
      spreadQuality: String((run.quote as any)?.spread_quality ?? "unknown"),
      ts: String(run.ts_gateway ?? ""),
    }
  }, [run])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const width = w
    const H = height

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(H * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${H}px`

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const g = ctx

    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.imageSmoothingEnabled = false

    const text = "#ffffff"
    const sub = "#e5e7eb"
    const accent = "#f97316"
    const good = "#22c55e"
    const bad = "#ef4444"
    const track = "#0f172a"
    const border = "#1f2937"

    function drawText(x: number, y: number, s: string, color: string, font: string) {
      g.fillStyle = color
      g.font = font
      g.fillText(s, round(x), round(y))
    }

    function roundRect(x: number, y: number, ww: number, hh: number, r: number) {
      const rr = Math.min(r, ww / 2, hh / 2)
      g.beginPath()
      g.moveTo(x + rr, y)
      g.arcTo(x + ww, y, x + ww, y + hh, rr)
      g.arcTo(x + ww, y + hh, x, y + hh, rr)
      g.arcTo(x, y + hh, x, y, rr)
      g.arcTo(x, y, x + ww, y, rr)
      g.closePath()
    }

    function drawBar(x: number, y: number, ww: number, hh: number, p: number, color: string) {
      g.fillStyle = track
      roundRect(x, y, ww, hh, 10)
      g.fill()

      g.fillStyle = color
      roundRect(x, y, ww * clamp(p, 0, 1), hh, 10)
      g.fill()

      g.strokeStyle = border
      g.lineWidth = 1
      roundRect(x, y, ww, hh, 10)
      g.stroke()
    }

    function drawSentimentLeftBar(x: number, y: number, ww: number, hh: number, sent: number) {
      const p = (clamp(sent, -1, 1) + 1) / 2
      const color = sent < 0 ? bad : good
      drawBar(x, y, ww, hh, p, color)

      g.strokeStyle = border
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(round(x + ww * 0.5), round(y + 3))
      g.lineTo(round(x + ww * 0.5), round(y + hh - 3))
      g.stroke()
    }

    function drawFullRingGauge(cx: number, cy: number, r: number, conf: number) {
      const start = -Math.PI / 2
      const end = start + Math.PI * 2
      const angle = start + Math.PI * 2 * clamp(conf, 0, 1)

      g.lineWidth = 12

      g.strokeStyle = track
      g.beginPath()
      g.arc(round(cx), round(cy), r, start, end)
      g.stroke()

      g.strokeStyle = accent
      g.beginPath()
      g.arc(round(cx), round(cy), r, start, angle)
      g.stroke()

      g.fillStyle = "#0b1220"
      g.beginPath()
      g.arc(round(cx), round(cy), r - 10, 0, Math.PI * 2)
      g.fill()

      g.fillStyle = text
      g.font = "20px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto"
      g.textAlign = "center"
      g.textBaseline = "middle"
      g.fillText(`${Math.round(conf * 100)}%`, round(cx), round(cy - 6))

      g.fillStyle = sub
      g.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto"
      g.fillText("confidence", round(cx), round(cy + 16))

      g.textAlign = "left"
      g.textBaseline = "alphabetic"
    }

    g.clearRect(0, 0, width, H)

    const px = 24
    const py = 22
    const pw = width - 36

    drawText(px, py + 6, data.ticker, accent, "16px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto")
    drawText(px + 70, py + 6, data.rec, text, "14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto")

    const q = data.quote ? data.quote.toFixed(2) : "—"
    const qualityText =
      data.spreadQuality && data.spreadQuality !== "unknown"
        ? `${data.quality} / spr:${data.spreadQuality}`
        : data.quality

    drawText(
      px,
      py + 26,
      `last: ${q} (${qualityText})`,
      sub,
      "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto"
    )

    if (data.ts) drawText(px, py + 44, `ts: ${data.ts}`, sub, "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto")

    const gaugeCx = px + 74
    const gaugeCy = py + 112
    const gaugeR = 44
    drawFullRingGauge(gaugeCx, gaugeCy, gaugeR, data.conf)

    const barsX = px + 160
    const barsY = py + 66
    const barsW = pw - 170
    const barH = 16
    const gap = 26

    drawText(barsX, barsY - 8, "sentiment (mean)", sub, "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto")
    drawSentimentLeftBar(barsX, barsY, barsW, barH, data.sent)

    const rvNormRaw = (data.rv20 - 0.02) / (0.8 - 0.02)
    const rvVisible = Math.max(rvNormRaw, 0.03)
    drawText(barsX, barsY + barH + gap - 8, "volatility (rv20)", sub, "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto")
    drawBar(barsX, barsY + barH + gap, barsW, barH, rvVisible, accent)

    const legendY = barsY + (barH + gap) * 2 + 0
    drawText(barsX, legendY, "sent_mean", sub, "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto")
    drawText(barsX, legendY + 18, data.sent.toFixed(3), text, "14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto")

    drawText(barsX + 170, legendY, "rv20", sub, "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto")
    drawText(barsX + 170, legendY + 18, data.rv20.toFixed(3), text, "14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto")

    drawText(barsX + 300, legendY, "confidence", sub, "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto")
    drawText(barsX + 300, legendY + 18, data.conf.toFixed(3), text, "14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto")
  }, [data, w, height])

  return (
    <div ref={wrapRef} className="w-full">
      <canvas ref={canvasRef} className="w-full" />
    </div>
  )
}