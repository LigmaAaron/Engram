import { useEffect, useState } from 'react'
import { Box, Plus, Close } from 'pixelarticons/react'
import { registerWidget, toast, notify, store } from '../../core'

async function api(method, path, body) {
  const res = await fetch(`/__extensions${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`)
  return data
}

const outdatedIds = (installed) => installed.filter((e) => e.outdated).map((e) => e.id)

function notifyNewlyOutdated(data, newlyOutdated) {
  for (const id of newlyOutdated) {
    const entry = data.installed.find((e) => e.id === id)
    const lib = data.libraries.find((l) => l.id === entry?.library)
    const ext = lib?.extensions.find((e) => e.path === entry?.path)
    notify('Extension update available', ext?.title || id)
  }
}

// Runs once per app session, in the background, shortly after this module
// loads — independent of whether the Extensions page is ever visited, so
// the sidebar badge/notification can appear without navigating here. This
// module evaluates before main.jsx's hydrate() resolves (import.meta.glob
// runs before the awaited hydrate() call), so an immediate store.set here
// would just get overwritten by hydrate()'s state replacement — waiting for
// the store's first post-hydrate notification sidesteps that.
let scheduled = false
const unsubBoot = store.subscribe(() => {
  unsubBoot()
  if (scheduled) return
  scheduled = true
  setTimeout(() => {
    api('POST', '/check', {}).then(({ newlyOutdated, ...data }) => {
      store.set({ extensionsOutdated: outdatedIds(data.installed) })
      notifyNewlyOutdated(data, newlyOutdated)
    }).catch(() => {})
  }, 3000)
})

function Extensions() {
  const [data, setData] = useState({ libraries: [], installed: [] })
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [tab, setTab] = useState('libraries')

  useEffect(() => {
    api('GET', '').then(setData).catch((e) => toast('Failed to load extensions', e.message))
  }, [])

  const addLibrary = () => {
    const u = url.trim()
    if (!u) return
    setBusy(true)
    api('POST', '/library', { url: u })
      .then((d) => { setData(d); setUrl('') })
      .catch((e) => toast('Failed to add library', e.message))
      .finally(() => setBusy(false))
  }

  const removeLibrary = (id) => {
    setBusy(true)
    api('DELETE', `/library/${id}`)
      .then(setData)
      .catch((e) => toast('Failed to remove library', e.message))
      .finally(() => setBusy(false))
  }

  const install = (libraryId, ext) => {
    setBusy(true)
    api('POST', '/install', { libraryId, path: ext.path, id: ext.id })
      .then(setData)
      .catch((e) => toast('Failed to install extension', e.message))
      .finally(() => setBusy(false))
  }

  const uninstall = (id) => {
    setBusy(true)
    api('DELETE', `/install/${id}`)
      .then(setData)
      .catch((e) => toast('Failed to remove extension', e.message))
      .finally(() => setBusy(false))
  }

  const checkForUpdates = () => {
    setChecking(true)
    api('POST', '/check', {})
      .then(({ newlyOutdated, ...d }) => {
        setData(d)
        store.set({ extensionsOutdated: outdatedIds(d.installed) })
        notifyNewlyOutdated(d, newlyOutdated)
      })
      .catch((e) => toast('Failed to check for updates', e.message))
      .finally(() => setChecking(false))
  }

  const update = (id) => {
    setBusy(true)
    api('POST', `/update/${id}`, {})
      .then((d) => { setData(d); store.set({ extensionsOutdated: outdatedIds(d.installed) }) })
      .catch((e) => toast('Failed to update extension', e.message))
      .finally(() => setBusy(false))
  }

  const outdated = data.installed.filter((e) => e.outdated)

  return (
    <>
      <div className="ext-tabs">
        <button className={'ext-tab' + (tab === 'libraries' ? ' active' : '')} onClick={() => setTab('libraries')}>Libraries</button>
        <button className={'ext-tab' + (tab === 'outdated' ? ' active' : '')} onClick={() => setTab('outdated')}>
          Outdated{outdated.length > 0 && <span className="ext-tab-badge">{outdated.length}</span>}
        </button>
        <button className="ext-check-btn" onClick={checkForUpdates} disabled={checking}>
          {checking ? 'Checking…' : 'Check for updates'}
        </button>
      </div>

      {tab === 'libraries' ? (
        <>
          <div className="add-row">
            <input value={url} onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addLibrary()} placeholder="Repo URL…" disabled={busy} />
            <button onClick={addLibrary} disabled={busy} aria-label="Add library"><Plus size={15} /></button>
          </div>
          {data.libraries.length === 0
            ? <div className="empty">No libraries yet. Add a repo URL above.</div>
            : data.libraries.map((lib) => (
                <div className="ext-lib" key={lib.id}>
                  <div className="ext-lib-h">
                    <div className="ext-lib-info">
                      <span className="ext-lib-name">{lib.name || lib.url}</span>
                      {lib.description && <span className="ext-lib-desc">{lib.description}</span>}
                      {lib.creator && <span className="ext-lib-creator">by {lib.creator}</span>}
                    </div>
                    <button className="icon-btn" aria-label={`Remove ${lib.name || lib.url}`} disabled={busy}
                      onClick={() => removeLibrary(lib.id)}><Close size={13} /></button>
                  </div>
                  {lib.extensions.length === 0
                    ? <div className="empty">No extensions found in this repo.</div>
                    : lib.extensions.map((ext) => {
                        const installedEntry = data.installed.find((e) => e.library === lib.id && e.path === ext.path)
                        return (
                          <div className="ext-row" key={ext.path}>
                            <div className="ext-row-info">
                              <span className="ext-row-title">{ext.title}</span>
                              {ext.description && <span className="ext-row-desc">{ext.description}</span>}
                            </div>
                            <button disabled={busy}
                              onClick={() => (installedEntry ? uninstall(installedEntry.id) : install(lib.id, ext))}>
                              {installedEntry ? 'Uninstall' : 'Install'}
                            </button>
                          </div>
                        )
                      })}
                </div>
              ))}
        </>
      ) : (
        outdated.length === 0
          ? <div className="empty">Nothing to update.</div>
          : outdated.map((entry) => {
              const lib = data.libraries.find((l) => l.id === entry.library)
              const ext = lib?.extensions.find((e) => e.path === entry.path)
              return (
                <div className="ext-row" key={entry.id}>
                  <div className="ext-row-info">
                    <span className="ext-row-title">{ext?.title || entry.id}</span>
                    <span className="ext-row-desc">from {lib?.name || lib?.url || entry.library}</span>
                  </div>
                  <button disabled={busy} onClick={() => update(entry.id)}>Update</button>
                </div>
              )
            })
      )}
    </>
  )
}

registerWidget({
  id: 'extensions', title: 'Extensions', icon: Box, order: 70, Page: Extensions,
  nav: { badge: (state) => state.extensionsOutdated.length },
})
export default Extensions
