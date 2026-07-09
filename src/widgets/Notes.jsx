import { useState, useRef, useEffect } from 'react'
import { Notes as NotesIcon } from 'pixelarticons/react'
import { useStore, actions, registerWidget } from '../core'

// One shared scratch pad. The agent can append to it (append_note) and reads it
// in every system prompt, so "note down that the quiz moved" just works.
function Notes() {
  const { notes } = useStore()
  const [val, setVal] = useState(notes)
  const focused = useRef(false)
  const timer = useRef(null)

  // pick up agent-made changes, but never clobber while Aaron is typing
  useEffect(() => { if (!focused.current) setVal(notes) }, [notes])

  const onChange = (e) => {
    const v = e.target.value
    setVal(v)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => actions.setNotes(v), 500)
  }

  return (
    <textarea className="notes" value={val} onChange={onChange} placeholder="Quick notes…"
      onFocus={() => { focused.current = true }}
      onBlur={() => { focused.current = false; clearTimeout(timer.current); actions.setNotes(val) }} />
  )
}

registerWidget({ id: 'notes', title: 'Notes', icon: NotesIcon, span: 6, Component: Notes })
export default Notes
