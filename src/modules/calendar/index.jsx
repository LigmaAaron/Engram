import { useState, useEffect } from 'react'
import { Calendar as CalIcon, Plus, Close, ChevronLeft, ChevronRight, Reload, Forward, Checkbox, CheckboxOn } from 'pixelarticons/react'
import { TimeField, DateInput, DateSegment } from 'react-aria-components'
import { Time } from '@internationalized/date'
import { useStore, actions, registerWidget, isoDay, occursOn, toast } from '../../core'

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WEEKDAYS = [1, 2, 3, 4, 5]
const WEEKEND = [0, 6]
const GUTTER = 44 // px reserved for hour labels on the timeline

// Plain-English recurrence for a timeblock chip: "every day", "every weekend",
// "every weekday except Wednesday", or a fallback list of day names.
function describeRecurrence(days) {
  if (!days || days.length === 7) return 'every day'
  if (days.length === 1) return `every ${DAY_NAME[days[0]]}`
  const sorted = [...days].sort()
  if (sorted.length === 5 && WEEKDAYS.every((d) => sorted.includes(d))) return 'every weekday'
  if (sorted.length === 2 && WEEKEND.every((d) => sorted.includes(d))) return 'every weekend'
  if (sorted.length === 4 && sorted.every((d) => WEEKDAYS.includes(d))) {
    return `every weekday except ${DAY_NAME[WEEKDAYS.find((d) => !sorted.includes(d))]}`
  }
  return 'every ' + sorted.map((d) => DAY_NAME[d].slice(0, 3)).join(', ')
}
// Classes always recur weekly on c.days. Events only recur via repeat (absent
// repeat.days means daily); their skip/end fields don't change the phrase.
const recurrenceLabel = (b) => b.kind === 'class' ? describeRecurrence(b.raw.days) : (b.raw.repeat ? describeRecurrence(b.raw.repeat.days) : null)

// Our event schema stores time as a plain "HH:MM" string; React Aria's TimeField
// works in terms of @internationalized/date's Time value, so convert at the edges.
const toTimeValue = (str) => {
  if (!str) return null
  const [h, m] = str.split(':').map(Number)
  return new Time(h, m)
}
const fromTimeValue = (t) => t ? `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}` : ''
const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

function TimeBox({ value, onChange, label }) {
  return (
    <TimeField aria-label={label} hourCycle={24} granularity="minute" value={toTimeValue(value)} onChange={(t) => onChange(fromTimeValue(t))}>
      <DateInput className="timefield">{(segment) => <DateSegment segment={segment} className="tf-seg" />}</DateInput>
    </TimeField>
  )
}

// Colliding blocks share the row: group transitively-overlapping blocks into a
// cluster, greedily assign each block the first free column, then every block
// in the cluster gets 1/n of the width.
// ponytail: equal-width columns; fancy expand-to-fill layout if it ever looks cramped.
function layoutBlocks(items) {
  const sorted = [...items].sort((a, b) => a.startM - b.startM || b.endM - a.endM)
  const out = []
  let cluster = [], colEnds = [], clusterEnd = -1
  const flush = () => {
    const n = colEnds.length
    cluster.forEach((b) => out.push({ ...b, left: b.col / n, width: 1 / n }))
    cluster = []; colEnds = []
  }
  for (const b of sorted) {
    if (cluster.length && b.startM >= clusterEnd) flush()
    let col = colEnds.findIndex((e) => e <= b.startM)
    if (col === -1) { col = colEnds.length; colEnds.push(0) }
    colEnds[col] = b.endM
    cluster.push({ ...b, col })
    clusterEnd = Math.max(clusterEnd, b.endM)
  }
  flush()
  return out
}

// Cell array for a month view: leading/trailing nulls pad to full weeks.
function monthCells(view) {
  const y = view.getFullYear(), m = view.getMonth()
  const first = new Date(y, m, 1), count = new Date(y, m + 1, 0).getDate()
  const lead = first.getDay(), trail = (7 - ((lead + count) % 7)) % 7
  return { y, m, first, cells: [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => i + 1), ...Array(trail).fill(null)] }
}

// Add-event/class form for the selected day. Shared by the overview widget and
// the Today page. "Repeats" checked = recurring class on the picked days;
// unchecked = a one-off event on the selected day. Leaves recurring/days as-is
// after add, so setting up several classes in a row doesn't require re-checking.
function AddForm({ sel }) {
  const [title, setTitle] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [recurring, setRecurring] = useState(false)
  const [days, setDays] = useState([1, 2, 3, 4, 5])
  const add = () => {
    if (!title.trim() || !start) return
    if (recurring && days.length) actions.addClass(title.trim(), start, end || fmt(mins(start) + 60), [...days].sort())
    else actions.addEvent(start, title.trim(), isoDay(sel), undefined, end || undefined)
    setTitle(''); setStart(''); setEnd('')
  }
  const toggleDay = (d) => setDays((x) => x.includes(d) ? x.filter((y) => y !== d) : [...x, d])
  return (
    <>
      <div className="add-row today-add">
        <input value={title} onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Add event or class…" />
        <TimeBox value={start} onChange={setStart} label="Start time" />
        <TimeBox value={end} onChange={setEnd} label="End time" />
        <button onClick={add} aria-label="Add"><Plus size={15} /></button>
      </div>
      <label className="repeat-toggle">
        <span className="box" onClick={() => setRecurring((r) => !r)}>
          {recurring ? <CheckboxOn size={14} /> : <Checkbox size={14} />}
        </span>
        Repeats weekly
      </label>
      <div className={'repeat-days-wrap' + (recurring ? ' open' : '')}>
        <div className="repeat-days-inner">
          <div className="day-picks">
            {DOW.map((l, d) => (
              <button key={d} className={'day-pick' + (days.includes(d) ? ' on' : '')} onClick={() => toggleDay(d)}>{l}</button>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

// The selected day's classes + events as duration-sized blocks on an hour
// ruler. `hour` = px per hour (the Today page's rail uses a taller scale).
function DayTimeline({ sel, hour = 44 }) {
  const { events, schedule } = useStore()
  const [, setTick] = useState(0)
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 30000); return () => clearInterval(t) }, [])

  const selIso = isoDay(sel)
  const selIsToday = selIso === isoDay()  // past/current/now-line only make sense today
  const now = new Date()
  const nowM = now.getHours() * 60 + now.getMinutes()

  // Classes and events on the selected day's timeline. Events without an end get a 1h block.
  const items = [
    ...schedule.filter((c) => c.days.includes(sel.getDay()) && !c.except?.includes(selIso))
      .map((c) => ({ kind: 'class', id: c.id, title: c.name, startM: mins(c.start), endM: mins(c.end), raw: c })),
    ...events.filter((e) => occursOn(e, selIso))
      .map((e) => ({ kind: 'event', id: e.id, title: e.title, startM: mins(e.time), endM: e.end ? mins(e.end) : mins(e.time) + 60, raw: e })),
  ].map((b) => ({ ...b, endM: Math.max(b.endM, b.startM + 15) }))

  const blocks = layoutBlocks(items)
  const h0 = items.length ? Math.min(...items.map((b) => Math.floor(b.startM / 60))) : 0
  const h1 = items.length ? Math.max(...items.map((b) => Math.ceil(b.endM / 60))) : 0

  const removeForever = (b) => {
    if (b.kind === 'class') { actions.removeClass(b.id); toast('Class removed', b.title, () => actions.restoreClass(b.raw)) }
    else { actions.removeEvent(b.id); toast('Event removed', b.title, () => actions.restoreEvent(b.raw)) }
  }
  // Only offered on recurring blocks — leaves the class/event itself intact,
  // just marks the selected day as an exception (e.g. no school). Undo un-marks it.
  const skipToday = (b) => {
    if (b.kind === 'class') { actions.skipClass(b.id, selIso); toast('Skipped', b.title, () => actions.unskipClass(b.id, selIso)) }
    else { actions.skipEvent(b.id, selIso); toast('Skipped', b.title, () => actions.unskipEvent(b.id, selIso)) }
  }

  if (items.length === 0) return <div className="empty">Nothing scheduled.</div>
  return (
    <div className="timeline" style={{ height: (h1 - h0) * hour + 14 }}>
      {Array.from({ length: h1 - h0 + 1 }, (_, i) => h0 + i).map((h) => (
        <div key={h} className="tl-hour" style={{ top: (h - h0) * hour }}>{fmt(h * 60)}</div>
      ))}
      {blocks.map((b) => {
        const past = selIsToday && b.endM <= nowM, current = selIsToday && b.startM <= nowM && nowM < b.endM
        const recur = recurrenceLabel(b)
        const until = b.kind === 'event' && b.raw.repeat?.until ? ` until ${b.raw.repeat.until}` : ''
        return (
          <div key={b.kind + b.id}
            className={'tl-block' + (past ? ' past' : '') + (current ? ' now' : '')}
            style={{
              top: (b.startM - h0 * 60) / 60 * hour,
              height: Math.max((b.endM - b.startM) / 60 * hour - 2, 18),
              left: `calc(${GUTTER}px + ${b.left} * (100% - ${GUTTER}px))`,
              width: `calc(${b.width} * (100% - ${GUTTER}px) - 3px)`,
            }}>
            <span className="tl-time">{fmt(b.startM)}–{fmt(b.endM)}</span>
            <span className="tl-title">{b.title}</span>
            {recur && (
              <span className="chip tl-recur" title={recur + until}>
                <Reload size={9} />{recur}
              </span>
            )}
            <span className="tl-actions">
              {recur && (
                <button aria-label={`Skip ${b.title} today only`} title="Skip today only — keeps repeating after"
                  onClick={() => skipToday(b)}><Forward size={12} /></button>
              )}
              <button className="del" aria-label={recur ? `Remove ${b.title} permanently` : `Remove ${b.title}`}
                title={recur ? 'Remove permanently — all future occurrences' : undefined}
                onClick={() => removeForever(b)}><Close size={12} /></button>
            </span>
          </div>
        )
      })}
      {selIsToday && h0 * 60 <= nowM && nowM <= h1 * 60 && <div className="tl-now" style={{ top: (nowM - h0 * 60) / 60 * hour }} />}
    </div>
  )
}

// Overview widget: the original compact two-column split — time blocks on the
// left, small month grid on the right. Deliberately untouched by the Today
// page's layout; they share only AddForm/DayTimeline.
function TodayCompact() {
  const { events } = useStore()
  const [view, setView] = useState(new Date())
  const [sel, setSel] = useState(new Date())   // day whose timeline is shown
  const selIsToday = isoDay(sel) === isoDay()

  const { y, m, first, cells } = monthCells(view)
  const t = new Date()
  const isToday = (d) => d === t.getDate() && m === t.getMonth() && y === t.getFullYear()
  const isSel = (d) => d === sel.getDate() && m === sel.getMonth() && y === sel.getFullYear()
  const hasEvent = (d) => events.some((e) => occursOn(e, isoDay(new Date(y, m, d))))

  return (
    <div className="cal-layout">
      <div className="cal-events">
        <div className="cal-sel-day">
          {selIsToday ? 'Today' : sel.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
          {!selIsToday && <button className="link" onClick={() => { setSel(new Date()); setView(new Date()) }}>Today</button>}
        </div>
        <AddForm sel={sel} />
        <DayTimeline sel={sel} />
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
            <div key={i} onClick={() => d && setSel(new Date(y, m, d))}
              className={'day' + (d == null ? ' muted' : '') + (d && isToday(d) ? ' today' : '') + (d && isSel(d) ? ' sel' : '') + (d && hasEvent(d) ? ' has' : '')}>{d}</div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Today page: the full-screen calendar. Big month grid on the left with event
// titles inside the day cells; a day rail on the right with prev/next-day
// stepping, the add form, and a taller hour timeline. Own tp-* markup/CSS so
// it can evolve without touching the overview widget above.
function TodayPage() {
  const { events } = useStore()
  const [view, setView] = useState(new Date())
  const [sel, setSel] = useState(new Date())

  const { y, m, first, cells } = monthCells(view)
  const weeks = cells.length / 7
  const selIso = isoDay(sel), todayIso = isoDay()
  const today = new Date()
  const offToday = selIso !== todayIso || y !== today.getFullYear() || m !== today.getMonth()

  // Events shown inside a month cell (classes stay off the grid — they repeat
  // every school day and would fill every cell with the same noise).
  const evsOn = (d) => events.filter((e) => occursOn(e, isoDay(new Date(y, m, d)))).sort((a, b) => mins(a.time) - mins(b.time))
  const stepDay = (n) => { const d = new Date(sel); d.setDate(d.getDate() + n); setSel(d); setView(new Date(d.getFullYear(), d.getMonth(), 1)) }
  const goToday = () => { setSel(new Date()); setView(new Date()) }

  return (
    <div className="tp">
      <div className="tp-month">
        <div className="tp-mhead">
          <strong>{first.toLocaleString(undefined, { month: 'long', year: 'numeric' })}</strong>
          {offToday && <button className="link" onClick={goToday}>Today</button>}
          <button className="nav" onClick={() => setView(new Date(y, m - 1, 1))} aria-label="Previous month"><ChevronLeft size={16} /></button>
          <button className="nav" onClick={() => setView(new Date(y, m + 1, 1))} aria-label="Next month"><ChevronRight size={16} /></button>
        </div>
        <div className="tp-grid" style={{ gridTemplateRows: `auto repeat(${weeks}, minmax(72px, 1fr))` }}>
          {DOW3.map((d) => <div className="dow" key={d}>{d}</div>)}
          {cells.map((d, i) => {
            if (d == null) return <div key={i} className="tp-cell muted" />
            const iso = isoDay(new Date(y, m, d))
            const evs = evsOn(d)
            return (
              <div key={i} className={'tp-cell' + (iso === todayIso ? ' today' : '') + (iso === selIso ? ' sel' : '')}
                onClick={() => setSel(new Date(y, m, d))}>
                <span className="num">{d}</span>
                {evs.slice(0, 3).map((e) => (
                  <span key={e.id} className="tp-evt"><span className="t">{e.time}</span> {e.title}</span>
                ))}
                {evs.length > 3 && <span className="tp-more">+{evs.length - 3} more</span>}
              </div>
            )
          })}
        </div>
      </div>
      <aside className="tp-rail">
        <div className="tp-rhead">
          <button className="nav" onClick={() => stepDay(-1)} aria-label="Previous day"><ChevronLeft size={14} /></button>
          <strong>{selIso === todayIso ? 'Today' : sel.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</strong>
          <button className="nav" onClick={() => stepDay(1)} aria-label="Next day"><ChevronRight size={14} /></button>
        </div>
        <AddForm sel={sel} />
        <div className="tp-scroll"><DayTimeline sel={sel} hour={52} /></div>
      </aside>
    </div>
  )
}

registerWidget({
  id: 'calendar', title: 'Calendar', icon: CalIcon, order: 30, span: 12, Widget: TodayCompact, Page: TodayPage,
  nav: { badge: (s) => s.events.filter((e) => occursOn(e, isoDay())).length },
})
export default TodayPage
