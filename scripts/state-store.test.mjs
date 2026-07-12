// Guards the invariant that lost Aaron's data once: a state write must never
// leave a corrupt or blank file behind. Run: node scripts/state-store.test.mjs
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeStore } from './state-store.mjs'

const dir = await mkdtemp(join(tmpdir(), 'aaronos-store-'))
const store = makeStore(dir)

// 1. round-trips a value
await store.save(JSON.stringify({ a: 1 }))
assert.equal(await store.load(), '{"a":1}')

// 2. 50 concurrent writes never corrupt: the file stays valid JSON and ends as
//    one whole blob, never an interleaved half — the bug we're fixing.
const blobs = Array.from({ length: 50 }, (_, i) => JSON.stringify({ n: i, pad: 'x'.repeat(i * 20) }))
await Promise.all(blobs.map((b) => store.save(b)))
const final = await store.load()
JSON.parse(final) // throws if the file is corrupt
assert.ok(blobs.includes(final), 'final file is one complete blob, not spliced together')

// 3. a corrupt live file recovers from .bak instead of coming back blank
await store.save(JSON.stringify({ good: true }))
await store.save(JSON.stringify({ good: 2 }))   // now .bak holds {"good":true}
await writeFile(store.FILE, '{ half-written garbage')
assert.equal(await store.load(), '{"good":true}', 'load falls back to .bak on corruption')

await rm(dir, { recursive: true, force: true })
console.log('ok — state-store integrity checks passed')
