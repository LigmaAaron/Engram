// Runs as npm `predev`, so `npm run dev` (and the preview harness) auto-starts
// Ollama before Vite — the chat works the moment the page loads. Never fails the
// dev run: if Ollama isn't installed it just warns and moves on.
import { spawn } from 'node:child_process'

const HOST = 'http://localhost:11434'
const MODEL = 'qwen3.5:latest' // keep in sync with src/widgets/Chat.jsx

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const up = async () => {
  try { return (await fetch(`${HOST}/api/version`, { signal: AbortSignal.timeout(1000) })).ok } catch { return false }
}
const detached = (args) => {
  const c = spawn('ollama', args, { detached: true, stdio: 'ignore' })
  c.on('error', () => {}) // ollama not installed — ignore
  c.unref()
}

// Preload the model so the first message isn't a cold start. Detached: outlives
// this script; `ollama serve` keeps the model resident (keep_alive) after it exits.
const warm = () => detached(['run', MODEL, 'hi'])

if (await up()) {
  console.log('[ollama] already running')
  warm()
} else {
  console.log('[ollama] starting `ollama serve`…')
  detached(['serve'])
  let ready = false
  for (let i = 0; i < 30 && !ready; i++) { await sleep(500); ready = await up() }
  if (ready) { console.log('[ollama] ready'); warm() }
  else console.warn('[ollama] did not come up — is it installed? chat will retry when it does')
}
