import { useState } from 'react'
import { Settings2, User, Brush, CloudSun, Moon, Undo, Checkbox, CheckboxOn } from 'pixelarticons/react'
import { useStore, useWidgets, actions, registerWidget } from '../../core'
import { THEME_VARS, DEFAULT_THEME } from '../../theme'
import Dropdown from '../../Dropdown'
import ColorPicker from '../../ColorPicker'

const USE_CASES = [
  { value: 'student', label: 'Student' },
  { value: 'developer', label: 'Developer' },
  { value: 'writer', label: 'Writer' },
  { value: 'general', label: 'General / other' },
]
const STYLES = [
  { value: 'detailed', label: 'Detailed explanations' },
  { value: 'direct', label: 'Direct answers' },
  { value: 'concise', label: 'Concise / terse' },
]
const MODES = [
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: CloudSun },
  { value: 'system', label: 'System', icon: Settings2 },
]
const VAR_LABELS = {
  bg: 'Background', sidebar: 'Sidebar', surface: 'Surface', 'surface-2': 'Surface (raised)',
  border: 'Border', 'border-soft': 'Border (soft)', text: 'Text', 'text-dim': 'Text (dim)',
  'text-faint': 'Text (faint)', accent: 'Accent',
}

function General() {
  const { settings } = useStore()
  return (
    <div className="set-panel">
      <label className="set-field">
        <span>Name</span>
        <input className="modal-input" style={{ marginBottom: 0 }} value={settings.userName}
          onChange={(e) => actions.setSettings({ userName: e.target.value })} placeholder="Your name" />
      </label>
      <label className="set-field">
        <span>Main use</span>
        <Dropdown value={settings.useCase} onChange={(v) => actions.setSettings({ useCase: v })} options={USE_CASES} title="Main use" />
      </label>
      <label className="set-field">
        <span>AI response style</span>
        <Dropdown value={settings.style} onChange={(v) => actions.setSettings({ style: v })} options={STYLES} title="Response style" />
      </label>
    </div>
  )
}

function Appearance() {
  const { settings } = useStore()
  const theme = settings.theme
  const [advOpen, setAdvOpen] = useState(false)
  return (
    <div className="set-panel">
      <div className="set-field">
        <span>Mode</span>
        <div className="set-mode-row">
          {MODES.map((m) => (
            <button key={m.value} className={'tb-btn set-mode-btn' + (theme.mode === m.value ? ' on' : '')}
              onClick={() => actions.setTheme({ mode: m.value })} title={m.label}>
              <m.icon size={14} /><span>{m.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="set-field">
        <span>Accent color</span>
        <ColorPicker value={theme.accent} onChange={(v) => actions.setTheme({ accent: v })} title="Accent color" />
      </div>
      <button className="set-adv-toggle" onClick={() => setAdvOpen((o) => !o)}>
        {advOpen ? 'Hide advanced' : 'Show advanced'}
      </button>
      {advOpen && (
        <div className="set-adv">
          {THEME_VARS.filter((v) => v !== 'accent').map((name) => (
            <div className="set-field" key={name}>
              <span>{VAR_LABELS[name]}</span>
              <div className="set-swatch-row">
                <ColorPicker value={theme.overrides[name] || getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()}
                  onChange={(v) => actions.setThemeOverride(name, v)} title={VAR_LABELS[name]} />
                {theme.overrides[name] && (
                  <button className="icon-btn" title={`Reset ${VAR_LABELS[name]}`} onClick={() => actions.clearThemeOverride(name)}><Undo size={13} /></button>
                )}
              </div>
            </div>
          ))}
          <button className="set-reset-all" onClick={() => actions.resetTheme()}>Reset all to default</button>
        </div>
      )}
    </div>
  )
}

function VisRow({ label, on, onToggle }) {
  return (
    <div className="set-field">
      <span>{label}</span>
      <button className={'tb-btn set-vis-btn' + (on ? ' on' : '')} onClick={onToggle}>
        {on ? <CheckboxOn size={14} /> : <Checkbox size={14} />}<span>{on ? 'Shown' : 'Hidden'}</span>
      </button>
    </div>
  )
}

function ModuleCategory({ m }) {
  const { ui } = useStore()
  const vis = ui.moduleVisibility[m.id] || {}
  const Custom = m.settings
  return (
    <div className="set-panel">
      {m.Widget && <VisRow label="Show on Overview" on={vis.widget !== false} onToggle={() => actions.setModuleVisibility(m.id, { widget: vis.widget === false })} />}
      {m.Page && <VisRow label="Show in Sidebar" on={vis.page !== false} onToggle={() => actions.setModuleVisibility(m.id, { page: vis.page === false })} />}
      {Custom && <div className="set-custom"><Custom /></div>}
    </div>
  )
}

function Settings() {
  const widgets = useWidgets()
  const modules = widgets.filter((w) => w.id !== 'settings')
  const cats = [
    { id: 'general', title: 'General', icon: User, Body: General },
    { id: 'appearance', title: 'Appearance', icon: Brush, Body: Appearance },
    ...modules.map((m) => ({ id: m.id, title: m.title, icon: m.icon, Body: () => <ModuleCategory m={m} /> })),
  ]
  const [cat, setCat] = useState('general')
  const active = cats.find((c) => c.id === cat) || cats[0]
  return (
    <div className="set-shell">
      <div className="set-cats">
        {cats.map((c) => (
          <button key={c.id} className={'nav-item' + (c.id === active.id ? ' active' : '')} onClick={() => setCat(c.id)}>
            <c.icon size={16} /><span className="nav-label-txt">{c.title}</span>
          </button>
        ))}
      </div>
      <div className="set-body"><active.Body /></div>
    </div>
  )
}

registerWidget({ id: 'settings', title: 'Settings', icon: Settings2, order: 900, Page: Settings })
