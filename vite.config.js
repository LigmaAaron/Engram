import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

// File-backed persistence for the dashboard. Browsers can't write to disk, so
// the app GETs/POSTs its whole state here and the dev server keeps it in
// data/state.json — survives clearing the browser, syncs across tabs on reload.
// ponytail: single JSON blob, last-write-wins. Split per-collection only if the
// file grows big enough that rewriting all of it on every change actually hurts.
const DATA_FILE = 'data/state.json'
// The chat agent's long-term memory: a plain markdown file it reads into every
// system prompt and appends to via its `remember` tool. Self-improvement in the
// laziest form that works — no DB, just a file you can also open and edit yourself.
const MEMORY_FILE = 'data/memory.md'

function dataStore() {
  return {
    name: 'aaronos-data-store',
    configureServer(server) {
      server.middlewares.use('/__data', (req, res) => {
        if (req.method === 'GET') {
          readFile(DATA_FILE, 'utf8')
            .then((txt) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(txt) })
            .catch(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}') })
          return
        }
        if (req.method === 'POST') {
          let body = ''
          req.on('data', (c) => { body += c })
          req.on('end', async () => {
            try { JSON.parse(body) } catch { res.writeHead(400).end('invalid JSON'); return }
            await mkdir(dirname(DATA_FILE), { recursive: true })
            await writeFile(DATA_FILE, body)
            res.writeHead(204).end()
          })
          return
        }
        res.writeHead(405).end()
      })

      // Web search for the chat agent: proxies DuckDuckGo's HTML results
      // (no API key) and scrapes the top hits server-side to dodge CORS.
      // ponytail: regex scrape of one known page layout — swap for a search API if DDG breaks it.
      server.middlewares.use('/__search', async (req, res) => {
        const q = new URL(req.url, 'http://localhost').searchParams.get('q') || ''
        try {
          const html = await (await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), {
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) AaronOS' },
          })).text()
          const strip = (h) => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
          const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
          const results = []
          let m
          while ((m = re.exec(html)) && results.length < 5) {
            const uddg = /uddg=([^&"]+)/.exec(m[1])
            results.push({ title: strip(m[2]), url: uddg ? decodeURIComponent(uddg[1]) : m[1], snippet: strip(m[3]) })
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(results))
        } catch (e) {
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: e.message }))
        }
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
        setTimeout(() => process.exit(0), 50)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), dataStore()],
  server: {
    // The chat widget calls Ollama through this proxy so the browser hits a
    // same-origin path — no OLLAMA_ORIGINS / CORS setup needed on Ollama's side.
    proxy: { '/ollama': { target: 'http://localhost:11434', changeOrigin: true, rewrite: (p) => p.replace(/^\/ollama/, '') } },
  },
})
