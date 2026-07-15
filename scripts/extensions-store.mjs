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
import { readFile, writeFile, mkdir, rm, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'

const FILE = 'data/extensions.json'
const CACHE_DIR = 'data/extensions-cache'
const MODULES_DIR = 'src/modules'

const safeId = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '')
const str = (v) => (typeof v === 'string' && v.trim()) || undefined

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

// Reads <path>/info.json (or the repo-root info.json when path is '') from
// the cached clone via `git show` — no checkout needed, same technique as
// archiveExtract. info.json is always optional: any failure (missing file,
// git error, invalid JSON, not an object) resolves to null, never throws.
async function readInfoJson(repoDir, path) {
  const gitPath = path ? `${path}/info.json` : 'info.json'
  try {
    const parsed = JSON.parse(await run('git', ['show', `HEAD:${gitPath}`], { cwd: repoDir }))
    return (parsed && typeof parsed === 'object') ? parsed : null
  } catch {
    return null
  }
}

// A library is cloned --depth 1, so there's exactly one commit — its author
// is the closest thing to a "creator" available without fetching more
// history. Never throws; a failed git log just means no creator field.
async function readCreator(repoDir) {
  try {
    return str(await run('git', ['log', '-1', '--format=%an', 'HEAD'], { cwd: repoDir }))
  } catch {
    return undefined
  }
}

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

export async function addLibrary(url) {
  const u = String(url || '').trim()
  if (!u) throw new Error('missing url')
  const data = await load()
  const slug = slugFromUrl(u)
  if (data.libraries.some((l) => l.id === slug)) throw new Error(`library already added: ${slug}`)
  const dir = join(CACHE_DIR, slug)
  await mkdir(CACHE_DIR, { recursive: true })
  await run('git', ['clone', '--no-checkout', '--depth', '1', '--filter=blob:none', u, dir])
  data.libraries.push({ id: slug, url: u, ...(await scanLibrary(dir)) })
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
  data.installed.push({ id: extId, library: libraryId, path: candidate.path, treeHash: candidate.treeHash, outdated: false })
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
