// Run: node scripts/parse.test.mjs
import assert from 'node:assert'
import { parseDue, extractTags, parseTags, reuseTags, parseTaskInput } from '../src/parse.js'

const base = new Date(2026, 6, 9) // Thu Jul 9 2026 (matches the app's "today")
const due = (t) => parseDue(t, base).due

// date detection
assert.equal(due('finish essay tomorrow'), '2026-07-10')
assert.equal(due('tonight'), '2026-07-09')
assert.equal(due('in 2 days'), '2026-07-11')
assert.equal(due('this weekend'), '2026-07-11')       // coming Saturday
assert.equal(due('Monday'), '2026-07-13')
assert.equal(due('next Tuesday'), '2026-07-21')
assert.equal(due('July 18'), '2026-07-18')
assert.equal(due('7/18'), '2026-07-18')
assert.equal(due('due by Friday'), '2026-07-10')
assert.equal(due('shower'), null)

// a past m/d rolls to next year
assert.equal(due('1/2'), '2027-01-02')

// the date phrase is stripped from the title
assert.deepEqual(parseDue('submit by Friday', base), { due: '2026-07-10', text: 'submit' })

// hashtags -> tags, stripped from text, deduped, existing casing reused
assert.deepEqual(extractTags('finish portfolio #college #design', ['College']),
  { text: 'finish portfolio', tags: ['College', 'design'] })
assert.deepEqual(extractTags('x #a #A #b').tags, ['a', 'b'])

// tag field parsing + reuse
assert.deepEqual(parseTags('college, design'), ['college', 'design'])
assert.deepEqual(reuseTags(['#Math', 'math'], ['math']), ['math'])

// full title parse
assert.deepEqual(parseTaskInput('finish portfolio #college by Friday', [], base),
  { text: 'finish portfolio', tags: ['college'], due: '2026-07-10' })

console.log('all parse checks passed')
