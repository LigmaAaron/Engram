import { useState, useEffect } from 'react'
import { Clock, Plus, Close } from 'pixelarticons/react'
import { TimeField, DateInput, DateSegment } from 'react-aria-components'
import { Time } from '@internationalized/date'
import { useStore, actions, registerWidget } from '../core'

const DAY_LBL = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const toTimeValue = (str) => { if (!str) return null; const [h, m] = str.split(':').map(Number); return new Time(h, m) }
const fromTimeValue = (t) => t ? `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}` : ''
const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
const mins = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }

function TimeBox({ value, onChange, label }) {
  return (
    <TimeField aria-label={label} hourCycle={24} granularity="minute" value={toTimeValue(value)} onChange={(t) => onChange(fromTimeValue(t))}>
      <DateInput className="timefield">{(segment) => <DateSegment segment={segment} className="tf-seg" />}</DateInput>
    </TimeField>
  )
}

// Bell schedule: your class periods per weekday, with a live now/next readout.
function Schedule() {
  const { schedule } = useStore()
  const [name, setName] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [days, setDays] = useState([1, 2, 3, 4, 5])
  const [, setTick] = useState(0)
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 30000); return () => clearInterval(t) }, [])

  const now = new Date()
  const nowHM = hm(now)
  const today = schedule.filter((c) => c.days.includes(now.getDay())).sort((a, b) => a.start.localeCompare(b.start))
  const next = today.find((c) => c.start > nowHM)
  const status = (c) => {
    if (c.start <= nowHM && nowHM < c.end) return { txt: 'now', cls: 'now' }
    if (c === next) return { txt: `in ${mins(c.start) - mins(nowHM)}m`, cls: 'next' }
    return c.end <= nowHM ? { txt: 'done', cls: 'past' } : null
  }

  const add = () => {
    if (!name.trim() || !start || !end || !days.length) return
    actions.addClass(name.trim(), start, end, [...days].sort())
    setName(''); setStart(''); setEnd('')
  }
  const toggleDay = (d) => setDays((x) => x.includes(d) ? x.filter((y) => y !== d) : [...x, d])

  return (
    <>
      <div className="add-row sched-add">
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Add class…" />
        <TimeBox value={start} onChange={setStart} label="Start time" />
        <TimeBox value={end} onChange={setEnd} label="End time" />
        <button onClick={add} aria-label="Add class"><Plus size={15} /></button>
      </div>
      <div className="day-picks">
        {DAY_LBL.map((l, d) => (
          <button key={d} className={'day-pick' + (days.includes(d) ? ' on' : '')} onClick={() => toggleDay(d)}>{l}</button>
        ))}
      </div>
      {today.length === 0
        ? <div className="empty">{schedule.length ? 'No classes today.' : 'Add your class periods.'}</div>
        : <ul className="agenda">
            {today.map((c) => {
              const st = status(c)
              return (
                <li key={c.id} className={'ev' + (st?.cls === 'past' ? ' past' : '')}>
                  <span className="time">{c.start}–{c.end}</span>
                  <span className="title">{c.name}</span>
                  {st && <span className={'chip ' + st.cls}>{st.txt}</span>}
                  <button className="del" onClick={() => actions.removeClass(c.id)} aria-label="Remove class"><Close size={13} /></button>
                </li>
              )
            })}
          </ul>}
    </>
  )
}

registerWidget({ id: 'schedule', title: 'Schedule', icon: Clock, span: 12, Component: Schedule })
export default Schedule
