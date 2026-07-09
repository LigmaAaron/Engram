import { useEffect, useState } from 'react'
import { Grid3x3, Settings2, Bell, Search, Cpu, Power } from 'pixelarticons/react'
import { useStore, useWidgets, actions, notify, on } from './core'
import { CommandBar } from './widgets/Chat'

const greetPart = () => { const h = new Date().getHours(); return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening' }
const todayStr = () => new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

function Sidebar({ view, widgets, onShutdown }) {
  const nav = [{ id: 'overview', title: 'Overview', icon: Grid3x3 }, ...widgets]
  return (
    <nav id="sidebar">
      <div className="brand"><div className="logo"><Cpu size={16} /></div><div className="name">AaronOS</div></div>
      <div className="nav">
        {nav.map((n) => (
          <button key={n.id} className={'nav-item' + (view === n.id ? ' active' : '')} onClick={() => actions.setView(n.id)}>
            <n.icon size={18} /><span className="nav-label-txt">{n.title}</span>
          </button>
        ))}
      </div>
      <div className="nav-spacer" />
      <div className="nav">
        <button className="nav-item" onClick={() => notify('Settings', 'Nothing to configure yet — wire it via window.AaronOS.')}>
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
        <h3>Shut down AaronOS?</h3>
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
      <p>&gt; AaronOS stopped.</p>
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
  useEffect(() => on('toast', (t) => {
    const id = Math.random()
    setToasts((x) => [...x, { ...t, id }])
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 4000)
  }), [])
  return (
    <div id="toasts">
      {toasts.map((t) => (
        <div className="toast" key={t.id}><div className="t">{t.title}</div>{t.body && <div className="b">{t.body}</div>}</div>
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
        <div className="grid">
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
