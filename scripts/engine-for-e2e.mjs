/**
 * Load the app's real legalTokens into this script.
 *
 * The first version of this test carried its own copy of the rule. It disagreed with
 * the app on blockades - the app has none - so it reported a seat with a 6 in hand
 * as unable to move, and the run sat in a loop calling nothing while a real game
 * waited for input. The lesson generalises: a test that reimplements the rule under
 * test can only prove the rule is self-consistent, not that it works.
 *
 * src/engine/ludo.ts is TypeScript with no runtime dependencies, so esbuild bundles
 * it to a plain module and it is imported for real. If the app's move rules change,
 * this picks them up with no edit here.
 */
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'node_modules', '.tmp')
mkdirSync(outDir, { recursive: true })
const outFile = join(outDir, 'engine-for-e2e.mjs')

await build({
  entryPoints: [join(root, 'src', 'engine', 'ludo.ts')],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'error',
})

const engine = await import(pathToFileURL(outFile).href)

export const legalTokens = engine.legalTokens
export const applyMove = engine.applyMove
export const initLudo = engine.initLudo