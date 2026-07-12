import { useState } from 'react'
import { ListBox, Checkbox, CheckboxOn, Plus, Close, Calendar as CalIcon, ChevronLeft, ChevronRight } from 'pixelarticons/react'
import {
  Button,
  Calendar,
  CalendarCell,
  CalendarGrid,
  DateInput,
  DatePicker,
  DateSegment,
  Dialog,
  Group,
  Heading,
  Popover
} from 'react-aria-components'
import { parseDate } from '@internationalized/date'
import { useStore, actions, registerWidget, isoDay, toast } from '../core'
import { extractTags } from '../parse'

// Homework-aware tasks: optional due date and a class tag
// typed inline as "#chem" anywhere in the text. Overdue = red date.
function Tasks() {
  const { tasks, ui } = useStore()
  const [text, setText] = useState('')
  const [due, setDue] = useState('')
  const today = isoDay()
  const shown = tasks
    .filter((t) => (t.text + ' ' + (t.tags || []).join(' ')).toLowerCase().includes(ui.search.toLowerCase()))
    .sort((a, b) => (a.done - b.done) || (a.due || '9999').localeCompare(b.due || '9999'))
  const add = () => {
    const { text: v, tags } = extractTags(text.trim(), actions.allTags())
    if (!v) return
    actions.addTask(v, due || undefined, tags)
    setText(''); setDue('')
  }
  const dueValue = due ? parseDate(due) : null

  return (
    <>
      <div className="add-row tasks-add-row">
        <input value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Add homework… (#class to tag)" />
        <DatePicker className="due-picker" aria-label="Due date" value={dueValue} onChange={(v) => setDue(v ? v.toString() : '')}>
          <Group className="due-group">
            <DateInput className="due-input" title="Due date">
              {(segment) => <DateSegment segment={segment} className="tf-seg" />}
            </DateInput>
            <Button className="due-btn" aria-label="Choose due date">
              <CalIcon size={14} />
            </Button>
            {due && (
              <button className="due-clear" type="button" aria-label="Clear due date" onClick={() => setDue('')}>
                <Close size={12} />
              </button>
            )}
          </Group>
          <Popover className="due-popover" placement="bottom end" offset={6}>
            <Dialog className="due-dialog">
              <Calendar>
                <header className="due-cal-head">
                  <Button slot="previous" aria-label="Previous month"><ChevronLeft size={14} /></Button>
                  <Heading className="due-cal-title" />
                  <Button slot="next" aria-label="Next month"><ChevronRight size={14} /></Button>
                </header>
                <CalendarGrid className="due-grid">
                  {(date) => <CalendarCell date={date} className="due-cell" />}
                </CalendarGrid>
              </Calendar>
            </Dialog>
          </Popover>
        </DatePicker>
        <button onClick={add}><Plus size={15} /></button>
      </div>
      {shown.length === 0
        ? <div className="empty">Nothing here. Add your first task.</div>
        : <ul className="task-list">
            {shown.map((t) => (
              <li key={t.id} className={'task' + (t.done ? ' done' : '')}>
                <span className="box" onClick={() => actions.toggleTask(t.id)}>
                  {t.done ? <CheckboxOn size={16} /> : <Checkbox size={16} />}
                </span>
                <span className="txt">{t.text}</span>
                {(t.tags || []).map((tag) => <span key={tag} className="chip">{tag}</span>)}
                {t.due && <span className={'chip due' + (!t.done && t.due < today ? ' late' : '')}>{t.due === today ? 'today' : t.due.slice(5)}</span>}
                <button className="del" aria-label={`Remove task ${t.text}`}
                  onClick={() => { actions.removeTask(t.id); toast('Task removed', t.text, () => actions.restoreTask(t)) }}><Close size={14} /></button>
              </li>
            ))}
          </ul>}
    </>
  )
}

registerWidget({ id: 'tasks', title: 'Tasks', icon: ListBox, span: 6, Component: Tasks })
export default Tasks
