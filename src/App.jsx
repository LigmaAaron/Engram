import { useEffect, useState } from 'react'
import { Grid3x3, Settings2, Bell, Search, Cpu, Power, ChevronDown, Pencil, Plus } from 'pixelarticons/react'
import { useStore, useWidgets, actions, notify, on, isoDay, occursOn } from './core'
import { CommandBar } from './widgets/Chat'

const greetPart = () => { const h = new Date().getHours(); return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening' }
const todayStr = () => new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

function Sidebar({ view, widgets, onShutdown }) {
  const { chats, notes, tasks, events, streak, ui } = useStore()
  const [renamingId, setRenamingId] = useState(null)
  const [renameText, setRenameText] = useState('')
  const [renamingNoteId, setRenamingNoteId] = useState(null)
  const [renameNoteText, setRenameNoteText] = useState('')
  const nav = [{ id: 'overview', title: 'Overview', icon: Grid3x3 }, ...widgets.filter((w) => w.page !== false)]
  const recentChats = chats.slice(-3).reverse()
  const recentNotes = [...notes].sort((a, b) => b.modified - a.modified).slice(0, 3)
  const openChat = (id) => { actions.setActiveChat(id); actions.setView('chat') }
  const openNote = (id) => { actions.setActiveNote(id); actions.setView('notes') }
  const startRename = (c) => { setRenamingId(c.id); setRenameText(c.title) }
  const commitRename = () => {
    const t = renameText.trim()
    if (t) actions.renameChat(renamingId, t)
    setRenamingId(null)
  }
  const startRenameNote = (n) => { setRenamingNoteId(n.id); setRenameNoteText(n.title) }
  const commitRenameNote = () => {
    const t = renameNoteText.trim()
    if (t) actions.updateNote(renamingNoteId, { title: t })
    setRenamingNoteId(null)
  }
  const done = tasks.filter((t) => t.done).length
  const openTasks = tasks.length - done
  const todayIso = isoDay()
  const todayEventCount = events.filter((e) => occursOn(e, todayIso)).length
  const navBadge = { tasks: openTasks, calendar: todayEventCount }
  const overviewStats = [
    { lbl: 'Completed', val: done },
    { lbl: 'Open tasks', val: openTasks },
    { lbl: 'Day streak', val: streak.count },
    { lbl: "Today's events", val: todayEventCount },
  ]
  return (
    <nav id="sidebar">
      <div className="brand"><div className="logo"><Cpu size={16} /></div><div className="name">Engram</div></div>
      <div className="nav">
        {nav.map((n) => n.id === 'overview' ? (
          <div className="nav-group" key={n.id}>
            <div className={'nav-item nav-item-split' + (view === n.id ? ' active' : '')}>
              <button className="nav-item-main" onClick={() => actions.setView('overview')}>
                <n.icon size={18} /><span className="nav-label-txt">{n.title}</span>
              </button>
              <button className={'nav-expand' + (ui.overviewOpen ? ' open' : '')} onClick={() => actions.toggleOverviewPanel()} title="Metrics">
                <ChevronDown size={14} />
              </button>
            </div>
            {ui.overviewOpen && (
              <div className="nav-sub">
                {overviewStats.map((s) => (
                  <div className="nav-sub-stat" key={s.lbl}><span>{s.lbl}</span><span>{s.val}</span></div>
                ))}
              </div>
            )}
          </div>
        ) : n.id === 'chat' ? (
          <div className="nav-group" key={n.id}>
            <div className={'nav-item nav-item-split' + (view === n.id ? ' active' : '')}>
              <button className="nav-item-main" onClick={() => actions.setView('chat')}>
                <n.icon size={18} /><span className="nav-label-txt">{n.title}</span>
              </button>
              <button className={'nav-expand' + (ui.chatOpen ? ' open' : '')} onClick={() => actions.toggleChatPanel()} title="Recent chats">
                <ChevronDown size={14} />
              </button>
            </div>
            {ui.chatOpen && (
              <div className="nav-sub">
                {recentChats.length === 0
                  ? <div className="nav-sub-empty">No chats yet</div>
                  : recentChats.map((c) => (
                      <div className="nav-sub-row" key={c.id}>
                        {renamingId === c.id ? (
                          <input className="nav-sub-rename-input" autoFocus value={renameText}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => setRenameText(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); else if (e.key === 'Escape') setRenamingId(null) }} />
                        ) : (
                          <>
                            <button className="nav-sub-item" onClick={() => openChat(c.id)}>{c.title}</button>
                            <button className="nav-sub-rename" onClick={() => startRename(c)} title="Rename chat"><Pencil size={12} /></button>
                          </>
                        )}
                      </div>
                    ))}
              </div>
            )}
          </div>
        ) : n.id === 'notes' ? (
          <div className="nav-group" key={n.id}>
            <div className={'nav-item nav-item-split' + (view === n.id ? ' active' : '')}>
              <button className="nav-item-main" onClick={() => actions.setView('notes')}>
                <n.icon size={18} /><span className="nav-label-txt">{n.title}</span>
              </button>
              <button className="nav-add" onClick={() => { const nt = actions.addNote(''); actions.setActiveNote(nt.id); actions.setView('notes') }} title="New note">
                <Plus size={14} />
              </button>
              <button className={'nav-expand' + (ui.notesOpen ? ' open' : '')} onClick={() => actions.toggleNotesPanel()} title="Recent notes">
                <ChevronDown size={14} />
              </button>
            </div>
            {ui.notesOpen && (
              <div className="nav-sub">
                {recentNotes.length === 0
                  ? <div className="nav-sub-empty">No notes yet</div>
                  : recentNotes.map((c) => (
                      <div className="nav-sub-row" key={c.id}>
                        {renamingNoteId === c.id ? (
                          <input className="nav-sub-rename-input" autoFocus value={renameNoteText}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => setRenameNoteText(e.target.value)}
                            onBlur={commitRenameNote}
                            onKeyDown={(e) => { if (e.key === 'Enter') commitRenameNote(); else if (e.key === 'Escape') setRenamingNoteId(null) }} />
                        ) : (
                          <>
                            <button className="nav-sub-item" onClick={() => openNote(c.id)}>{c.title || 'Untitled'}</button>
                            <button className="nav-sub-rename" onClick={() => startRenameNote(c)} title="Rename note"><Pencil size={12} /></button>
                          </>
                        )}
                      </div>
                    ))}
              </div>
            )}
          </div>
        ) : (
          <button key={n.id} className={'nav-item' + (view === n.id ? ' active' : '')} onClick={() => actions.setView(n.id)}>
            <n.icon size={18} /><span className="nav-label-txt">{n.title}</span>
            {navBadge[n.id] > 0 && <span className="nav-badge">{navBadge[n.id]}</span>}
          </button>
        ))}
      </div>
      <div className="nav-spacer" />
      <div className="nav">
        <button className="nav-item" onClick={() => notify('Settings', 'Nothing to configure yet — wire it via window.Engram.')}>
          <Settings2 size={18} /><span className="nav-label-txt">Settings</span>
        </button>
        <button className="nav-item" onClick={onShutdown}>
          <Power size={18} /><span className="nav-label-txt">Shut Down</span>
        </button>
      </div>
    </nav>
  )
}

function ShutdownModal({ open, onCancel, onConfirm }) {
  if (!open) return null
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>Shut down Engram?</h3>
        <p>This stops the local server. You'll need to reopen the app to use it again.</p>
        <div className="modal-actions">
          <button className="nav-item" onClick={onCancel}>Cancel</button>
          <button className="modal-danger" onClick={onConfirm}>Shut Down</button>
        </div>
      </div>
    </div>
  )
}

function ShutdownScreen() {
  useEffect(() => { window.close() }, [])
  return (
    <div className="shutdown-screen">
      <p>&gt; Engram stopped.</p>
      <p className="dim">You can close this tab.</p>
    </div>
  )
}

function NotifPanel({ open, notifs, onClose }) {
  if (!open) return null
  return (
    <div id="notif-panel" className="open">
      <header><span>Notifications</span><button onClick={onClose}>Close</button></header>
      <div id="notif-list">
        {notifs.length === 0
          ? <div className="notif-empty">No notifications</div>
          : notifs.slice().reverse().map((n, i) => (
              <div className="notif-item" key={i}><div className="t">{n.title}</div>{n.body && <div className="b">{n.body}</div>}</div>
            ))}
      </div>
    </div>
  )
}

function Toaster() {
  const [toasts, setToasts] = useState([])
  const dismiss = (id) => setToasts((x) => x.filter((y) => y.id !== id))
  useEffect(() => on('toast', (t) => {
    const id = Math.random()
    setToasts((x) => [...x, { ...t, id }])
    setTimeout(() => dismiss(id), 4000)
  }), [])
  return (
    <div id="toasts">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          <div className="t">{t.title}</div>
          {t.body && <div className="b">{t.body}</div>}
          {t.undo && <button className="toast-undo" onClick={() => { t.undo(); dismiss(t.id) }}>Undo</button>}
        </div>
      ))}
    </div>
  )
}

export default function App() {
  const { ui, notifs } = useStore()
  const widgets = useWidgets()
  const [bellOpen, setBellOpen] = useState(false)
  const [seen, setSeen] = useState(0)
  const [confirmShutdown, setConfirmShutdown] = useState(false)
  const [shutDown, setShutDown] = useState(false)
  const unread = notifs.length - seen

  const solo = ui.view !== 'overview'
  const shown = solo ? widgets.filter((w) => w.id === ui.view) : widgets.filter((w) => w.grid !== false)

  if (shutDown) return <ShutdownScreen />

  return (
    <>
      <Sidebar view={ui.view} widgets={widgets} onShutdown={() => setConfirmShutdown(true)} />
      <main id="main">
        <div className="topbar">
          <div className="greeting">
            <h1>Good {greetPart()}, Aaron</h1>
            <p>{todayStr()}</p>
          </div>
          <div className="topbar-right">
            <label className="search">
              <Search size={15} />
              <input value={ui.search} onChange={(e) => actions.setSearch(e.target.value)} placeholder="Search tasks…" />
            </label>
            <button className="icon-btn" onClick={() => { setBellOpen((o) => !o); setSeen(notifs.length) }}>
              <Bell size={18} />
              {unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
            </button>
          </div>
        </div>
        {ui.view === 'overview' && <CommandBar />}
        <div className={'grid' + (solo ? ' solo' : '')}>
          {shown.map((w) => (
            <section className="card" key={w.id} style={{ gridColumn: `span ${solo ? 12 : w.span}` }}>
              <div className="card-h"><w.icon size={16} /><h2>{w.title}</h2></div>
              <div className="card-b"><w.Component /></div>
            </section>
          ))}
        </div>
      </main>
      <Toaster />
      <NotifPanel open={bellOpen} notifs={notifs} onClose={() => setBellOpen(false)} />
      <ShutdownModal
        open={confirmShutdown}
        onCancel={() => setConfirmShutdown(false)}
        onConfirm={() => { setConfirmShutdown(false); fetch('/__shutdown', { method: 'POST' }).finally(() => setShutDown(true)) }}
      />
    </>
  )
}
