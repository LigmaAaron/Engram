import { readFile, writeFile, rename, copyFile, mkdir } from 'node:fs/promises'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const isAlive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }

// File-backed state store for the dashboard, hardened against the two ways a
// plain writeFile loses data: a non-atomic write that interleaves with another
// writer (corrupt file), and an overwrite with no way back (unrecoverable).
export function makeStore(dir) {
  const FILE = join(dir, 'state.json')
  const BAK = join(dir, 'state.json.bak')
  const LOCK = join(dir, '.server.lock')

  // Keep the last good copy as .bak, write the new state to a unique temp file,
  // then rename it over the real one. rename() is atomic on POSIX, so a reader
  // never sees a half-written file — even if two processes save at the same
  // instant, each rename swaps in one whole blob (last wins) instead of the
  // corrupt trailing-garbage a shared, non-atomic writeFile produces.
  async function save(body) {
    await mkdir(dir, { recursive: true })
    if (existsSync(FILE)) await copyFile(FILE, BAK).catch(() => {})
    const tmp = `${FILE}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    await writeFile(tmp, body)
    await rename(tmp, FILE)
  }

  // Serve the live file; if it's missing or somehow unparseable, fall back to
  // the .bak so one bad write is recoverable instead of silently blank.
  async function load() {
    for (const f of [FILE, BAK]) {
      try { const txt = await readFile(f, 'utf8'); JSON.parse(txt); return txt } catch { /* try next */ }
    }
    return '{}'
  }

  // Warn (loudly) if another live server is already using this same data dir —
  // that's what corrupts/loses state. Warn-only, never refuse to start: a stale
  // lock must not lock Aaron out of his own dashboard.
  function claimLock(warn = console.warn) {
    try {
      if (existsSync(LOCK)) {
        const pid = Number(readFileSync(LOCK, 'utf8'))
        if (pid && pid !== process.pid && isAlive(pid)) {
          warn(`\n⚠️  AaronOS: another server (pid ${pid}) is already using ${FILE}.\n   Running two at once can lose dashboard edits — quit the other one first.\n`)
        }
      }
      writeFileSync(LOCK, String(process.pid))
    } catch { /* best effort — locking is advisory */ }
    return LOCK
  }

  return { FILE, BAK, LOCK, save, load, claimLock }
}
