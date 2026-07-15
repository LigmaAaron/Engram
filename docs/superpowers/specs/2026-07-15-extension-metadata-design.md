# Extension/library metadata (info.json)

## Purpose

The Extensions marketplace currently shows raw repo URLs and folder names.
Let library and extension authors supply a real name/description via an
optional `info.json`, and auto-detect a creator, so the marketplace reads
like a marketplace instead of a file browser.

## Schema

`info.json`, optional, JSON object with `name` and/or `description` string
fields — both optional, unknown/extra keys ignored.

- **Library root** — `info.json` at the repo root.
- **Each extension folder** — `info.json` sibling to that folder's
  `index.jsx`.

```json
{ "name": "My Extension Pack", "description": "A few widgets I built" }
```

Missing file, unreadable path, or malformed JSON → treated as "no info.json
here," never fails the scan. Extra/unknown keys are ignored, not rejected.

## Creator: derived, never in JSON

Libraries are cloned with `--depth 1`, so exactly one commit is ever
present in the cache — `creator` is therefore inherently a **per-library**
fact (the author of that one commit), not something meaningfully
per-extension. Computed once during `addLibrary` via
`git log -1 --format=%an HEAD` in the cached clone. Shown once on the
library card, not repeated per extension row. If that command fails for any
reason, `creator` is simply omitted (not an error).

## Scan changes (`addLibrary`)

This is a deliberate, narrow exception to the existing "adding a library
fetches zero file contents" guarantee: reading `info.json` requires
fetching that one small blob per location. Extension source code itself is
still never fetched until install — only these tiny metadata files.

After the existing `git clone --no-checkout --filter=blob:none` +
`git ls-tree -r --name-only HEAD` scan:

1. Try `git show HEAD:info.json` in the cached clone. On success, parse as
   JSON; use `.name`/`.description` if present as the library's `name`/
   `description`. On any failure (missing file, git error, `JSON.parse`
   throwing) leave both `undefined` — the UI falls back to the repo URL.
2. For each candidate extension path `p` found by the existing scan, try
   `git show HEAD:${p}/info.json`, same parse-or-fallback treatment. Use
   `.name` as that extension's `title` (replacing the current
   folder-basename default) and `.description` as its `description`.
3. Compute `creator` once via `git log -1 --format=%an HEAD`. Omit the field
   entirely if the command fails.

## Data shape

```
library: {
  id, url,
  name?, description?, creator?,   // new — all optional, all auto-detected/read
  extensions: [
    { path, id, title, description? }  // title: from info.json `name`, else folder basename (unchanged fallback)
  ]
}
```

`installed` entries and the `installExtension`/`uninstallExtension`/
`removeLibrary` functions are unaffected — this only touches what
`addLibrary` records and what the UI reads.

## UI

- Library card header: `name` (fallback: `url`, current behavior) +
  `description` beneath it if present + `by {creator}` if a creator was
  found — omit the "by" line entirely rather than showing "by unknown."
- Extension row: `title` (unchanged behavior/fallback) + `description`
  beneath it if present.

## Error handling

Every `git show`/`JSON.parse` in this feature is wrapped so a failure
degrades to the pre-existing fallback (URL / folder name / no description /
no creator) rather than failing `addLibrary` outright. A library with no
`info.json` anywhere behaves exactly as it does today.

## Testing

Extend `scripts/extensions-store.test.mjs`'s fixture repo with a root
`info.json` and an `info.json` inside `foo-ext/`, and a commit author set
via the existing `-c user.name=`. Assert `addLibrary`'s result includes the
expected `name`/`description`/`creator` and that the extension's `title`/
`description` reflect its own `info.json`. Add a second fixture repo with no
`info.json` at all and assert the existing fallback fields are unchanged.
