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
