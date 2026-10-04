/**
 * Check the configured TURN relay really hands out a relayed address.
 *
 * hasTurn() returning true only proves three variables are set. It does not prove the
 * server exists, that the hostname resolves, or that the credentials are accepted -
 * and a relay that refuses to allocate leaves the player with a mic that opens onto
 * nobody, which is the exact failure the button is supposed to be honest about.
 *
 * So this speaks TURN properly: an Allocate request, then long-term credential
 * authentication (HMAC-SHA1 over the message, key = MD5(username:realm:password)) and
 * a second Allocate that must come back with XOR-RELAYED-ADDRESS.
 *
 *   node scripts/turn-check.mjs [url] [username] [credential]
 *
 * Defaults come from .env. Exit code 0 only when a relay was actually allocated.
 *
 * Both requests go out over one socket and each gets a fresh transaction id. Coturn
 * binds a nonce to the peer address, and a real client keeps the socket open across the
 * challenge, so reusing the socket is not pedantry - sending the authenticated Allocate
 * from a different source port is what turns a valid 401 challenge into a 400.
 */
import { readFileSync } from 'node:fs'
import { createSocket } from 'node:dgram'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import * as tls from 'node:tls'

const env = {}
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const url = process.argv[2] ?? (env.VITE_TURN_URLS ?? '').split(',')[0].trim()
const user = process.argv[3] ?? env.VITE_TURN_USERNAME
const pass = process.argv[4] ?? env.VITE_TURN_CREDENTIAL

if (!url || !user || !pass) {
  console.error('need a turn: url, username and credential (from .env or argv)')
  process.exit(1)
}

const m = url.match(/^([a-z]+):(?:([^:@]*)(?::([^@]*))?@)?([^:]+):(\d+)$/i)
if (!m) { console.error(`cannot parse url: ${url}`); process.exit(1) }
const [, scheme, , , host, portStr] = m
const port = Number(portStr)
const secure = scheme.toLowerCase() === 'turns'

console.log(`target ${url}  (${host}:${port}${secure ? ', TLS' : ', plain'})`)
console.log(`user  ${user}`)

const MAGIC = 0x2112a442
const ALLOCATE = 0x0003
const ALLOCATE_ERROR = 0x0113
const ALLOCATE_SUCCESS = 0x0103
const ATTR = {
  USERNAME: 0x0006, MESSAGE_INTEGRITY: 0x0008, ERROR_CODE: 0x0009,
  UNKNOWN_ATTRIBUTES: 0x000a, REALM: 0x0014, NONCE: 0x0015,
  XOR_RELAYED: 0x0016, REQUESTED_TRANSPORT: 0x0019, XOR_MAPPED: 0x0020,
  SOFTWARE: 0x8022, FINGERPRINT: 0x8028,
}

const pad = (n) => (n + 3) & ~3
function attr(type, value) {
  const b = Buffer.alloc(4 + pad(value.length))
  b.writeUInt16BE(type, 0)
  b.writeUInt16BE(value.length, 2)
  value.copy(b, 4)
  return b
}
function header(type, length, txid) {
  const b = Buffer.alloc(20)
  b.writeUInt16BE(type, 0)
  b.writeUInt16BE(length, 2)
  b.writeUInt32BE(MAGIC, 4)
  txid.copy(b, 8)
  return b
}
/** Walk the attribute list, keeping whole attributes including padding. */
function parse(msg) {
  const out = { type: msg.readUInt16BE(0), length: msg.readUInt16BE(2), attrs: [] }
  let off = 20
  while (off + 4 <= msg.length) {
    const t = msg.readUInt16BE(off)
    const len = msg.readUInt16BE(off + 2)
    if (off + 4 + len > msg.length) break
    out.attrs.push({ type: t, value: msg.subarray(off + 4, off + 4 + len) })
    off += 4 + pad(len)
  }
  return out
}
const find = (p, t) => p.attrs.find((a) => a.type === t)?.value
const str = (b) => b?.toString('utf8').replace(/\0+$/, '').trim()

/**
 * ERROR-CODE carries 2 reserved bytes, then the code.
 *
 * RFC 5389 / 8489 bit-pack it: byte 2 holds 3 class bits above 5 number bits and byte 3
 * holds the low 8 number bits. coturn - which is what nearly every hosted relay runs -
 * does not do that. It writes class and number as two separate bytes, so 401 arrives as
 * 00 00 04 01 and the bit-packed reading calls it "class 0, number 1025", i.e. an
 * unknown fault rather than the authentication challenge it actually is. Decode both
 * and keep whichever is a well-formed HTTP-style code.
 */
function decodeError(e) {
  const packed = (e[2] >> 5) * 100 + (((e[2] & 0x1f) << 8) | e[3])
  const split = e[2] * 100 + e[3]
  const valid = (c) => c >= 100 && c <= 699 && (c % 100) >= 1 && (c % 100) <= 99
  const code = valid(packed) ? packed : valid(split) ? split : packed
  return { code, reason: str(e.subarray(4)) }
}
function describe(p) {
  const e = find(p, ATTR.ERROR_CODE)
  if (!e) return `no error attribute (type 0x${p.type.toString(16)})`
  const { code, reason } = decodeError(e)
  return `${code}${reason ? ` ${reason}` : ''} [${e.subarray(0, 6).toString('hex')}]`
}
function dumpAttrs(p) {
  return p.attrs
    .map((a) => `0x${a.type.toString(16).padStart(4, '0')} len=${a.value.length}${a.type === ATTR.ERROR_CODE ? ` ${describe(p)}` : ''}`)
    .join(', ')
}

/** One socket for the whole exchange; replies are matched to the transaction id. */
function openTransport(onMessage) {
  if (secure) {
    const sock = tlsConnect({ host, port, servername: host }, () => {})
    sock.on('secureConnect', () => {})
    sock.on('data', (d) => onMessage(d))
    sock.on('error', (e) => onMessage(null, e))
    return {
      send: (buf) => sock.write(buf),
      close: () => sock.destroy(),
      ready: new Promise((res, rej) => { sock.once('secureConnect', res); sock.once('error', rej) }),
    }
  }
  const sock = createSocket('udp4')
  sock.on('message', (d) => onMessage(d))
  sock.on('error', (e) => onMessage(null, e))
  return { send: (buf) => sock.send(buf, port, host), close: () => sock.close(), ready: Promise.resolve() }
}

let pending = null
const transport = openTransport((data, err) => {
  if (!pending) return
  const p = pending
  pending = null
  if (err) p.reject(err)
  else p.resolve(parse(data))
})

/** Send one request and wait for the reply bearing the same transaction id. */
function exchange(msg, txid, ms = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending = null; reject(new Error(`no answer after ${ms}ms`)) }, ms)
    pending = {
      resolve: (p) => { clearTimeout(timer); resolve(p) },
      reject: (e) => { clearTimeout(timer); reject(e) },
      txid,
    }
    // Ignore replies that are late or belong to another transaction.
    const wrapped = (p) => (pending && pending.txid.equals(txid) ? pending : null)
    const real = pending
    transport.send(msg)
    real.resolve = (p) => {
      clearTimeout(timer)
      if (!p.txid || Buffer.compare(p.txid, txid) === 0) resolve(p)
      else setTimeout(() => reject(new Error('mismatched transaction id')), 10)
    }
    real.reject = (e) => { clearTimeout(timer); reject(e) }
  })
}


const transportAttr = attr(ATTR.REQUESTED_TRANSPORT, (() => { const b = Buffer.alloc(4); b.writeUInt16BE(17, 0); return b })())

/**
 * Brute force the encoding instead of deriving it.
 *
 * The authenticated Allocate has two independent length decisions that the spec ties
 * together, and getting them out of step is invisible locally:
 *
 *   - the length written into the STUN header, and
 *   - the length of the message actually fed to HMAC-SHA1.
 *
 * RFC 5389 15.4 says both must count MESSAGE-INTEGRITY. Trying them separately matters:
 * with both set the way the RFC says, coturn answers a bare "400 Bad Request", and
 * with both left out it answers 401, which reads like a wrong password. Neither points
 * at the other choice. 16 combinations is two round trips each, so just ask.
 */
const COMBOS = []
for (const declaredCounts of [true, false]) {
  for (const hmacCounts of [true, false]) {
    for (const realmInMessage of ['trim', 'null']) {
      for (const realmInKey of ['trim', 'null']) {
        COMBOS.push({ declaredCounts, hmacCounts, realmInMessage, realmInKey })
      }
    }
  }
}

const label = (c) =>
  `header length ${c.declaredCounts ? 'counts' : 'excludes'} MESSAGE-INTEGRITY, ` +
  `hmac input ${c.hmacCounts ? 'counts' : 'excludes'} it, ` +
  `realm ${c.realmInMessage} in message, ${c.realmInKey} in key`

/** Challenge then authenticated Allocate for one combination. */
async function attempt(c) {
  const tx1 = randomBytes(12)
  const challenge = await exchange(
    Buffer.concat([header(ALLOCATE, transportAttr.length, tx1), transportAttr]),
    tx1,
  )
  const code = find(challenge, ATTR.ERROR_CODE) ? decodeError(find(challenge, ATTR.ERROR_CODE)).code : null
  if (challenge.type !== ALLOCATE_ERROR || code !== 401) {
    return { ok: false, detail: `no 401 challenge, got ${describe(challenge)}` }
  }
  const rawRealm = find(challenge, ATTR.REALM)
  const nonce = find(challenge, ATTR.NONCE)
  if (!rawRealm || !nonce) return { ok: false, detail: 'no realm and/or nonce' }

  const trimmed = str(rawRealm)
  const msgRealm = c.realmInMessage === 'null' ? rawRealm : Buffer.from(trimmed, 'utf8')
  const keyRealm = c.realmInKey === 'null' ? trimmed + '\0' : trimmed
  const key = createHash('md5').update(`${user}:${keyRealm}:${pass}`).digest()

  const body = Buffer.concat([
    attr(ATTR.USERNAME, Buffer.from(user, 'utf8')),
    attr(ATTR.REALM, msgRealm),
    attr(ATTR.NONCE, nonce),
    transportAttr,
  ])

  const miAttr = 24 // 4 header bytes + 20 bytes of SHA-1
  // Header and HMAC input are written separately so the two choices can differ.
  const declared = body.length + (c.declaredCounts ? miAttr : 0)
  const hmacHeader = header(ALLOCATE, body.length + (c.hmacCounts ? miAttr : 0), tx1)
  const hmac = createHmac('sha1', key).update(Buffer.concat([hmacHeader, body])).digest()

  const authed = Buffer.concat([
    header(ALLOCATE, declared, tx1),
    body,
    Buffer.from([0x00, ATTR.MESSAGE_INTEGRITY, 0x00, 0x14]),
    hmac,
  ])

  const reply = await exchange(authed, tx1)
  const relayed = find(reply, ATTR.XOR_RELAYED)
  return {
    ok: reply.type === ALLOCATE_SUCCESS && Boolean(relayed),
    relayed,
    trimmed,
    detail: reply.type === ALLOCATE_SUCCESS
      ? `allocated a relay${relayed ? '' : ' (no relayed address!)'}`
      : describe(reply),
  }
}

await transport.ready
console.log(`\nsweeping ${COMBOS.length} encodings against ${host}:${port}`)

const seen = new Map()
for (const c of COMBOS) {
  let res
  try {
    res = await attempt(c)
  } catch (e) {
    // A public relay drops packets now and then; one lost reply says nothing about
    // the encoding, so keep the tally and let the winning combination retry.
    seen.set(e.message, (seen.get(e.message) ?? 0) + 1)
    continue
  }
  seen.set(res.detail, (seen.get(res.detail) ?? 0) + 1)
  if (!res.ok) continue

  const relayed = res.relayed
  const family = relayed.readUInt16BE(1)
  const xport = relayed.readUInt16BE(3) ^ (MAGIC >>> 16)
  const mask = Buffer.from([(MAGIC >>> 24) & 0xff, (MAGIC >>> 16) & 0xff, (MAGIC >>> 8) & 0xff, MAGIC & 0xff])
  const ip = [...relayed.subarray(5, 9)].map((b, i) => b ^ mask[i]).join('.')
  console.log(`\nPASS  ${label(c)}`)
  console.log(`  realm "${res.trimmed}", relayed ${family === 0x01 ? 'IPv4' : 'IPv6'}:${ip}:${xport}`)
  console.log('  the relay accepted the HMAC, so the credentials are valid and this')
  console.log('  relay will carry voice.')
  if (seen.size) {
    console.log('\n  ruled out along the way:')
    for (const [why, n] of seen) console.log(`    ${n}x  ${why}`)
  }
  transport.close()
  process.exit(0)
}

console.log('\nFAILED: no encoding allocated a relay.')
for (const [why, n] of seen) console.log(`  ${n}x  ${why}`)
console.log('Voice would connect to nothing on this relay.')
transport.close()
process.exit(1)