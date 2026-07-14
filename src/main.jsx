import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { bumpStreak, dailyBrief, hydrate } from './core'
import './styles.css'

// Every folder in src/modules/ with an index.jsx self-registers via registerWidget.
// Adding a module = adding a folder; see src/modules/README.md.
import.meta.glob('./modules/*/index.jsx', { eager: true })

// Load saved state from disk first so the app renders with it, not defaults.
await hydrate()
bumpStreak()
createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
// First open of the day: what's due, first class, today's events, streak.
setTimeout(dailyBrief, 400)
