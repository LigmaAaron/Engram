# Extension Update Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect when an installed extension's upstream folder has changed (fingerprinted via `git ls-tree`'s tree-object hash, no blob fetches), surface it as a sidebar badge + one-time notification, and let the user update it atomically from a dedicated "Outdated" tab on the Extensions page.

**Architecture:** `scripts/extensions-store.mjs` gains a `treeHash` fingerprint on every scanned extension, a `refreshLibrary`/`checkForUpdates` pair that advances a library's cached clone to its remote's latest commit and diffs tree hashes per installed extension, and an atomic `updateExtension`. Two new `vite.config.js` routes expose these. The Extensions module writes its outdated count into the global app store (the only way `nav.badge` can see it) and adds a tab toggle to its own page.

**Tech Stack:** Same as the existing extensions feature — `node:child_process` (git CLI), no new dependencies.

## Global Constraints

- `treeHash` fingerprinting must never fetch blob content — same "metadata only" property `addLibrary` already has for everything except an installed extension's own files.
- A failed `refreshLibrary` (offline, remote gone) must leave that library's last known data untouched, never wipe it.
- `updateExtension` must never leave an extension half-deleted: extract to a temp directory first, only replace the real folder after extraction succeeds.
- The sidebar badge can only read the global app store (`data/state.json`, via `useStore()`) — `nav.badge(state)` has no access to `data/extensions.json`.
- Notification fires only for extensions newly flagged outdated on a given check, not every time an already-known-stale extension is re-checked.
- No new npm dependencies.

---

### Task 1: Tree-hash fingerprinting, `refreshLibrary`, `checkForUpdates`, `updateExtension`

**Files:**
- Modify: `scripts/extensions-store.mjs`
- Modify: `scripts/extensions-store.test.mjs`

**Interfaces:**
- Produces (consumed by Task 2's routes):
  - `refreshLibrary(id: string): Promise<library>` — throws if `id` unknown.
  - `checkForUpdates(): Promise<{ data: {libraries, installed}, newlyOutdated: string[] }>`
  - `updateExtension(id: string): Promise<{libraries, installed}>` — throws if `id` isn't installed, or its extension no longer exists in its library.
  - `installExtension`'s resolved `installed` entries now include `treeHash: string|undefined` and `outdated: false`.
  - Each library's `extensions[]` entries now include `treeHash: string|undefined`.

- [ ] **Step 1: Add `readTreeHash` and refactor the scan into `scanLibrary`**

In `scripts/extensions-store.mjs`, add this helper right after `readCreator`:

```js
// `git ls-tree HEAD -- <path>` returns one line — mode, type, object hash,
// path — for that folder. The hash fingerprints the folder's entire
// contents (recursively) as pure metadata, no blob content fetched.
// Verified locally: differs when a file inside the folder changes, stable
// otherwise.
async function readTreeHash(repoDir, path) {
  try {
    const line = (await run('git', ['ls-tree', 'HEAD', '--', path], { cwd: repoDir })).trim()
    return line.split(/\s+/)[2] || undefined
  } catch {
    return undefined
  }
}
```

Replace the tree-scan section of `addLibrary` — currently:

```js
  const tree = await run('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: dir })
  const paths = tree.split('\n')
    .filter((p) => p.endsWith('/index.jsx'))
    .map((p) => p.slice(0, -'/index.jsx'.length))
  const extensions = []
  for (const p of paths) {
    const info = await readInfoJson(dir, p)
    extensions.push({
      path: p,
      id: safeId(basename(p)),
      title: str(info?.name) || basename(p),
      description: str(info?.description),
    })
  }
  const libInfo = await readInfoJson(dir, '')
  data.libraries.push({
    id: slug,
    url: u,
    name: str(libInfo?.name),
    description: str(libInfo?.description),
    creator: await readCreator(dir),
    extensions,
  })
  await save(data)
  return data
```

with a call to a new shared `scanLibrary` helper:

```js
  data.libraries.push({ id: slug, url: u, ...(await scanLibrary(dir)) })
  await save(data)
  return data
```

And define `scanLibrary` right above `addLibrary`:

```js
// Scans a cached clone's current HEAD: every folder containing an
// index.jsx, its info.json name/description (if any), its tree-hash
// fingerprint, plus the library's own root info.json and commit author.
// Shared by addLibrary (first scan) and refreshLibrary (re-scan after
// fetching the remote's latest commit).
async function scanLibrary(dir) {
  const tree = await run('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: dir })
  const paths = tree.split('\n')
    .filter((p) => p.endsWith('/index.jsx'))
    .map((p) => p.slice(0, -'/index.jsx'.length))
  const extensions = []
  for (const p of paths) {
    const info = await readInfoJson(dir, p)
    extensions.push({
      path: p,
      id: safeId(basename(p)),
      title: str(info?.name) || basename(p),
      description: str(info?.description),
      treeHash: await readTreeHash(dir, p),
    })
  }
  const libInfo = await readInfoJson(dir, '')
  return {
    name: str(libInfo?.name),
    description: str(libInfo?.description),
    creator: await readCreator(dir),
    extensions,
  }
}
```

- [ ] **Step 2: Add `refreshLibrary`, `checkForUpdates`, `updateExtension`**

Add `refreshLibrary` right after `removeLibrary`:

```js
// Advances a library's cached (--no-checkout) clone to the remote's latest
// commit without ever checking out a working tree, then re-scans it in
// place. Verified locally: `git fetch --filter=blob:none origin HEAD` +
// `git update-ref HEAD FETCH_HEAD` works cleanly against a --no-checkout
// clone.
export async function refreshLibrary(id) {
  const data = await load()
  const lib = data.libraries.find((l) => l.id === id)
  if (!lib) throw new Error(`unknown library: ${id}`)
  const dir = join(CACHE_DIR, id)
  await run('git', ['fetch', '--filter=blob:none', 'origin', 'HEAD'], { cwd: dir })
  await run('git', ['update-ref', 'HEAD', 'FETCH_HEAD'], { cwd: dir })
  Object.assign(lib, await scanLibrary(dir))
  await save(data)
  return lib
}
```

Update `installExtension`'s push to snapshot `treeHash` and start `outdated: false` — change:

```js
  data.installed.push({ id: extId, library: libraryId, path: candidate.path })
```

to:

```js
  data.installed.push({ id: extId, library: libraryId, path: candidate.path, treeHash: candidate.treeHash, outdated: false })
```

Add `checkForUpdates` and `updateExtension` at the end of the file, after `uninstallExtension`:

```js
// Refreshes every library that has at least one installed extension (skips
// libraries nobody installed anything from — nothing to check), then
// re-derives each installed entry's `outdated` flag by comparing its
// snapshotted treeHash to the freshly-scanned one for that (library, path).
// A library whose refresh fails (offline, remote gone) is left exactly as
// it was — refreshLibrary only persists on success, so a thrown error here
// simply means that library's data doesn't change this round.
export async function checkForUpdates() {
  const libraryIds = new Set((await load()).installed.map((e) => e.library))
  for (const libId of libraryIds) {
    try { await refreshLibrary(libId) } catch { /* leave that library's last known state alone */ }
  }
  const data = await load()
  const newlyOutdated = []
  for (const entry of data.installed) {
    const lib = data.libraries.find((l) => l.id === entry.library)
    const current = lib?.extensions.find((e) => e.path === entry.path)
    const wasOutdated = !!entry.outdated
    entry.outdated = !current || current.treeHash !== entry.treeHash
    if (entry.outdated && !wasOutdated) newlyOutdated.push(entry.id)
  }
  await save(data)
  return { data, newlyOutdated }
}

// Re-fetches one extension's folder into a temp directory first; only once
// that succeeds does it delete the old src/modules/<id> and rename the temp
// directory into place. A failed fetch/extract leaves the old, working
// version fully intact and still flagged outdated.
export async function updateExtension(id) {
  const data = await load()
  const entry = data.installed.find((e) => e.id === id)
  if (!entry) throw new Error(`not an installed extension: ${id}`)
  const lib = data.libraries.find((l) => l.id === entry.library)
  if (!lib) throw new Error(`unknown library: ${entry.library}`)
  const current = lib.extensions.find((e) => e.path === entry.path)
  if (!current) throw new Error(`extension no longer exists in its library: ${entry.path}`)
  const tmp = join(CACHE_DIR, `.update-${id}`)
  await rm(tmp, { recursive: true, force: true })
  await mkdir(tmp, { recursive: true })
  try {
    await archiveExtract(join(CACHE_DIR, entry.library), entry.path, tmp)
  } catch (e) {
    await rm(tmp, { recursive: true, force: true })
    throw e
  }
  const dest = join(MODULES_DIR, id)
  await rm(dest, { recursive: true, force: true })
  await rename(tmp, dest)
  entry.treeHash = current.treeHash
  entry.outdated = false
  await save(data)
  return data
}
```

Add `rename` to the existing `node:fs/promises` import at the top of the file — change:

```js
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
```

to:

```js
import { readFile, writeFile, mkdir, rm, rename } from 'node:fs/promises'
```

- [ ] **Step 3: Extend `scripts/extensions-store.test.mjs`**

Add these imports to the existing destructured import from `extensions-store.mjs` — change:

```js
const { addLibrary, installExtension, uninstallExtension, removeLibrary, loadExtensions } =
  await import(join(originalCwd, 'scripts', 'extensions-store.mjs'))
```

to:

```js
const { addLibrary, installExtension, uninstallExtension, removeLibrary, loadExtensions, checkForUpdates, updateExtension } =
  await import(join(originalCwd, 'scripts', 'extensions-store.mjs'))
```

Add these steps right before the final `console.log('ok — ...')` line (after step 8's fallback assertions):

```js
  // 9. installing snapshots a treeHash and starts not-outdated
  data = await addLibrary(remote)
  const libId2 = data.libraries.find((l) => l.url === remote).id
  data = await installExtension(libId2, 'foo-ext', 'foo-ext')
  let entry = data.installed.find((e) => e.id === 'foo-ext')
  assert.ok(entry.treeHash, 'installed entry has a treeHash')
  assert.equal(entry.outdated, false)

  // 10. mutating the remote and checking for updates flags just that
  //     extension, and reports it as newly outdated
  await writeFile(join(remote, 'foo-ext', 'index.jsx'), 'export default function(){ return 2 }\n')
  await run('git', ['add', '-A'], { cwd: remote })
  await run('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=Fixture Author', 'commit', '-q', '-m', 'v2'], { cwd: remote })

  let result = await checkForUpdates()
  assert.deepEqual(result.newlyOutdated, ['foo-ext'])
  assert.equal(result.data.installed.find((e) => e.id === 'foo-ext').outdated, true)

  // 11. checking again with no further remote change re-confirms outdated
  //     but does not report it as newly outdated a second time
  result = await checkForUpdates()
  assert.equal(result.data.installed.find((e) => e.id === 'foo-ext').outdated, true)
  assert.deepEqual(result.newlyOutdated, [])

  // 12. updating rewrites the file, clears outdated, and adopts the new treeHash
  data = await updateExtension('foo-ext')
  const updatedContent = await readFile(join(projectDir, 'src/modules/foo-ext/index.jsx'), 'utf8')
  assert.equal(updatedContent, 'export default function(){ return 2 }\n')
  entry = data.installed.find((e) => e.id === 'foo-ext')
  assert.equal(entry.outdated, false)
  const libExt = data.libraries.find((l) => l.id === libId2).extensions.find((e) => e.path === 'foo-ext')
  assert.equal(entry.treeHash, libExt.treeHash)

  // 13. a library with zero installed extensions is left untouched by a check
  data = await addLibrary(remote2)
  const untouchedBefore = data.libraries.find((l) => l.url === remote2)
  result = await checkForUpdates()
  const untouchedAfter = result.data.libraries.find((l) => l.url === remote2)
  assert.deepEqual(untouchedAfter, untouchedBefore, 'library with nothing installed from it is not re-scanned')
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `node scripts/extensions-store.test.mjs`
Expected: `ok — extensions-store integrity checks passed` printed, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/extensions-store.mjs scripts/extensions-store.test.mjs
git commit -m "feat: detect and apply extension updates via tree-hash fingerprints"
```

---

### Task 2: Wire `/check` and `/update/:id` into `vite.config.js`

**Files:**
- Modify: `vite.config.js`

**Interfaces:**
- Consumes: `checkForUpdates`, `updateExtension` from Task 1.
- Produces (consumed by Task 3's UI):
  - `POST /__extensions/check` → 200, JSON body `{libraries, installed, newlyOutdated}` (the `checkForUpdates()` result flattened into one object); 400 JSON `{error}` on failure.
  - `POST /__extensions/update/:id` → 200, JSON body `{libraries, installed}`; 400 JSON `{error}` on failure.

- [ ] **Step 1: Update the import and add the two routes**

Change the existing import line:

```js
import { loadExtensions, addLibrary, removeLibrary, installExtension, uninstallExtension } from './scripts/extensions-store.mjs'
```

to:

```js
import { loadExtensions, addLibrary, removeLibrary, installExtension, uninstallExtension, checkForUpdates, updateExtension } from './scripts/extensions-store.mjs'
```

Inside `extensionsPlugin`'s `try` block, add these two checks right before the existing `send(404, { error: 'not found' })` line:

```js
          if (req.method === 'POST' && segs[0] === 'check' && segs.length === 1) {
            const { data, newlyOutdated } = await checkForUpdates()
            return send(200, { ...data, newlyOutdated })
          }
          if (req.method === 'POST' && segs[0] === 'update' && segs[1]) return send(200, await updateExtension(segs[1]))
```

- [ ] **Step 2: Manually verify against a local fixture repo**

```bash
FIXTURE=$(mktemp -d)/lib-src
mkdir -p "$FIXTURE/foo-ext"
echo "export default function(){}" > "$FIXTURE/foo-ext/index.jsx"
git init -q "$FIXTURE"
git -C "$FIXTURE" add -A
git -C "$FIXTURE" -c user.email=t@t.com -c user.name=t commit -q -m v1

npx vite --port 5183 > /tmp/aaronos-ext-verify.log 2>&1 &
VITE_PID=$!
for i in $(seq 1 30); do curl -sf http://localhost:5183/__extensions >/dev/null 2>&1 && break; sleep 0.3; done

LIB_ID=$(curl -sf -X POST http://localhost:5183/__extensions/library -H 'Content-Type: application/json' -d "{\"url\":\"$FIXTURE\"}" \
  | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).libraries[0].id))")
curl -sf -X POST http://localhost:5183/__extensions/install -H 'Content-Type: application/json' -d "{\"libraryId\":\"$LIB_ID\",\"path\":\"foo-ext\",\"id\":\"foo-ext\"}" > /dev/null
test -f src/modules/foo-ext/index.jsx && echo "INSTALL OK"

# no remote change yet — check should report no newly outdated
curl -sf -X POST http://localhost:5183/__extensions/check | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);console.log('newlyOutdated:',JSON.stringify(j.newlyOutdated))})"

# mutate the remote, then check again
echo "export default function(){ return 2 }" > "$FIXTURE/foo-ext/index.jsx"
git -C "$FIXTURE" add -A
git -C "$FIXTURE" -c user.email=t@t.com -c user.name=t commit -q -m v2
curl -sf -X POST http://localhost:5183/__extensions/check | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);console.log('newlyOutdated:',JSON.stringify(j.newlyOutdated))})"

curl -sf -X POST http://localhost:5183/__extensions/update/foo-ext > /dev/null
grep -q "return 2" src/modules/foo-ext/index.jsx && echo "UPDATE OK"

kill $VITE_PID
rm -rf src/modules/foo-ext data/extensions-cache data/extensions.json
git status --short
```

Expected: `INSTALL OK`, then `newlyOutdated: []` for the first check, `newlyOutdated: ["foo-ext"]` for the second, `UPDATE OK`, and a clean `git status --short` after cleanup.

- [ ] **Step 3: Commit**

```bash
git add vite.config.js
git commit -m "feat: wire extension update-check/update routes into the dev server"
```

---

### Task 3: Sidebar badge, notification, and the Outdated tab

**Files:**
- Modify: `src/core.js`
- Modify: `src/modules/extensions/index.jsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `POST /__extensions/check` and `POST /__extensions/update/:id` from Task 2; `store`, `notify`, `registerWidget`, `toast` from `../../core`.
- Produces: `state.extensionsOutdated: string[]` in the global store (new default field); `nav.badge` on the `extensions` module now reads it.

- [ ] **Step 1: Add the new default field to `src/core.js`**

Change:

```js
  notifs: [],
  streak: { count: 0, last: null },
```

to:

```js
  notifs: [],
  extensionsOutdated: [], // installed extension ids currently flagged outdated — see src/modules/extensions
  streak: { count: 0, last: null },
```

- [ ] **Step 2: Rewrite `src/modules/extensions/index.jsx`**

Replace the entire file with:

```jsx
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
```

- [ ] **Step 3: Add tab CSS to `src/styles.css`**

Insert right after the existing Extensions block's last line
(`.ext-row button:disabled,.ext-lib-h button:disabled{opacity:.5;cursor:default;}`):

```css
.ext-tabs{display:flex;align-items:center;gap:6px;margin-bottom:12px;}
.ext-tab{border:1px solid var(--border);background:none;color:var(--text-dim);font:inherit;font-size:12.5px;padding:6px 12px;cursor:pointer;transition:border-color .15s ease,color .15s ease;display:flex;align-items:center;gap:6px;}
.ext-tab:hover{color:var(--text);border-color:var(--text-faint);}
.ext-tab.active{color:var(--text);border-color:var(--text);}
.ext-tab-badge{min-width:16px;padding:1px 5px;border:1px solid currentColor;font-size:10.5px;font-weight:700;text-align:center;opacity:.85;}
.ext-check-btn{margin-left:auto;border:1px solid var(--border);background:none;color:var(--text-dim);font:inherit;font-size:12px;padding:6px 10px;cursor:pointer;transition:border-color .15s ease,color .15s ease;}
.ext-check-btn:hover{color:var(--text);border-color:var(--text-faint);}
.ext-check-btn:disabled{opacity:.5;cursor:default;}
```

- [ ] **Step 4: Manually verify in the browser**

```bash
npm run dev
```

1. Open the app. Confirm no badge appears on "Extensions" in the sidebar
   yet (no libraries added, nothing installed).
2. Build a fixture repo (same as Task 2 Step 2), go to Extensions, add it,
   switch to the "Outdated" tab — expect "Nothing to update."
3. Install `foo-ext` from the Libraries tab.
4. Mutate the fixture's `foo-ext/index.jsx` and commit again (same as Task
   2 Step 2).
5. Click "Check for updates". Expect: the "Outdated" tab badge shows `1`,
   the sidebar "Extensions" nav item gains a badge showing `1`, and a
   notification appears in the bell panel ("Extension update available").
6. Switch to the Outdated tab — expect the extension listed with an
   "Update" button.
7. Click Update. Expect the row to disappear, the badge (both tab and
   sidebar) to clear, and the installed file to reflect the new content.
8. Reload the page. Confirm the sidebar badge stays cleared (no
   re-notification for something no longer outdated).
9. Clean up: `rm -rf src/modules/foo-ext data/extensions-cache data/extensions.json`
   and confirm `git status --short` is clean.

- [ ] **Step 5: Commit**

```bash
git add src/core.js src/modules/extensions/index.jsx src/styles.css
git commit -m "feat: sidebar badge, notification, and Outdated tab for extension updates"
```
