import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'pixelarticons/react'

// Custom-styled replacement for <select>: looks like a toolbar button with a
// chevron, opens a matching option list. Keeps native <select> out of the UI
// so every dropdown shares the button skin instead of the OS's own widget.
export default function Dropdown({ value, onChange, options, title, className = '', matchSibling = false }) {
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

  // Auto-match a neighbor's height — opt in via matchSibling for toolbar/add-row
  // placements where the dropdown sits beside a fixed-height button and CSS
  // stretch can't do it (the dropdown's own intrinsic height would define the
  // row instead). Off by default: matching an arbitrary sibling (e.g. a label
  // above it in a form) collapses the button to that sibling's height instead.
  useEffect(() => {
    if (!matchSibling) return
    const el = ref.current
    const sib = el?.nextElementSibling || el?.previousElementSibling
    if (!sib) return
    const measure = () => setH(sib.getBoundingClientRect().height || undefined)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(sib)
    return () => ro.disconnect()
  }, [matchSibling])

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
              onClick={() => { setOpen(false); onChange(o.value) }}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
