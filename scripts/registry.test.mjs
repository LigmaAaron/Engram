// Guards the module registry: sorted by order, ids deduped, subscribers fire.
// Run: node scripts/registry.test.mjs
import assert from 'node:assert/strict'
import { registerWidget, getWidgets, onWidgets } from '../src/registry.js'

registerWidget({ id: 'b', order: 20 })
registerWidget({ id: 'a', order: 10 })
assert.deepEqual(getWidgets().map((w) => w.id), ['a', 'b'], 'sorted by order, not registration order')

registerWidget({ id: 'a', order: 5 })
assert.equal(getWidgets().length, 2, 'duplicate id is ignored')

registerWidget({ id: 'c' }) // no order -> sorts last
assert.deepEqual(getWidgets().map((w) => w.id), ['a', 'b', 'c'])

let fired = 0
const before = getWidgets()
onWidgets(() => fired++)
registerWidget({ id: 'd', order: 1 })
assert.equal(fired, 1, 'subscriber fires on registration')
assert.notEqual(getWidgets(), before, 'new array identity so useSyncExternalStore re-renders')
assert.equal(getWidgets()[0].id, 'd')

console.log('registry.test: ok')
