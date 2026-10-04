// Structural checks for the Supabase migrations.
//
// There is no local Postgres in this project and the anon key cannot run DDL, so
// these SQL files cannot be executed here. That makes a structural pass the only
// automated verification available, and it is worth catching the mistakes that
// would otherwise only surface in the Supabase SQL editor on a live database:
// an unbalanced dollar quote, a plpgsql block that never closes, a money
// function left without security definer, a new table without RLS, or a stray
// destructive statement.
//
// This is a LINTER, not a parser. It proves shape, not semantics - the functions
// still have to be run against a real database.
//
// usage: node check-sql.mjs [file ...]
import { readFileSync, readdirSync } from 'node:fs'

// every .sql in supabase/, so a new migration is checked the day it is written
// rather than the day someone remembers to add it here
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync('supabase')
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => `supabase/${f}`)

let fails = 0
const bad = (f: string, m: string) => { console.log(`  FAIL ${f}: ${m}`); fails++ }

/** drop -- line comments and /* *\/ blocks so they cannot affect counting */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
}

/** "p_mode text, p_amount bigint, p_ref text default ''" -> "text,bigint,text"
 *  A GRANT names the argument TYPES, not the parameter names, so matching on the
 *  declared parameters silently never finds the grant. */
function argTypes(args: string): string {
  return args
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean)
    .map((a) => a.replace(/^p_\w+\s+/, '').split(/\s+default\s+/i)[0].trim())
    .join(',')
}

/** every plpgsql body, as { name, args, body } */
function functionBodies(sql: string) {
  const out: { name: string; args: string; body: string; header: string }[] = []
  const re = /create\s+or\s+replace\s+function\s+([\w.]+)\s*\(([^)]*)\)([\s\S]*?)\$\$/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(sql)) !== null) {
    const start = m.index + m[0].length
    const end = sql.indexOf('$$', start)
    if (end < 0) { bad('?', `function ${m[1]}( has no closing $$`); continue }
    out.push({ name: m[1], args: m[2], header: m[3], body: sql.slice(start, end) })
    re.lastIndex = end + 2
  }
  return out
}

for (const file of files) {
  console.log(`=== ${file} ===`)
  let raw: string
  try { raw = readFileSync(file, 'utf8') } catch { bad(file, 'cannot be read'); continue }
  const sql = stripComments(raw)

  // ---- 1. dollar quotes must pair up
  const dollars = (sql.match(/\$\$/g) || []).length
  if (dollars % 2 !== 0) bad(file, `${dollars} occurrences of $$ - odd, so a function body is unterminated`)
  else console.log(`  ${dollars / 2} function bodies, all $$ paired`)

  // ---- 2. nothing destructive. these migrations must only ever add.
  const destructive = [
    { re: /\bdrop\s+table\b/i, why: 'drop table' },
    { re: /\btruncate\b/i, why: 'truncate' },
    { re: /\bdelete\s+from\s+public\.\w+\s*(;|$)/i, why: 'delete with no where clause' },
    { re: /\balter\s+table\s+public\.\w+\s+drop\b/i, why: 'alter table ... drop' },
  ]
  for (const d of destructive) {
    const hit = sql.match(d.re)
    if (hit) bad(file, `contains a destructive statement (${d.why}) - this file is meant to be additive only`)
  }

  // ---- 2b. `drop function` is allowed ONLY to change a signature.
  //
  // Postgres refuses CREATE OR REPLACE when the return type differs (42P13), so
  // widening or narrowing one cannot be done in place - the old overload has to
  // be dropped and recreated. That is not data loss, so banning it outright just
  // guarantees migrations that cannot be applied.
  //
  // What IS worth banning is dropping a function and not putting it back, which
  // would silently remove an ability something else depends on. So every drop has
  // to be matched by a create of the same name and argument types later in the
  // same file. A `cascade` is refused outright: it would happily take tables and
  // views with it, which is never what a signature change needs.
  const drops = [...sql.matchAll(/\bdrop\s+function\s+(?:if\s+exists\s+)?([\w.]+)\s*\(([^)]*)\)\s*([^;]*);/gi)]
  for (const m of drops) {
    const tail = m[3] ?? ''
    if (/\bcascade\b/i.test(tail)) {
      bad(file, `drop function ${m[1]} uses cascade - a signature change never needs to remove dependants`)
      continue
    }
    const name = m[1].replace(/^public\./i, '').toLowerCase()
    const types = argTypes(m[2]).toLowerCase()
    const recreated = [...sql.matchAll(/create\s+or\s+replace\s+function\s+([\w.]+)\s*\(([^)]*)\)/gi)]
      .some((c) => c[1].replace(/^public\./i, '').toLowerCase() === name && argTypes(c[2]).toLowerCase() === types)
    if (!recreated) {
      bad(file, `drop function ${m[1]}(${types}) is never recreated in this file - that removes it rather than changing it`)
    }
  }

  const fns = functionBodies(sql)
  // A migration may legitimately contain no function body - a grant/revoke-only
  // file is normal, and 008 is exactly that. What must never pass is a file that
  // contains no statements at all: an empty or truncated migration silently does
  // nothing while looking like it applied. This check exists for that case, and it
  // is the reason it has to be a statement count rather than a function count -
  // a pure `grant` line is a statement, a zero-byte file is not.
  if (fns.length === 0) {
    const statements = sql
      .replace(/--[^\n]*/g, '')
      .split(/;\s*\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    if (statements.length === 0) {
      bad(file, 'no function bodies and no statements - this file is empty or truncated, so it would apply nothing')
    }
  }

  // ---- 3. every function body must be closed. Counting begin/end with a regex
  //        is unreliable (end if; / end loop; / end case; all contain "end"), so
  //        this only proves the number of `create or replace function` headers
  //        equals the number of body terminators - which is the failure that
  //        actually matters, an unterminated or concatenated body.
  //        `do $$ ... $$;` blocks carry no header, so they are discounted.
  const headers = (sql.match(/create\s+or\s+replace\s+function/gi) || []).length
  const doBlocks = (sql.match(/\bdo\s+\$\$/gi) || []).length
  const terminators = (sql.match(/\$\$\s*;/g) || []).length - doBlocks
  if (headers !== terminators) {
    bad(file, `${headers} function headers but ${terminators} body terminators - a body is unterminated or two are concatenated`)
  }

  for (const fn of fns) {
    const { name, args, body, header } = fn

    // ---- 4. anything that touches user rows must be security definer with a
    //        pinned search_path, otherwise it runs as the caller.
    const readsUserRows = /public\.(profiles|transactions|matches|settlements|live_matches|live_match_seats|match_modes)/i.test(body)
    if (readsUserRows && !/security\s+definer/i.test(header)) {
      bad(file, `${name}(${argTypes(args)}) touches user tables but is not SECURITY DEFINER`)
    }
    if (/security\s+definer/i.test(header) && !/set\s+search_path\s*=/i.test(header)) {
      bad(file, `${name}(${argTypes(args)}) is SECURITY DEFINER without SET search_path`)
    }

    // ---- 5. a MONEY path must prove who is calling. Narrow on purpose: trigger
    //        functions and the deliberately-public leaderboard do not read the
    //        caller and must not be flagged.
    //
    //        Two ways to prove it, because one of them is a lie in service-role
    //        functions. A money function called with a user JWT proves the caller
    //        with auth.uid(). One called with the service_role key - decide_deposit,
    //        decide_withdrawal - has NO user JWT at all, so auth.uid() is NULL there.
    //        Those functions used to satisfy this check only because they wrote
    //        `decided_by = auth.uid()`, i.e. the check passed on the very line that
    //        was silently recording NULL. What they actually assert is
    //        `auth.role() <> 'service_role'` plus an explicit staff-id lookup, which
    //        is a stronger proof than a non-null uid. Accept either, reject neither.
    const movesMoney = /available_minor|locked_minor|insert\s+into\s+public\.(transactions|settlements)|entry_locked/i.test(body)
    const provesCaller = /auth\.uid\(\)/i.test(body) || /auth\.role\(\)[^;]*service_role/i.test(body)
    if (movesMoney && !provesCaller) {
      bad(file, `${name}(${argTypes(args)}) moves money or locks an entry but never proves who is calling (needs auth.uid() or a service_role check)`)
    }

    // ---- 6. every function needs an explicit privilege decision.
    //        A GRANT writes the argument TYPES with spaces - settle_match(text,
    //        text, text) - so both sides are stripped of whitespace before
    //        comparing, otherwise nothing ever matches and the check is theatre.
    const flat = `${name}(${argTypes(args)})`.replace(/\s+/g, '')
    const esc = flat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const sqlFlat = sql.replace(/\s+/g, '')
    const granted = new RegExp(`grants?executeonfunction${esc}(to|;)`, 'i').test(sqlFlat)
    const revoked = new RegExp(`revoke(all|execute)onfunction${esc}`, 'i').test(sqlFlat)
    if (!granted && !revoked) bad(file, `${flat} has neither GRANT EXECUTE nor REVOKE - decide who may call it`)
  }

  // ---- 7. every new user-data table must have RLS switched on
  for (const t of sql.matchAll(/create\s+table\s+if\s+not\s+exists\s+public\.(\w+)/gi)) {
    const table = t[1]
    if (!new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, 'i').test(sql)) {
      bad(file, `public.${table} is created without ENABLE ROW LEVEL SECURITY`)
    }
  }

  // ---- 8. money columns must stay unrevivable by a client
  if (/create\s+table/i.test(sql) && !/revoke\s+insert,\s*update,\s*delete\s+on\s+public\.live_matches/i.test(sql) && /live_matches/i.test(sql)) {
    bad(file, 'live_matches has no client-side write revoke')
  }

  console.log(`  ${fns.length} functions checked`)
}

console.log('')
console.log(fails === 0 ? 'STRUCTURE OK - shapes balance, privileges are explicit, new tables have RLS' : `${fails} CHECK(S) FAILED`)
process.exit(fails ? 1 : 0)