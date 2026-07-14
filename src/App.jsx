import { useEffect, useState } from 'react'
import { Grid3x3, Settings2, Bell, Search, Cpu, Power, ChevronDown, Plus } from 'pixelarticons/react'
import { useStore, useWidgets, actions, notify, on, isoDay, occursOn } from './core'
import { CommandBar } from './modules/chat/index.jsx'

const greetPart = () => { const h = new Date().getHours(); return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening' }
const todayStr = () => new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

// Overview's expandable stats panel — the shell's own nav extra, not a module's.
function OverviewStats() {
  const { tasks, events, streak } = useStore()
  const done = tasks.filter((t) => t.done).length
  const stats = [
    { lbl: 'Completed', val: done },
    { lbl: 'Open tasks', val: tasks.length - done },
    { lbl: 'Day streak', val: streak.count },
    { lbl: "Today's events", val: events.filter((e) => occursOn(e, isoDay())).length },
  ]
  return stats.map((s) => <div className="nav-sub-stat" key={s.lbl}><span>{s.lbl}</span><span>{s.val}</span></div>)
}

// One sidebar entry, fully described by a module manifest's { title, icon, nav }.
function NavItem({ m, active }) {
  const state = useStore()
  const badge = m.nav?.badge?.(state)
  const hasPanel = !!m.nav?.Panel
  if (!hasPanel && !m.nav?.onAdd) return (
    <button className={'nav-item' + (active ? ' active' : '')} onClick={() => actions.setView(m.id)}>
      <m.icon size={18} /><span className="nav-label-txt">{m.title}</span>
      {badge > 0 && <span className="nav-badge">{badge}</span>}
    </button>
  )
  const open = !!state.ui.navOpen[m.id]
  return (
    <div className="nav-group">
      <div className={'nav-item nav-item-split' + (active ? ' active' : '')}>
        <button className="nav-item-main" onClick={() => actions.setView(m.id)}>
          <m.icon size={18} /><span className="nav-label-txt">{m.title}</span>
          {badge > 0 && <span className="nav-badge">{badge}</span>}
        </button>
        {m.nav?.onAdd && <button className="nav-add" onClick={m.nav.onAdd} title={'New ' + m.title.toLowerCase().replace(/s$/, '')}><Plus size={14} /></button>}
        {hasPanel && (
          <button className={'nav-expand' + (open ? ' open' : '')} onClick={() => actions.toggleNavPanel(m.id)} title={m.title + ' panel'}>
            <ChevronDown size={14} />
          </button>
        )}
      </div>
      {open && hasPanel && <div className="nav-sub"><m.nav.Panel /></div>}
    </div>
  )
}

function Sidebar({ view, widgets, onShutdown }) {
  const overview = { id: 'overview', title: 'Overview', icon: Grid3x3, nav: { Panel: OverviewStats } }
  const nav = [overview, ...widgets.filter((w) => w.Page)]
  return (
    <nav id="sidebar">
      <div className="brand"><div className="logo"><Cpu size={16} /></div><div className="name">Engram</div></div>
      <div className="nav">
        {nav.map((m) => <NavItem key={m.id} m={m} active={view === m.id} />)}
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

function NameModal({ open, value, onChange, onConfirm }) {
  if (!open) return null
  return (
    <div className="modal-overlay">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>Welcome to Engram</h3>
        <p>What's your name?</p>
        <input autoFocus className="modal-input" value={value} onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onConfirm()} placeholder="Enter your name" />
        <div className="modal-actions">
          <button className="nav-item" disabled={!value.trim()} onClick={onConfirm}>Continue</button>
        </div>
      </div>
    </div>
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
  const { ui, notifs, settings } = useStore()
  const widgets = useWidgets()
  const [bellOpen, setBellOpen] = useState(false)
  const [seen, setSeen] = useState(0)
  const [confirmShutdown, setConfirmShutdown] = useState(false)
  const [shutDown, setShutDown] = useState(false)
  const [askName, setAskName] = useState(false)
  const [nameInput, setNameInput] = useState(settings.userName)
  const unread = notifs.length - seen

  useEffect(() => {
    if (!settings.userName) setAskName(true)
  }, [])

  const solo = ui.view !== 'overview'
  const shown = solo ? widgets.filter((w) => w.id === ui.view && w.Page) : widgets.filter((w) => w.Widget)

  if (shutDown) return <ShutdownScreen />

  return (
    <>
      <Sidebar view={ui.view} widgets={widgets} onShutdown={() => setConfirmShutdown(true)} />
      <main id="main">
        <div className="topbar">
          <div className="greeting">
            <h1>Good {greetPart()}, {settings.userName}</h1>
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
          {shown.map((w) => {
            const Body = solo ? w.Page : w.Widget
            return (
              <section className="card" key={w.id} style={{ gridColumn: `span ${solo ? 12 : w.span}` }}>
                <div className="card-h"><w.icon size={16} /><h2>{w.title}</h2></div>
                <div className="card-b"><Body /></div>
              </section>
            )
          })}
        </div>
      </main>
      <Toaster />
      <NotifPanel open={bellOpen} notifs={notifs} onClose={() => setBellOpen(false)} />
      <NameModal
        open={askName}
        value={nameInput}
        onChange={setNameInput}
        onConfirm={() => { actions.setSettings({ userName: nameInput.trim() }); setAskName(false) }}
      />
      <ShutdownModal
        open={confirmShutdown}
        onCancel={() => setConfirmShutdown(false)}
        onConfirm={() => { setConfirmShutdown(false); fetch('/__shutdown', { method: 'POST' }).finally(() => setShutDown(true)) }}
      />
    </>
  )
}
