import { useEffect, useState } from 'react'
import { Box, Plus, Close } from 'pixelarticons/react'
import { registerWidget, toast } from '../../core'

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

function Extensions() {
  const [data, setData] = useState({ libraries: [], installed: [] })
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

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

  return (
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
  )
}

registerWidget({ id: 'extensions', title: 'Extensions', icon: Box, order: 70, Page: Extensions })
export default Extensions
