/* AaronOS core — store, event bus, widget registry, notifications.
   window.AaronOS is the scripting surface for later integration. */
import { useSyncExternalStore } from 'react'

// local date as YYYY-MM-DD (not toISOString — that's UTC and shifts overnight)
export const isoDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Does event `ev` happen on day `ds` (YYYY-MM-DD)?
// One-off: { date }. Recurring: { date?: start, repeat: { days?: [0-6] weekly (absent = daily), until?, except?: [dates] } }
export const occursOn = (ev, ds) => {
  if (!ev.repeat) return ev.date === ds
  if (ev.date && ds < ev.date) return false
  const r = ev.repeat
  if (r.until && ds > r.until) return false
  if (r.except?.includes(ds)) return false
  if (r.days?.length) return r.days.includes(new Date(ds + 'T12:00').getDay())
  return true
}

const defaults = {
  tasks: [],   // { id, text, done, due?: 'YYYY-MM-DD', tags?: ['class'] }
  events: [],  // { id, time: 'HH:MM', title, date?, repeat? } — see occursOn
  links: [
    { label: 'Gmail',    url: 'https://mail.google.com',     icon: 'Mail' },
    { label: 'GitHub',   url: 'https://github.com',          icon: 'Terminal' },
    { label: 'Calendar', url: 'https://calendar.google.com', icon: 'Calendar' },
    { label: 'Drive',    url: 'https://drive.google.com',    icon: 'Folder' },
    { label: 'Chat',     url: 'https://chat.google.com',     icon: 'Message' },
  ],
  chats: [],       // { id, title, messages: [{role, content, thinking?}], artifacts: [{title, content, ts}] }
  activeChat: null,
  notes: '',
  schedule: [],    // { id, name, start: 'HH:MM', end: 'HH:MM', days: [0-6] }
  reminders: [],   // { id, at: epoch ms, title, body }
  settings: { model: 'qwen3.5:latest', think: true, effort: 'medium' },
  notifs: [],
  streak: { count: 0, last: null },
  lastBrief: null,
  ui: { view: 'overview', search: '' },
}

/* ---- Store: single source of truth, persisted to data/state.json via the
   dev server (see vite.config.js's dataStore plugin). Everything the tool
   saves lives in that one file. ---- */
let state = { ...defaults }
let hydrated = false
const subs = new Set()
const persist = () => {
  if (!hydrated) return // don't clobber the saved file before we've loaded it
  fetch('/__data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) }).catch(() => {})
}

// Load saved state from disk before the app renders. main.jsx awaits this.
export async function hydrate() {
  try {
    const saved = await fetch('/__data').then((r) => r.json())
    if (saved && typeof saved === 'object') state = { ...defaults, ...saved }
  } catch { /* first run / server unreachable — fall back to defaults */ }
  // migrations from the pre-sessions / pre-dates schema
  state.settings = { ...defaults.settings, ...state.settings }
  if (!state.chats.length) state.chats = [{ id: 1, title: 'chat 1', messages: state.chat || [], artifacts: [] }]
  if (!state.chats.find((c) => c.id === state.activeChat)) state.activeChat = state.chats[0].id
  delete state.chat
  state.events = state.events.map((e, i) => (e.id ? e : { ...e, id: Date.now() + i, date: isoDay() }))
  // single `tag` string -> `tags` array
  state.tasks = state.tasks.map((t) => { if (t.tags || !('tag' in t)) return t; const { tag, ...rest } = t; return tag ? { ...rest, tags: [tag] } : rest })
  hydrated = true
  subs.forEach((f) => f())
}

export const store = {
  get: () => state,
  set: (patch) => {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
    persist(); subs.forEach((f) => f())
  },
  subscribe: (f) => { subs.add(f); return () => subs.delete(f) },
}
export const useStore = () => useSyncExternalStore(store.subscribe, store.get)

/* ---- Event bus ---- */
const bus = {}
export const on = (e, f) => { (bus[e] ??= new Set()).add(f); return () => bus[e].delete(f) }
export const emit = (e, p) => { (bus[e] || []).forEach((f) => f(p)) }

/* ---- Widget registry: register() to add a widget to grid + sidebar ---- */
const widgets = []
export const registerWidget = (w) => {
  if (!widgets.find((x) => x.id === w.id)) { widgets.push(w); emit('widgets') }
}
export const useWidgets = () =>
  useSyncExternalStore((cb) => on('widgets', cb), () => widgets)

/* ---- Notifications ---- */
export const notify = (title, body = '') => {
  store.set((s) => ({ notifs: [...s.notifs, { title, body, ts: Date.now() }] }))
  emit('toast', { title, body })
}

const updateChat = (fn) =>
  store.set((s) => ({ chats: s.chats.map((c) => (c.id === s.activeChat ? fn(c) : c)) }))

/* ---- Actions (also the window.AaronOS scripting API) ---- */
export const actions = {
  addTask: (text, due, tags) => store.set((s) => ({ tasks: [{ id: Date.now(), text, done: false, ...(due ? { due } : {}), ...(tags?.length ? { tags } : {}) }, ...s.tasks] })),
  toggleTask: (id) => store.set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) })),
  updateTask: (id, patch) => store.set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  removeTask: (id) => store.set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
  addEvent: (time, title, date, repeat) => store.set((s) => ({ events: [...s.events, { id: Date.now(), time, title, date: date || isoDay(), ...(repeat ? { repeat } : {}) }] })),
  removeEvent: (id) => store.set((s) => ({ events: s.events.filter((e) => e.id !== id) })),
  skipEvent: (id, date) => store.set((s) => ({ events: s.events.map((e) => (e.id === id && e.repeat ? { ...e, repeat: { ...e.repeat, except: [...(e.repeat.except || []), date] } } : e)) })),
  endEvent: (id, until) => store.set((s) => ({ events: s.events.map((e) => (e.id === id && e.repeat ? { ...e, repeat: { ...e.repeat, until } } : e)) })),
  addClass: (name, start, end, days = [1, 2, 3, 4, 5]) => store.set((s) => ({ schedule: [...s.schedule, { id: Date.now(), name, start, end, days }] })),
  removeClass: (id) => store.set((s) => ({ schedule: s.schedule.filter((c) => c.id !== id) })),
  setNotes: (notes) => store.set({ notes }),
  allTags: () => [...new Set(store.get().tasks.flatMap((t) => t.tags || []))],
  remind: (at, title, body = '') => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission()
    store.set((s) => ({ reminders: [...s.reminders, { id: Date.now(), at, title, body }] }))
  },
  removeReminder: (id) => store.set((s) => ({ reminders: s.reminders.filter((r) => r.id !== id) })),
  addLink: (label, url, icon) => store.set((s) => ({ links: [...s.links, { label, url, icon }] })),
  removeLink: (i) => store.set((s) => ({ links: s.links.filter((_, x) => x !== i) })),
  setView: (view) => store.set((s) => ({ ui: { ...s.ui, view } })),
  setSearch: (search) => store.set((s) => ({ ui: { ...s.ui, search } })),
  setSettings: (patch) => store.set((s) => ({ settings: { ...s.settings, ...patch } })),
  // chat sessions
  newChat: () => { const id = Date.now(); store.set((s) => ({ chats: [...s.chats, { id, title: 'new chat', messages: [], artifacts: [] }], activeChat: id })) },
  deleteChat: (id) => store.set((s) => {
    const chats = s.chats.filter((c) => c.id !== id)
    if (!chats.length) chats.push({ id: Date.now(), title: 'new chat', messages: [], artifacts: [] })
    return { chats, activeChat: chats[chats.length - 1].id }
  }),
  setActiveChat: (id) => store.set({ activeChat: id }),
  pushMsg: (msg) => updateChat((c) => ({
    ...c,
    messages: [...c.messages, msg],
    title: c.messages.length === 0 && msg.role === 'user' ? msg.content.slice(0, 30) : c.title,
  })),
  setMessages: (messages) => updateChat((c) => ({ ...c, messages })),
  saveArtifact: (title, content) => updateChat((c) => {
    const artifacts = c.artifacts.some((a) => a.title === title)
      ? c.artifacts.map((a) => (a.title === title ? { ...a, content, ts: Date.now() } : a))
      : [...c.artifacts, { title, content, ts: Date.now() }]
    return { ...c, artifacts }
  }),
  clearChat: () => updateChat((c) => ({ ...c, messages: [], artifacts: [] })),
}

/* ---- Streak: bump once per calendar day ---- */
export function bumpStreak() {
  const today = new Date().toDateString()
  const s = state.streak
  if (s.last === today) return
  const yesterday = new Date(Date.now() - 864e5).toDateString()
  store.set({ streak: { count: s.last === yesterday ? s.count + 1 : 1, last: today } })
}

/* ---- Daily briefing: first open of the day.
   ponytail: deterministic sentence, no LLM round-trip — instant and works
   offline. Route it through the chat agent if it ever needs to be smarter. ---- */
export function dailyBrief() {
  const today = isoDay()
  if (state.lastBrief === today) return
  const due = state.tasks.filter((t) => !t.done && t.due === today).length
  const over = state.tasks.filter((t) => !t.done && t.due && t.due < today).length
  const cls = state.schedule.filter((c) => c.days.includes(new Date().getDay())).sort((a, b) => a.start.localeCompare(b.start))
  const evs = state.events.filter((e) => occursOn(e, today))
  const bits = [due ? `${due} due today` : 'nothing due today']
  if (over) bits.push(`${over} overdue`)
  if (cls.length) bits.push(`first class ${cls[0].name} at ${cls[0].start}`)
  if (evs.length) bits.push(`${evs.length} event${evs.length > 1 ? 's' : ''}`)
  if (state.streak.count > 1) bits.push(`streak ${state.streak.count}`)
  notify('Daily briefing', bits.join(' · '))
  store.set({ lastBrief: today })
}

/* ---- Reminders: check every 20s, fire once, drop from the list ---- */
if (typeof window !== 'undefined') {
  setInterval(() => {
    if (!hydrated) return
    const now = Date.now()
    const due = state.reminders.filter((r) => r.at <= now)
    if (!due.length) return
    due.forEach((r) => {
      notify(r.title, r.body)
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(r.title, { body: r.body })
    })
    store.set((s) => ({ reminders: s.reminders.filter((r) => r.at > now) }))
  }, 20000)
}

/* ---- Scripting bridge: window.AaronOS ---- */
export const AaronOS = { registerWidget, notify, on, emit, store, ...actions }
if (typeof window !== 'undefined') {
  window.AaronOS = AaronOS
  // cross-frame control: postMessage({ aaronos:true, cmd:'notify', args:[...] })
  // ponytail: no origin check — add an allowlist if this ever runs untrusted content.
  window.addEventListener('message', (e) => {
    const m = e.data
    if (m && m.aaronos && typeof AaronOS[m.cmd] === 'function') AaronOS[m.cmd](...(m.args || []))
  })
}
