import { useState, useRef, useEffect } from 'react'
import { Message, Send, Trash, Plus, Square, Copy, Reload, Close, Download, FileText, Lightbulb, LightbulbOff } from 'pixelarticons/react'
import { useStore, actions, store, registerWidget, notify, emit, on, isoDay, occursOn } from '../core'
import { parseTaskInput, parseDue, parseTags, reuseTags } from '../parse'
import Md from '../md'
import Dropdown from '../Dropdown'

// The dashboard is its own AI agent: chat runs a local Ollama model and lets it
// change the dashboard directly (events, homework, schedule, notes, reminders…).
// It reads a memory file into every system prompt and can append to it via
// `remember`, search the web via the dev-server proxy, and write markdown
// documents that show up as artifacts on the chat.

// 'mon,wed' → [1,3]; 'daily' → null (repeat with no day filter)
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const parseDays = (s) => {
  if (!s || /daily/i.test(s)) return null
  const days = s.toLowerCase().split(/[,\s]+/).map((w) => DAY_NAMES.findIndex((d) => w.startsWith(d))).filter((i) => i >= 0)
  return days.length ? days : null
}
// 'HH:MM' (today) or 'YYYY-MM-DD HH:MM' → epoch ms
const parseAt = (s) => {
  s = s.trim()
  if (/^\d{1,2}:\d{2}$/.test(s)) s = `${isoDay()}T${s}`
  const t = new Date(s.replace(' ', 'T')).getTime()
  if (isNaN(t)) throw new Error(`can't parse time "${s}"`)
  return t
}

// Look up an item by id in a state array, throwing if absent — so the model
// can't invent an id, get a silent no-op, and then "confirm" a change that
// never happened. run() feeds the thrown message back as the tool result.
const byId = (key, id, kind) => {
  const x = store.get()[key].find((e) => e.id === id)
  if (!x) throw new Error(`no ${kind} with id ${id}`)
  return x
}

// tool name -> { desc, params ('?'-suffixed key = optional), run }
// run returns a string describing what actually changed; it's fed back to the
// model, which must ground its confirmation on it (never on its own guess).
const TOOLS = {
  add_task:     { desc: 'add a homework/to-do task; #hashtags in text become tags and natural-language dates ("tomorrow", "next Friday", "7/18") are detected automatically', params: { text: 'string', 'due?': 'string YYYY-MM-DD', 'tags?': 'string comma-separated, e.g. "chem, lab"' }, run: (a) => {
    const existing = actions.allTags()
    const p = parseTaskInput(a.text || '', existing)
    const tags = reuseTags([...(a.tags ? parseTags(a.tags, existing) : []), ...p.tags], existing)
    const due = a.due || p.due
    actions.addTask(p.text, due, tags)
    const t = store.get().tasks[0]
    return `added task #${t.id}: "${t.text}"${t.due ? ` due ${t.due}` : ''}${t.tags?.length ? ` [${t.tags.join(', ')}]` : ''}`
  } },
  toggle_task:  { desc: 'toggle a task done/undone by id', params: { id: 'number' }, run: (a) => { const t = byId('tasks', a.id, 'task'); actions.toggleTask(a.id); return `task #${a.id} "${t.text}" is now ${t.done ? 'not done' : 'done'}` } },
  remove_task:  { desc: 'delete a task by id', params: { id: 'number' }, run: (a) => { const t = byId('tasks', a.id, 'task'); actions.removeTask(a.id); return `removed task #${a.id} "${t.text}"` } },
  add_event:    { desc: 'add a calendar event; give days/until to make it recurring', params: { time: 'string 24h HH:MM', title: 'string', 'end?': 'string 24h HH:MM end time (omit for a 1h block)', 'date?': 'string YYYY-MM-DD, omit for today; for recurring this is the start date', 'days?': 'string "daily" or weekdays like "mon,wed,fri" for weekly', 'until?': 'string YYYY-MM-DD last day of a recurring event' }, run: (a) => { actions.addEvent(a.time, a.title, a.date, (a.days || a.until) ? { ...(parseDays(a.days) ? { days: parseDays(a.days) } : {}), ...(a.until ? { until: a.until } : {}) } : undefined, a.end); const e = store.get().events.at(-1); return `added event #${e.id}: ${e.time} ${e.title} on ${e.date}${e.repeat ? ' (recurring)' : ''}` } },
  remove_event: { desc: 'delete an event entirely by id', params: { id: 'number' }, run: (a) => { const e = byId('events', a.id, 'event'); actions.removeEvent(a.id); return `removed event #${a.id} "${e.title}"` } },
  skip_event:   { desc: 'skip one date of a recurring event (e.g. no school that day)', params: { id: 'number', date: 'string YYYY-MM-DD' }, run: (a) => { const e = byId('events', a.id, 'event'); if (!e.repeat) throw new Error(`event #${a.id} is not recurring`); actions.skipEvent(a.id, a.date); return `event #${a.id} "${e.title}" skipped on ${a.date}` } },
  end_event:    { desc: 'end a recurring event after a date', params: { id: 'number', until: 'string YYYY-MM-DD last day it still happens' }, run: (a) => { const e = byId('events', a.id, 'event'); if (!e.repeat) throw new Error(`event #${a.id} is not recurring`); actions.endEvent(a.id, a.until); return `event #${a.id} "${e.title}" now ends after ${a.until}` } },
  add_class:    { desc: 'add a class period to the school schedule', params: { name: 'string', start: 'string HH:MM', end: 'string HH:MM', 'days?': 'string weekdays like "mon,tue,wed,thu,fri" (default mon-fri)' }, run: (a) => { actions.addClass(a.name, a.start, a.end, parseDays(a.days) || undefined); const c = store.get().schedule.at(-1); return `added class #${c.id}: ${c.name} ${c.start}–${c.end}` } },
  remove_class: { desc: 'remove a class period by id', params: { id: 'number' }, run: (a) => { const c = byId('schedule', a.id, 'class'); actions.removeClass(a.id); return `removed class #${a.id} "${c.name}"` } },
  skip_class:   { desc: 'skip one date of a class (e.g. no school that day) without removing the class period', params: { id: 'number', date: 'string YYYY-MM-DD' }, run: (a) => { const c = byId('schedule', a.id, 'class'); actions.skipClass(a.id, a.date); return `class #${a.id} "${c.name}" skipped on ${a.date}` } },
  append_note:  { desc: 'append a line to the quick-notes pad', params: { text: 'string' }, run: (a) => { actions.setNotes((store.get().notes + '\n' + a.text).trim()); return `appended note: "${a.text}"` } },
  remind:       { desc: 'schedule a reminder notification for a specific time', params: { at: 'string HH:MM for today, or YYYY-MM-DD HH:MM', title: 'string', 'body?': 'string' }, run: (a) => { actions.remind(parseAt(a.at), a.title, a.body); const r = store.get().reminders.at(-1); return `reminder set for ${new Date(r.at).toLocaleString()}: ${r.title}` } },
  web_search:   { desc: 'search the web; returns top results as JSON (title, url, snippet)', params: { query: 'string' }, run: async (a) => {
    const r = await fetch('/__search?q=' + encodeURIComponent(a.query))
    if (!r.ok) throw new Error('search failed')
    return (await r.text()).slice(0, 4000)
  } },
  write_document: { desc: 'create or update a markdown document in the chat artifacts panel — for durable content Aaron keeps (essays, study guides, plans), not for restating dashboard state. Write plain clean markdown: headings, short paragraphs, lists. No emoji, no decorative tables, no fake links/buttons; include only sections with real content.', params: { title: 'string short title; reuse a title to update that document', content: 'string full markdown' }, run: (a) => { actions.saveArtifact(a.title, a.content); return `saved document "${a.title}"` } },
  add_link:     { desc: 'add a quick-launch link', params: { label: 'string', url: 'string', 'icon?': 'string' }, run: (a) => { actions.addLink(a.label, a.url, a.icon || 'ExternalLink'); return `added link ${a.label}` } },
  notify:       { desc: 'show a notification right now', params: { title: 'string', 'body?': 'string' }, run: (a) => { notify(a.title, a.body || ''); return `notified: ${a.title}` } },
  remember:     { desc: 'save a durable fact or preference about Aaron to long-term memory', params: { note: 'string' }, run: async (a) => { const r = await fetch('/__memory', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: a.note }); if (!r.ok) throw new Error('memory save failed'); return `remembered: "${a.note}"` } },
}

const toolSpec = Object.entries(TOOLS).map(([name, { desc, params }]) => ({
  type: 'function',
  function: {
    name,
    description: desc,
    parameters: {
      type: 'object',
      properties: Object.fromEntries(Object.entries(params).map(([k, ty]) => [k.replace('?', ''), { type: ty.startsWith('number') ? 'number' : 'string', description: ty }])),
      required: Object.keys(params).filter((k) => !k.endsWith('?')),
    },
  },
}))

const systemPrompt = (s, memory, extra) => {
  const now = new Date()
  const today = isoDay(now)
  return [
    "You are AaronOS, the assistant built into Aaron's personal dashboard. Aaron is a student — help with school. Change the dashboard directly by calling tools; don't just describe what to do.",
    'Use ids from the state below for toggle/remove/skip/end; never invent them. Recurring events: days+until on add_event; skip_event for one-day exceptions (like no school); end_event to stop one. When Aaron tells you a lasting preference or fact, call remember. Use web_search when you need current or factual info you are unsure about, and cite result URLs. Use write_document for anything long (essays, study guides) instead of dumping it in chat. After acting, reply briefly in markdown confirming what you did.',
    '',
    'Where things live: tasks = untimed to-dos; events = anything with a time on the calendar; notes = freeform text; long-term memory = durable preferences/facts only, never calendar or task data. Never claim you added, saved, changed, or deleted something unless a tool call this turn returned a result confirming it — if you have not called the tool, call it; do not just assert the outcome.',
    ...(extra ? ['', extra] : []),
    '',
    `Now: ${today} (${DAY_NAMES[now.getDay()]}) ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    '',
    'Long-term memory (persisted across chats):',
    memory.trim() || '(empty)',
    '',
    'Current dashboard state:',
    JSON.stringify({
      tasks: s.tasks.map((t) => ({ id: t.id, text: t.text, done: t.done, due: t.due, tags: t.tags })),
      events: s.events.map((e) => ({ id: e.id, time: e.time, title: e.title, date: e.date, repeat: e.repeat })),
      todays_agenda: s.events.filter((e) => occursOn(e, today)).map((e) => `${e.time} ${e.title}`),
      class_schedule: s.schedule.map((c) => ({ id: c.id, name: c.name, start: c.start, end: c.end, days: c.days.map((d) => DAY_NAMES[d]) })),
      notes: s.notes,
      reminders: s.reminders.map((r) => ({ id: r.id, at: new Date(r.at).toLocaleString(), title: r.title })),
      links: s.links.map((l) => l.label),
    }),
  ].join('\n')
}

// Stream Ollama's /api/chat NDJSON. `think` variants are tried in order because
// support differs per model: effort strings (gpt-oss) → boolean (qwen) → none.
async function streamChat(messages, { model, think }, signal, onDelta) {
  const variants = think === false ? [false, undefined] : [think, true, undefined]
  let res
  for (const v of variants) {
    res = await fetch('/ollama/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, tools: toolSpec, stream: true, options: { temperature: 0.2 }, ...(v === undefined ? {} : { think: v }) }),
      signal,
    })
    if (res.ok) break
  }
  if (!res.ok || !res.body) throw new Error(`Ollama HTTP ${res.status}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = '', content = '', thinking = '', toolCalls = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      let chunk
      try { chunk = JSON.parse(line) } catch { continue }
      const msg = chunk.message
      if (msg?.thinking) thinking += msg.thinking
      if (msg?.content) content += msg.content
      if (msg?.thinking || msg?.content) onDelta({ content, thinking })
      if (msg?.tool_calls?.length) toolCalls.push(...msg.tool_calls)
    }
  }
  return { role: 'assistant', content, thinking, tool_calls: toolCalls }
}

// Slash commands: Aaron picks the task, so no model classification step to get
// wrong. `run` executes directly (no LLM — can't be faked); `prompt` injects
// task-specific guidance into the system prompt and the rest of the line is the
// request. `/task buy milk` -> direct add; `/essay photosynthesis` -> LLM with guidance.
const COMMANDS = {
  task:       { desc: 'add a task',         task: true }, // createTask parses #tags/dates and infers the rest
  essay:      { desc: 'write an essay',      prompt: 'Write a well-structured essay with write_document. Plain markdown, no emoji.' },
  studyguide: { desc: 'make a study guide',  prompt: 'Make a concise study guide with write_document. Prefer lists over tables; no emoji.' },
  plan:       { desc: 'plan/adjust today',   prompt: "Adjust today's schedule using tools. Do NOT write a document restating dashboard state." },
}

// After a task is created, ask the model once to fill only the metadata the
// deterministic parser couldn't (semantic tags, fuzzy dates). Best-effort: the
// task already exists, so any failure just leaves it as parsed. `format: 'json'`
// keeps a 9B on the rails; existing tags are passed so it reuses over inventing.
async function inferTaskMeta(id, title, need) {
  const existing = actions.allTags()
  const prompt = `Task: "${title}". Today is ${isoDay()}. Existing tags: ${existing.join(', ') || '(none)'}.\n`
    + 'Reply ONLY JSON like {"tags":["x"],"due":"YYYY-MM-DD or null"}. '
    + 'Prefer an existing tag; add a new one only if none fits. Set due only if the task clearly implies a deadline.'
  try {
    const { model } = store.get().settings
    const res = await fetch('/ollama/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], stream: false, format: 'json', options: { temperature: 0.1 } }),
    })
    if (!res.ok) return
    const out = JSON.parse((await res.json()).message?.content || '{}')
    const patch = {}
    if (need.tags && Array.isArray(out.tags) && out.tags.length) patch.tags = reuseTags(out.tags, existing)
    if (need.due && typeof out.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(out.due)) patch.due = out.due
    if (Object.keys(patch).length) actions.updateTask(id, patch)
  } catch { /* leave the task as parsed */ }
}

// Add a task from a free-text title (parses #tags + natural-language dates),
// firing AI inference only for what the parser left blank. Returns the new task,
// or null if empty. Shared by the chat's /task and the overview command bar.
function addTaskFromTitle(title, tagsField = '', dateField = '') {
  title = title.trim()
  if (!title) return null
  const existing = actions.allTags()
  const p = parseTaskInput(title, existing)
  const tags = reuseTags([...(tagsField ? parseTags(tagsField, existing) : []), ...p.tags], existing)
  let due = p.due
  if (dateField.trim()) { const d = parseDue(dateField); due = d.due || (/^\d{4}-\d{2}-\d{2}$/.test(dateField.trim()) ? dateField.trim() : due) }
  actions.addTask(p.text, due || undefined, tags)
  const t = store.get().tasks[0]
  if (!tags.length || !due) inferTaskMeta(t.id, p.text, { tags: !tags.length, due: !due })
  return t
}

// Run the agent loop with no chat UI and nothing saved: tools fire (so the
// dashboard changes), and the final reply is surfaced as a notification. Used
// by the overview command bar's slash commands. Mirrors run()'s loop minus the
// live streaming, message persistence, and fabricated-confirmation nudge.
export async function runBackground(userText, extra) {
  const { model, think, effort } = store.get().settings
  const memory = await fetch('/__memory').then((r) => r.text()).catch(() => '')
  const sys = () => ({ role: 'system', content: systemPrompt(store.get(), memory, extra) })
  const convo = [sys(), { role: 'user', content: userText }]
  for (let round = 0; round < 8; round++) {
    const msg = await streamChat(convo, { model, think: think ? effort : false }, undefined, () => {})
    convo.push(msg)
    if (msg.tool_calls?.length) {
      for (const call of msg.tool_calls) {
        const tool = TOOLS[call.function.name]
        let result = 'unknown tool'
        if (tool) { try { result = (await tool.run(call.function.arguments || {})) ?? 'ok' } catch (e) { result = 'error: ' + e.message } }
        convo.push({ role: 'tool', content: String(result) })
      }
      convo[0] = sys()
      continue
    }
    notify('AaronOS', (msg.content || 'done').slice(0, 240))
    break
  }
}

// Bridge from the overview command bar to the Chat tab, which may not be mounted
// yet. Stash the prompt, switch to the chat view, and ping; Chat consumes it on
// mount (covers the pre-mount case) and on the event (covers already-mounted).
let queuedPrompt = null
export const queuePrompt = (raw) => { queuedPrompt = raw; actions.setView('chat'); emit('chat:queued') }

const EFFORTS = ['low', 'medium', 'high']

function Chat() {
  const { chats, activeChat, settings } = useStore()
  const chat = chats.find((c) => c.id === activeChat) || chats[0] || { messages: [], artifacts: [] }
  const [text, setText] = useState('')
  const [live, setLive] = useState(null) // null = idle, { content, thinking } = streaming
  const [models, setModels] = useState([])
  const [openArt, setOpenArt] = useState(null) // artifact title or null
  const logRef = useRef(null)
  const inputRef = useRef(null)
  const abortRef = useRef(null)
  const liveRef = useRef(null) // latest stream text — state var is stale inside run()'s catch
  const submitRef = useRef(null) // latest submit() — the queue listener is registered once

  useEffect(() => {
    fetch('/ollama/api/tags').then((r) => r.json()).then((d) => setModels((d.models || []).map((m) => m.name))).catch(() => {})
  }, [])
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, [chat.messages, live])
  useEffect(() => { setOpenArt(null) }, [activeChat])
  // Consume a prompt queued by the overview command bar — on mount (it was set
  // before this tab existed) and on the event (already mounted).
  useEffect(() => {
    const consume = () => { if (queuedPrompt != null) { const p = queuedPrompt; queuedPrompt = null; submitRef.current?.(p) } }
    consume()
    return on('chat:queued', consume)
  }, [])

  // history: array of stored {role, content} to replay (regenerate passes a trimmed one)
  const setLiveBoth = (v) => { liveRef.current = v; setLive(v) }

  const run = async (history, extra) => {
    setLiveBoth({ content: '', thinking: '' })
    abortRef.current = new AbortController()
    const { model, think, effort } = store.get().settings
    try {
      const memory = await fetch('/__memory').then((r) => r.text()).catch(() => '')
      const sys = () => ({ role: 'system', content: systemPrompt(store.get(), memory, extra) })
      const convo = [sys(), ...history.map((m) => ({ role: m.role, content: m.content }))]
      let acted = false, nudged = false
      for (let round = 0; round < 8; round++) {
        const msg = await streamChat(convo, { model, think: think ? effort : false }, abortRef.current.signal, setLiveBoth)
        convo.push(msg)
        if (msg.tool_calls?.length) {
          for (const call of msg.tool_calls) {
            const tool = TOOLS[call.function.name]
            let result = 'unknown tool'
            if (tool) { try { result = (await tool.run(call.function.arguments || {})) ?? 'ok' } catch (e) { result = 'error: ' + e.message } }
            convo.push({ role: 'tool', content: String(result) })
          }
          acted = true
          convo[0] = sys() // refresh state so the model reacts to what actually landed, not the stale snapshot
          setLiveBoth({ content: '', thinking: '' }) // reset the live bubble while the model reacts to results
          continue
        }
        // Caught a fabricated confirmation: claims an action but no tool ran this turn. Nudge once.
        if (!acted && !nudged && /\b(added|created|saved|updated|deleted|removed|scheduled|set up|marked)\b/i.test(msg.content || '')) {
          nudged = true
          convo.push({ role: 'user', content: '(system: you described an action as done but called no tool this turn. Call the tool now, or rephrase without claiming it happened.)' })
          continue
        }
        actions.pushMsg({ role: 'assistant', content: msg.content || '(no reply)', ...(msg.thinking ? { thinking: msg.thinking } : {}) })
        break
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        const partial = liveRef.current?.content
        actions.pushMsg({ role: 'assistant', content: (partial || '') + ' *(stopped)*' })
      } else {
        actions.pushMsg({ role: 'assistant', content: `Couldn't reach Ollama (${e.message}). Is it running? Model: ${model}.` })
      }
    } finally {
      setLiveBoth(null)
      abortRef.current = null
    }
  }

  // Create a task from a title and echo it into the chat log as a /task exchange.
  const createTask = (title, tagsField = '', dateField = '') => {
    const t = addTaskFromTitle(title, tagsField, dateField)
    if (!t) return false
    actions.pushMsg({ role: 'user', content: `/task ${title.trim()}` })
    actions.pushMsg({ role: 'assistant', content: `Added task #${t.id}: "${t.text}"${t.due ? ` — due ${t.due}` : ''}${t.tags?.length ? ` [${t.tags.join(', ')}]` : ''}` })
    return true
  }
  // Handle a submitted line (from the input or the overview command bar).
  const submit = (raw) => {
    raw = raw.trim()
    if (!raw || live !== null) return
    const m = raw.match(/^\/(\w+)\s*([\s\S]*)$/)
    const cmd = m && COMMANDS[m[1]]
    if (cmd?.task) { const rest = m[2].trim(); if (!rest) return; createTask(rest); return }
    actions.pushMsg({ role: 'user', content: raw })
    run([...chat.messages, { role: 'user', content: cmd ? m[2].trim() : raw }], cmd?.prompt)
  }
  submitRef.current = submit
  const send = () => { const raw = text; setText(''); submit(raw) }
  // suggestions while typing a command word (before the first space)
  const suggest = /^\/\w*$/.test(text)
    ? Object.entries(COMMANDS).filter(([n]) => n.startsWith(text.slice(1)))
    : []
  const pickCmd = (n) => { setText('/' + n + ' '); inputRef.current?.focus() }
  const stop = () => abortRef.current?.abort()
  const regenerate = () => {
    if (live !== null) return
    const msgs = [...chat.messages]
    while (msgs.length && msgs[msgs.length - 1].role === 'assistant') msgs.pop()
    if (!msgs.length) return
    actions.setMessages(msgs)
    run(msgs)
  }
  const copy = (t) => navigator.clipboard.writeText(t)
  const download = (a) => {
    const url = URL.createObjectURL(new Blob([a.content], { type: 'text/markdown' }))
    const el = Object.assign(document.createElement('a'), { href: url, download: a.title.replace(/\W+/g, '-') + '.md' })
    el.click(); URL.revokeObjectURL(url)
  }

  const art = chat.artifacts.find((a) => a.title === openArt)
  const lastAssistant = chat.messages.map((m) => m.role).lastIndexOf('assistant')

  return (
    <div className="chat">
      <div className="chat-toolbar">
        <Dropdown value={chat.id} onChange={(v) => actions.setActiveChat(Number(v))} title="Chat session"
          options={chats.map((c) => ({ value: c.id, label: c.title }))} />
        <button className="tb-btn" onClick={() => actions.newChat()} title="New chat"><Plus size={14} /></button>
        <button className="tb-btn" onClick={() => actions.deleteChat(chat.id)} title="Delete chat"><Trash size={14} /></button>
        <span className="tb-gap" />
        <Dropdown value={settings.model} onChange={(v) => actions.setSettings({ model: v })} title="Model"
          options={[settings.model, ...models.filter((m) => m !== settings.model)].map((m) => ({ value: m, label: m }))} />
        <button className={'tb-btn' + (settings.think ? ' on' : '')} onClick={() => actions.setSettings({ think: !settings.think })} title={settings.think ? 'Thinking on' : 'Thinking off'}>
          {settings.think ? <Lightbulb size={14} /> : <LightbulbOff size={14} />}
        </button>
        {settings.think && (
          <Dropdown value={settings.effort} onChange={(v) => actions.setSettings({ effort: v })} title="Thinking effort"
            options={EFFORTS.map((e) => ({ value: e, label: e }))} />
        )}
      </div>
      <div className={'chat-cols' + (art ? ' split' : '')}>
        <div className="chat-main">
          <div className="chat-log" ref={logRef}>
            {chat.messages.length === 0 && live === null
              ? <div className="empty">Ask about homework, classes, events — or "search the web for…"</div>
              : chat.messages.map((m, i) => (
                  <div key={i} className={'msg ' + m.role}>
                    <span className="who">{m.role === 'user' ? 'you' : 'aos'}</span>
                    <span className="body">
                      {m.thinking && <details className="think"><summary>thinking</summary><div className="tk">{m.thinking}</div></details>}
                      {m.role === 'assistant' ? <Md text={m.content} /> : m.content}
                      <span className="msg-actions">
                        <button onClick={() => copy(m.content)} title="Copy"><Copy size={13} /></button>
                        {i === lastAssistant && <button onClick={regenerate} title="Regenerate"><Reload size={13} /></button>}
                      </span>
                    </span>
                  </div>
                ))}
            {live !== null && (
              <div className="msg assistant">
                <span className="who">aos</span>
                <span className="body">
                  {live.thinking && <details className="think" open><summary>thinking</summary><div className="tk">{live.thinking}</div></details>}
                  {live.content ? <Md text={live.content} /> : (live.thinking ? null : '…')}
                </span>
              </div>
            )}
          </div>
          {chat.artifacts.length > 0 && (
            <div className="art-strip">
              {chat.artifacts.map((a) => (
                <button key={a.title} className={'art-chip' + (openArt === a.title ? ' on' : '')} onClick={() => setOpenArt(openArt === a.title ? null : a.title)}>
                  <FileText size={13} />{a.title}
                </button>
              ))}
            </div>
          )}
          <div className="add-row chat-input">
            {suggest.length > 0 && (
              <div className="cmd-menu">
                {suggest.map(([n, c]) => (
                  <button key={n} className="cmd-item" onMouseDown={(e) => { e.preventDefault(); pickCmd(n) }}>
                    <strong>/{n}</strong> <span>{c.desc}</span>
                  </button>
                ))}
              </div>
            )}
            <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { if (suggest.length === 1) pickCmd(suggest[0][0]); else send() }
                else if (e.key === 'Escape' && suggest.length) setText('')
              }} placeholder="Message AaronOS…  (/ for commands)" disabled={live !== null} />
            {live !== null
              ? <button onClick={stop} title="Stop"><Square size={15} /></button>
              : <button onClick={send} title="Send"><Send size={15} /></button>}
          </div>
        </div>
        {art && (
          <div className="art-pane">
            <div className="art-head">
              <FileText size={14} /><strong>{art.title}</strong>
              <button onClick={() => copy(art.content)} title="Copy markdown"><Copy size={14} /></button>
              <button onClick={() => download(art)} title="Download .md"><Download size={14} /></button>
              <button onClick={() => setOpenArt(null)} title="Close"><Close size={14} /></button>
            </div>
            <div className="art-body"><Md text={art.content} /></div>
          </div>
        )}
      </div>
    </div>
  )
}

// Overview command bar: a single input at the top of the dashboard. A slash
// command runs the agent in the background (nothing saved to any chat, tools
// still fire); anything else opens the AI Chat tab and answers there as usual.
export function CommandBar() {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  const submit = () => {
    const raw = text.trim()
    if (!raw || busy) return
    const m = raw.match(/^\/(\w+)\s*([\s\S]*)$/)
    const cmd = m && COMMANDS[m[1]]
    setText('')
    if (cmd) {
      const rest = m[2].trim()
      if (cmd.task) { const t = addTaskFromTitle(rest); if (t) notify('Task added', t.text) }
      else if (rest || !cmd.prompt) { setBusy(true); runBackground(rest || raw, cmd.prompt).catch((e) => notify('AaronOS failed', e.message)).finally(() => setBusy(false)) }
      return
    }
    queuePrompt(raw) // hand off to the AI Chat tab
  }

  const suggest = /^\/\w*$/.test(text)
    ? Object.entries(COMMANDS).filter(([n]) => n.startsWith(text.slice(1)))
    : []
  const pickCmd = (n) => { setText('/' + n + ' '); inputRef.current?.focus() }

  return (
    <div className="add-row chat-input command-bar">
      {suggest.length > 0 && (
        <div className="cmd-menu">
          {suggest.map(([n, c]) => (
            <button key={n} className="cmd-item" onMouseDown={(e) => { e.preventDefault(); pickCmd(n) }}>
              <strong>/{n}</strong> <span>{c.desc}</span>
            </button>
          ))}
        </div>
      )}
      <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { if (suggest.length === 1) pickCmd(suggest[0][0]); else submit() }
          else if (e.key === 'Escape' && suggest.length) setText('')
        }} placeholder={busy ? 'Running…' : 'Ask AaronOS or / for a command…'} disabled={busy} />
      <button onClick={submit} title="Send" disabled={busy}><Send size={15} /></button>
    </div>
  )
}

// grid:false — lives only as a sidebar tab; the overview shows CommandBar instead.
registerWidget({ id: 'chat', title: 'AI Chat', icon: Message, span: 12, grid: false, Component: Chat })
export default Chat
