// Pure theme math — no DOM, no store, no imports. Kept import-free on purpose
// so plain `node scripts/theme.test.mjs` can exercise it directly, same as
// src/registry.js.

// Every CSS custom property a user can override in Appearance > Advanced.
// 'accent' is included here too (not just in DEFAULT_THEME.accent) because
// overriding it in `overrides` must win over the plain accent field.
export const THEME_VARS = ['bg', 'sidebar', 'surface', 'surface-2', 'border', 'border-soft', 'text', 'text-dim', 'text-faint', 'accent']

// accent default equals the current --inverse-bg hex so a fresh install (or
// anyone who never opens Appearance) looks pixel-identical to before this
// feature existed.
export const DEFAULT_THEME = { mode: 'dark', accent: '#e8e8e6', overrides: {} }

// mode 'system' resolves via the caller's own matchMedia check — this stays
// pure by taking the already-evaluated boolean instead of touching `window`.
export const resolveMode = (mode, prefersLight) => {
  if (mode === 'light') return 'light'
  if (mode === 'dark') return 'dark'
  return prefersLight ? 'light' : 'dark'
}

// Final { varName: hex } map to apply as inline styles on <html>. 'accent'
// is only included once the user actually changes it away from
// DEFAULT_THEME.accent — otherwise every mode would inherit dark mode's
// accent inline, shadowing [data-theme="light"]'s own --accent in
// styles.css. Whatever's in `overrides` always wins, so clearing an
// override falls straight back to the stylesheet's (mode-aware) value.
export const resolvedVars = (theme) => {
  const t = { ...DEFAULT_THEME, ...theme }
  const vars = t.accent !== DEFAULT_THEME.accent ? { accent: t.accent } : {}
  return { ...vars, ...t.overrides }
}
