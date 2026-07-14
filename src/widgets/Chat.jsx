import { useState, useRef, useEffect } from 'react'
import { Message, Send, Trash, Plus, Square, Copy, Reload, Close, Download, FileText, Lightbulb, LightbulbOff, Pencil, ListBox, Calendar, Notes as NotesIcon, AlarmClock } from 'pixelarticons/react'
import { useStore, actions, store, registerWidget, notify, emit, on, isoDay } from '../core'
import { parseTaskInput, parseDue, parseTags, reuseTags } from '../parse'
import Md from '../md'
import Dropdown from '../Dropdown'

// The dashboard is its own AI agent, but the agent itself runs in the Node
// process (scripts/agent.mjs), not here: this file is a thin client that starts
// a generation and streams it over SSE. That's what lets a reply survive a
// reload, a chat switch, or closing the window — the server owns the loop, and
// data/state.json (pushed back over the stream) is the source of truth.

// Read a server SSE stream (text/event-stream) frame by frame, calling
// onEvent(type, data) per `event:`/`data:` frame. Works for both the POST that
// starts a generation and the GET that reattaches to one.
async function streamSSE(url, opts, onEvent) {
  const res = await fetch(url, opts)
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i)
      buf = buf.slice(i + 2)
      let ev = 'message', data = ''
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) ev = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      if (data) { try { onEvent(ev, JSON.parse(data)) } catch { /* skip malformed frame */ } }
    }
  }
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

// Bridge from the overview command bar to the Chat tab, which may not be mounted
// yet. Stash the prompt, switch to the chat view, and ping; Chat consumes it on
// mount (covers the pre-mount case) and on the event (covers already-mounted).
let queuedPrompt = null
export const queuePrompt = (raw) => { queuedPrompt = raw; actions.setView('chat'); emit('chat:queued') }

const EFFORTS = ['low', 'medium', 'high']

// Cycles through the categories Engram actually acts on (tasks, calendar,
// notes, reminders) while it thinks — pulses via transform/opacity only, so
// the fixed-size slot never reflows the "generating" text next to it. The
// interval matches the CSS animation-duration so each icon's pulse finishes
// right as the next one mounts.
const SPIN_ICONS = [ListBox, Calendar, NotesIcon, AlarmClock]
const SPIN_MS = 900
function Spinner() {
  const [i, setI] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % SPIN_ICONS.length), SPIN_MS)
    return () => clearInterval(id)
  }, [])
  const Icon = SPIN_ICONS[i]
  return <span className="gen-icon-slot"><Icon key={i} size={14} className="gen-icon" /></span>
}

// One generation at a time, module-scoped so it survives StrictMode's remount —
// guards the reload-resume effect from firing twice.
let resumed = false

function Chat() {
  const { chats, activeChat, settings, generating } = useStore()
  const chat = chats.find((c) => c.id === activeChat) || chats[0] || { messages: [], artifacts: [] }
  const [text, setText] = useState('')
  const [live, setLive] = useState(null) // null = idle, { content, thinking } = streaming
  const [models, setModels] = useState([])
  const [openArt, setOpenArt] = useState(null) // artifact title or null
  const [renaming, setRenaming] = useState(false)
  const [renameText, setRenameText] = useState('')
  const logRef = useRef(null)
  const inputRef = useRef(null)
  const renameRef = useRef(null)
  const submitRef = useRef(null) // latest submit() — the queue listener is registered once

  useEffect(() => {
    fetch('/ollama/api/tags').then((r) => r.json()).then((d) => setModels((d.models || []).map((m) => m.name))).catch(() => {})
  }, [])
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, [chat.messages, live])
  useEffect(() => { setOpenArt(null); setRenaming(false) }, [activeChat])
  useEffect(() => { if (renaming) renameRef.current?.select() }, [renaming])
  // Consume a prompt queued by the overview command bar — on mount (it was set
  // before this tab existed) and on the event (already mounted).
  useEffect(() => {
    const consume = () => { if (queuedPrompt != null) { const p = queuedPrompt; queuedPrompt = null; submitRef.current?.(p) } }
    consume()
    return on('chat:queued', consume)
  }, [])

  const onSSE = (ev, data) => {
    if (ev === 'delta') setLive({ content: data.content || '', thinking: data.thinking || '' })
    else if (ev === 'state') store.setLocal(data.state) // server pushed authoritative state
    // 'done'/'error': the stream ends; the finally clears the live bubble and the
    // final message is already in the state the server pushed.
  }

  // Start (or, if this chat is already running, re-attach to) a generation on the
  // server and stream it. The server owns the loop and persistence — we only
  // render deltas and apply the state it pushes back.
  const listen = (body, chatId) => {
    store.setLocal({ generating: chatId }) // optimistic; server's state events are authoritative
    setLive({ content: '', thinking: '' })
    streamSSE('/__chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, onSSE)
      .catch(() => store.setLocal({ generating: null })) // server unreachable — nothing is running
      .finally(() => setLive(null))
  }

  // Reattach on mount: if the server is mid-generation for some chat (a flag that
  // survived this tab reloading or closing), pick the stream back up.
  useEffect(() => {
    if (resumed) return
    resumed = true
    const g = store.get().generating
    if (g == null) return
    setLive({ content: '', thinking: '' })
    streamSSE('/__chat?chatId=' + g, {}, onSSE).finally(() => setLive(null))
  }, [])

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
    if (!raw || store.get().generating === chat.id) return
    const m = raw.match(/^\/(\w+)\s*([\s\S]*)$/)
    const cmd = m && COMMANDS[m[1]]
    if (cmd?.task) { const rest = m[2].trim(); if (!rest) return; createTask(rest); return }
    // Optimistically show the user's line; the server appends the authoritative
    // copy and streams the whole state back, so we don't persist ours here.
    store.setLocal((s) => ({ chats: s.chats.map((c) => (c.id === chat.id ? { ...c, messages: [...c.messages, { role: 'user', content: raw }] } : c)) }))
    listen({ chatId: chat.id, userText: raw, runText: cmd ? m[2].trim() : raw, extra: cmd?.prompt }, chat.id)
  }
  submitRef.current = submit
  const send = () => { const raw = text; setText(''); submit(raw) }
  // suggestions while typing a command word (before the first space)
  const suggest = /^\/\w*$/.test(text)
    ? Object.entries(COMMANDS).filter(([n]) => n.startsWith(text.slice(1)))
    : []
  const pickCmd = (n) => { setText('/' + n + ' '); inputRef.current?.focus() }
  const stop = () => fetch('/__chat/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId: chat.id }) })
  const regenerate = () => {
    if (store.get().generating === chat.id) return
    const msgs = [...chat.messages]
    while (msgs.length && msgs[msgs.length - 1].role === 'assistant') msgs.pop()
    if (!msgs.length) return
    store.setLocal((s) => ({ chats: s.chats.map((c) => (c.id === chat.id ? { ...c, messages: msgs } : c)) })) // optimistic trim; server re-trims authoritatively
    listen({ chatId: chat.id, regenerate: true }, chat.id)
  }
  const copy = (t) => navigator.clipboard.writeText(t)
  const download = (a) => {
    const url = URL.createObjectURL(new Blob([a.content], { type: 'text/markdown' }))
    const el = Object.assign(document.createElement('a'), { href: url, download: a.title.replace(/\W+/g, '-') + '.md' })
    el.click(); URL.revokeObjectURL(url)
  }

  const art = chat.artifacts.find((a) => a.title === openArt)
  const lastAssistant = chat.messages.map((m) => m.role).lastIndexOf('assistant')
  const gen = generating === chat.id // is *this* chat the one generating?

  const startRename = () => { setRenameText(chat.title); setRenaming(true) }
  const commitRename = () => {
    const t = renameText.trim()
    if (t) actions.renameChat(chat.id, t)
    setRenaming(false)
  }

  return (
    <div className="chat">
      <div className="chat-toolbar">
        {renaming ? (
          <input ref={renameRef} className="tb-rename" value={renameText} onChange={(e) => setRenameText(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); else if (e.key === 'Escape') setRenaming(false) }} />
        ) : (
          <Dropdown value={chat.id} onChange={(v) => actions.setActiveChat(Number(v))} title="Chat session"
            options={chats.map((c) => ({ value: c.id, label: c.title }))} />
        )}
        <button className="tb-btn" onClick={startRename} title="Rename chat"><Pencil size={14} /></button>
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
            {chat.messages.length === 0 && !gen
              ? <div className="empty">Ask about homework, classes, events — or "search the web for…"</div>
              : chat.messages.map((m, i) => (
                  <div key={i} className={'msg ' + m.role}>
                    <span className="who">{m.role === 'user' ? 'you' : 'Engram'}</span>
                    <div className="body">
                      {m.thinking && <details className="think"><summary>thinking</summary><div className="tk">{m.thinking}</div></details>}
                      {m.role === 'assistant' ? <Md text={m.content} /> : m.content}
                    </div>
                    <span className="msg-actions">
                      <button onClick={(e) => { copy(m.content); e.currentTarget.blur() }} title="Copy"><Copy size={13} /></button>
                      {i === lastAssistant && <button onClick={(e) => { regenerate(); e.currentTarget.blur() }} title="Regenerate"><Reload size={13} /></button>}
                    </span>
                  </div>
                ))}
            {gen && (
              <div className="msg assistant">
                <span className="who">Engram</span>
                <div className="body">
                  {live?.thinking && <details className="think" open><summary>thinking</summary><div className="tk">{live.thinking}</div></details>}
                  {live?.content ? <Md text={live.content} /> : (
                    <span className="generating"><Spinner /> generating<span className="gen-dots" /></span>
                  )}
                </div>
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
              }} placeholder="Message Engram…  (/ for commands)" disabled={live !== null} />
            {gen
              ? <button onClick={stop} title="Stop"><Square size={15} /></button>
              : <button onClick={send} title="Send" disabled={live !== null}><Send size={15} /></button>}
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

// Overview command bar: a single input at the top of the dashboard. `/task` adds
// a task directly; every other slash command and plain text hands off to the AI
// Chat tab, which runs it on the server (tools live only there now).
export function CommandBar() {
  const [text, setText] = useState('')
  const inputRef = useRef(null)

  const submit = () => {
    const raw = text.trim()
    if (!raw) return
    const m = raw.match(/^\/(\w+)\s*([\s\S]*)$/)
    const cmd = m && COMMANDS[m[1]]
    setText('')
    if (cmd?.task) { const t = addTaskFromTitle(m[2].trim()); if (t) notify('Task added', t.text); return }
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
        }} placeholder="Ask Engram or / for a command…" />
      <button onClick={submit} title="Send"><Send size={15} /></button>
    </div>
  )
}

// Sidebar sub-panel: last three chats, click to open, pencil to rename.
export function ChatNavPanel() {
  const { chats } = useStore()
  const [renamingId, setRenamingId] = useState(null)
  const [text, setText] = useState('')
  const recent = chats.slice(-3).reverse()
  const open = (id) => { actions.setActiveChat(id); actions.setView('chat') }
  const commit = () => { const t = text.trim(); if (t) actions.renameChat(renamingId, t); setRenamingId(null) }
  if (!recent.length) return <div className="nav-sub-empty">No chats yet</div>
  return recent.map((c) => (
    <div className="nav-sub-row" key={c.id}>
      {renamingId === c.id ? (
        <input className="nav-sub-rename-input" autoFocus value={text}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') setRenamingId(null) }} />
      ) : (
        <>
          <button className="nav-sub-item" onClick={() => open(c.id)}>{c.title}</button>
          <button className="nav-sub-rename" onClick={() => { setRenamingId(c.id); setText(c.title) }} title="Rename chat"><Pencil size={12} /></button>
        </>
      )}
    </div>
  ))
}

registerWidget({ id: 'chat', title: 'AI Chat', icon: Message, order: 60, Page: Chat, nav: { Panel: ChatNavPanel } })
export default Chat
