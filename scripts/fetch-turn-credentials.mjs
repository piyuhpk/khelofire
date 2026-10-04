/**
 * Fetch TURN credentials and write them into .env.
 *
 * The relay itself is the one piece of voice that cannot be built, bought or guessed:
 * STUN only discovers addresses, and carrier NAT on a phone kills the direct path, so
 * without a relay the mic opens onto nobody. OpenRelay's free relay went down in April
 * 2026 and every remaining option needs an account, so this script takes the key from
 * that account and does the rest.
 *
 *   node scripts/fetch-turn-credentials.mjs <appname> <apiKey>
 *
 * It writes VITE_TURN_* into .env, replaces any previous relay, and refuses to report
 * success on a reply with no relay URLs in it. Then run npm run turn:probe - that is the
 * check that decides whether a call can actually connect, and a credential that has not
 * passed it should not go into a build.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const app = process.argv[2]
const apiKey = process.argv[3]

if (!app || !apiKey) {
  console.error('usage: node scripts/fetch-turn-credentials.mjs <appname> <apiKey>')
  console.error('  appname and apiKey come from the TURN provider dashboard')
  process.exit(1)
}
if (!existsSync('.env')) {
  console.error('no .env here - run this from the app directory')
  process.exit(1)
}

const url = `https://${app}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`
console.log(`asking ${app}.metered.live for credentials`)

const res = await fetch(url)
const text = await res.text()
if (!res.ok) {
  console.error(`HTTP ${res.status} - check the app name and the API key`)
  console.error(text.slice(0, 300))
  process.exit(1)
}

let body
try {
  body = JSON.parse(text)
} catch {
  console.error('the reply was not JSON:')
  console.error(text.slice(0, 300))
  process.exit(1)
}

// The provider has answered in more than one shape over time, so take the iceServers
// list wherever it is rather than assuming one.
const servers = Array.isArray(body) ? body
  : Array.isArray(body?.iceServers) ? body.iceServers
  : Array.isArray(body?.data?.iceServers) ? body.data.iceServers
  : [body]

const usable = servers.filter((s) => s?.urls)
const turnUrls = []
for (const s of usable) {
  for (const u of [].concat(s.urls)) {
    if (typeof u === 'string' && /^turns?:/.test(u) && !turnUrls.includes(u)) turnUrls.push(u)
  }
}

const withCreds = usable.find((s) => s?.username && s?.credential)
if (!turnUrls.length) {
  console.error('the reply contained no turn: urls, so there is nothing to write')
  console.error(JSON.stringify(body).slice(0, 400))
  process.exit(1)
}
if (!withCreds) {
  console.error('the reply had no username/credential pair')
  console.error(JSON.stringify(body).slice(0, 400))
  process.exit(1)
}

const lines = [
  `VITE_TURN_URLS=${turnUrls.join(',')}`,
  `VITE_TURN_CREDENTIAL=${withCreds.credential}`,
  `VITE_TURN_USERNAME=${withCreds.username}`,
]
console.log('\nturn urls:')
for (const u of turnUrls) console.log(`  ${u}`)
console.log(`username: ${withCreds.username}`)

// Replace an existing block in place so the rest of .env, including the notes, survives.
let env = readFileSync('.env', 'utf8')
const strip = (s) => s
  .split(/\r?\n/)
  .filter((l) => !/^\s*VITE_TURN_(URLS|CREDENTIAL|USERNAME)\s*=/.test(l))
  .filter((l) => l.trim() !== '')
  .join('\n')

const marker = '# ---------- voice chat: TURN relay ----------'
const head = env.includes(marker) ? env.slice(0, env.indexOf(marker)).trimEnd() : strip(env)
writeFileSync('.env', `${head}\n\n${marker}\n${lines.join('\n')}\n`, 'utf8')
console.log('\nwrote VITE_TURN_* into .env')
console.log('now run: npm run turn:probe   (PASS required before shipping)')