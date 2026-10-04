/**
 * Run scripts/turn-probe.html in headless Chrome and print what WebRTC can gather.
 *
 * Why the browser rather than turn-check.mjs: a STUN reply that decodes correctly says
 * nothing about whether a call can be made. What a call needs is a relay candidate, and
 * only the real ICE stack decides that. An Android WebView is Chromium, so a result
 * here is evidence about the phone rather than about a stand-in.
 *
 * Dependencies are deliberately zero. There is no Playwright in this project and no
 * ws package, so this drives Chrome over the DevTools protocol on Node's built-in
 * WebSocket, which is why the port and the temp profile are handled by hand.
 *
 *   node scripts/turn-browser-probe.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => { try { readFileSync(p); return true } catch { return false } })

if (!CHROME) {
  console.error('no Chrome or Edge found')
  process.exit(1)
}

const env = {}
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const urls = (env.VITE_TURN_URLS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const server = { urls, username: env.VITE_TURN_USERNAME, credential: env.VITE_TURN_CREDENTIAL }
if (!urls.length || !server.username || !server.credential) {
  console.error('no TURN config in .env - nothing to probe')
  process.exit(1)
}

console.log(`browser  ${CHROME}`)
console.log(`ice      ${JSON.stringify(server)}\n`)

// The page reads its config from window.__ICE_SERVERS, so the values have to exist
// before the module script runs.
const html = readFileSync('scripts/turn-probe.html', 'utf8')
  .replace(
    '<script type="module">',
    `<script>window.__ICE_SERVERS = ${JSON.stringify([server])}</script>\n<script type="module">`,
  )
const page = join(mkdtempSync(join(tmpdir(), 'turnprobe-')), 'probe.html')
writeFileSync(page, html)

const profile = mkdtempSync(join(tmpdir(), 'turnchrome-'))
const PORT = 9333
const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--allow-running-insecure-content',
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${PORT}`,
  pathToFileURL(page).href,
], { stdio: 'ignore' })

const cleanup = () => {
  try { chrome.kill() } catch {}
  for (const d of [profile, join(page, '..')]) {
    try { rmSync(d, { recursive: true, force: true }) } catch {}
  }
}

async function waitForDevTools() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await r.json()
      const target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (target) return target
    } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('DevTools did not come up on port ' + PORT)
}

let code = 1
try {
  const target = await waitForDevTools()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('cdp socket failed')) })

  let id = 0
  const pending = new Map()
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    }
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id
    pending.set(n, { resolve, reject })
    ws.send(JSON.stringify({ id: n, method, params }))
  })

  // A module script is deferred, so window.__probe does not exist the instant DevTools
  // attaches. Evaluating before that yields undefined and looks like a dead page.
  let ready = false
  for (let i = 0; i < 80; i++) {
    const probe = await send('Runtime.evaluate', {
      expression: 'typeof window.__probe',
      returnByValue: true,
    })
    if (probe.result?.value === 'object') { ready = true; break }
    await new Promise((r) => setTimeout(r, 250))
  }
  if (!ready) {
    console.error('the probe script never installed window.__probe')
    console.error('page url:', target.url)
    ws.close()
    cleanup()
    process.exit(1)
  }

  const evalResult = await send('Runtime.evaluate', {
    expression: 'window.__probe',
    awaitPromise: true,
    returnByValue: true,
    timeout: 30000,
  })

  if (evalResult.exceptionDetails) {
    console.error('page threw:', JSON.stringify(evalResult.exceptionDetails, null, 2))
  } else if (evalResult.result?.value === undefined) {
    console.error('the probe promise never resolved to a value')
    console.error('page said:', JSON.stringify(evalResult.result))
    code = 1
  } else {
    const r = evalResult.result.value
    console.log(JSON.stringify(r, null, 2))
    const relayCount = r.relay?.length ?? 0
    console.log()
    if (relayCount > 0) {
      console.log(`PASS: ${relayCount} relay candidate(s). The browser can be relayed, so voice will connect.`)
      code = 0
    } else {
      console.log(`FAILED: no relay candidate. Gathering=${r.done}, candidates=${r.total}.`)
      console.log('The relay did not hand the browser an address, so a call would never establish.')
      if (r.errors?.length) console.log(`errors: ${r.errors.join(', ')}`)
    }
  }
  ws.close()
} catch (e) {
  console.error(`probe failed: ${e.message}`)
} finally {
  cleanup()
}
process.exit(code)