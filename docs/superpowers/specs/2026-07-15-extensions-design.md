# Extensions page

## Purpose

Let the user add git repos ("libraries") that bundle one or more AaronOS
modules, browse what each library offers, and install/uninstall individual
extensions without hand-copying folders into `src/modules/`.

## Architecture

Reuses existing patterns instead of inventing new ones:

- **Extensions page** — a new module, `src/modules/extensions/index.jsx`
  (`Page` only; no overview widget, nothing worth summarizing on the
  dashboard).
- **Server-side work** (git operations, filesystem scan, archive extraction)
  lives in `vite.config.js` middleware, alongside the existing `__data` /
  `__memory` endpoints. Cloning and writing into `src/modules/` must happen
  server-side — the browser can't do it.
- **State** persists to a new `data/extensions.json` (same pattern as
  `data/state.json` / `memory.md`): tracks added libraries, their discovered
  extensions, and which are currently installed.
- Extensions install into `src/modules/<id>`, where Vite's existing
  `import.meta.glob` auto-discovers them (same mechanism used for
  hand-written modules) and HMR picks them up live — no separate loader.

## Add library (metadata only, no file contents)

`POST /__extensions/library {url}`

1. `git clone --no-checkout --depth 1 --filter=blob:none <url> data/extensions-cache/<slug>`
   — pulls commit + tree structure only; no file *contents* (blobs) are
   fetched. This is the "doesn't instantly download the extensions" part:
   cheap, no bytes for actual source files yet.
2. `git ls-tree -r --name-only HEAD` inside that clone, scan for folders
   containing an `index.jsx` (skip `node_modules`, depth-limited) →
   candidate extensions. `id`/`title` default to the folder name.
3. Persist `{id, url, slug, extensions: [{path, id, title}]}` to
   `extensions.json`. Nothing exists in `src/modules/` yet.

## Install one extension (this is where bytes get pulled)

`POST /__extensions/install {libraryId, path, id}`

1. `git archive --format=tar HEAD:<path>` from the cached repo, piped
   straight into `src/modules/<id>` — materializes just that one
   extension's files, nothing else from the repo. Stateless per install, so
   installing multiple extensions from the same library doesn't fight over
   checkout state.
2. Record `{id, library, path}` in `extensions.json`'s installed list.
3. Reject if `id` collides with an existing `src/modules/` folder (built-in
   or already-installed extension).

## Uninstall

`DELETE /__extensions/install/:id`

- `rm -rf src/modules/<id>` — **only if `id` is in the installed list.**
  This is what keeps the endpoint from ever being pointed at a built-in
  module: built-ins are never in that list.
- Removes the entry from `extensions.json`.

## Remove a library

`DELETE /__extensions/library/:id`

- Deletes the cache dir (`data/extensions-cache/<slug>`) and its record.
- Already-installed extensions from it are untouched — they're independent
  copies in `src/modules/`, no longer linked to the cache.

## UI (`src/modules/extensions/Page`)

- "Add library" — repo URL input + button.
- List of added libraries, each expandable to show its discovered
  extensions with an Install/Uninstall action and an installed/not-installed
  badge.
- Remove-library action per library.

Out of scope: dependency management (an extension needing an npm package
AaronOS doesn't already have), extension versioning/updates, and any
non-folder-scan metadata (description, author) beyond the folder name.

## Error handling

- Bad/unreachable URL, non-git target, or a path with no `index.jsx` inside
  it → 4xx with a message, surfaced via the existing `toast()` helper.
- Install `id` collision with an existing `src/modules/` folder → 4xx,
  rejected before any files are written.
- Uninstall of an `id` not present in the installed list → 4xx (protects
  built-in modules).

## Risk (accepted, not mitigated)

Installing an extension runs arbitrary third-party code with full access to
`window.AaronOS` (all app data and actions). Acceptable for a personal,
single-user local tool — stated here so it's a conscious tradeoff, not an
oversight.

## Notes

- `data/extensions-cache/` and `data/extensions.json` should be gitignored,
  matching `data/state.json` / `memory.md`.
- Installed extensions land as regular files in `src/modules/<id>` and will
  be tracked by git like any other module unless the user chooses to
  gitignore specific ones — no special-casing added for this.

## Testing

Manual: add a small real test repo containing one module-shaped folder,
install it, confirm it shows up in sidebar/overview via HMR; uninstall,
confirm it's gone; confirm an id collision is rejected; confirm removing a
library doesn't touch an already-installed extension from it.
