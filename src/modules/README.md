# Modules

Each folder here is a self-contained plugin: its widget (overview card), its
sidebar behavior, and its solo page. Drop in a folder with an `index.jsx` that
calls `registerWidget` and it appears in the app — no shared files to edit.

```jsx
// src/modules/hello/index.jsx
import { Zap } from 'pixelarticons/react'
import { registerWidget } from '../../core'

function Hello() { return <p>Hi from a plugin!</p> }

registerWidget({
  id: 'hello',       // unique; doubles as the sidebar view id
  title: 'Hello',
  icon: Zap,         // any pixelarticons/react icon
  order: 70,         // sidebar + overview position (10–60 are taken)
  span: 6,           // overview grid columns out of 12
  Widget: Hello,     // overview card — omit to stay off the overview
  Page: Hello,       // solo page — omit to stay out of the sidebar
  nav: {             // optional sidebar extras
    badge: (state) => 0,   // count shown on the nav item when > 0
    onAdd: () => {},       // "+" button next to the nav item
    Panel: Hello,          // expandable sub-panel under the nav item
  },
  settings: HelloSettings, // optional — rendered in this module's category
                           // on the Settings page, below the visibility
                           // toggles. Omit if the module has no configurable
                           // behavior.
})
```

Modules read/write app state via `useStore`/`actions` from `../../core`.
Big modules can split into more files (`Page.jsx`, `Widget.jsx`, …) imported
by `index.jsx` — only `index.jsx` is auto-loaded.

Every module (built-in or installed extension) automatically gets a category
on the Settings page with "Show on Overview"/"Show in Sidebar" toggles
(whichever of `Widget`/`Page` it defines); `settings` is only needed for
extra, module-specific options.
