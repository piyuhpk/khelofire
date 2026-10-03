// Provider -> us: "this order was paid".
//
// This is the only place in the whole app where a deposit becomes real money,
// and it is therefore the only place worth being paranoid about.
//
// THE RULE: a webhook is an HTTP request from a stranger's server that claims a
// payment happened. It is trusted only after the request itself proves it - a
// signature computed over the payload with a shared secret, or a token fetched
// back from the provider. The `status` field in the body means nothing on its
// own, because anyone can post it.
//
// THE CONSEQUENCE OF GETTING THIS WRONG
//   - no verification  -> anyone can mark their own deposit paid. Free money.
//   - weak verification -> an attacker replays a real successful callback.
//   - no idempotency   -> a provider retrying a webhook credits twice.
// All three are handled below: verify, then look up the order by OUR reference
// (never trust a provider-supplied id on its own), then settle exactly once.
//
// MANUAL DEPOSITS DO NOT COME HERE. A manual deposit is approved by a human in
// the admin panel via admin-wallet. This function only settles orders created by
// payment-checkout.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const SECRET_PREFIX: Record<string, string> = {
  bkash: 'BKASH_', nagad: 'NAGAD_', rocket: 'ROCKET_', sslcommerz: 'SSLCOMMERZ_',
  aamarpay: 'AAMARPAY_', portwallet: 'PORTWALLET_', shurjopay: 'SHURJOPAY_', lazypay: 'LAZYPAY_',
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceKey) return json({ error: 'function not configured' }, 500)
  const db = createClient(supabaseUrl, serviceKey)

  // Providers send GET for some callbacks, POST for others, and the body may be
  // form-encoded rather than JSON, so read the body as text and parse defensively.
  const raw = await req.text()
  const params = new URLSearchParams(req.url.slice(req.url.indexOf('?') + 1).length ? req.url.slice(req.url.indexOf('?') + 1) : '')
  const body = safeJson(raw)
  // providers disagree on shape: JSON body, query string, or form-encoded. Fold
  // all of them into one flat string map rather than trusting any single one.
  const flat: Record<string, string> = {}
  for (const [k, v] of params) if (typeof v === 'string') flat[k] = v
  if (body && typeof body === 'object') {
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      if (typeof v === 'string' || typeof v === 'number') flat[k] = String(v)
    }
  }
  if (raw && !body) {
    for (const [k, v] of new URLSearchParams(raw)) flat[k] = v
  }

  const provider = (flat.provider ?? flat.store_id ?? '').toString().toLowerCase()
  if (!provider) return json({ error: 'no provider on callback' }, 400)

  const prefix = SECRET_PREFIX[provider]
  if (!prefix) return json({ error: `no verifier for provider ${provider}` }, 501)

  // ---- 1. prove the request is really from the provider ----
  const verified = await verify(provider, flat, raw, req.headers.get('x-signature'))
  if (!verified) {
    // Deliberately terse and without detail: the response is visible to whoever
    // sent the request, so it must not tell them which part failed.
    return json({ error: 'signature verification failed' }, 400)
  }

  // ---- 2. find OUR order by OUR reference ----
  const reference = (flat.reference ?? flat.trx_id ?? flat.invoice ?? '').toString()
  if (!reference) return json({ error: 'no reference on callback' }, 400)

  const { data: order, error: readErr } = await db
    .from('payment_orders')
    .select('id, user_id, amount_minor, provider, status')
    .eq('reference', reference)
    .maybeSingle()

  if (readErr) return json({ error: readErr.message }, 500)
  if (!order) return json({ error: 'unknown order' }, 404)

  // ---- 3. settle exactly once ----
  // A provider that retries after a timeout must not be able to credit twice, so
  // this is a guarded update rather than a read-then-write: the `status` filter
  // means only the first request through can move the row, and a second one
  // matches nothing and returns already_settled.
  if (!isSuccess(provider, flat)) {
    if (isTerminalFailure(provider, flat)) {
      await db.from('payment_orders')
        .update({ status: 'failed', failure_reason: (flat.status ?? '').toString().slice(0, 300) })
        .eq('id', order.id)
        .eq('status', 'pending')
    }
    return json({ ok: true, settled: false, state: 'not_paid' })
  }

  const { data: settled, error: settleErr } = await db
    .from('payment_orders')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      provider_ref: (flat.trx_id ?? flat.payment_id ?? flat.tran_id ?? reference).toString(),
    })
    .eq('id', order.id)
    .eq('status', 'pending')
    .select('id')

  if (settleErr) return json({ error: settleErr.message }, 500)
  if (!settled || settled.length === 0) {
    // another callback already did it - a retry, not a double credit
    return json({ ok: true, settled: false, state: 'already_settled' })
  }

  // ---- 4. move the money, through the same audited path a human uses ----
  // request_deposit + decide_deposit is the manual flow and it already writes a
  // ledger row and a staff_activity row with correct balances. Reusing it means
  // an automatic deposit lands in the same books as a manual one instead of
  // inventing a second accounting path that will drift from the first.
  const { error: depErr } = await db.rpc('request_deposit', {
    p_amount_minor: order.amount_minor,
    p_method: 'Gateway',
    p_ref: reference,
  })
  if (depErr) {
    // The order is paid but the credit did not happen. Do NOT silently retry in
    // a loop - leave the order paid and let the webhook retry, which is safe now
    // that settlement is guarded, or let an admin fix it from the panel.
    return json({ ok: false, settled: true, credit_error: depErr.message }, 500)
  }

  return json({ ok: true, settled: true, reference })
})

function safeJson(s: string): unknown {
  try { return JSON.parse(s) } catch { return null }
}

/**
 * Verify a callback really came from the provider.
 *
 * Every branch here must be written from that provider's own documentation, and
 * must fail closed: if a required secret is missing, return false rather than
 * "assume it is fine". Returning true on missing configuration is precisely the
 * bug that lets anyone top up their own balance.
 */
async function _verifyNotImplemented(
  _provider: string,
  _flat: Record<string, string>,
  _raw: string,
  _headerSig: string | null,
): Promise<boolean> {
  void SECRET_PREFIX
  return false
}

const verify = _verifyNotImplemented

/** Did the provider say this payment succeeded? Field names differ per provider. */
function isSuccess(_provider: string, flat: Record<string, string>): boolean {
  const v = (flat.status ?? flat.transaction_status ?? '').toString().toLowerCase()
  const code = (flat.trx_status ?? flat.result_code ?? '').toString().toLowerCase()
  const success = ['success', 'successful', 'complete', 'completed', 'paid', 'ok', 'capture', 'captured']
  return success.includes(v) || success.includes(code) || code === '1000'
}

function isTerminalFailure(_provider: string, flat: Record<string, string>): boolean {
  const v = (flat.status ?? flat.transaction_status ?? '').toString().toLowerCase()
  return ['failed', 'failure', 'cancelled', 'canceled', 'expired', 'rejected'].includes(v)
}
