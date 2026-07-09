import { useState } from 'react'
import { Calendar as CalIcon, Plus, Close, ChevronLeft, ChevronRight, Reload } from 'pixelarticons/react'
import { TimeField, DateInput, DateSegment } from 'react-aria-components'
import { Time } from '@internationalized/date'
import { useStore, actions, registerWidget, isoDay, occursOn } from '../core'

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// Our event schema stores time as a plain "HH:MM" string; React Aria's TimeField
// works in terms of @internationalized/date's Time value, so convert at the edges.
const toTimeValue = (str) => {
  if (!str) return null
  const [h, m] = str.split(':').map(Number)
  return new Time(h, m)
}
const fromTimeValue = (t) => t ? `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}` : ''

function Calendar() {
  const { events } = useStore()
  const [view, setView] = useState(new Date())
  const [time, setTime] = useState('')
  const [title, setTitle] = useState('')

  // Quick-add makes a one-off event today; recurring events (repeat/skip/end)
  // are managed through the chat agent — that's what it's for.
  const add = () => { if (time && title.trim()) { actions.addEvent(time, title.trim()); setTitle('') } }
  const today = isoDay()
  const agenda = events.filter((e) => occursOn(e, today)).sort((a, b) => a.time.localeCompare(b.time))

  const y = view.getFullYear(), m = view.getMonth()
  const first = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate(), t = new Date()
  const isToday = (d) => d === t.getDate() && m === t.getMonth() && y === t.getFullYear()
  const hasEvent = (d) => events.some((e) => occursOn(e, isoDay(new Date(y, m, d))))
  const lead = first.getDay(), trail = (7 - ((lead + days) % 7)) % 7
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1), ...Array(trail).fill(null)]

  return (
    <div className="cal-layout">
      <div className="cal-events">
        <div className="add-row">
          <TimeField aria-label="Event time" hourCycle={24} granularity="minute"
            value={toTimeValue(time)} onChange={(t) => setTime(fromTimeValue(t))}>
            <DateInput className="timefield">
              {(segment) => <DateSegment segment={segment} className="tf-seg" />}
            </DateInput>
          </TimeField>
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Add event…" />
          <button onClick={add} aria-label="Add event"><Plus size={15} /></button>
        </div>
        {agenda.length === 0
          ? <div className="empty">No events today.</div>
          : <ul className="agenda">
              {agenda.map((ev) => (
                <li key={ev.id} className="ev">
                  <span className="time">{ev.time}</span>
                  <span className="title">{ev.title}</span>
                  {ev.repeat && <span className="rep" title={'Recurring' + (ev.repeat.until ? ` until ${ev.repeat.until}` : '')}><Reload size={12} /></span>}
                  <button className="del" onClick={() => actions.removeEvent(ev.id)} aria-label="Remove event"><Close size={13} /></button>
                </li>
              ))}
            </ul>}
      </div>
      <div className="cal-month">
        <div className="cal-head">
          <button onClick={() => setView(new Date(y, m - 1, 1))} aria-label="Previous month"><ChevronLeft size={16} /></button>
          <strong>{first.toLocaleString(undefined, { month: 'long', year: 'numeric' })}</strong>
          <button onClick={() => setView(new Date(y, m + 1, 1))} aria-label="Next month"><ChevronRight size={16} /></button>
        </div>
        <div className="cal-grid">
          {DOW.map((d, i) => <div className="dow" key={i}>{d}</div>)}
          {cells.map((d, i) => (
            <div key={i} className={'day' + (d == null ? ' muted' : '') + (d && isToday(d) ? ' today' : '') + (d && hasEvent(d) ? ' has' : '')}>{d}</div>
          ))}
        </div>
      </div>
    </div>
  )
}

registerWidget({ id: 'calendar', title: 'Today', icon: CalIcon, span: 12, Component: Calendar })
export default Calendar
