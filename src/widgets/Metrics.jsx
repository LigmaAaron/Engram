import { Chart, CheckboxOn, ListBox, Fire, Calendar } from 'pixelarticons/react'
import { useStore, registerWidget } from '../core'

function Metrics() {
  const { tasks, events, streak } = useStore()
  const done = tasks.filter((t) => t.done).length
  const open = tasks.length - done
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0

  const tiles = [
    { icon: CheckboxOn, num: done, lbl: 'Completed', delta: tasks.length ? `${pct}% done` : '—', up: true },
    { icon: ListBox, num: open, lbl: 'Open tasks', delta: open ? 'in progress' : 'all clear' },
    { icon: Fire, num: streak.count, lbl: 'Day streak', delta: streak.count > 1 ? 'keep it up' : 'day 1', up: true },
    { icon: Calendar, num: events.length, lbl: "Today's events", delta: 'on the agenda' },
  ]

  return (
    <>
      <div className="stat-grid">
        {tiles.map((t, i) => (
          <div className="stat" key={i}>
            <t.icon size={16} />
            <div className="num">{t.num}</div>
            <div className="lbl">{t.lbl}</div>
            <div className={'delta ' + (t.up ? 'up' : 'flat')}>{t.delta}</div>
          </div>
        ))}
      </div>
      <div className="bar"><i style={{ width: pct + '%' }} /></div>
      <div className="bar-cap"><span>Task completion</span><span>{done}/{tasks.length}</span></div>
    </>
  )
}

registerWidget({ id: 'metrics', title: 'Metrics', icon: Chart, span: 6, Component: Metrics })
export default Metrics
