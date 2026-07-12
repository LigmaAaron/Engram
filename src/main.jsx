import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { bumpStreak, dailyBrief, hydrate } from './core'
import './styles.css'

// Import widgets for their registration side-effects. Add a file here to add a widget.
import './widgets/Tasks'
import './widgets/Metrics'
import './widgets/Calendar'
import './widgets/Notes'
import './widgets/Launcher'
import './widgets/Chat'

// Load saved state from disk first so the app renders with it, not defaults.
await hydrate()
bumpStreak()
createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
// First open of the day: what's due, first class, today's events, streak.
setTimeout(dailyBrief, 400)
