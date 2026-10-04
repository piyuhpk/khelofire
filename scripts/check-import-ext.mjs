/**
 * Catch the imports that only Deno refuses.
 *
 * The Deno edge functions and the vite web app are built by two different
 * resolvers from the same source tree. vite happily resolves `from './ludo'`,
 * Deno requires `from './ludo.ts'`. So a module can pass every unit test, typecheck
 * and lint, and still fail to bundle on deploy with:
 *
 *   Module not found "file:///tmp/.../source/src/engine/ludo".
 *   Maybe add a '.ts' extension
 *
 * That is not hypothetical - it is how ludo-game failed its first deploy, after
 * the code had been described as working.
 *
 * Scope is deliberately the transitive closure of supabase/functions/**, not all of
 * src/. The app is bundled by vite and does not care, so flagging it there would be
 * 180 false positives a day.
 *
 *   node scripts/check-import-ext.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'

const ENTRY = 'supabase/functions'
const EXT = /\.(ts|tsx|mjs|js|json)$/

function* tsFiles(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name)
    if (e.isDirectory()) yield* tsFiles(p)
    else if (/\.tsx?$/.test(e.name)) yield p
  }
}

const bad = []
const seen = new Set()

function visit(file) {
  if (seen.has(file)) return
  seen.add(file)

  const src = readFileSync(file, 'utf8')
  const re = /(?:from|import)\s+['"]([^'"]+)['"]/g
  let m
  while ((m = re.exec(src))) {
    const spec = m[1]
    if (!spec.startsWith('.')) continue

    const abs = resolve(dirname(file), spec)
    // Try each way TypeScript allows before complaining.
    const resolved = [abs, `${abs}.ts`, `${abs}.tsx`, `${abs}.mjs`, `${abs}/index.ts`].find(
      (p) => existsSync(p),
    )

    if (!resolved) {
      bad.push({ file, line: src.slice(0, m.index).split('\n').length, spec, kind: 'missing' })
      continue
    }
    if (!EXT.test(spec)) {
      bad.push({ file, line: src.slice(0, m.index).split('\n').length, spec, kind: 'no-extension' })
    }
    if (/\.tsx?$/.test(resolved)) visit(resolved)
  }
}

for (const entry of tsFiles(resolve(ENTRY))) visit(entry)

if (bad.length) {
  console.error('Deno bundle would fail: relative imports Deno cannot resolve\n')
  for (const b of bad) {
    console.error(`  ${b.kind.padEnd(12)} ${b.file}:${b.line}  ${b.spec}`)
  }
  console.error(`\n${bad.length} found across ${seen.size} files in the edge function closure.`)
  process.exit(1)
}
console.log(`edge function imports clean (${seen.size} files reachable from ${ENTRY})`)