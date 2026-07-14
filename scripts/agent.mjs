// The chat agent, server-side. This is the same loop that used to run in the
// browser (src/modules/chat/index.jsx), moved into the Node process so a generation
// belongs to the always-on app, not a tab: reloading, switching chats, or
// closing the window can't kill an in-flight reply anymore.
//
// Tools mutate a plain `state` object (the same shape persisted to
// data/state.json) instead of the React store; the reducers here mirror the
// ones in src/core.js. parse.js is reused as-is (already framework-free).
import { readFile, appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parseTaskInput, parseDue, parseTags, reuseTags } from '../src/parse.js'

const OLLAMA = 'http://localhost:11434'

// local date as YYYY-MM-DD (mirrors core.js isoDay)
const isoDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Does event `ev` happen on day `ds`? (mirrors core.js occursOn)
const occursOn = (ev, ds) => {
  if (!ev.repeat) return ev.date === ds
  if (ev.date && ds < ev.date) return false
  const r = ev.repeat
  if (r.until && ds > r.until) return false
  if (r.except?.includes(ds)) return false
  if (r.days?.length) return r.days.includes(new Date(ds + 'T12:00').getDay())
  return true
}

// monotonic id (mirrors core.js uid) — never repeats within this process
let lastId = 0
const uid = () => { const t = Date.now(); lastId = t > lastId ? t : lastId + 1; return lastId }

const pad2 = (n) => String(n).padStart(2, '0')
const noteTitle = (existing = []) => {
  const d = new Date()
  const base = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  const taken = new Set(existing.map((x) => x.title))
  let title = base, n = 2
  while (taken.has(title)) title = `${base} (${n++})`
  return title
}

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const parseDays = (s) => {
  if (!s || /daily/i.test(s)) return null
  const days = s.toLowerCase().split(/[,\s]+/).map((w) => DAY_NAMES.findIndex((d) => w.startsWith(d))).filter((i) => i >= 0)
  return days.length ? days : null
}
const parseAt = (s) => {
  s = s.trim()
  if (/^\d{1,2}:\d{2}$/.test(s)) s = `${isoDay()}T${s}`
  const t = new Date(s.replace(' ', 'T')).getTime()
  if (isNaN(t)) throw new Error(`can't parse time "${s}"`)
  return t
}

const byId = (s, key, id, kind) => {
  const x = s[key].find((e) => e.id === id)
  if (!x) throw new Error(`no ${kind} with id ${id}`)
  return x
}
const allTags = (s) => [...new Set(s.tasks.flatMap((t) => t.tags || []))]

// Web search for the chat agent: proxies DuckDuckGo's HTML results (no API key)
// and scrapes the top hits. Exported so vite.config's /__search reuses it.
export async function searchWeb(q) {
  const html = await (await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) Engram' },
  })).text()
  const strip = (h) => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
  const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
  const results = []
  let m
  while ((m = re.exec(html)) && results.length < 5) {
    const uddg = /uddg=([^&"]+)/.exec(m[1])
    results.push({ title: strip(m[2]), url: uddg ? decodeURIComponent(uddg[1]) : m[1], snippet: strip(m[3]) })
  }
  return results
}

// tool name -> { desc, params ('?'-suffixed key = optional), run(args, ctx) }.
// run mutates ctx.s (the working state) and returns a string describing what
// changed — fed back to the model so it grounds its confirmation on reality.
const TOOLS = {
  add_task: { desc: 'add a homework/to-do task; #hashtags in text become tags and natural-language dates ("tomorrow", "next Friday", "7/18") are detected automatically', params: { text: 'string', 'due?': 'string YYYY-MM-DD', 'tags?': 'string comma-separated, e.g. "chem, lab"' }, run: (a, { s }) => {
    const existing = allTags(s)
    const p = parseTaskInput(a.text || '', existing)
    const tags = reuseTags([...(a.tags ? parseTags(a.tags, existing) : []), ...p.tags], existing)
    const due = a.due || p.due
    s.tasks.unshift({ id: uid(), text: p.text, done: false, ...(due ? { due } : {}), ...(tags.length ? { tags } : {}) })
    const t = s.tasks[0]
    return `added task #${t.id}: "${t.text}"${t.due ? ` due ${t.due}` : ''}${t.tags?.length ? ` [${t.tags.join(', ')}]` : ''}`
  } },
  toggle_task: { desc: 'toggle a task done/undone by id', params: { id: 'number' }, run: (a, { s }) => { const t = byId(s, 'tasks', a.id, 'task'); t.done = !t.done; return `task #${a.id} "${t.text}" is now ${t.done ? 'done' : 'not done'}` } },
  remove_task: { desc: 'delete a task by id', params: { id: 'number' }, run: (a, { s }) => { const t = byId(s, 'tasks', a.id, 'task'); s.tasks = s.tasks.filter((x) => x.id !== a.id); return `removed task #${a.id} "${t.text}"` } },
  add_event: { desc: 'add a calendar event; give days/until to make it recurring', params: { time: 'string 24h HH:MM', title: 'string', 'end?': 'string 24h HH:MM end time (omit for a 1h block)', 'date?': 'string YYYY-MM-DD, omit for today; for recurring this is the start date', 'days?': 'string "daily" or weekdays like "mon,wed,fri" for weekly', 'until?': 'string YYYY-MM-DD last day of a recurring event' }, run: (a, { s }) => {
    const days = parseDays(a.days)
    const repeat = (a.days || a.until) ? { ...(days ? { days } : {}), ...(a.until ? { until: a.until } : {}) } : undefined
    s.events.push({ id: uid(), time: a.time, title: a.title, date: a.date || isoDay(), ...(a.end ? { end: a.end } : {}), ...(repeat ? { repeat } : {}) })
    const e = s.events.at(-1)
    return `added event #${e.id}: ${e.time} ${e.title} on ${e.date}${e.repeat ? ' (recurring)' : ''}`
  } },
  remove_event: { desc: 'delete an event entirely by id', params: { id: 'number' }, run: (a, { s }) => { const e = byId(s, 'events', a.id, 'event'); s.events = s.events.filter((x) => x.id !== a.id); return `removed event #${a.id} "${e.title}"` } },
  skip_event: { desc: 'skip one date of a recurring event (e.g. no school that day)', params: { id: 'number', date: 'string YYYY-MM-DD' }, run: (a, { s }) => { const e = byId(s, 'events', a.id, 'event'); if (!e.repeat) throw new Error(`event #${a.id} is not recurring`); e.repeat.except = [...(e.repeat.except || []), a.date]; return `event #${a.id} "${e.title}" skipped on ${a.date}` } },
  end_event: { desc: 'end a recurring event after a date', params: { id: 'number', until: 'string YYYY-MM-DD last day it still happens' }, run: (a, { s }) => { const e = byId(s, 'events', a.id, 'event'); if (!e.repeat) throw new Error(`event #${a.id} is not recurring`); e.repeat.until = a.until; return `event #${a.id} "${e.title}" now ends after ${a.until}` } },
  add_class: { desc: 'add a class period to the school schedule', params: { name: 'string', start: 'string HH:MM', end: 'string HH:MM', 'days?': 'string weekdays like "mon,tue,wed,thu,fri" (default mon-fri)' }, run: (a, { s }) => { s.schedule.push({ id: uid(), name: a.name, start: a.start, end: a.end, days: parseDays(a.days) || [1, 2, 3, 4, 5] }); const c = s.schedule.at(-1); return `added class #${c.id}: ${c.name} ${c.start}–${c.end}` } },
  remove_class: { desc: 'remove a class period by id', params: { id: 'number' }, run: (a, { s }) => { const c = byId(s, 'schedule', a.id, 'class'); s.schedule = s.schedule.filter((x) => x.id !== a.id); return `removed class #${a.id} "${c.name}"` } },
  skip_class: { desc: 'skip one date of a class (e.g. no school that day) without removing the class period', params: { id: 'number', date: 'string YYYY-MM-DD' }, run: (a, { s }) => { const c = byId(s, 'schedule', a.id, 'class'); c.except = [...(c.except || []), a.date]; return `class #${a.id} "${c.name}" skipped on ${a.date}` } },
  append_note: { desc: 'append a line to the most recent note (or start one if there are none)', params: { text: 'string' }, run: (a, { s }) => {
    if (!s.notes.length) { s.notes = [{ id: uid(), title: noteTitle([]), body: a.text, created: Date.now(), modified: Date.now() }]; return `appended note: "${a.text}"` }
    const [newest, ...rest] = [...s.notes].sort((x, y) => y.modified - x.modified)
    s.notes = [{ ...newest, body: (newest.body + '\n' + a.text).trim(), modified: Date.now() }, ...rest]
    return `appended note: "${a.text}"`
  } },
  remind: { desc: 'schedule a reminder notification for a specific time', params: { at: 'string HH:MM for today, or YYYY-MM-DD HH:MM', title: 'string', 'body?': 'string' }, run: (a, { s }) => { const r = { id: uid(), at: parseAt(a.at), title: a.title, body: a.body || '' }; s.reminders.push(r); return `reminder set for ${new Date(r.at).toLocaleString()}: ${r.title}` } },
  web_search: { desc: 'search the web; returns top results as JSON (title, url, snippet)', params: { query: 'string' }, run: async (a) => JSON.stringify(await searchWeb(a.query)).slice(0, 4000) },
  write_document: { desc: 'create or update a markdown document in the chat artifacts panel — for durable content Aaron keeps (essays, study guides, plans), not for restating dashboard state. Write plain clean markdown: headings, short paragraphs, lists. No emoji, no decorative tables, no fake links/buttons; include only sections with real content.', params: { title: 'string short title; reuse a title to update that document', content: 'string full markdown' }, run: (a, { s, chatId }) => {
    const c = s.chats.find((x) => x.id === chatId)
    if (!c) throw new Error('no active chat')
    c.artifacts = c.artifacts || []
    const i = c.artifacts.findIndex((x) => x.title === a.title)
    if (i >= 0) c.artifacts[i] = { ...c.artifacts[i], content: a.content, ts: Date.now() }
    else c.artifacts.push({ title: a.title, content: a.content, ts: Date.now() })
    return `saved document "${a.title}"`
  } },
  add_link: { desc: 'add a quick-launch link', params: { label: 'string', url: 'string', 'icon?': 'string' }, run: (a, { s }) => { s.links.push({ label: a.label, url: a.url, icon: a.icon || 'ExternalLink' }); return `added link ${a.label}` } },
  notify: { desc: 'show a notification right now', params: { title: 'string', 'body?': 'string' }, run: (a, { s }) => { s.notifs.push({ title: a.title, body: a.body || '', ts: Date.now() }); return `notified: ${a.title}` } },
  remember: { desc: 'save a durable fact or preference about Aaron to long-term memory', params: { note: 'string' }, run: async (a, { memoryFile }) => { await mkdir(dirname(memoryFile), { recursive: true }); await appendFile(memoryFile, `- ${new Date().toISOString().slice(0, 10)}: ${a.note.trim()}\n`); return `remembered: "${a.note}"` } },
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

// Framing per install-time use-case answer — keeps the assistant's sense of
// what it's helping with specific instead of falling back to generic advice.
const USE_CASE_FRAMING = {
  student: 'is a student — help with schoolwork, assignments, and staying on top of classes.',
  developer: 'is a developer — help with code, technical tasks, and project tracking.',
  writer: 'is a writer — help with drafts, editing, and research.',
  general: 'uses this for daily life — help with whatever comes up.',
}
const STYLE_FRAMING = {
  detailed: 'Explain your reasoning, not just the answer.',
  direct: 'Answer directly; skip unnecessary preamble.',
  concise: 'Be terse — the shortest correct answer, no elaboration unless asked.',
}

const systemPrompt = (s, memory, extra) => {
  const now = new Date()
  const today = isoDay(now)
  const name = s.settings?.userName || 'there'
  const framing = USE_CASE_FRAMING[s.settings?.useCase] || USE_CASE_FRAMING.general
  const style = STYLE_FRAMING[s.settings?.style] || STYLE_FRAMING.direct
  return [
    `You are Engram, the assistant built into ${name}'s personal dashboard. ${name} ${framing} Change the dashboard directly by calling tools; don't just describe what to do. ${style}`,
    `Use ids from the state below for toggle/remove/skip/end; never invent them. Recurring events: days+until on add_event; skip_event for one-day exceptions; end_event to stop one. When ${name} tells you a lasting preference or fact, call remember. Use web_search when you need current or factual info you are unsure about, and cite result URLs. Use write_document for anything long instead of dumping it in chat. After acting, reply briefly in markdown confirming what you did.`,
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
      notes: s.notes.map((n) => ({ title: n.title, body: n.body })),
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
    res = await fetch(`${OLLAMA}/api/chat`, {
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

const NUDGE_RE = /\b(added|created|saved|updated|deleted|removed|scheduled|set up|marked)\b/i

// Run the agent for one chat. `store` is scripts/state-store.mjs makeStore().
// Loads state, appends the turn (or trims for regenerate), runs the tool loop,
// persists after each tool round + at the end, and reports progress via onEvent:
//   { type:'delta', content, thinking }  streamed tokens
//   { type:'state', state }              full state after a mutation
//   { type:'done' } | { type:'error', message }
// The final assistant message is written into the chat itself, so a reconnecting
// client sees it via the persisted state, not a transient event.
export async function runAgent({ store, chatId, userText, runText, extra, regenerate, signal, onEvent, memoryFile }) {
  let s = JSON.parse(await store.load())
  const chat = s.chats?.find((c) => c.id === chatId)
  if (!chat) throw new Error(`no chat with id ${chatId}`)

  if (regenerate) {
    while (chat.messages.length && chat.messages.at(-1).role === 'assistant') chat.messages.pop()
    if (!chat.messages.length) return
  } else if (userText != null) {
    if (chat.messages.length === 0) chat.title = userText.slice(0, 30)
    chat.messages.push({ role: 'user', content: userText })
  }
  s.generating = chatId
  await store.save(JSON.stringify(s))
  onEvent({ type: 'state', state: s })

  const { model, think, effort } = s.settings
  const memory = await readFile(memoryFile, 'utf8').catch(() => '')
  const sys = () => ({ role: 'system', content: systemPrompt(s, memory, extra) })
  // The model sees runText for the last turn (slash-command text stripped) while
  // the chat log keeps userText verbatim — matches the old client behavior.
  const history = chat.messages.map((m) => ({ role: m.role, content: m.content }))
  if (runText != null && history.length) history[history.length - 1] = { role: 'user', content: runText }
  const convo = [sys(), ...history]
  let acted = false, nudged = false, live = { content: '', thinking: '' }
  try {
    for (let round = 0; round < 8; round++) {
      const msg = await streamChat(convo, { model, think: think ? effort : false }, signal, (d) => { live = d; onEvent({ type: 'delta', ...d }) })
      convo.push(msg)
      if (msg.tool_calls?.length) {
        for (const call of msg.tool_calls) {
          const tool = TOOLS[call.function.name]
          let result = 'unknown tool'
          if (tool) { try { result = (await tool.run(call.function.arguments || {}, { s, chatId, memoryFile })) ?? 'ok' } catch (e) { result = 'error: ' + e.message } }
          convo.push({ role: 'tool', content: String(result) })
        }
        acted = true
        await store.save(JSON.stringify(s))
        onEvent({ type: 'state', state: s })
        convo[0] = sys() // refresh state so the model reacts to what actually landed
        live = { content: '', thinking: '' }
        onEvent({ type: 'delta', content: '', thinking: '' })
        continue
      }
      // Fabricated confirmation: claims an action but no tool ran this turn. Nudge once.
      if (!acted && !nudged && NUDGE_RE.test(msg.content || '')) {
        nudged = true
        convo.push({ role: 'user', content: '(system: you described an action as done but called no tool this turn. Call the tool now, or rephrase without claiming it happened.)' })
        continue
      }
      chat.messages.push({ role: 'assistant', content: msg.content || '(no reply)', ...(msg.thinking ? { thinking: msg.thinking } : {}) })
      break
    }
  } catch (e) {
    if (e.name === 'AbortError') chat.messages.push({ role: 'assistant', content: (live.content || '') + ' *(stopped)*' })
    else chat.messages.push({ role: 'assistant', content: `Couldn't reach Ollama (${e.message}). Is it running? Model: ${model}.` })
  } finally {
    s.generating = null
    await store.save(JSON.stringify(s))
    onEvent({ type: 'state', state: s })
    onEvent({ type: 'done' })
  }
}
