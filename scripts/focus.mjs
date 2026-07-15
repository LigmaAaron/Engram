// Enforces an app blocklist while a Pomodoro work session is running: polls
// for running apps every 2s and quits any that match. Used by the /__focus
// middleware in vite.config.js — see that file for routing.
// ponytail: single global blocklist/interval, one focus session at a time.
// Fine for a single-user desktop tool; add per-session ids if that changes.
import { execSync } from 'node:child_process'

let blocklist = []
let timer = null

export function appsToQuit(runningNames, list) {
  const set = new Set(list.map((a) => a.toLowerCase()))
  return runningNames.filter((n) => set.has(n.toLowerCase()))
}

function runningAppNames() {
  try {
    const out = execSync(
      `osascript -e 'tell application "System Events" to get name of every process whose background only is false'`,
      { encoding: 'utf8' }
    )
    return out.trim().split(', ').map((s) => s.trim()).filter(Boolean)
  } catch {
    return []
  }
}

function quitApp(name) {
  try {
    execSync(`osascript -e 'tell application "${name}" to quit'`)
  } catch {
    // best-effort — one unscriptable or permission-denied app shouldn't stop
    // enforcement for the rest of the blocklist
  }
}

export function startEnforcing(apps) {
  blocklist = apps
  if (timer) clearInterval(timer)
  timer = setInterval(() => {
    for (const name of appsToQuit(runningAppNames(), blocklist)) quitApp(name)
  }, 2000)
}

export function stopEnforcing() {
  if (timer) clearInterval(timer)
  timer = null
  blocklist = []
}

export function isEnforcing() {
  return timer !== null
}
