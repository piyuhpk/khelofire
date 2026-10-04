/**
 * Turn on the Supabase Google provider with an OAuth client.
 *
 * Sign-in is a chain and it fails in the least helpful place at every link. The app
 * collecting a Google ID token means nothing if the Supabase side has no Google provider
 * or a different one: Supabase validates the token's audience against the client id it
 * holds, so a mismatch is reported by the app as "Google sign-in did not return a usable
 * credential" even though Google itself succeeded. Checking that the client id here
 * matches what the app sends is the difference between a two-minute fix and a hunt
 * through logs.
 *
 * Reads GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from the environment so the secret is
 * never written to a file or a command line.
 */
const PAT = process.env.SUPABASE_PAT
const REF = 'btnpyscviudnwabjobmz'
const clientId = process.env.GOOGLE_CLIENT_ID
const secret = process.env.GOOGLE_CLIENT_SECRET

if (!PAT || !clientId || !secret) {
  console.error('needs SUPABASE_PAT, GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the environment')
  process.exit(1)
}

const url = `https://api.supabase.com/v1/projects/${REF}/config/auth`
const headers = { apikey: PAT, Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' }

const before = await (await fetch(url, { headers })).json()
const current = before.external_providers?.google ?? {}
if (current.enabled && current.client_id && current.client_id !== clientId) {
  console.error('a different Google client is already configured on this project')
  console.error(`  configured: ${current.client_id}`)
  console.error(`  given:      ${clientId}`)
  console.error('Replacing it changes who can sign in, so stop and confirm which one is right.')
  process.exit(1)
}

const res = await fetch(url, {
  method: 'PATCH',
  headers,
  body: JSON.stringify({
    external_providers: {
      ...(before.external_providers ?? {}),
      google: { ...current, enabled: true, client_id: clientId, secret },
    },
  }),
})

const body = await res.text()
if (!res.ok) {
  console.error(`HTTP ${res.status}`)
  console.error(body)
  process.exit(1)
}

const after = JSON.parse(body).external_providers?.google ?? {}
console.log(JSON.stringify({
  enabled: after.enabled,
  client_id: after.client_id,
  client_id_matches_app: after.client_id === clientId,
  secret_stored: Boolean(after.secret),
}, null, 2))

// Confirm by reading it back: a 200 on the PATCH is not proof it was applied, and the
// read is the same call the dashboard would make.
const verify = await (await fetch(url, { headers })).json()
const g = verify.external_providers?.google
const ok = g?.enabled === true && g?.client_id === clientId && Boolean(g?.secret)
console.log(ok ? '\nverified: Google provider is live on the project.' : '\nNOT verified - read back does not show it enabled.')
process.exit(ok ? 0 : 1)