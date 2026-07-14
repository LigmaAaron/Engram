// Smallest check that fails if the server-side tool loop breaks: mock Ollama to
// return one tool call then a final reply, run the agent, and confirm the tool
// actually mutated state.json. Run: node scripts/agent.test.mjs
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert'
import { makeStore } from './state-store.mjs'
import { runAgent } from './agent.mjs'

// Fake Ollama /api/chat: first call emits an add_task tool call, second replies.
let call = 0
globalThis.fetch = async () => {
  call++
  const lines = call === 1
    ? ['{"message":{"tool_calls":[{"function":{"name":"add_task","arguments":{"text":"finish chem lab tomorrow"}}}]}}']
    : ['{"message":{"content":"Added it."}}']
  const body = new ReadableStream({ start(c) { for (const l of lines) c.enqueue(new TextEncoder().encode(l + '\n')); c.close() } })
  return new Response(body, { status: 200 })
}

const dir = await mkdtemp(join(tmpdir(), 'engram-agent-'))
try {
  const store = makeStore(dir)
  const state = {
    tasks: [], events: [], schedule: [], notes: [], reminders: [], links: [], notifs: [],
    chats: [{ id: 1, title: '', messages: [{ role: 'user', content: 'add a task to finish chem lab tomorrow' }], artifacts: [] }],
    activeChat: 1, settings: { model: 'test', think: false, effort: 'low' }, generating: null,
  }
  await store.save(JSON.stringify(state))

  const events = []
  await runAgent({ store, chatId: 1, signal: undefined, onEvent: (e) => events.push(e.type), memoryFile: join(dir, 'memory.md') })

  const out = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'))
  assert.equal(out.tasks.length, 1, 'add_task should have created one task')
  assert.match(out.tasks[0].text, /chem lab/, 'task text preserved')
  assert.equal(out.generating, null, 'generating flag cleared at the end')
  assert.equal(out.chats[0].messages.at(-1).content, 'Added it.', 'final assistant reply persisted')
  assert.ok(events.includes('state') && events.includes('done'), 'emitted state + done events')
  console.log('agent.test.mjs OK — tool loop mutated state.json')
} finally {
  await rm(dir, { recursive: true, force: true })
}
