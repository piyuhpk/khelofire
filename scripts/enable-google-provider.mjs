/**
 * Find a Management API payload that actually persists the Google provider.
 *
 * PATCH /v1/projects/{ref}/config/auth does apply some fields - the redirect allowlist
 * went in with the same call and the same headers - so the endpoint works. It just
 * quietly discards external_providers, answering 200 and leaving the provider absent.
 * A 200 here means nothing, so every shape is tried and then read back, and the only
 * thing reported as success is one that survives a GET.
 *
 *   node scripts/enable-google-provider.mjs
 *
 * Needs SUPABASE_PAT, GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the environment.
 */
const PAT = process.env.SUPABASE_PAT
const REF = 'btnpyscviudnwabjobmz'
const clientId = process.env.GOOGLE_CLIENT_ID
const secret = process.env.GOOGLE_CLIENT_SECRET

if (!PAT || !clientId || !secret) {
  console.error('needs SUPABASE_PAT, GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET')
  process.exit(1)
}

const url = `https://api.supabase.com/v1/projects/${REF}/config/auth`
const headers = { apikey: PAT, Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' }

const readBack = async () => (await (await fetch(url, { headers })).json()).external_providers ?? {}

const google = { enabled: true, client_id: clientId, secret }

const SHAPES = [
  { name: 'external_providers.google', body: { external_providers: { google } } },
  { name: 'external_providers.google + site_url', body: { external_providers: { google }, site_url: 'https://btnpyscviudnwabjobmz.supabase.co' } },
  { name: 'google at top level', body: { google } },
  { name: 'external_providers.google with skip_nonce_check', body: { external_providers: { google: { ...google, skip_nonce_check: false } } } },
  { name: 'external_providers.google as a full array', body: { external_providers: { google: { client_id: clientId, secret, enabled: true, scope: 'email profile' } } } },
  { name: 'provider field instead of external_providers', body: { external_providers: { google: { ...google } }, external_email_enabled: true } },
]

for (const shape of SHAPES) {
  const res = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(shape.body) })
  const text = await res.text()
  const stored = await readBack()
  const g = stored.google
  const ok = g?.enabled === true && g?.client_id === clientId
  console.log(`${ok ? 'STORED ' : 'dropped'}  ${res.status}  ${shape.name}`)
  if (ok) {
    console.log(`\nworked: "${shape.name}"`)
    console.log(JSON.stringify({ enabled: g.enabled, client_id: g.client_id, secret_present: 'secret' in g }, null, 2))
    process.exit(0)
  }
  if (res.status >= 400) console.log(`          ${text.slice(0, 200)}`)
}

console.log('\nnothing persisted. external_providers is not writable through this API,')
console.log('so the provider has to be switched on in the dashboard:')
console.log('  Authentication -> Providers -> Google -> paste the client id and secret -> Save')
process.exit(1)