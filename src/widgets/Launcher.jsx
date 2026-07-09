import { Terminal, Plus, Close, ExternalLink, Mail, Calendar, Folder, Message } from 'pixelarticons/react'
import { useStore, actions, registerWidget } from '../core'

const ICONS = { Mail, Terminal, Calendar, Folder, Message, ExternalLink }

function Launcher() {
  const { links } = useStore()
  const add = () => {
    const label = prompt('Link name?'); if (!label) return
    let url = prompt('URL?', 'https://'); if (!url) return
    if (!/^https?:\/\//.test(url)) url = 'https://' + url
    actions.addLink(label, url, 'ExternalLink')
  }

  return (
    <div className="launch-grid">
      {links.map((l, i) => {
        const Icon = ICONS[l.icon] || ExternalLink
        return (
          <a className="launch" key={i} href={l.url} target="_blank" rel="noopener noreferrer">
            <span className="tile"><Icon size={16} /></span>
            <span className="lbl">{l.label}</span>
            <button className="rm" onClick={(e) => { e.preventDefault(); actions.removeLink(i) }}><Close size={13} /></button>
          </a>
        )
      })}
      <button className="launch add-launch" onClick={add}>
        <span className="tile"><Plus size={16} /></span>
        <span className="lbl">Add</span>
      </button>
    </div>
  )
}

registerWidget({ id: 'launcher', title: 'Quick launch', icon: Terminal, span: 12, Component: Launcher })
export default Launcher
