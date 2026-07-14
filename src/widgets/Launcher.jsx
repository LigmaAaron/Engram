import { useState } from 'react'
import { Terminal, Plus, Close, ExternalLink, Mail, Calendar, Folder, Message } from 'pixelarticons/react'
import { useStore, actions, registerWidget, toast } from '../core'
import Dropdown from '../Dropdown'

const ICONS = { Mail, Terminal, Calendar, Folder, Message, ExternalLink }
const ICON_NAMES = { Mail: 'Mail', Terminal: 'Terminal', Calendar: 'Calendar', Folder: 'Folder', Message: 'Chat', ExternalLink: 'Link' }
const ICON_OPTIONS = Object.entries(ICONS).map(([value, Icon]) => ({
  value, label: <span className="icon-opt"><Icon size={14} />{ICON_NAMES[value]}</span>,
}))

function Launcher() {
  const { links } = useStore()
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [icon, setIcon] = useState('ExternalLink')

  const add = () => {
    const l = label.trim()
    let u = url.trim()
    if (!l || !u) return
    if (!/^https?:\/\//.test(u)) u = 'https://' + u
    actions.addLink(l, u, icon)
    setLabel(''); setUrl('')
  }

  return (
    <>
      <div className="add-row launch-add-row">
        <input value={label} onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Link name…" />
        <input value={url} onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="https://…" />
        <Dropdown value={icon} onChange={setIcon} title="Icon" options={ICON_OPTIONS} />
        <button onClick={add} aria-label="Add link"><Plus size={15} /></button>
      </div>
      {links.length === 0
        ? <div className="empty">No links yet. Add one above.</div>
        : <div className="launch-grid">
            {links.map((l, i) => {
              const Icon = ICONS[l.icon] || ExternalLink
              return (
                <div className="launch" key={i}>
                  <a className="launch-link" href={l.url} target="_blank" rel="noopener noreferrer">
                    <span className="tile"><Icon size={16} /></span>
                    <span className="lbl">{l.label}</span>
                  </a>
                  <button className="rm" aria-label={`Remove ${l.label}`}
                    onClick={() => { actions.removeLink(i); toast('Link removed', l.label, () => actions.restoreLink(l)) }}><Close size={13} /></button>
                </div>
              )
            })}
          </div>}
    </>
  )
}

registerWidget({ id: 'launcher', title: 'Quick launch', icon: Terminal, order: 50, span: 12, Widget: Launcher, Page: Launcher })
export default Launcher
