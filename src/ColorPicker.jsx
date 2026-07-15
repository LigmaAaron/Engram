import { useState, useRef, useEffect } from 'react'

// hex <-> hsv, kept local (no color-math dependency for three conversions).
const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
const rgbToHsv = (r, g, b) => {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, max === 0 ? 0 : d / max, max]
}
const hsvToRgb = (h, s, v) => {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}
const isHex = (s) => /^#[0-9a-f]{6}$/i.test(s)

// Custom saturation/value + hue + hex picker — no native <input type="color">
// (its OS-chrome popup can't be themed) and no picker dependency; this stays
// in the app's own flat/hairline visual language like every other control.
export default function ColorPicker({ value, onChange, title }) {
  const [open, setOpen] = useState(false)
  const [hex, setHex] = useState(value)
  const ref = useRef(null)
  const svRef = useRef(null)
  const [h, s, v] = rgbToHsv(...hexToRgb(isHex(value) ? value : '#000000'))

  useEffect(() => setHex(value), [value])

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const setHsv = (nh, ns, nv) => onChange(rgbToHex(...hsvToRgb(nh, ns, nv)))

  const dragSv = (e) => {
    const move = (ev) => {
      const r = svRef.current.getBoundingClientRect()
      const x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width))
      const y = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height))
      setHsv(h, x, 1 - y)
    }
    move(e)
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up) }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  const dragHue = (e) => {
    const track = e.currentTarget
    const move = (ev) => {
      const r = track.getBoundingClientRect()
      const x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width))
      setHsv(x * 360, s, v)
    }
    move(e)
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up) }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  const commitHex = () => { if (isHex(hex)) onChange(hex.toLowerCase()); else setHex(value) }

  return (
    <div className="cpicker" ref={ref} title={title}>
      <button type="button" className="cpicker-btn" onClick={() => setOpen((o) => !o)}>
        <span className="cpicker-swatch" style={{ background: value }} />
        <span className="cpicker-hex">{value}</span>
      </button>
      {open && (
        <div className="cpicker-panel">
          <div className="cpicker-sv" ref={svRef} onMouseDown={dragSv} style={{ background: `hsl(${h},100%,50%)` }}>
            <div className="cpicker-sv-white" />
            <div className="cpicker-sv-black" />
            <div className="cpicker-sv-thumb" style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }} />
          </div>
          <div className="cpicker-hue" onMouseDown={dragHue}>
            <div className="cpicker-hue-thumb" style={{ left: `${(h / 360) * 100}%` }} />
          </div>
          <input className="cpicker-input" value={hex} onChange={(e) => setHex(e.target.value)}
            onBlur={commitHex} onKeyDown={(e) => e.key === 'Enter' && commitHex()} spellCheck={false} />
        </div>
      )}
    </div>
  )
}
