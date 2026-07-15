// Guards theme.js's pure math: mode resolution and the applied-vars map.
// Run: node scripts/theme.test.mjs
import assert from 'node:assert/strict'
import { THEME_VARS, DEFAULT_THEME, resolveMode, resolvedVars } from '../src/theme.js'

assert.deepEqual(THEME_VARS.includes('accent'), true)
assert.equal(DEFAULT_THEME.accent, '#e8e8e6', 'default accent matches current --inverse-bg so stock look is unchanged')

assert.equal(resolveMode('dark', true), 'dark')
assert.equal(resolveMode('light', false), 'light')
assert.equal(resolveMode('system', true), 'light')
assert.equal(resolveMode('system', false), 'dark')

assert.deepEqual(resolvedVars(DEFAULT_THEME), {}, 'unmodified default -> nothing written, mode-aware CSS accent applies')
assert.deepEqual(
  resolvedVars({ mode: 'dark', accent: '#ff0000', overrides: { bg: '#111111' } }),
  { accent: '#ff0000', bg: '#111111' },
)
assert.deepEqual(
  resolvedVars({ mode: 'dark', accent: '#ff0000', overrides: { accent: '#00ff00' } }),
  { accent: '#00ff00' },
  'an explicit accent override in overrides wins over the plain accent field',
)

console.log('theme.test: ok')
