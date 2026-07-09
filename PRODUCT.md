# Product

## Register

product

## Users

Aaron, solo. A personal daily-use dashboard he opens repeatedly throughout the day to track tasks, agenda, and quick metrics, and to jump to frequently used links. Single-user tool, not a multi-tenant product — no onboarding flow, no auth, no account switching.

## Product Purpose

A self-contained daily dashboard: tasks, today's agenda + month calendar, at-a-glance metrics (completion, streak, event count), and a quick-launch grid of links. Built with a scripting hook (`window.Hermes`) so an external automation layer can register widgets, push notifications, and drive state later. Success looks like: opens fast, state persists across reloads, and it feels like a tool Aaron actually wants to look at every day rather than a generic template.

## Brand Personality

Modern dev-tool terminal — the feel of Warp, Ghostty, or a well-configured VS Code integrated terminal. Utilitarian, precise, monospace-first. Explicitly not the "hacker" cliché (no neon green-on-black, no CRT glitch, no Matrix rain). Blocky pixel-icon precision over rounded, friendly iconography.

## Anti-references

- The generic SaaS/Linear-style dashboard this project started as: rounded corners, soft shadows, purple gradient accents, humanist sans-serif. Explicitly rejected as "unlike me."
- Neon-green Matrix/CRT-glitch "hacker" terminal tropes — scanlines, glow, glitch text.
- Decorative color for its own sake (brand-colored icon tiles, gradients, accent-per-widget).

## Design Principles

1. **Utilitarian over decorative** — every visual choice earns its keep; nothing is there to look impressive.
2. **Monospace as structure, not costume** — grid alignment and a real type system, not a gimmick font swapped in.
3. **Color is functional, not decorative** — grayscale by default; hue only ever signals state (done/success, error/overdue).
4. **Sharp edges, no soft chrome** — zero border-radius, thin 1px borders, no shadows or blur.
5. **Restraint over roleplay** — terminal-inspired, not terminal-cosplay: no fake window chrome, no blinking cursors, no ASCII decoration.

## Accessibility & Inclusion

Standard WCAG AA contrast target. Single named user, no stated assistive-tech needs. `prefers-reduced-motion` still respected for any transitions since it costs nothing to honor.
