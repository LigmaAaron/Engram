# Extensions Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Extensions page where the user adds git repo URLs ("libraries"), each scanned for module-shaped folders, and installs/uninstalls individual extensions into `src/modules/` on demand.

**Architecture:** A new `scripts/extensions-store.mjs` holds all git/filesystem logic (clone-metadata-only, tree scan, per-extension archive-extract, JSON persistence to `data/extensions.json`), following the existing `scripts/state-store.mjs` / `scripts/agent.mjs` split. `vite.config.js` gets one new middleware plugin exposing that logic over HTTP at `/__extensions`, same pattern as the existing `/__data` and `/__memory` routes. A new self-registering module, `src/modules/extensions/index.jsx`, is the UI — no changes to `App.jsx`/`main.jsx`.

**Tech Stack:** Node.js (`node:child_process`, `node:fs/promises`), git CLI, tar CLI (both already required by the dev machine), Vite dev-server middleware, React.

## Global Constraints

- New widgets/pages are new `src/modules/<id>/` folders — never edit `App.jsx`/`main.jsx` (see project convention).
- No new npm dependencies — git/tar are invoked as external CLIs via `child_process`, matching how `scripts/ensure-ollama.js` already shells out.
- `data/extensions.json` and `data/extensions-cache/` are local/derived state — gitignored, same treatment as `data/state.json`.
- Adding a library must not fetch any file contents — only commit/tree metadata (`--filter=blob:none`, no checkout). File contents are fetched only when a specific extension is installed (`git archive` of just that one path).
- Uninstall/install can never touch a folder that isn't tracked in `extensions.json`'s own lists — this is what protects built-in modules.

---

### Task 1: `scripts/extensions-store.mjs` — git/filesystem core logic

**Files:**
- Create: `scripts/extensions-store.mjs`
- Create: `scripts/extensions-store.test.mjs`

**Interfaces:**
- Produces (consumed by Task 2's middleware):
  - `loadExtensions(): Promise<{libraries: Array<{id, url, extensions: Array<{path, id, title}>}>, installed: Array<{id, library, path}>}>`
  - `addLibrary(url: string): Promise<same shape as loadExtensions()>`
  - `removeLibrary(id: string): Promise<same shape>`
  - `installExtension(libraryId: string, path: string, id?: string): Promise<same shape>`
  - `uninstallExtension(id: string): Promise<same shape>`
  - All reject with an `Error` whose `.message` is safe to show the user directly (bad url, unknown library, id collision, etc).

- [ ] **Step 1: Write `scripts/extensions-store.mjs`**

```js
// Extensions: git repos ("libraries") scanned for module-shaped folders
// (anything containing an index.jsx), installed one at a time into
// src/modules/<id>. Adding a library only fetches commit+tree metadata
// (--filter=blob:none, --no-checkout) — no file contents. Installing an
// extension is the only step that pulls actual file bytes, via `git
// archive` of just that one path piped into `tar -x`. State lives in
// data/extensions.json, plain JSON (low write frequency, no atomic-write
// dance like state.json — a bad write self-heals on the next addLibrary
// rescan).
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'

const FILE = 'data/extensions.json'
const CACHE_DIR = 'data/extensions-cache'
const MODULES_DIR = 'src/modules'

const safeId = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '')

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, opts)
    let stdout = '', stderr = ''
    child.stdout?.on('data', (d) => { stdout += d })
    child.stderr?.on('data', (d) => { stderr += d })
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `${cmd} exited ${code}`))))
  })
}

// Pipes `git archive` straight into `tar -x` — materializes one path from a
// cached repo without checking out the repo's working tree at all.
function archiveExtract(repoDir, path, destDir) {
  return new Promise((resolve, reject) => {
    const archive = spawn('git', ['archive', '--format=tar', `HEAD:${path}`], { cwd: repoDir })
    const extract = spawn('tar', ['-x', '-C', destDir])
    archive.stdout.pipe(extract.stdin)
    let stderr = ''
    archive.stderr.on('data', (d) => { stderr += d })
    extract.stderr.on('data', (d) => { stderr += d })
    let settled = false
    const fail = (e) => { if (!settled) { settled = true; reject(e) } }
    archive.on('error', fail)
    extract.on('error', fail)
    extract.on('close', (code) => {
      if (settled) return
      if (code === 0) { settled = true; resolve() }
      else fail(new Error(stderr.trim() || 'archive extract failed'))
    })
  })
}

async function load() {
  try {
    const parsed = JSON.parse(await readFile(FILE, 'utf8'))
    return { libraries: [], installed: [], ...parsed }
  } catch {
    return { libraries: [], installed: [] }
  }
}

async function save(data) {
  await mkdir(dirname(FILE), { recursive: true })
  await writeFile(FILE, JSON.stringify(data, null, 2))
}

// Repo URL -> filesystem-safe cache dir name, e.g.
// "https://github.com/x/aaronos-extras.git" -> "github-com-x-aaronos-extras"
function slugFromUrl(url) {
  return safeId(url.replace(/^\w+:\/\//, '').replace(/\.git$/, ''))
}

export async function loadExtensions() {
  return load()
}

export async function addLibrary(url) {
  const u = String(url || '').trim()
  if (!u) throw new Error('missing url')
  const data = await load()
  const slug = slugFromUrl(u)
  if (data.libraries.some((l) => l.id === slug)) throw new Error(`library already added: ${slug}`)
  const dir = join(CACHE_DIR, slug)
  await mkdir(CACHE_DIR, { recursive: true })
  await run('git', ['clone', '--no-checkout', '--depth', '1', '--filter=blob:none', u, dir])
  const tree = await run('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: dir })
  const extensions = tree.split('\n')
    .filter((p) => p.endsWith('/index.jsx'))
    .map((p) => p.slice(0, -'/index.jsx'.length))
    .map((p) => ({ path: p, id: safeId(basename(p)), title: basename(p) }))
  data.libraries.push({ id: slug, url: u, extensions })
  await save(data)
  return data
}

export async function removeLibrary(id) {
  const data = await load()
  if (!data.libraries.some((l) => l.id === id)) throw new Error(`unknown library: ${id}`)
  await rm(join(CACHE_DIR, id), { recursive: true, force: true })
  data.libraries = data.libraries.filter((l) => l.id !== id)
  await save(data)
  return data
}

export async function installExtension(libraryId, path, id) {
  const data = await load()
  const lib = data.libraries.find((l) => l.id === libraryId)
  if (!lib) throw new Error(`unknown library: ${libraryId}`)
  const candidate = lib.extensions.find((e) => e.path === path)
  if (!candidate) throw new Error(`unknown extension path: ${path}`)
  const extId = safeId(id || candidate.id)
  if (!extId) throw new Error('invalid extension id')
  const dest = join(MODULES_DIR, extId)
  if (existsSync(dest)) throw new Error(`src/modules/${extId} already exists`)
  await mkdir(dest, { recursive: true })
  await archiveExtract(join(CACHE_DIR, libraryId), candidate.path, dest)
  data.installed.push({ id: extId, library: libraryId, path: candidate.path })
  await save(data)
  return data
}

export async function uninstallExtension(id) {
  const data = await load()
  if (!data.installed.some((e) => e.id === id)) throw new Error(`not an installed extension: ${id}`)
  await rm(join(MODULES_DIR, id), { recursive: true, force: true })
  data.installed = data.installed.filter((e) => e.id !== id)
  await save(data)
  return data
}
```

- [ ] **Step 2: Write `scripts/extensions-store.test.mjs`**

```js
// Guards the extensions pipeline end to end: adding a library only scans
// metadata, installing materializes just one extension's files, install/
// uninstall reject anything not in their own tracked lists, and removing a
// library doesn't touch an already-installed copy. Run:
//   node scripts/extensions-store.test.mjs
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { chdir, cwd } from 'node:process'

const run = (cmd, args, opts) => new Promise((resolve, reject) => {
  const c = spawn(cmd, args, opts)
  let err = ''
  c.stderr?.on('data', (d) => { err += d })
  c.on('error', reject)
  c.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err))))
})

// Build a throwaway git repo to act as the "remote" library.
const remoteRoot = await mkdtemp(join(tmpdir(), 'aaronos-ext-remote-'))
const remote = join(remoteRoot, 'lib-src')
await mkdir(join(remote, 'foo-ext'), { recursive: true })
await mkdir(join(remote, 'not-a-module'), { recursive: true })
await writeFile(join(remote, 'foo-ext', 'index.jsx'), 'export default function(){}\n')
await writeFile(join(remote, 'not-a-module', 'readme.md'), 'hi\n')
await run('git', ['init', '-q'], { cwd: remote })
await run('git', ['add', '-A'], { cwd: remote })
await run('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: remote })

// Run the whole test inside a scratch project dir so the relative
// data/src/modules paths extensions-store.mjs writes to land in a
// throwaway place instead of the real project.
const projectDir = await mkdtemp(join(tmpdir(), 'aaronos-ext-project-'))
await mkdir(join(projectDir, 'src', 'modules'), { recursive: true })
const originalCwd = cwd()
chdir(projectDir)

const { addLibrary, installExtension, uninstallExtension, removeLibrary, loadExtensions } =
  await import(join(originalCwd, 'scripts', 'extensions-store.mjs'))

try {
  // 1. adding a library only scans metadata — nothing installed yet
  let data = await addLibrary(remote)
  assert.equal(data.libraries.length, 1)
  assert.deepEqual(data.libraries[0].extensions.map((e) => e.path), ['foo-ext'])
  assert.equal(data.installed.length, 0)
  assert.ok(!existsSync(join(projectDir, 'src/modules/foo-ext')), 'nothing written to src/modules yet')

  const libId = data.libraries[0].id

  // 2. installing materializes just that one extension's files
  data = await installExtension(libId, 'foo-ext', 'foo-ext')
  assert.equal(data.installed.length, 1)
  const written = await readFile(join(projectDir, 'src/modules/foo-ext/index.jsx'), 'utf8')
  assert.equal(written, 'export default function(){}\n')

  // 3. installing again over the same id is rejected (never overwrites)
  await assert.rejects(() => installExtension(libId, 'foo-ext', 'foo-ext'), /already exists/)

  // 4. uninstalling an id that was never installed is rejected
  await assert.rejects(() => uninstallExtension('not-installed'), /not an installed extension/)

  // 5. uninstall removes the files and the record
  data = await uninstallExtension('foo-ext')
  assert.equal(data.installed.length, 0)
  assert.ok(!existsSync(join(projectDir, 'src/modules/foo-ext')))

  // 6. removing the library drops its record but doesn't touch a reinstall
  data = await installExtension(libId, 'foo-ext', 'foo-ext')
  data = await removeLibrary(libId)
  assert.equal(data.libraries.length, 0)
  assert.ok(existsSync(join(projectDir, 'src/modules/foo-ext')), 'installed copy survives library removal')

  // 7. state round-trips through disk
  const reloaded = await loadExtensions()
  assert.deepEqual(reloaded, data)

  console.log('ok — extensions-store integrity checks passed')
} finally {
  chdir(originalCwd)
  await rm(projectDir, { recursive: true, force: true })
  await rm(remoteRoot, { recursive: true, force: true })
}
```

- [ ] **Step 3: Run the test and verify it passes**

Run: `node scripts/extensions-store.test.mjs`
Expected: `ok — extensions-store integrity checks passed` printed, exit code 0. (There's no separate "verify it fails first" step here since the implementation was written alongside the test — if you want strict red/green, comment out the body of `installExtension` to force a failure, confirm the test fails with a clear assertion error, then restore it before continuing.)

- [ ] **Step 4: Commit**

```bash
git add scripts/extensions-store.mjs scripts/extensions-store.test.mjs
git commit -m "feat: add extensions-store git/fs core logic"
```

---

### Task 2: Wire `/__extensions` middleware into `vite.config.js`

**Files:**
- Modify: `vite.config.js`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the five functions produced by Task 1 (`loadExtensions`, `addLibrary`, `removeLibrary`, `installExtension`, `uninstallExtension`), imported from `./scripts/extensions-store.mjs`.
- Produces (consumed by Task 3's UI):
  - `GET /__extensions` → 200, JSON body `{libraries, installed}`
  - `POST /__extensions/library` body `{url}` → 200, JSON body `{libraries, installed}`; 400 JSON `{error}` on failure
  - `DELETE /__extensions/library/:id` → 200, JSON body `{libraries, installed}`; 400 JSON `{error}` on failure
  - `POST /__extensions/install` body `{libraryId, path, id?}` → 200, JSON body `{libraries, installed}`; 400 JSON `{error}` on failure
  - `DELETE /__extensions/install/:id` → 200, JSON body `{libraries, installed}`; 400 JSON `{error}` on failure

- [ ] **Step 1: Add gitignore entries**

Add to `.gitignore` (after the existing `data/memory.md` line):

```
data/extensions.json
data/extensions-cache/
```

- [ ] **Step 2: Add the `extensionsPlugin` middleware to `vite.config.js`**

At the top of `vite.config.js`, add the import alongside the existing ones:

```js
import { loadExtensions, addLibrary, removeLibrary, installExtension, uninstallExtension } from './scripts/extensions-store.mjs'
```

Add this new plugin function after `dataStore()` (before `export default defineConfig(...)`):

```js
// Extensions: add a git repo, browse the module-shaped folders it contains,
// install/uninstall them individually into src/modules. See
// scripts/extensions-store.mjs for the git/fs logic — this is just routing.
function extensionsPlugin() {
  return {
    name: 'aaronos-extensions',
    configureServer(server) {
      server.middlewares.use('/__extensions', async (req, res) => {
        const url = new URL(req.url, 'http://localhost')
        const segs = url.pathname.split('/').filter(Boolean)
        const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
        const readBody = (req) => new Promise((resolve) => {
          let b = ''
          req.on('data', (c) => { b += c })
          req.on('end', () => { try { resolve(JSON.parse(b || '{}')) } catch { resolve({}) } })
        })

        try {
          if (req.method === 'GET' && segs.length === 0) return send(200, await loadExtensions())
          if (req.method === 'POST' && segs[0] === 'library' && segs.length === 1) {
            const { url: repoUrl } = await readBody(req)
            return send(200, await addLibrary(repoUrl))
          }
          if (req.method === 'DELETE' && segs[0] === 'library' && segs[1]) return send(200, await removeLibrary(segs[1]))
          if (req.method === 'POST' && segs[0] === 'install' && segs.length === 1) {
            const { libraryId, path, id } = await readBody(req)
            return send(200, await installExtension(libraryId, path, id))
          }
          if (req.method === 'DELETE' && segs[0] === 'install' && segs[1]) return send(200, await uninstallExtension(segs[1]))
          send(404, { error: 'not found' })
        } catch (e) {
          send(400, { error: e.message })
        }
      })
    },
  }
}
```

Register it in the plugins array:

```js
export default defineConfig({
  plugins: [react(), dataStore(), extensionsPlugin()],
```

(replacing the existing `plugins: [react(), dataStore()],` line)

- [ ] **Step 3: Manually verify the endpoints against a local fixture repo**

```bash
# 1. Build a tiny fixture "remote" repo
FIXTURE=$(mktemp -d)/lib-src
mkdir -p "$FIXTURE/foo-ext"
echo "export default function(){}" > "$FIXTURE/foo-ext/index.jsx"
git init -q "$FIXTURE"
git -C "$FIXTURE" add -A
git -C "$FIXTURE" -c user.email=t@t.com -c user.name=t commit -q -m init

# 2. Start a scratch dev server (skips predev's Ollama check)
npx vite --port 5183 > /tmp/aaronos-ext-verify.log 2>&1 &
VITE_PID=$!
until curl -sf http://localhost:5183/__extensions >/dev/null 2>&1; do sleep 0.3; done

# 3. Add the library — expect one extension, foo-ext
curl -sf -X POST http://localhost:5183/__extensions/library \
  -H 'Content-Type: application/json' -d "{\"url\":\"$FIXTURE\"}" | tee /tmp/lib.json
LIB_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/lib.json')).libraries[0].id)")

# 4. Install it — expect src/modules/foo-ext/index.jsx to exist
curl -sf -X POST http://localhost:5183/__extensions/install \
  -H 'Content-Type: application/json' -d "{\"libraryId\":\"$LIB_ID\",\"path\":\"foo-ext\",\"id\":\"foo-ext\"}"
test -f src/modules/foo-ext/index.jsx && echo "INSTALL OK"

# 5. Uninstall it — expect the folder gone
curl -sf -X DELETE http://localhost:5183/__extensions/install/foo-ext
test ! -e src/modules/foo-ext && echo "UNINSTALL OK"

# 6. Remove the library
curl -sf -X DELETE "http://localhost:5183/__extensions/library/$LIB_ID"

# 7. Clean up — this touched the real repo's src/modules and data/ dirs
kill $VITE_PID
rm -rf src/modules/foo-ext data/extensions-cache data/extensions.json
git status --short   # should show nothing extra
```

Expected: `INSTALL OK` and `UNINSTALL OK` both print, and the final `git status --short` shows no leftover files (everything touched was gitignored or manually cleaned up).

- [ ] **Step 4: Commit**

```bash
git add vite.config.js .gitignore
git commit -m "feat: wire /__extensions middleware into the dev server"
```

---

### Task 3: `src/modules/extensions/index.jsx` — Extensions page UI

**Files:**
- Create: `src/modules/extensions/index.jsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `registerWidget`, `toast` from `../../core`; the `/__extensions*` HTTP API from Task 2.
- Produces: registers module id `extensions`, order `70`, `Page` only (no overview `Widget`, no `nav` — matches the "just a page" design decision).

- [ ] **Step 1: Write `src/modules/extensions/index.jsx`**

```jsx
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
                <span className="ext-lib-url">{lib.url}</span>
                <button className="icon-btn" aria-label={`Remove ${lib.url}`} disabled={busy}
                  onClick={() => removeLibrary(lib.id)}><Close size={13} /></button>
              </div>
              {lib.extensions.length === 0
                ? <div className="empty">No extensions found in this repo.</div>
                : lib.extensions.map((ext) => {
                    const installedEntry = data.installed.find((e) => e.library === lib.id && e.path === ext.path)
                    return (
                      <div className="ext-row" key={ext.path}>
                        <span className="ext-row-title">{ext.title}</span>
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
```

- [ ] **Step 2: Add Extensions CSS to `src/styles.css`**

Insert after the `.icon-opt{...}` line (end of the Launcher block, before the `/* AI Chat` comment):

```css

/* Extensions — repos scanned for module-shaped folders; installing copies
   just one extension's files into src/modules, nothing else from the repo. */
.ext-lib{border:1px solid var(--border-soft);margin-bottom:10px;}
.ext-lib-h{display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface-2);border-bottom:1px solid var(--border-soft);}
.ext-lib-url{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;color:var(--text-dim);}
.ext-lib-h .icon-btn{width:26px;height:26px;flex:0 0 auto;}
.ext-row{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--border-soft);}
.ext-row:last-child{border-bottom:none;}
.ext-row-title{flex:1;font-size:13px;}
.ext-row button{border:1px solid var(--border);background:none;color:var(--text-dim);font:inherit;cursor:pointer;font-size:11.5px;padding:4px 9px;transition:border-color .15s ease,color .15s ease;}
.ext-row button:hover{color:var(--text);border-color:var(--text-faint);}
.ext-row button:disabled,.ext-lib-h button:disabled{opacity:.5;cursor:default;}
```

- [ ] **Step 3: Manually verify in the browser**

```bash
npm run dev
```

1. Open the app, confirm "Extensions" appears in the sidebar (icon: a box, order places it after the built-in modules).
2. Navigate to the Extensions page — expect "No libraries yet. Add a repo URL above." (the empty state).
3. Build the same fixture repo as Task 2 Step 3 (or reuse it), paste its local path into the URL field, click add (or press Enter).
4. Expect the library to appear with one extension row, "foo-ext", with an "Install" button.
5. Click Install — expect the button to flip to "Uninstall", and (via HMR) a moment later the sidebar gains a new nav entry for the installed extension (it won't render meaningfully since the fixture's `index.jsx` is a stub, but its registered id should appear).
6. Click Uninstall — expect the button to flip back to "Install" and the extra sidebar entry to disappear.
7. Click the remove-library button (X) — expect the library row to disappear.
8. Clean up: `rm -rf src/modules/foo-ext data/extensions-cache data/extensions.json` and confirm `git status --short` is clean.

- [ ] **Step 4: Commit**

```bash
git add src/modules/extensions/index.jsx src/styles.css
git commit -m "feat: add Extensions page"
```
