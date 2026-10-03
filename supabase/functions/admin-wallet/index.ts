// Supabase Edge Function: admin-wallet
//
// Approves or rejects deposits and withdrawals using the service_role key.
// This exists because decide_deposit/decide_withdrawal are REVOKED from
// anon+authenticated - only this trusted function may call them, so a stolen
// anon key (it ships inside every APK) cannot pay itself out.
//
// Deploy:
//   supabase functions deploy admin-wallet
// Call:
//   POST <project>/functions/v1/admin-wallet
//   Authorization: Bearer <the staff member's Supabase access token>
//   { "kind": "deposit" | "withdrawal", "id": "<uuid>", "approve": true }
//
// Requires supabase/004_payments.sql - it calls the 3-arg decide_*(id, approve,
// staff) form. The 2-arg form was neutralised on purpose so a stale deploy fails
// loudly instead of approving with a NULL decided_by.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Kind = 'deposit' | 'withdrawal'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const callerJwt = authHeader.replace(/^Bearer\s+/i, '')
    if (!callerJwt) {
      return json({ error: 'missing authorization' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // who is calling? resolve the JWT with the service client
    const { data: caller, error: callerErr } = await admin.auth.getUser(callerJwt)
    if (callerErr || !caller.user) return json({ error: 'invalid session' }, 401)

    // are they staff? (staff table is unreachable from anon/authenticated)
    const { data: staff } = await admin
      .from('staff')
      .select('role')
      .eq('user_id', caller.user.id)
      .maybeSingle()

    if (!staff) return json({ error: 'not authorised: staff only' }, 403)
    if (staff.role === 'support') return json({ error: 'support cannot move money' }, 403)

    const body = await req.json().catch(() => null)
    const kind = body?.kind as Kind
    const id = body?.id as string
    const approve = body?.approve as boolean

    if ((kind !== 'deposit' && kind !== 'withdrawal') || !id || typeof approve !== 'boolean') {
      return json({ error: 'expected { kind, id, approve }' }, 400)
    }

    // p_staff is passed explicitly because the deciding staff id cannot be derived
    // from the session here: this runs on the service_role key, which carries no
    // user JWT, so auth.uid() inside the RPC is NULL. Passing it in is what makes
    // deposits.decided_by / withdrawals.decided_by record a real person instead
    // of NULL on every row.
    const fn = kind === 'deposit' ? 'decide_deposit' : 'decide_withdrawal'
    const { error } = await admin.rpc(fn, { p_id: id, p_approve: approve, p_staff: caller.user.id })
    if (error) return json({ error: error.message }, 400)

    // audit trail
    await admin.from('staff_activity').insert({
      staff_id: caller.user.id,
      role: staff.role,
      action: `${kind}_${approve ? 'approve' : 'reject'}`,
      target: id,
    })

    return json({ ok: true })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}