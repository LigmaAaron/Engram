import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFile, appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { makeStore } from './scripts/state-store.mjs'
import { runAgent, searchWeb } from './scripts/agent.mjs'

// File-backed persistence for the dashboard. Browsers can't write to disk, so
// the app GETs/POSTs its whole state here and the dev server keeps it in
// data/state.json — survives clearing the browser, syncs across tabs on reload.
// Writes go through makeStore: atomic (temp + rename) with a rolling .bak, so a
// crash or a second writer can't corrupt or erase the file.
// ponytail: single JSON blob, last-write-wins. Split per-collection only if the
// file grows big enough that rewriting all of it on every change actually hurts.
const store = makeStore('data')
// The chat agent's long-term memory: a plain markdown file it reads into every
// system prompt and appends to via its `remember` tool. Self-improvement in the
// laziest form that works — no DB, just a file you can also open and edit yourself.
const MEMORY_FILE = 'data/memory.md'

function dataStore() {
  return {
    name: 'aaronos-data-store',
    configureServer(server) {
      store.claimLock() // warn if another dev server already owns data/state.json
      server.middlewares.use('/__data', (req, res) => {
        if (req.method === 'GET') {
          store.load()
            .then((txt) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(txt) })
            .catch(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}') })
          return
        }
        if (req.method === 'POST') {
          let body = ''
          req.on('data', (c) => { body += c })
          req.on('end', async () => {
            try { JSON.parse(body) } catch { res.writeHead(400).end('invalid JSON'); return }
            await store.save(body)
            res.writeHead(204).end()
          })
          return
        }
        res.writeHead(405).end()
      })

      // Web search for the chat agent (see searchWeb in scripts/agent.mjs, shared
      // with the agent's web_search tool). ponytail: DDG HTML scrape, no API key.
      server.middlewares.use('/__search', async (req, res) => {
        const q = new URL(req.url, 'http://localhost').searchParams.get('q') || ''
        try {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(await searchWeb(q)))
        } catch (e) {
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: e.message }))
        }
      })

      // ---- Server-side chat agent ----
      // A generation belongs to this Node process, not a browser tab: the loop
      // runs in scripts/agent.mjs and streams over SSE, so reloading, switching
      // chats, or closing the window can't kill an in-flight reply. `runs` tracks
      // one live generation per chatId; a reconnecting tab reattaches to it.
      const runs = new Map() // chatId -> { subscribers:Set<res>, controller, partial }
      const sseOpen = (res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); res.write(':\n\n') }
      const sseSend = (res, ev) => res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`)
      const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c }); req.on('end', () => { try { resolve(JSON.parse(b || '{}')) } catch { resolve({}) } }) })

      // On boot, a `generating` flag left in state.json is stale (the process
      // that owned it is gone) — clear it so the UI doesn't show a dead bubble.
      store.load().then((txt) => {
        const s = JSON.parse(txt)
        if (s && s.generating != null) { s.generating = null; store.save(JSON.stringify(s)) }
      }).catch(() => {})

      server.middlewares.use('/__chat/stop', async (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405).end(); return }
        const { chatId } = await readBody(req)
        runs.get(chatId)?.controller.abort()
        res.writeHead(204).end()
      })

      server.middlewares.use('/__chat', async (req, res) => {
        // GET reattaches a tab to an in-flight generation (e.g. after reload).
        if (req.method === 'GET') {
          const chatId = Number(new URL(req.url, 'http://localhost').searchParams.get('chatId'))
          const run = runs.get(chatId)
          sseOpen(res)
          if (!run) {
            // Nothing running — push current state so the tab clears any stale
            // `generating` flag it reloaded with, then close.
            const state = await store.load().then(JSON.parse).catch(() => null)
            if (state) sseSend(res, { type: 'state', state })
            sseSend(res, { type: 'done' }); res.end(); return
          }
          run.subscribers.add(res)
          req.on('close', () => run.subscribers.delete(res))
          if (run.partial.content || run.partial.thinking) sseSend(res, { type: 'delta', ...run.partial })
          return
        }
        if (req.method !== 'POST') { res.writeHead(405).end(); return }
        const body = await readBody(req)
        const chatId = body.chatId
        sseOpen(res)
        // Already running for this chat → just attach as another viewer.
        const existing = runs.get(chatId)
        if (existing) {
          existing.subscribers.add(res)
          req.on('close', () => existing.subscribers.delete(res))
          if (existing.partial.content || existing.partial.thinking) sseSend(res, { type: 'delta', ...existing.partial })
          return
        }
        const run = { subscribers: new Set([res]), controller: new AbortController(), partial: { content: '', thinking: '' } }
        runs.set(chatId, run)
        req.on('close', () => run.subscribers.delete(res))
        const onEvent = (ev) => {
          if (ev.type === 'delta') run.partial = { content: ev.content, thinking: ev.thinking }
          for (const r of run.subscribers) sseSend(r, ev)
        }
        runAgent({ store, chatId, userText: body.userText, runText: body.runText, extra: body.extra, regenerate: body.regenerate, signal: run.controller.signal, onEvent, memoryFile: MEMORY_FILE })
          .catch((e) => onEvent({ type: 'error', message: e.message }))
          .finally(() => { runs.delete(chatId); for (const r of run.subscribers) r.end() })
      })

      // GET reads the memory markdown; POST appends one timestamped note to it.
      server.middlewares.use('/__memory', (req, res) => {
        if (req.method === 'GET') {
          readFile(MEMORY_FILE, 'utf8')
            .then((txt) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(txt) })
            .catch(() => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('') })
          return
        }
        if (req.method === 'POST') {
          let body = ''
          req.on('data', (c) => { body += c })
          req.on('end', async () => {
            const note = body.trim()
            if (!note) { res.writeHead(400).end('empty note'); return }
            await mkdir(dirname(MEMORY_FILE), { recursive: true })
            await appendFile(MEMORY_FILE, `- ${new Date().toISOString().slice(0, 10)}: ${note}\n`)
            res.writeHead(204).end()
          })
          return
        }
        res.writeHead(405).end()
      })

      // Lets the UI stop the dev server itself — the standalone app's Dock
      // icon doesn't reliably offer a quit (it's a plain script, not a real
      // Cocoa app), so this is the actual "close" button.
      server.middlewares.use('/__shutdown', (req, res) => {
        if (req.method !== 'POST') { res.writeHead(405).end(); return }
        res.writeHead(204).end()
        setTimeout(() => process.exit(0), 300)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), dataStore()],
  build: { target: 'esnext' }, // main.jsx uses top-level await

  server: {
    // The chat widget calls Ollama through this proxy so the browser hits a
    // same-origin path — no OLLAMA_ORIGINS / CORS setup needed on Ollama's side.
    proxy: { '/ollama': { target: 'http://localhost:11434', changeOrigin: true, rewrite: (p) => p.replace(/^\/ollama/, '') } },
  },
})
