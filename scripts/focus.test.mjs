// Guards the blocklist-matching logic used to decide which running apps to
// quit, and that start/stop toggle enforcement cleanly. Run:
//   node scripts/focus.test.mjs
import assert from 'node:assert/strict'
import { appsToQuit, startEnforcing, stopEnforcing, isEnforcing } from './focus.mjs'

// 1. matches case-insensitively, ignores apps not in the blocklist
assert.deepEqual(appsToQuit(['Discord', 'Finder', 'Safari'], ['discord', 'safari']), ['Discord', 'Safari'])

// 2. empty blocklist matches nothing
assert.deepEqual(appsToQuit(['Discord', 'Finder'], []), [])

// 3. start/stop toggle enforcement state
assert.equal(isEnforcing(), false)
startEnforcing(['Discord'])
assert.equal(isEnforcing(), true)
stopEnforcing()
assert.equal(isEnforcing(), false)

console.log('ok — focus enforcement checks passed')
