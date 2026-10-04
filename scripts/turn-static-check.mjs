/**
 * Does the public static-auth TURN relay actually hand out a relayed address?
 *
 * Why a second script, when scripts/turn-check.mjs exists.
 *
 * turn-check.mjs speaks long-term credential auth: username, password, and a 401
 * challenge answered with MD5(username:realm:password). That is the mechanism a
 * REST-issued credential from a hosted provider uses.
 *
 * Static auth is a different mechanism entirely, and it is the one the public relay
 * uses. The username carries an expiry and the credential is an HMAC-SHA1 of that
 * username under a shared secret - MD5 is not involved. Pointing turn-check.mjs at a
 * static-auth server therefore tests the wrong protocol: it gets a 401 it can never
 * answer correctly and reports "no relay" for a server that is working fine. That is
 * indistinguishable from the server being dead, which is how a working relay gets
 * written off as broken.
 *
 * The credentials are public. Metered documents them for projects without their own
 * TURN server, and this URL/secret pair is published on their Open Relay page, so they
 * are read from argv rather than treated as a secret in .env. A shared public relay is
 * not private by design: anyone can use it, so nothing sent through it should be, and
 * WebRTC media is end-to-end encrypted above the relay regardless.
 *
 *   node scripts/turn-static-check.mjs [host:port] [secret]
 *
 * Exit code 0 only when XOR-RELAYED-ADDRESS comes back on an authenticated Allocate.
 */
import { createSocket } from 'node:dgram'
import { createHmac } from 'node:crypto'

const target = process.argv[2] ?? 'staticauth.openrelay.metered.ca:80'
const secret = process.argv[3] ?? 'openrelayprojectsecret'

const DEFAULT_STUN = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
]

const [host, portRaw] = target.split(':')
const port = Number(portRaw ?? 3478)

/** Static-auth username: expiry seconds, then any label. Met in seconds, not ms. */
const staticUsername = (label = 'khelofire') => {
  const expiry = Math.floor(Date.now() / 1000) + 3600
  return `${expiry}:${label}`
}

const staticCredential = (username, secret) =>
  createHmac('sha1', secret).update(username).digest('base64')

const allocateBody = (transactionId, magicCookie) => {
  // Allocate, REQUESTED-TRANSPORT = UDP (17 in the top 16 bits), no attributes.
  const b = Buffer.alloc(12)
  b.writeUInt16BE(0x0003, 0) // Allocate
  b.writeUInt16BE(0, 2) // length, filled in below
  b.writeUInt32BE(magicCookie, 4)
  b.copy(transactionId, 0, 8, 12)
  b.writeUInt32BE(0x2112a442, 8) // transaction id
  const req = Buffer.concat([
    Buffer.from([0x00, 0x01, 0x00, 0x00]), // request type
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    b.subarray(0, 4),
    b.subarray(4, 8),
    b.subarray(8, 12),
    Buffer.from([0x00, 0x00]), // no attributes
    Buffer.from([0x00, 0x11, 0x00, 0x00]), // REQUESTED-TRANSPORT
    Buffer.from([0x00, 0x00, 0x00, 0x11]), // UDP
  ])
  req.writeUInt16BE(0x0003, 0)
  req.writeUInt16BE(req.length - 20 + 4, 2)
  // message length is the part after the 20-byte header
  req.writeUInt16BE(req.length - 20, 2)
  return req
}

const sock = createSocket('udp4')
const MAGIC = 0x2112a442
let stage = 'first'
const seen = new Set()

const send = (username) => {
  const txid = Buffer.from(Array.from({ length: 12 }, () => Math.floor(Math.random() * 256)))
  const msg = allocateBody(txid, MAGIC)
  // MESSAGE-INTEGRITY with the HMAC-SHA1 credential, which is what makes the second
  // Allocate different from the first: the same packet with no integrity is a request
  // for an unauthenticated allocation.
  const key = Buffer.from(staticCredential(username, secret), 'utf8')
  const withKey = Buffer.concat([msg, Buffer.from([0x00, 0x08, 0x00, key.length]), key])
  withKey.writeUInt16BE(withKey.length - 24 + 4, 2)
  withKey.writeUInt16BE(withKey.length - 20 + 24 - 20, 2)
  withKey.writeUInt16BE(withKey.length - 20, 2)
  sock.send(withKey, port, host)
}

console.log(`probing static-auth TURN at ${host}:${port}`)
console.log(`secret is the published Open Relay one: ${secret === 'openrelayprojectsecret'}`)

const username = staticUsername()
const deadline = setTimeout(() => {
  console.error('timeout: no relayed address')
  process.exit(1)
}, 12000)

sock.on('message', (buf) => {
  if (buf.length < 20 || buf.readUInt32BE(4) !== MAGIC) return
  const type = buf.readUInt16BE(0)

  if (type === 0x0113) {
    // 401: the challenge is a success - it proves the server speaks TURN and wants auth.
    if (stage === 'first') {
      stage = 'auth'
      send(username)
      return
    }
  }

  if (type === 0x0103) {
    // Success. Walk the attributes for XOR-RELAYED-ADDRESS (0x0016) and XOR-MAPPED (0x0001).
    let off = 20
    let relayed = false
    let mapped = false
    while (off + 4 <= buf.length) {
      const at = buf.readUInt16BE(off)
      const len = buf.readUInt16BE(off + 2)
      if (at === 0x0016) {
        relayed = true
        const port = buf.readUInt16BE(off + 6) ^ 0x2112
        const ip = [1, 2, 3, 4].map((i) => buf.readUInt8(off + 4 + i) ^ [0, 0, 0, 0][i])
        const masked = [1, 2, 3, 4].map((i) => buf.readUInt8(off + 4 + i) ^ [0, 0, 0, 0][i])
        console.log(`relayed address present: ${masked.join('.')}:${port} (relayed=${relayed})`)
        void ip
      }
      if (at === 0x0001) mapped = true
      off += 4 + len + ((4 - (len % 4)) % 4)
    }
    clearTimeout(deadline)
    if (relayed) {
      console.log(`PASS: ${host}:${port} allocated a relay. mapped-address=${mapped}`)
      console.log('static-auth open relay is alive.')
      process.exit(0)
    }
    console.error('allocated but no XOR-RELAYED-ADDRESS - server refused to relay')
    process.exit(1)
  }

  if (type === 0x0111) {
    const code = buf.readUInt16BE(8)
    if (!seen.has(code)) {
      seen.add(code)
      console.error(`error response, code ${code}${code === 401 ? ' (unauthorized)' : ''}`)
    }
  }
})

sock.on('error', (e) => {
  clearTimeout(deadline)
  console.error(`socket error: ${e.message}`)
  process.exit(1)
})

send(username)
void DEFAULT_STUN