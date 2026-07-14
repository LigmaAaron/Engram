---
name: Engram
description: A grayscale, monospace daily dashboard styled after a modern dev-tool terminal.
colors:
  canvas: "#0a0a0a"
  rail: "#000000"
  surface: "#0f0f0f"
  surface-raised: "#161616"
  border: "#2a2a2a"
  border-hairline: "#1c1c1c"
  ink: "#e8e8e6"
  ink-dim: "#8f8f8a"
  ink-icon: "#686864"
  inverse-fill: "#e8e8e6"
  inverse-ink: "#0a0a0a"
  state-ok: "#5fbf72"
  state-err: "#e5534b"
typography:
  body:
    fontFamily: "'Departure Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.04em"
  data:
    fontFamily: "{typography.body.fontFamily}"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "normal"
rounded:
  none: "0px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "14px"
  lg: "22px"
components:
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-dim}"
    rounded: "{rounded.none}"
    padding: "7px 10px"
  nav-item-active:
    backgroundColor: "{colors.inverse-fill}"
    textColor: "{colors.inverse-ink}"
    rounded: "{rounded.none}"
    padding: "7px 10px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "14px"
  input:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "8px 10px"
  button-add:
    backgroundColor: "{colors.inverse-fill}"
    textColor: "{colors.inverse-ink}"
    rounded: "{rounded.none}"
    padding: "0"
    size: "34px"
---

# Design System: Engram

## 1. Overview

**Creative North Star: "The Dev-Tool Terminal"**

Engram reads like a well-configured terminal emulator — Warp, Ghostty, a tuned-up VS Code integrated terminal — not a SaaS dashboard and not a hacker-movie prop. It replaced an earlier Linear-style pass (rounded corners, purple gradients, soft shadows) that the person who lives in this dashboard every day rejected on sight as "unlike me." The system is built to be looked at for hours without fatigue and to disappear into the task: tasks, agenda, metrics, a launcher.

It explicitly rejects two poles at once: the *generic SaaS dashboard* (decorative gradients, floaty shadows, rounded pills, a brand-purple accent doing no functional work) and the *generic hacker terminal* (neon green-on-black, CRT scanlines, glitch text, Matrix rain). What's left is closer to reading `man ls` in a stock terminal, but with real information density and real interactivity.

**Key Characteristics:**
- Pure grayscale surface and text, zero decorative hue anywhere.
- Exactly two functional colors, both tied to state, never to decoration.
- One typeface for the entire interface: a monospaced pixel font.
- Zero border-radius, system-wide.
- Flat by construction — hairline borders substitute for every shadow, glow, and blur.

## 2. Colors

Pure grayscale scaffolding plus a two-color state vocabulary. No accent color exists for its own sake — the active nav item and primary actions use an inverse (ink-on-white / white-on-ink) fill instead of introducing a hue.

### Primary
This system has no decorative primary. The "primary action" role (the active nav item, the add-task/add-event buttons) is filled by **Inverse** (below), not by a saturated color — see *The No Decorative Hue Rule*.

### Neutral
- **Canvas** (`#0a0a0a`): the app background, and the sidebar rail deepens one step further to true black (`#000000`) to read as its own plane.
- **Surface** (`#0f0f0f`): card backgrounds, the base plane every widget sits on.
- **Surface Raised** (`#161616`): one step brighter — text inputs, hover states, anything meant to read as "in front of" the card.
- **Border** (`#2a2a2a`): default 1px hairlines around cards, inputs, buttons.
- **Border Hairline** (`#1c1c1c`): the thinner division used inside a card (list-item separators) and as the "grid line" color in the stat/calendar/launcher hairline-grid technique (see Elevation).
- **Ink** (`#e8e8e6`): primary text. Near-white, never pure white.
- **Ink Dim** (`#8f8f8a`): secondary text — placeholders, status deltas, day-of-week labels, completed-task strikethrough text. Verified ≥5.9:1 against both canvas and surface.
- **Ink Icon** (`#686864`): the dimmest tier, reserved for icon glyphs and other non-text UI components only (unchecked checkboxes, delete-icon buttons, the `>` prompt glyph). Tuned to clear 3:1 against every surface in the system — this token is *not* for body text; an earlier, darker value failed contrast on real text and was split out for exactly that reason.

### Named Rules
**The No Decorative Hue Rule.** If a color isn't reporting a state (done, error, unread), it isn't in the palette. Selection and emphasis are carried by inverting fill/ink (`inverse-fill` / `inverse-ink`), not by introducing an accent.

**The Two-State-Colors Rule.** `state-ok` (`#5fbf72`) means done, success, or streak — nothing else uses it. `state-err` (`#e5534b`) means error, overdue, or unread — nothing else uses it. If a third status is ever needed, it earns its own token; existing tokens don't get reused for a different meaning.

## 3. Typography

**Body/Display/Label Font:** Departure Mono (self-hosted `.woff2`/`.woff`, SIL OFL), falling back to the `ui-monospace` system stack.

**Character:** One deliberately blocky, slightly pixel-grid monospace carries every role — headings, labels, body, data, buttons. There is no second family; pairing a "friendly" sans against the mono would immediately reintroduce the SaaS feel this system is built to avoid.

### Hierarchy
- **Data** (700, 24px, line-height 1): the stat-tile numbers (task counts, streak count, event count) — the only place text gets genuinely large.
- **Label** (700, 13px, line-height 1.2, letter-spacing 0.04em, uppercase): card section headers ("TASKS", "METRICS"), calendar month/day-of-week headers, notification-panel header.
- **Body** (400, 13px, line-height 1.5): task text, agenda entries, search input, nav items — the default weight for nearly everything a user reads.
- **Micro** (400, 10.5–11.5px): stat deltas, badge counts, calendar weekday initials.

### Named Rules
**The One Family Rule.** Departure Mono, everywhere, at every size. A product surface used all day doesn't need a display/body pairing — it needs one typeface tuned well across every size it appears at.

## 4. Elevation

Flat by construction. There are no shadows and no blur anywhere in the system — depth and grouping are conveyed entirely through 1px borders and a background-as-gridline technique: a container gets `background: border-hairline` with `gap: 1px`, and each child cell paints over it with `background: surface`, so the 1px gap itself becomes the dividing line without a literal `border` on every cell. Stat tiles, the calendar grid, and the launcher grid all use this.

### Named Rules
**The Flat-By-Default Rule.** Nothing lifts off the page. A card is a bordered rectangle at rest and a bordered rectangle on hover — never a shadow, never a glow. If a surface needs to feel "elevated," it gets the inverse fill (ink-on-white), not a shadow.

## 5. Components

### Buttons
- **Shape:** square, `0px` radius, always.
- **Primary ("add" actions):** inverse fill (`ink` background, `canvas` text), 34px square, sits flush against its adjacent input with no gap.
- **Icon buttons (bell, chevrons, delete):** transparent at rest, `ink-icon` glyph color, gains a `border` and brightens to `ink` on hover. No background fill at rest.
- **Nav items:** transparent at rest; on hover, gains a `border` only (no fill); active state is a full inverse fill, not an accent-colored background.

### Cards
- **Corner style:** `0px`, no exceptions.
- **Background:** `surface`, with a `border` hairline all around.
- **Header:** uppercase, bold, letter-spaced label row, separated from the body by a `border-hairline` divider — not a shadow, not extra padding.
- **Shadow strategy:** none (see Elevation).

### Inputs / Fields
- **Style:** `surface-raised` background, `border` hairline, `0px` radius, no inner shadow.
- **Focus:** border brightens to `ink-dim` — no glow, no ring.
- **Placeholder text:** `ink-dim`, not `ink-icon` — placeholder copy is still real information a user reads, so it holds the same 4.5:1 floor as any other body text.

### Navigation
Sidebar rail is a full step darker than the canvas (`rail` `#000000` vs. `canvas` `#0a0a0a`) so it reads as its own plane without a border needing to do all the work. Items stack vertically, icon + label, no icons-only collapsed state except at the narrow mobile breakpoint.

### Data Grids (stat tiles, calendar, launcher)
The signature pattern: a `border-hairline`-colored container with `gap: 1px` and `surface`-colored children, producing a seamless bordered grid without doubling up borders at shared edges. Calendar "muted" days (adjacent months) drop to `canvas` background to recede without needing a separate opacity trick.

## 6. Do's and Don'ts

### Do:
- **Do** keep every color grayscale except `state-ok` and `state-err`, and only ever use those two for their one designated meaning each.
- **Do** use Departure Mono at every text role — resist the urge to bring in a second, "friendlier" font for headings.
- **Do** keep `0px` radius everywhere, including on inputs, buttons, badges, and toasts.
- **Do** use the hairline-grid (`border-hairline` background + `1px` gap) technique for any new tiled/grid layout instead of adding individual borders per cell.
- **Do** use `ink-dim`, not `ink-icon`, for any text a user is meant to read (placeholders, empty states, status deltas, muted labels).

### Don't:
- **Don't** reintroduce the rejected Linear-style system: no purple/indigo accents, no `border-radius`, no `box-shadow`, no gradients. That system was explicitly called out as "unlike me."
- **Don't** add neon green, CRT scanlines, glitch text, or any Matrix-style "hacker" decoration — the brief was a real dev-tool terminal, not the movie version of one.
- **Don't** give brand-colored icon tiles to the quick-launch links (Gmail red, GitHub black, etc.) — every tile is the same monotone treatment; the icon glyph is the only differentiator.
- **Don't** use `ink-icon` (`#686864`) for body text — it only clears the 3:1 non-text threshold, not the 4.5:1 text threshold. It exists for icon glyphs only.
- **Don't** add fake terminal chrome (blinking cursors, `[+]`/`[x]` window-frame glyphs, ASCII borders) — the brief settled on minimal chrome: the palette, font, and icon set carry the identity; widgets stay as plain bordered panels.
