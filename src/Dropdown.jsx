import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'pixelarticons/react'

// Custom-styled replacement for <select>: looks like a toolbar button with a
// chevron, opens a matching option list. Keeps native <select> out of the UI
// so every dropdown shares the button skin instead of the OS's own widget.
export default function Dropdown({ value, onChange, options, title, className = '' }) {
  const [open, setOpen] = useState(false)
  const [h, setH] = useState() // matched to a neighbor so the button lines up with whatever sits beside it
  const ref = useRef(null)
  const current = options.find((o) => o.value === value) || options[0]

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  // Auto-match a neighbor's height. CSS stretch can't do it: the dropdown's own
  // intrinsic height would define the row, so it ends up taller than the fixed-
  // height buttons beside it. Measure a sibling instead — works wherever it's placed.
  useEffect(() => {
    const el = ref.current
    const sib = el?.nextElementSibling || el?.previousElementSibling
    if (!sib) return
    const measure = () => setH(sib.getBoundingClientRect().height || undefined)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(sib)
    return () => ro.disconnect()
  }, [])

  return (
    <div className={'dropdown ' + className} ref={ref} title={title}>
      <button type="button" className="dropdown-btn" style={h ? { height: h } : undefined} onClick={() => setOpen((o) => !o)}>
        <span>{current?.label}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="dropdown-menu">
          {options.map((o) => (
            <button key={o.value} type="button" className={'dropdown-item' + (o.value === value ? ' on' : '')}
              onClick={() => { onChange(o.value); setOpen(false) }}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
