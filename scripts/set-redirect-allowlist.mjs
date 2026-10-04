/**
 * Set the project's redirect allowlist.
 *
 * Read the current value with auth-config.mjs before running this, and prefer that
 * output to whatever is written here - this file is the thing you edit when the
 * allowlist needs to change, and clobbering a list someone hand-curated in the
 * dashboard would break sign-in that already works.
 *
 * Why it has to be set at all: it is empty. With an empty allowlist Supabase falls
 * back to site_url, which is still http://localhost:3000. So a Google sign-in on a
 * real phone cannot come back into the app no matter how correct the client is -
 * the redirect is refused before Supabase is involved. The failure surfaces as
 * "Google sign-in did not return a usable credential", which points at the app and
 * not at this setting.
 */
const PAT = process.env.SUPABASE_PAT
const REF = 'btnpyscviudnwabjobmz'

if (!PAT) {
  console.error('SUPABASE_PAT is not set')
  process.exit(1)
}

// localhost kept so `npm run dev` still works; the rest are the ways the app can be
// opened. khelofire:// is the deep link the Capacitor app registers, and it is the
 // one that matters for an install on a phone.
const allowList = [
  'http://localhost:3000',
  'http://localhost:5173',
  'https://btnpyscviudnwabjobmz.supabase.co/auth/callback',
  'khelofire://auth-callback',
  'khelofire://',
].join(',')

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, {
  method: 'PATCH',
  headers: {
    apikey: PAT,
    Authorization: `Bearer ${PAT}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ uri_allow_list: allowList }),
})

const body = await res.text()
if (!res.ok) {
  console.error(`HTTP ${res.status}`)
  console.error(body)
  process.exit(1)
}

const cfg = JSON.parse(body)
console.log('uri_allow_list now:')
console.log(JSON.stringify(cfg.uri_allow_list, null, 2))