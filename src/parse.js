// Pure parsing helpers for the task system — no React import, so node can test
// them directly (see scripts/parse.test.mjs). isoDay is duplicated (2 lines) to
// keep this file dependency-free.
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (base, n) => { const d = new Date(base); d.setDate(d.getDate() + n); return d }
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const wd = (s) => DAYS.indexOf(s.slice(0, 3).toLowerCase())
const DAY = 'sun(?:day)?|mon(?:day)?|tues?(?:day)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?'

// Map raw tag words to a clean, deduped list, reusing an existing tag's casing
// when one matches case-insensitively (so #college + "College" stay one tag).
export const reuseTags = (tags, existing = []) => {
  const seen = new Set(), out = []
  for (const raw of tags) {
    const lc = String(raw).replace(/^#/, '').toLowerCase()
    if (!lc || seen.has(lc)) continue
    seen.add(lc)
    out.push(existing.find((e) => e.toLowerCase() === lc) || lc)
  }
  return out
}

// Pull "#tag" tokens out of text -> { text: without them, tags: reused list }.
export const extractTags = (text, existing = []) => {
  const found = []
  const cleaned = text.replace(/#(\w[\w-]*)/g, (_, t) => (found.push(t), '')).replace(/\s{2,}/g, ' ').trim()
  return { text: cleaned, tags: reuseTags(found, existing) }
}

// Split a comma/space-separated tag field ("college, design" or "#a #b").
export const parseTags = (raw, existing = []) => reuseTags(String(raw).split(/[,\s]+/), existing)

// Pull the first natural-language due date out of text.
// Returns { due: 'YYYY-MM-DD'|null, text: text with the date phrase removed }.
// ponytail: first-match wins, whole-word weekdays; good enough for chat input,
// not full NLP — swap in Chrono if phrasings outgrow this list.
export const parseDue = (text, base = new Date()) => {
  const dow = base.getDay()
  const coming = (target) => addDays(base, (target - dow + 7) % 7) // 0 = today
  const roll = (mo, day) => { let d = new Date(base.getFullYear(), mo, day); if (iso(d) < iso(base)) d = new Date(base.getFullYear() + 1, mo, day); return d }
  const rules = [
    [/\bin (\d+) days?\b/i, (m) => addDays(base, +m[1])],
    [/\btomorrow\b/i, () => addDays(base, 1)],
    [/\b(?:today|tonight)\b/i, () => base],
    [/\bthis weekend\b/i, () => coming(6)],
    [new RegExp(`\\bnext (${DAY})\\b`, 'i'), (m) => addDays(coming(wd(m[1])), 7)],
    [new RegExp(`\\b(?:by |on |this )?(${DAY})\\b`, 'i'), (m) => coming(wd(m[1]))],
    [new RegExp(`\\b(${MONTHS.join('|')})[a-z]*\\.?\\s+(\\d{1,2})\\b`, 'i'), (m) => roll(MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()), +m[2])],
    [/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (m) => (m[3] ? new Date(+((m[3].length === 2 ? '20' : '') + m[3]), +m[1] - 1, +m[2]) : roll(+m[1] - 1, +m[2]))],
  ]
  for (const [re, fn] of rules) {
    const m = text.match(re)
    if (!m) continue
    const d = fn(m)
    if (!d || isNaN(d)) continue
    const cleaned = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).replace(/\s{2,}/g, ' ').trim()
    return { due: iso(d), text: cleaned }
  }
  return { due: null, text }
}

// One shot for a raw task title: strip #tags and a date phrase, return the rest.
export const parseTaskInput = (title, existing = [], base = new Date()) => {
  const d = parseDue(title, base)
  const t = extractTags(d.text, existing)
  return { text: t.text, tags: t.tags, due: d.due }
}
