/**
 * Run SQL against the project through the Supabase Management API.
 *
 * The token is read from the environment and never written to disk, so this file is
 * safe to commit. Usage:
 *
 *   $env:SUPABASE_PAT='sbp_...'
 *   node scripts/db-admin.mjs supabase/011_no_engine_no_paid_mode.sql
 *
 * Prints the first rows of any rows the statement returned, so a query can be used
 * to look at the database as well as to change it.
 */
import { readFileSync } from 'node:fs'

const PAT = process.env.SUPABASE_PAT
const REF = 'btnpyscviudnwabjobmz'
const file = process.argv[2]

if (!PAT) {
  console.error('SUPABASE_PAT is not set')
  process.exit(1)
}
if (!file) {
  console.error('usage: node scripts/db-admin.mjs <file.sql>')
  process.exit(1)
}

const query = readFileSync(file, 'utf8')
console.log(`-> ${file} (${query.length} bytes)`)

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: {
    apikey: PAT,
    Authorization: `Bearer ${PAT}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query }),
})

const text = await res.text()

if (!res.ok) {
  console.error(`HTTP ${res.status}`)
  console.error(text)
  process.exit(1)
}

// The API answers with an array, one entry per statement.
let out
try {
  out = JSON.parse(text)
} catch {
  console.log(text)
  process.exit(0)
}

if (!Array.isArray(out) || out.length === 0) {
  console.log('ok (no rows returned)')
  process.exit(0)
}

let statements = 0
for (const entry of out) {
  statements++
  const rows = Array.isArray(entry) ? entry : entry == null ? [] : [entry]
  if (rows.length === 0) {
    console.log(`  statement ${statements}: ok, 0 rows`)
    continue
  }
  console.log(`  statement ${statements}: ${rows.length} row(s)`)
  console.log(JSON.stringify(rows.slice(0, 40), null, 2))
}