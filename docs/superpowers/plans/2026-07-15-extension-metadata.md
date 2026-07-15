# Extension/Library Metadata (info.json) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let libraries and extensions supply a real `name`/`description` via an optional `info.json`, and auto-detect a `creator` from git, so the Extensions marketplace shows names/descriptions instead of raw URLs and folder names.

**Architecture:** `addLibrary` in `scripts/extensions-store.mjs` gains two small helpers — `readInfoJson` (reads one blob via `git show HEAD:<path>` from the already-cloned, `--no-checkout` repo, never fails, returns `null` on any problem) and `readCreator` (`git log -1 --format=%an HEAD`) — and uses them to populate `name`/`description`/`creator` on the library record and `title`/`description` on each scanned extension. `src/modules/extensions/index.jsx` renders the new fields with fallbacks to the existing URL/folder-name behavior.

**Tech Stack:** Same as the existing extensions feature — `node:child_process` (git CLI), no new dependencies.

## Global Constraints

- `info.json` is always optional — missing file, git error, or malformed JSON must degrade to today's fallback (URL / folder basename / no description / no creator), never throw or fail `addLibrary`.
- `creator` is a per-library fact (one commit in a `--depth 1` clone), computed once, never read from JSON, never repeated per extension.
- No new npm dependencies.
- `installExtension`/`uninstallExtension`/`removeLibrary` are unaffected — only `addLibrary`'s output and the UI change.

---

### Task 1: `addLibrary` reads `info.json` + creator

**Files:**
- Modify: `scripts/extensions-store.mjs`
- Modify: `scripts/extensions-store.test.mjs`

**Interfaces:**
- Produces (consumed by Task 2's UI): `addLibrary`'s resolved value gains optional `name`, `description`, `creator` string fields on each library object, and an optional `description` string field on each entry in that library's `extensions` array (`title` was already present — now sourced from `info.json`'s `name` key when available, unchanged fallback to folder basename otherwise). No other function's signature changes.

- [ ] **Step 1: Update `scripts/extensions-store.mjs`**

Add a `str` helper and the two new read functions right after the existing `safeId` definition:

```js
const safeId = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/^-+|-+$/g, '')
const str = (v) => (typeof v === 'string' && v.trim()) || undefined
```

Add `readInfoJson` and `readCreator` after the `run` function (before `archiveExtract`):

```js
// Reads <path>/info.json (or the repo-root info.json when path is '') from
// the cached clone via `git show` — no checkout needed, same technique as
// archiveExtract. info.json is always optional: any failure (missing file,
// git error, invalid JSON, not an object) resolves to null, never throws.
async function readInfoJson(repoDir, path) {
  const gitPath = path ? `${path}/info.json` : 'info.json'
  try {
    const parsed = JSON.parse(await run('git', ['show', `HEAD:${gitPath}`], { cwd: repoDir }))
    return (parsed && typeof parsed === 'object') ? parsed : null
  } catch {
    return null
  }
}

// A library is cloned --depth 1, so there's exactly one commit — its author
// is the closest thing to a "creator" available without fetching more
// history. Never throws; a failed git log just means no creator field.
async function readCreator(repoDir) {
  try {
    return str(await run('git', ['log', '-1', '--format=%an', 'HEAD'], { cwd: repoDir }))
  } catch {
    return undefined
  }
}
```

Replace the body of `addLibrary` (keep the same function signature and the
existing early validation/dedup/clone lines) — the tree-scan-to-push section
changes from the current:

```js
  const tree = await run('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: dir })
  const extensions = tree.split('\n')
    .filter((p) => p.endsWith('/index.jsx'))
    .map((p) => p.slice(0, -'/index.jsx'.length))
    .map((p) => ({ path: p, id: safeId(basename(p)), title: basename(p) }))
  data.libraries.push({ id: slug, url: u, extensions })
  await save(data)
  return data
```

to:

```js
  const tree = await run('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: dir })
  const paths = tree.split('\n')
    .filter((p) => p.endsWith('/index.jsx'))
    .map((p) => p.slice(0, -'/index.jsx'.length))
  const extensions = []
  for (const p of paths) {
    const info = await readInfoJson(dir, p)
    extensions.push({
      path: p,
      id: safeId(basename(p)),
      title: str(info?.name) || basename(p),
      description: str(info?.description),
    })
  }
  const libInfo = await readInfoJson(dir, '')
  data.libraries.push({
    id: slug,
    url: u,
    name: str(libInfo?.name),
    description: str(libInfo?.description),
    creator: await readCreator(dir),
    extensions,
  })
  await save(data)
  return data
```

(Note: the "before" snippet above has a typo duplicate `title:` key showing
the actual current line — the real current line is
`.map((p) => ({ path: p, id: safeId(basename(p)), title: basename(p) }))`;
that's the line being replaced.)

- [ ] **Step 2: Update `scripts/extensions-store.test.mjs`**

Replace the fixture-repo-building section (everything from `// Build a
throwaway git repo...` through the `commit` call) with a version that adds
`info.json` files and a distinguishable commit author:

```js
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
```

Then, inside the `try` block, right after step "1. adding a library only
scans metadata — nothing installed yet" and its existing assertions, insert
new assertions on the same `data` (don't change the existing assertions —
just add these after them, still before `const libId = data.libraries[0].id`):

```js
  assert.equal(data.libraries[0].name, 'Fixture Library')
  assert.equal(data.libraries[0].description, 'A demo library for tests')
  assert.equal(data.libraries[0].creator, 'Fixture Author')
  assert.equal(data.libraries[0].extensions[0].title, 'Foo Extension')
  assert.equal(data.libraries[0].extensions[0].description, 'Demo extension')
```

And at the very end of the `try` block, right before the final
`console.log('ok — ...')` line, add the fallback check using the second
fixture:

```js
  // 8. no info.json anywhere -> existing fallback fields, no name/description
  const plain = await addLibrary(remote2)
  const plainLib = plain.libraries.find((l) => l.url === remote2)
  assert.equal(plainLib.name, undefined)
  assert.equal(plainLib.description, undefined)
  assert.equal(plainLib.extensions[0].title, 'bar-ext')
  assert.equal(plainLib.extensions[0].description, undefined)
```

- [ ] **Step 3: Run the test and verify it passes**

Run: `node scripts/extensions-store.test.mjs`
Expected: `ok — extensions-store integrity checks passed` printed, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/extensions-store.mjs scripts/extensions-store.test.mjs
git commit -m "feat: read info.json and creator when adding an extension library"
```

---

### Task 2: Show name/description/creator in the Extensions UI

**Files:**
- Modify: `src/modules/extensions/index.jsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: the `name`/`description`/`creator` fields on library objects and `description` on extension objects, produced by Task 1's `addLibrary` (delivered to the browser via the existing `GET /__extensions` response, unchanged endpoint).

- [ ] **Step 1: Update the library/extension row rendering in `src/modules/extensions/index.jsx`**

Replace the `data.libraries.map(...)` block (from `: data.libraries.map((lib) => (` through its closing `))}`) with:

```jsx
        : data.libraries.map((lib) => (
            <div className="ext-lib" key={lib.id}>
              <div className="ext-lib-h">
                <div className="ext-lib-info">
                  <span className="ext-lib-name">{lib.name || lib.url}</span>
                  {lib.description && <span className="ext-lib-desc">{lib.description}</span>}
                  {lib.creator && <span className="ext-lib-creator">by {lib.creator}</span>}
                </div>
                <button className="icon-btn" aria-label={`Remove ${lib.name || lib.url}`} disabled={busy}
                  onClick={() => removeLibrary(lib.id)}><Close size={13} /></button>
              </div>
              {lib.extensions.length === 0
                ? <div className="empty">No extensions found in this repo.</div>
                : lib.extensions.map((ext) => {
                    const installedEntry = data.installed.find((e) => e.library === lib.id && e.path === ext.path)
                    return (
                      <div className="ext-row" key={ext.path}>
                        <div className="ext-row-info">
                          <span className="ext-row-title">{ext.title}</span>
                          {ext.description && <span className="ext-row-desc">{ext.description}</span>}
                        </div>
                        <button disabled={busy}
                          onClick={() => (installedEntry ? uninstall(installedEntry.id) : install(lib.id, ext))}>
                          {installedEntry ? 'Uninstall' : 'Install'}
                        </button>
                      </div>
                    )
                  })}
            </div>
          ))}
```

- [ ] **Step 2: Update `src/styles.css`**

Replace the existing Extensions block:

```css
.ext-lib{border:1px solid var(--border-soft);margin-bottom:10px;}
.ext-lib-h{display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface-2);border-bottom:1px solid var(--border-soft);}
.ext-lib-url{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;color:var(--text-dim);}
.ext-lib-h .icon-btn{width:26px;height:26px;flex:0 0 auto;}
.ext-row{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--border-soft);}
.ext-row:last-child{border-bottom:none;}
.ext-row-title{flex:1;font-size:13px;}
.ext-row button{border:1px solid var(--border);background:none;color:var(--text-dim);font:inherit;cursor:pointer;font-size:11.5px;padding:4px 9px;transition:border-color .15s ease,color .15s ease;}
.ext-row button:hover{color:var(--text);border-color:var(--text-faint);}
.ext-row button:disabled,.ext-lib-h button:disabled{opacity:.5;cursor:default;}
```

with:

```css
.ext-lib{border:1px solid var(--border-soft);margin-bottom:10px;}
.ext-lib-h{display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface-2);border-bottom:1px solid var(--border-soft);}
.ext-lib-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}
.ext-lib-name{font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ext-lib-desc{font-size:11.5px;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ext-lib-creator{font-size:11px;color:var(--text-faint);}
.ext-lib-h .icon-btn{width:26px;height:26px;flex:0 0 auto;}
.ext-row{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--border-soft);}
.ext-row:last-child{border-bottom:none;}
.ext-row-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}
.ext-row-title{font-size:13px;}
.ext-row-desc{font-size:11.5px;color:var(--text-dim);}
.ext-row button{border:1px solid var(--border);background:none;color:var(--text-dim);font:inherit;cursor:pointer;font-size:11.5px;padding:4px 9px;transition:border-color .15s ease,color .15s ease;}
.ext-row button:hover{color:var(--text);border-color:var(--text-faint);}
.ext-row button:disabled,.ext-lib-h button:disabled{opacity:.5;cursor:default;}
```

- [ ] **Step 3: Manually verify in the browser**

```bash
npm run dev
```

1. Build a fixture repo with a root `info.json` and one extension folder
   with its own `info.json`, matching Task 1's test fixture:
   ```bash
   FIXTURE=$(mktemp -d)/lib-src
   mkdir -p "$FIXTURE/foo-ext"
   echo "export default function(){}" > "$FIXTURE/foo-ext/index.jsx"
   echo '{"name":"Foo Extension","description":"Demo extension"}' > "$FIXTURE/foo-ext/info.json"
   echo '{"name":"Fixture Library","description":"A demo library for tests"}' > "$FIXTURE/info.json"
   git init -q "$FIXTURE"
   git -C "$FIXTURE" add -A
   git -C "$FIXTURE" -c user.email=t@t.com -c user.name="Fixture Author" commit -q -m init
   echo "$FIXTURE"
   ```
2. Open the app, go to Extensions, paste the printed path, click Add.
3. Expect the library card to show "Fixture Library", "A demo library for
   tests" beneath it, and "by Fixture Author" — not the raw path.
4. Expect the extension row to show "Foo Extension" with "Demo extension"
   beneath it — not "foo-ext".
5. Click Remove on the library, confirm it disappears.
6. Clean up: `rm -rf data/extensions-cache data/extensions.json` and
   confirm `git status --short` shows nothing left over.

- [ ] **Step 4: Commit**

```bash
git add src/modules/extensions/index.jsx src/styles.css
git commit -m "feat: show extension/library name, description, and creator"
```
