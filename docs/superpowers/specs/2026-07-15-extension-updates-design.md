# Extension update detection

## Purpose

Installed extensions can silently drift from their source library. Detect
when an installed extension's upstream folder has changed, surface it as a
sidebar badge + one-time notification, and let the user update it in place
from a dedicated tab on the Extensions page.

## Detection: per-extension tree-hash fingerprint

`git ls-tree HEAD -- <path>` returns a single tree-object hash fingerprinting
a folder's entire contents (recursively), fetched as pure metadata — no
blob content — same property `addLibrary`'s existing scan already relies on.

- Every extension found during a scan (initial `addLibrary` or a later
  `refreshLibrary`) gets a `treeHash` field alongside its existing
  `path`/`id`/`title`/`description`.
- Every `installed` entry snapshots the `treeHash` it was installed at,
  plus an `outdated: false` flag.
- "Outdated" = an installed entry's snapshotted `treeHash` no longer
  matches the current `treeHash` for that `(library, path)` in the
  library's latest scan (or that path no longer exists in the library at
  all — also outdated, nothing to compare against). Scoped per extension,
  not per library — this is what makes "check which extensions changed"
  correct for packs with several extensions where only one moved.

## Refreshing a library

`addLibrary` only ever fetches once, at add time. Checking for updates
needs the cached clone to catch up to the remote's current state:

`refreshLibrary(id)`:
1. In the existing cached clone (`data/extensions-cache/<id>`), run
   `git fetch --filter=blob:none origin HEAD` then
   `git update-ref HEAD FETCH_HEAD` — advances the local `HEAD` to the
   remote's latest commit without ever checking out a working tree
   (verified locally: this sequence works cleanly against a
   `--no-checkout` clone).
2. Rerun the same scan `addLibrary` does today (tree hashes, `info.json`
   name/description, creator) and replace that library's `extensions[]` in
   place. `name`/`description`/`creator` are refreshed too — they reflect
   whatever the latest commit says.
3. Any failure (network, remote gone, repo deleted upstream) is caught and
   that library is left as-is from its last successful scan — a failed
   refresh must not wipe out what's already known.

## Checking for updates

`checkForUpdates()`:
1. For every library with at least one entry in `installed` (skip
   libraries nobody installed anything from — nothing to check), call
   `refreshLibrary`.
2. For every `installed` entry, look up its `(library, path)` in that
   library's refreshed `extensions[]`. Set `outdated = true` if the
   `treeHash` differs or the path is gone; `outdated = false` otherwise.
3. Persist the updated `installed` list.
4. Return the full data plus `newlyOutdated: string[]` — installed ids
   whose `outdated` flipped from `false`/absent to `true` on *this* call
   specifically (not ids that were already outdated before this check).

## Trigger and notification

- Runs once automatically, in the background, shortly after the Extensions
  module loads — non-blocking, doesn't delay the rest of the app's first
  paint.
- A "Check for updates" button on the Extensions page triggers it
  on-demand.
- `newlyOutdated` (and only that list) triggers one `notify('Extension
  update available', ...)` per newly-stale extension. Finding the same
  still-outdated extension on a later check does not re-notify — the
  sidebar badge is the persistent reminder, not the notification.

## Sidebar badge

`nav.badge(state)` (see `src/App.jsx`'s `NavItem`) only ever receives the
global app store (`useStore()`, backed by `data/state.json`) — it has no
access to `data/extensions.json`. So the Extensions module writes its
outdated count into the global store:

- `core.js` `defaults` gains `extensionsOutdated: []` (array of installed
  extension ids currently flagged outdated) — small additive default,
  same pattern as `notifs`/`reminders`. This is the one shared-file touch
  this feature needs, and it's justified: `nav.badge` structurally cannot
  read anything else.
- After every check (automatic or manual), the Extensions module calls
  `store.set({ extensionsOutdated: <ids> })`.
- `registerWidget`'s `nav` gains `{ badge: (state) => state.extensionsOutdated.length }`.

## Extensions page: Outdated tab

- A "Libraries" / "Outdated" tab toggle at the top of the page — local
  `useState`, no routing/nav changes.
- "Outdated" tab lists every installed extension currently flagged
  outdated: its `title`, which library it came from (`name || url`), and
  an "Update" button. Empty state: "Nothing to update."

## Updating, atomically

`updateExtension(id)`:
1. Look up the `installed` entry for `id` (error if not installed — same
   guard `uninstallExtension` already has).
2. `archiveExtract` the extension's current path from its library's cached
   clone into a fresh temp directory (`data/extensions-cache/.update-<id>`),
   not directly into `src/modules/<id>`.
3. On success: delete the old `src/modules/<id>`, then rename the temp
   directory into its place — atomic on the same filesystem, mirroring the
   temp-file-then-rename pattern `scripts/state-store.mjs` already uses.
   Update the `installed` entry's `treeHash` to the new value and clear
   `outdated`.
4. On failure at step 2: remove the temp directory, leave `src/modules/<id>`
   and the `installed` entry untouched (still outdated, still working) —
   never leave the extension half-deleted.

## Data shape

```
library: {
  id, url, name?, description?, creator?,
  extensions: [{ path, id, title, description?, treeHash }]
}
installed: [{ id, library, path, treeHash, outdated }]
```

## Error handling

- `refreshLibrary` failures degrade to "leave that library's last known
  state alone" — never throws out of `checkForUpdates`, never blanks
  existing data.
- `updateExtension` failures leave the pre-update extension fully intact
  and still flagged outdated (see atomicity above).
- `checkForUpdates`/`updateExtension` follow the same "never fails the
  whole operation for one bad library/extension" posture as `addLibrary`
  already has for `info.json`.

## Testing

Extend `scripts/extensions-store.test.mjs`'s fixture: after the existing
install assertions, mutate the *remote* fixture repo's `foo-ext/index.jsx`
and commit again, then:
- assert `checkForUpdates()` flags that installed extension as
  `outdated: true` and reports it in `newlyOutdated`
- assert a second `checkForUpdates()` call (no further remote change)
  reports the same extension `outdated: true` but an empty `newlyOutdated`
  (already-known staleness doesn't re-notify)
- assert `updateExtension(id)` rewrites the installed file to the new
  content, clears `outdated`, and updates the stored `treeHash`
- assert `checkForUpdates()` on a library with zero installed extensions
  doesn't attempt a refresh (no network call made — verifiable by pointing
  its `url` at a nonexistent path and confirming no error is thrown)
