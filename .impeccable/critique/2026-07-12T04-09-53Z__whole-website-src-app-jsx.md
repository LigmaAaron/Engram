---
target: whole website (src/App.jsx)
total_score: 24
p0_count: 0
p1_count: 3
timestamp: 2026-07-12T04-09-53Z
slug: whole-website-src-app-jsx
---
#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Toasts/notifications/streaming chat all confirm actions well; the global topbar search silently does nothing on 6 of 8 tabs |
| 2 | Match System / Real World | 3 | Plain, student-appropriate language throughout; "Day streak" reads as a task-completion streak but actually counts consecutive days the app was opened |
| 3 | User Control and Freedom | 2 | No undo/confirm on deleting a task, event, class, or link — one click, gone, unlike the confirmed Shutdown flow |
| 4 | Consistency and Standards | 2 | Quick Launch "Add" uses raw `window.prompt()` dialogs — the only place the app breaks its own component system |
| 5 | Error Prevention | 2 | Same instant-delete gap as #3; empty-field submits just silently no-op with no inline feedback |
| 6 | Recognition Rather Than Recall | 3 | Nav is fully labeled; delete/remove icons have `aria-label`s but are invisible until hovered |
| 7 | Flexibility and Efficiency | 2 | Slash-commands in chat/command-bar are a genuine power-user win; no shortcuts, no command palette, no bulk actions elsewhere |
| 8 | Aesthetic and Minimalist Design | 4 | The system's strongest dimension — disciplined grayscale, zero decorative clutter, one typeface, hairline-grid used consistently |
| 9 | Error Recovery | 2 | Chat's Ollama-unreachable message is a model example of good recovery copy; nothing else in the app has an equivalent |
| 10 | Help and Documentation | 1 | No help anywhere; Settings literally says "Nothing to configure yet — wire it via window.AaronOS" |
| **Total** | | **24/40** | **Acceptable — solid foundation, real functional gaps under the surface** |

#### Anti-Patterns Verdict

**Start here.** Does this look AI-generated?

**LLM assessment**: No — and that's the headline. AaronOS actively rejects every AI-slop tell in its own DESIGN.md: no gradients, no rounded corners, no card-grid sameness, no purple SaaS accent, no eyebrow labels, no glassmorphism. The grayscale-plus-two-state-colors system, the hairline-grid technique used identically across stat tiles/calendar/launcher, and the single self-hosted pixel-mono typeface read as a genuinely hand-tuned personal tool, not a template. This is the rare project where the design system itself, not just this critique, is doing the anti-slop work.

**Deterministic scan**: `detect.mjs` found exactly one advisory finding — a literal `#ffffff` at `src/styles.css:74` (`.add-row > button:hover{background:#ffffff}`), outside the documented palette. I traced this by hand: it's real. DESIGN.md's own commentary on the `ink` token is explicit that "near-white, never pure white" is a deliberate rule, and this hover state on the primary "+" add button (the single most-repeated interactive element in the app — Tasks, Calendar, Schedule all use it) breaks that rule by hovering to pure white instead of `--inverse-bg` (`#e8e8e6`). Not a false positive — a real, if small, drift.

**Visual overlays**: Browser injection was not run for this pass — a local Vite dev server was used directly for live inspection (screenshots, computed styles, DOM/CSS queries) instead of the `detect.js` overlay flow, since the target is a full authenticated app rather than a static page. No user-visible overlay is available in a tab; findings below are backed by direct screenshots and source inspection instead.

#### Overall Impression

The visual design is genuinely disciplined and does exactly what it set out to do — it looks like a tool Aaron would actually want open all day, not a generic dashboard. The gap is beneath the surface: several interactions quietly don't work the way the rest of the system promises. The biggest opportunity is closing that gap without touching the aesthetic at all — this needs functional polish, not a redesign.

#### What's Working

- **The hairline-grid technique is used with real discipline.** Stat tiles, the calendar, and quick-launch all share the identical `border-hairline` + `1px` gap pattern with zero one-off borders — confirmed in `styles.css` lines 89, and matched visually in the Metrics and Quick Launch screenshots. This is the kind of small systemic consistency that most "design system" projects claim and don't actually deliver.
- **Contrast is not just claimed, it's true.** I computed WCAG contrast ratios directly from the shipped hex values: `ink-dim` on `surface` is 5.9:1, placeholder text (confirmed via computed `::placeholder` color) resolves to the same `ink-dim` token rather than the dimmer `ink-icon` — exactly what DESIGN.md's "Don't use ink-icon for body text" rule demands. Nothing here is theoretical; it's shipped correctly.
- **The chat agent's failure messaging is a model for the rest of the app.** "Couldn't reach Ollama (…). Is it running? Model: qwen3.5:latest." names the problem, suggests a cause, and doesn't lose the user's message. Nothing else in the app is this good at recovery — see Priority Issues below.

#### Priority Issues

**[P1] Destructive icon buttons are invisible to keyboard users**
Why it matters: `.task .del`, `.ev .del` (calendar and schedule), and `.launch .rm` (quick-launch remove) are all `opacity:0` at rest and only reveal on `:hover` — I grep'd `styles.css` and confirmed none of the three have a `:focus`/`:focus-within` companion rule, only `.task:hover .del`, `.ev:hover .del`, `.launch:hover .rm`. A sighted keyboard-only user (persona Sam) tabbing through tasks or quick-launch tiles lands on a completely invisible, unstyled control with no visual confirmation of what's focused or that a delete action even exists there.
Fix: Add `:focus-within` (or `:focus-visible` on the button itself) alongside every `:hover` reveal rule for these four opacity-gated affordances.
Suggested command: `/impeccable harden`

**[P1] Quick Launch's "Add" flow breaks the entire component system**
Why it matters: `Launcher.jsx` (lines 8–9) calls `prompt('Link name?')` and `prompt('URL?', 'https://')` directly — two sequential native browser dialogs, completely unstyled, blocking, with no icon selection despite the widget supporting six icon types (`Mail`, `Terminal`, `Calendar`, `Folder`, `Message`, `ExternalLink`). Every other data-entry flow in the app (Shutdown, due-date picker, event/class add-rows) uses the custom bordered-panel component vocabulary. This is the one place a user hits raw OS chrome in an otherwise fully custom terminal aesthetic — and it's a core action (adding a link) that a power user (Alex) will use often.
Fix: Build the same inline `add-row` pattern already used by Tasks/Calendar/Schedule for the launcher: a text input, URL input, and an icon `Dropdown` (the component already exists and is used elsewhere in Chat's model/effort pickers).
Suggested command: `/impeccable craft` (quick-launch add form)

**[P1] No responsive breakpoint — the app is unusable at phone width**
Why it matters: At 375px width, I confirmed by screenshot that the icon-only sidebar rail never collapses and permanently consumes ~28% of viewport width. The remaining space is so cramped that the Tasks placeholder "Add homework… (#class to tag)" renders as literally "Ad", the topbar search placeholder truncates to "Search task", and the month calendar grid overflows its card and requires horizontal scrolling to see Friday/Saturday. DESIGN.md's own Navigation section states items "stack vertically, icon + label, no icons-only collapsed state **except at the narrow mobile breakpoint**" — implying a mobile breakpoint was planned but was never implemented. The `product.md` register this project is scored against is explicit that responsive behavior should be "structural (collapse sidebar, responsive table)," not absent.
Fix: Add a real narrow breakpoint — collapse the sidebar to icons-only or an off-canvas drawer below ~600px, and let the two-column add-rows (Tasks, Calendar, Schedule) stack to one column so their inputs get real width back.
Suggested command: `/impeccable adapt`

**[P2] Instant, unconfirmed deletion of tasks, events, classes, and links**
Why it matters: Every delete affordance (task, event, class, quick-launch link) fires on a single click with no confirmation and no undo — the only confirmed destructive action in the whole app is Shutdown. Losing a hand-typed class schedule entry or a quick-launch link to a misclick has real reconstruction cost, and it's inconsistent that the lowest-stakes action (closing the app) is the one that got a confirm modal.
Fix: A lightweight undo toast ("Task removed · Undo") reusing the existing `Toaster` component would fix this without adding a modal anywhere.
Suggested command: `/impeccable harden`

**[P2] Design-token drift on the app's most-repeated button**
Why it matters: `.add-row > button:hover{background:#ffffff}` (styles.css:74) is pure white, while DESIGN.md is explicit that the near-white ink tokens are "never pure white" by design. This is the hover state of the "+" button used identically in Tasks, Calendar, and Schedule, so the drift is small in file size but shows up constantly during real use.
Fix: Swap `#ffffff` for `var(--inverse-bg)` (`#e8e8e6`) to match the documented token, or brighten `--inverse-bg` itself if a brighter hover was actually the intent.
Suggested command: `/impeccable polish`

#### Persona Red Flags

**Alex (Power User)**: The slash-command system in chat (`/task`, `/essay`, `/studyguide`, `/plan`) is a genuinely good power-user accelerator, and the overview command bar surfacing it is a smart touch. But there's no keyboard shortcut to jump between widgets or open the command bar from anywhere (no Cmd+K), and every delete action is one-at-a-time with no bulk select — clearing five completed tasks means five individual clicks, each requiring a hover first to even see the delete icon.

**Jordan (First-Timer)**: The empty states are good ("Nothing here. Add your first task.") and icons are consistently paired with text labels in the sidebar. The one place Jordan will stall: clicking "Settings" fires a notification reading "Nothing to configure yet — wire it via window.AaronOS." — that's a raw developer-facing message surfaced as user-facing copy, and it will read as broken/confusing to anyone who isn't the developer.

**Sam (Accessibility-Dependent User)**: Confirmed via direct CSS inspection — text inputs (task/event/class/notes fields) get a documented, deliberate focus style (border brightens to `ink-dim`, consistent with DESIGN.md's "no glow, no ring" rule) and that's legitimate. But the delete/remove icon buttons across Tasks, Calendar, Schedule, and Quick Launch have zero focus treatment at all — see [P1] above. This is the single biggest accessibility gap in the app: it's not that focus indicators are missing everywhere, it's that they're missing exactly on the destructive actions.

#### Minor Observations

- The global topbar search (placeholder "Search tasks…") is present on all 8 sidebar views but only ever filters the Tasks widget (confirmed: `ui.search` is read in exactly one file, `Tasks.jsx`). The placeholder text is honest about its scope, so this is low-severity, but a user typing into it while on the Schedule or Notes tab gets no feedback that it's doing nothing there.
- "Day streak" on the Metrics tile counts consecutive days the app was *opened* (`bumpStreak()` in `core.js`), not days a task was completed, despite sitting directly next to "Completed" and "Open tasks" tiles that are about task activity. A student glancing at it will likely misread it as a homework-completion streak.
- I could not get Enter-to-submit to reliably fire in the Tasks add-row during this session (text stayed in the field after focused Return presses; the "+" button worked every time). This may be a limitation of the automated browser tooling used for this review rather than a real defect — worth a 30-second manual check in an actual browser before treating it as a bug.
- The notification bell badge and the "late" task-due chip both correctly use the single `--err` token (`#e5534b`) — the two-state-color rule is being followed with no drift found there.

#### Questions to Consider

- The Quick Launch `prompt()` flow is the only native-chrome moment in an otherwise fully custom interface — was that a deliberate "this one's low-stakes, don't bother" call, or just the last thing that didn't get the custom-component treatment?
- Given this is a single-user, mostly-desktop daily tool (per PRODUCT.md), is phone-width support actually a real use case worth building, or is the DESIGN.md mobile-breakpoint language aspirational and safe to defer?
- Would an undo-toast pattern (reusing the existing `Toaster`) cover the delete-confirmation gap well enough, or does the class-schedule specifically warrant a harder confirm given how tedious it'd be to retype?
