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
await writeFile(join(remote, 'foo-ext', 'info.json'), JSON.stringify({ name: 'Foo Extension', description: 'Demo extension' }))
await writeFile(join(remote, 'info.json'), JSON.stringify({ name: 'Fixture Library', description: 'A demo library for tests' }))
await writeFile(join(remote, 'not-a-module', 'readme.md'), 'hi\n')
await run('git', ['init', '-q'], { cwd: remote })
await run('git', ['add', '-A'], { cwd: remote })
await run('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=Fixture Author', 'commit', '-q', '-m', 'init'], { cwd: remote })

// A second fixture with no info.json anywhere, to check the fallback path.
const remote2 = join(remoteRoot, 'lib-src-plain')
await mkdir(join(remote2, 'bar-ext'), { recursive: true })
await writeFile(join(remote2, 'bar-ext', 'index.jsx'), 'export default function(){}\n')
await run('git', ['init', '-q'], { cwd: remote2 })
await run('git', ['add', '-A'], { cwd: remote2 })
await run('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: remote2 })

// Run the whole test inside a scratch project dir so the relative
// data/src/modules paths extensions-store.mjs writes to land in a
// throwaway place instead of the real project.
const projectDir = await mkdtemp(join(tmpdir(), 'aaronos-ext-project-'))
await mkdir(join(projectDir, 'src', 'modules'), { recursive: true })
const originalCwd = cwd()
chdir(projectDir)

const { addLibrary, installExtension, uninstallExtension, removeLibrary, loadExtensions, checkForUpdates, updateExtension } =
  await import(join(originalCwd, 'scripts', 'extensions-store.mjs'))

try {
  // 1. adding a library only scans metadata — nothing installed yet
  let data = await addLibrary(remote)
  assert.equal(data.libraries.length, 1)
  assert.deepEqual(data.libraries[0].extensions.map((e) => e.path), ['foo-ext'])
  assert.equal(data.installed.length, 0)
  assert.ok(!existsSync(join(projectDir, 'src/modules/foo-ext')), 'nothing written to src/modules yet')
  assert.equal(data.libraries[0].name, 'Fixture Library')
  assert.equal(data.libraries[0].description, 'A demo library for tests')
  assert.equal(data.libraries[0].creator, 'Fixture Author')
  assert.equal(data.libraries[0].extensions[0].title, 'Foo Extension')
  assert.equal(data.libraries[0].extensions[0].description, 'Demo extension')

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

  // 8. no info.json anywhere -> existing fallback fields, no name/description
  const plain = await addLibrary(remote2)
  const plainLib = plain.libraries.find((l) => l.url === remote2)
  assert.equal(plainLib.name, undefined)
  assert.equal(plainLib.description, undefined)
  assert.equal(plainLib.extensions[0].title, 'bar-ext')
  assert.equal(plainLib.extensions[0].description, undefined)

  // 9. installing snapshots a treeHash and starts not-outdated
  //    (step 6 left an installed copy of foo-ext on disk after its library
  //    was removed — clear it so the id is free to reinstall under)
  await uninstallExtension('foo-ext')
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
  //     (remote2 was added in step 8 and nothing was ever installed from it)
  data = await loadExtensions()
  const untouchedBefore = data.libraries.find((l) => l.url === remote2)
  result = await checkForUpdates()
  const untouchedAfter = result.data.libraries.find((l) => l.url === remote2)
  assert.deepEqual(untouchedAfter, untouchedBefore, 'library with nothing installed from it is not re-scanned')

  console.log('ok — extensions-store integrity checks passed')
} finally {
  chdir(originalCwd)
  await rm(projectDir, { recursive: true, force: true })
  await rm(remoteRoot, { recursive: true, force: true })
}
