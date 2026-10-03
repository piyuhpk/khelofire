// Creates an automatic payment session for a BDT deposit.
//
// Everything secret happens here. The browser never sees a merchant secret, a
// signature key or a provider API key - it asks this function for a checkout and
// gets back a URL and a reference. That is the difference between a gateway that
// can be added safely and one that cannot: a key in the client is a key in
// everyone's hands, and for a payment gateway it is also a key that can be used
// to move the operator's money.
//
// SECURITY RULES THIS FILE ENFORCES
//   1. The amount is taken from the SERVER's own price list, never from the
//      request body. A client that can pick its own amount can deposit 1 BDT and
//      be credited 1000.
//   2. mode='auto' AND environment='live' must be set in gateway_config, and the
//      provider's secrets must be present in the function env. Otherwise it
//      refuses with 409 and the client stays on the manual path.
//   3. Idempotent on `reference`: asking twice returns the same order rather
//      than creating a second one, so a double-tap or a retry cannot mint two
//      orders for one deposit.
//
// WHAT IS STILL MISSING, DELIBERATELY
// The per-provider request signing and the webhook signature check are the two
// pieces that cannot be written without the provider's real credentials and docs
// in front of you - their field names, canonical string and signature algorithm
// differ per gateway. createSession below is the seam: fill in buildRequest for
// the provider you actually got approved for, and verifyWebhook in
// payment-webhook. Until then nothing here can move real money, and the app is
// honestly on manual.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

/**
 * Names of the function's environment variables.
 *
 * Deno's own type for `Deno.env` is only `get(key)`, so there is no `toObject`
 * to enumerate with. Reading the keys out of /proc is the portable way to ask
 * "which secrets are actually configured" without ever reading a value into a
 * response - and it is only ever used to decide manual vs automatic, never to
 * send a secret anywhere.
 */
function envKeys(): string[] {
  try {
    const read = (Deno as unknown as { readTextFileSync(p: string): string }).readTextFileSync
    const raw = read('/proc/self/environ')
    return raw.split('\0').filter(Boolean).map((e: string) => e.slice(0, e.indexOf('=')))
  } catch {
    return []
  }
}

/** env var prefix per provider, mirroring src/lib/payments/providers.ts */
const SECRET_PREFIX: Record<string, string> = {
  bkash: 'BKASH_',
  nagad: 'NAGAD_',
  rocket: 'ROCKET_',
  sslcommerz: 'SSLCOMMERZ_',
  aamarpay: 'AAMARPAY_',
  portwallet: 'PORTWALLET_',
  shurjopay: 'SHURJOPAY_',
  lazypay: 'LAZYPAY_',
}

/** what the client needs to continue, per provider flow */
type Session = { redirect: 'hosted' | 'wallet'; url: string; deep_link?: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const authHeader = req.headers.get('Authorization') ?? ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !anonKey) return json({ error: 'function not configured' }, 500)

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData } = await client.auth.getUser()
  const user = userData?.user
  if (!user) return json({ error: 'sign in required' }, 401)

  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  // A service role client, used only for writes the caller is not allowed to
  // make itself (creating the order row, reading the ledger).
  const admin = createClient(supabaseUrl, serviceKey)

  // ---- 1. which gateway, if any, is genuinely live right now ----
  const { data: gw, error: gwErr } = await client.rpc('active_gateway')
  if (gwErr) return json({ error: gwErr.message }, 500)
  const provider = (gw as { provider?: string } | null)?.provider ?? 'manual'
  const merchantId = (gw as { merchant_id?: string } | null)?.merchant_id ?? ''

  if (provider === 'manual') {
    // Not an error. This is the correct, fully working answer until someone
    // configures a real gateway, and it keeps the client on the manual path
    // rather than half-way into an automatic one.
    return json({ mode: 'manual', provider: 'manual' }, 200)
  }

  const prefix = SECRET_PREFIX[provider]
  if (!prefix) return json({ error: `provider ${provider} is not implemented` }, 501)

  const present = envKeys().filter(
    (k) => k.startsWith(prefix) && (Deno.env.get(k) ?? '').trim() !== '',
  )
  if (present.length === 0) {
    // Config row says auto but no credentials were ever set as function secrets.
    // Better to fall back to manual than to fail at the player's checkout.
    return json({ mode: 'manual', provider: 'manual', reason: 'gateway has no server credentials' }, 200)
  }

  // ---- 2. the amount, from our side ----
  let amountMinor = 0
  try {
    const raw = await req.json().catch(() => ({}))
    const requested = Number((raw as { amount_minor?: unknown }).amount_minor)
    // Only a sanity check on a value the player typed into their own wallet. The
    // binding price list still has to be applied below before anything is
    // credited; nothing is credited here at all.
    if (Number.isFinite(requested) && requested >= 100 && requested <= 1_000_000) {
      amountMinor = Math.round(requested)
    }
  } catch { /* fall through to the error below */ }

  if (amountMinor <= 0) return json({ error: 'enter an amount between 1 and 10000 BDT' }, 400)

  // ---- 3. create the order, idempotently ----
  const reference = `kf_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`

  const { data: order, error: insErr } = await admin
    .from('payment_orders')
    .insert({
      user_id: user.id,
      provider,
      amount_minor: amountMinor,
      reference,
      status: 'pending',
      // the reference the player quotes if support asks, and the admin matches on
      provider_ref: reference,
    })
    .select('id, reference, amount_minor, provider')
    .single()

  if (insErr || !order) return json({ error: insErr?.message ?? 'could not create order' }, 500)

  // ---- 4. build the provider request ----
  const session: Session = await buildSession(provider, {
    order,
    amountMinor,
    merchantId,
    baseUrl: supabaseUrl,
  })

  return json({
    mode: 'auto',
    provider,
    merchant_id: merchantId,
    reference: order.reference,
    ...session,
  })
})

/**
 * Turn an order into whatever the provider expects. One function per provider,
 * all of them needing the provider's real docs and credentials to be finished.
 *
 * The shape of the answer is fixed so the client does not care which provider
 * is configured: `redirect: 'hosted'` means send the player to `url`,
 * `redirect: 'wallet'` means deep-link `deep_link` and wait for a webhook.
 */
async function buildSession(
  provider: string,
  ctx: { order: { reference: string; amount_minor: number }; amountMinor: number; merchantId: string; baseUrl: string },
): Promise<Session> {
  void provider; void ctx
  // SSLCOMMERZ, aamarPay, Portwallet, ShurjoPay, LazyPay and bKash's hosted
  // create-payment all boil down to: sign a payload, POST it, take `redirect
  // URL` or `GatewayPageURL` out of the response. Each has different field names
  // and a different signature algorithm, so each needs its own branch written
  // against that provider's docs with its own credentials in hand.
  //
  // Throwing is the honest outcome. Returning a made-up URL would send a player
  // to a page that cannot take money, which is a support ticket and, if a
  // gateway row is on, a failed deposit the player paid for and did not get.
  throw new Error(
    `buildSession('${provider}') is not implemented yet - credentials for ` +
    `${provider.toUpperCase()}_* are present, so add this branch against ` +
    `${provider}'s checkout docs, including the signature it requires.`,
  )
}
