import { useState, useRef, useEffect } from 'react'
import { Notes as NotesIcon, Plus, Trash, ChevronLeft } from 'pixelarticons/react'
import { useStore, actions, store, registerWidget, toast } from '../core'

/* Notes are a list of titled entries. Two surfaces share the same store:
   - the overview shows QuickNote, a throwaway capture box that gets sealed into
     a dated note on the next reload (see hydrate);
   - the solo Notes page shows the full list + editor. */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const ordinal = (d) => { const s = ['th', 'st', 'nd', 'rd'], v = d % 100; return d + (s[(v - 20) % 10] || s[v] || s[0]) }
const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate())

// Bucket a note by how long ago it was last modified: Today / Yesterday / a
// specific date this year ("January 1st") / "A long time ago" for older years.
function category(modified) {
  const now = new Date(), d = new Date(modified)
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 864e5)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (d.getFullYear() === now.getFullYear()) return `${MONTHS[d.getMonth()]} ${ordinal(d.getDate())}`
  return 'A long time ago'
}

const preview = (body) => body.replace(/\s+/g, ' ').trim() || 'Empty note'

// -- Overview widget: a scratch box. Text lives in noteDraft as you type and is
// sealed into a dated note on the next page load, so a reload clears the box but
// never loses what you wrote.
function QuickNote() {
  const [val, setVal] = useState(() => store.get().noteDraft || '')
  const valRef = useRef(val)
  const timer = useRef(null)
  const flush = () => { clearTimeout(timer.current); actions.setNoteDraft(valRef.current) }
  useEffect(() => flush, []) // keep the buffer when navigating away mid-thought

  const onChange = (e) => {
    const v = e.target.value
    setVal(v); valRef.current = v
    clearTimeout(timer.current)
    timer.current = setTimeout(() => actions.setNoteDraft(v), 500)
  }
  return (
    <textarea className="notes" value={val} onChange={onChange} onBlur={flush}
      placeholder="Jot something down… it's saved as a dated note when you reload." />
  )
}

// -- Editor: title + body for one note, autosaved. Reused for whichever note is
// active; resets its buffers when the selected note changes.
function Editor({ note }) {
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)
  const timer = useRef(null)
  const bodyRef = useRef(null)
  const cur = useRef()
  cur.current = { id: note.id, title, body }

  const save = () => { const c = cur.current; actions.updateNote(c.id, { title: c.title, body: c.body }) }
  const schedule = () => { clearTimeout(timer.current); timer.current = setTimeout(save, 400) }

  useEffect(() => {
    setTitle(note.title); setBody(note.body)
    // flush pending edits to the outgoing note before swapping / unmounting,
    // but only when they actually changed so viewing a note doesn't re-date it
    return () => {
      clearTimeout(timer.current)
      const c = cur.current, orig = store.get().notes.find((n) => n.id === c.id)
      if (orig && (orig.title !== c.title || orig.body !== c.body)) actions.updateNote(c.id, { title: c.title, body: c.body })
    }
  }, [note.id])

  const remove = () => {
    const snapshot = store.get().notes.find((n) => n.id === note.id)
    clearTimeout(timer.current)
    actions.removeNote(note.id)
    toast('Note deleted', snapshot.title, () => actions.restoreNote(snapshot))
  }

  return (
    <div className="note-editor">
      <div className="note-editor-h">
        <button className="note-back" onClick={() => { save(); actions.setActiveNote(null) }} title="Back to notes"><ChevronLeft size={16} /></button>
        <input className="note-title" value={title} placeholder="Untitled"
          onChange={(e) => { setTitle(e.target.value); schedule() }} onBlur={save} />
        <button className="note-del" onClick={remove} title="Delete note"><Trash size={15} /></button>
      </div>
      <textarea ref={bodyRef} className="note-body" value={body} placeholder="Write your note…"
        onChange={(e) => { setBody(e.target.value); schedule() }} onBlur={save} />
    </div>
  )
}

// -- Solo Notes page: grouped list on the left, editor on the right.
function NotesPage() {
  const { notes, activeNote } = useStore()
  const sorted = [...notes].sort((a, b) => b.modified - a.modified)
  const active = notes.find((n) => n.id === activeNote)

  const groups = []
  for (const n of sorted) {
    const label = category(n.modified)
    const g = groups.at(-1)?.label === label ? groups.at(-1) : (groups.push({ label, notes: [] }), groups.at(-1))
    g.notes.push(n)
  }

  const newNote = () => { const n = actions.addNote(''); actions.setActiveNote(n.id) }

  return (
    <div className={'notes-page' + (active ? ' editing' : '')}>
      <div className="notes-list">
        <div className="notes-list-h">
          <span>{notes.length} note{notes.length === 1 ? '' : 's'}</span>
          <button className="notes-new" onClick={newNote}><Plus size={13} /> New</button>
        </div>
        <div className="notes-scroll">
          {sorted.length === 0
            ? <div className="empty">No notes yet.<br />Jot one on the overview, or hit New.</div>
            : groups.map((g) => (
                <div className="notes-group" key={g.label}>
                  <div className="notes-group-h">{g.label}</div>
                  {g.notes.map((n) => (
                    <button key={n.id} className={'note-row' + (n.id === activeNote ? ' on' : '')} onClick={() => actions.setActiveNote(n.id)}>
                      <span className="note-row-title">{n.title || 'Untitled'}</span>
                      <span className="note-row-prev">{preview(n.body)}</span>
                    </button>
                  ))}
                </div>
              ))}
        </div>
      </div>
      <div className="notes-detail">
        {active
          ? <Editor key={active.id} note={active} />
          : <div className="notes-detail-empty">Select a note, or create a new one.</div>}
      </div>
    </div>
  )
}

registerWidget({ id: 'notes', title: 'Notes', icon: NotesIcon, order: 40, span: 12, Widget: QuickNote, Page: NotesPage })
export default NotesPage
