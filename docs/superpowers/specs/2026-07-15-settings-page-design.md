# Settings page

## Purpose

Add a real Settings page (currently a hardcoded sidebar button that just
toasts "Nothing to configure yet"). Categories down the left: **General**,
**Appearance**, then one category per registered module (built-in or
installed extension) with per-module widget/page visibility toggles and any
custom settings the module declares.

## Data model

Two new pieces of persisted state, both merged over safe defaults so old
saved files keep working:

```js
settings: {
  ...existing (userName, useCase, style, model, think, effort),
  theme: {
    mode: 'dark',      // 'dark' | 'light' | 'system'
    accent: '#e8e8e6', // matches current --inverse-bg exactly — stock look is unchanged
    overrides: {},      // { [cssVarName]: '#hex' } — advanced per-variable overrides, on top of mode+accent
  },
},
ui: {
  ...existing,
  moduleVisibility: {}, // { [moduleId]: { widget?: false, page?: false } } — absent = visible (manifest default)
}
```

`moduleVisibility` entries are sparse: a module with no entry, or an entry
missing a key, is visible. This is the `ui.overviewLayout`-shaped primitive
flagged as future work in the modules refactor — landing the visibility slice
of it now, `span`/`order` customization stays out of scope (not asked for).

## Theming mechanics

- `--accent` becomes a new CSS var. It replaces `--inverse-bg`/`--inverse-text`
  on `.nav-item.active` and on notification/nav badges — the two places an
  accent color reads naturally. Default value equals the current
  `--inverse-bg` hex, so an unmodified install looks pixel-identical to today.
- `mode` toggles a `data-theme="light"` attribute on `<html>` (`system` resolves
  via `matchMedia('(prefers-color-scheme: light)')` once, live-updates on
  change). A new `[data-theme="light"]` block in `styles.css` supplies a light
  palette for the existing grayscale vars; `--ok`/`--err` are shared as-is.
- `overrides` are the "advanced" escape hatch: any of the reusable vars
  (`--bg`, `--sidebar`, `--surface`, `--surface-2`, `--border`, `--border-soft`,
  `--text`, `--text-dim`, `--text-faint`, `--accent`) can be pinned to an exact
  hex, applied as inline `style.setProperty` calls on `<html>` after the
  mode/accent CSS resolves — so overrides always win, and clearing one just
  falls back to the palette.
- Picker UI: native `<input type="color">` for every swatch (accent, and each
  advanced row) — zero new dependencies, and it's unstyleable by definition so
  there's nothing fighting the app's look. A small custom swatch button next
  to each one shows the resolved color and opens it.

## Module categories

For every registered module except `settings` itself:
- If it has a `Widget`, show a "Show on Overview" toggle → `ui.moduleVisibility[id].widget`.
- If it has a `Page`, show a "Show in Sidebar" toggle → `ui.moduleVisibility[id].page`.
  Turning this off removes the sidebar nav entry entirely (App.jsx already
  computes `nav` from `widgets.filter(w => w.Page)` — visibility just adds
  another filter predicate there, and correspondingly filters the overview
  grid's `Widget` list).
- If the manifest declares an optional `settings` field (a component, same
  shape as `nav.Panel`), render it below the toggles. No built-in module
  defines one today; this is the hook extensions declare custom options
  through. `src/modules/README.md` and the extension-authoring path document
  the new optional manifest field.

## New module: `src/modules/settings/`

Registers with `Page` only (no `Widget`) and a high `order` so it sorts to
the bottom of the sidebar list, right above the existing Shut Down button.
The old hardcoded toast-only Settings button in `App.jsx`'s `Sidebar` is
deleted — Settings becomes a normal module rendered through the existing
`NavItem`/module-list machinery like every other page, nothing new to build
there.

Layout: a left-hand category list (General, Appearance, one per module) and
a right-hand panel for the selected category — same shell pattern as the
Extensions page's tabs, reused for consistency rather than inventing a new
pattern.

**General category:** `userName` (text input), `useCase`/"main use" (the
same 4 options install.sh offers: Student/Developer/Writer/General), `style`/
"response style" (Detailed/Direct/Concise) — all three already exist in
`settings` (set once by `install.sh` or the first-run name modal) and become
editable here for the first time via `actions.setSettings`.

**Appearance category:** mode toggle (Dark/Light/System segmented buttons),
accent color swatch, and a collapsed "Advanced" disclosure listing every
reusable CSS var as a labeled swatch + reset button, plus one "Reset all" for
the whole theme object.

## Out of scope

- Widget `span`/`order` customization (only visibility was asked for).
- A settings UI for the 7 built-in modules beyond visibility toggles — none
  of them have configurable behavior today.
- Retroactively adding `settings` panels to already-installed extensions —
  only the manifest field + docs land now.
