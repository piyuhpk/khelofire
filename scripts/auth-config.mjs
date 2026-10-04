/**
 * Read the project's auth config through the Management API.
 *
 * Printing it is safer than guessing at it in the dashboard: the redirect allowlist
 * decides whether Google can come back into the APK at all, and a wrong entry there
 * fails as "Google sign-in did not return a usable credential" with nothing useful in
 * the app to show for it.
 *
 * Reads SUPABASE_PAT from the environment; never writes it anywhere.
 */
const PAT = process.env.SUPABASE_PAT
const REF = 'btnpyscviudnwabjobmz'

if (!PAT) {
  console.error('SUPABASE_PAT is not set')
  process.exit(1)
}

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, {
  headers: { apikey: PAT, Authorization: `Bearer ${PAT}` },
})
const cfg = await res.json()

if (!res.ok) {
  console.error(`HTTP ${res.status}`)
  console.error(JSON.stringify(cfg, null, 2))
  process.exit(1)
}

const providers = {}
for (const [name, v] of Object.entries(cfg.external_providers ?? {})) {
  providers[name] = { enabled: v.enabled, hasClientId: Boolean(v.client_id), hasSecret: Boolean(v.secret) }
}

console.log(JSON.stringify({
  site_url: cfg.site_url,
  uri_allow_list: cfg.uri_allow_list,
  redirect_urls: cfg.redirect_urls,
  external_providers: providers,
  enable_signup: cfg.enable_signup,
  mailer_autoconfirm: cfg.mailer_autoconfirm,
  security_captcha_enabled: cfg.security_captcha_enabled,
}, null, 2))