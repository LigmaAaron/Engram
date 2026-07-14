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
