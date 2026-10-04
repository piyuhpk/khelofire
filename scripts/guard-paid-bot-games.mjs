/**
 * Give chess, guti and dice the same deep-link guard ludo already has.
 *
 * /play/<game>/<modeId> is reachable by deep link, browser history or an Android
 * intent. Each of these three components then runs a local bot game and calls
 * settle() with that mode's real entry and prize. So /play/chess/chess_1v1 opened a
 * solo game whose win credited the 36tk prize with no entry ever debited.
 *
 * LudoGame was patched for exactly this and the other three were missed. The guard
 * belongs here because a router wrapper cannot tell whether a real match id was
 * carried in - and only ludo has a live engine to hand the player to.
 *
 * Idempotent, and reports what it could not do rather than half-applying.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const GAMES = ['chess/ChessGame', 'guti/GutiGame', 'dice/DiceGame']

const guard = (bn) => `  const toast = useToast()
  // A paid mode reached without a real match id is not a game, it is a free win:
  // the local settle() below credits this mode's real prize with no entry ever
  // debited, and a deep link is all it takes. LudoGame got this guard when the same
  // hole was found there; chess, guti and dice were left behind and reachable the
  // same way. Only ludo has a live engine, so only ludo has anywhere to go.
  const blockedNoMatch = !!m && m.entryMinor > 0 && !m.practice && !hasLiveOpponent(m.game)
  useEffect(() => {
    if (!blockedNoMatch) return
    toast(${bn}, 'err')
    nav('/', { replace: true })
  }, [blockedNoMatch, toast, nav])
`

const BN = "lang === 'bn' ? 'এই গেমটা এখনো লাইভ নেই' : 'This game is not live yet'"

let changed = 0
const problems = []

for (const rel of GAMES) {
  const path = `src/features/${rel}.tsx`
  let src = readFileSync(path, 'utf8')

  if (src.includes('blockedNoMatch')) {
    console.log(`skip  ${path} (already guarded)`)
    continue
  }

  // Only these must already be here - everything else the guard needs is injected
  // below, so asking for it up front would be checking for the thing being added.
  const needs = []
  if (!/\buseNavigate\b/.test(src)) needs.push('useNavigate')
  if (!/const t = useT\(\)/.test(src)) needs.push('const t = useT()')
  if (!/^(\s*)const m = modeById\(modeId!\)$/m.test(src)) needs.push('const m = modeById(modeId!)')
  if (needs.length) {
    problems.push(`${path} is missing: ${needs.join(', ')}`)
    continue
  }

  // catalog import
  src = src.replace(
    /import \{ modeById \} from '\.\.\/\.\.\/lib\/catalog'/,
    "import { modeById, hasLiveOpponent } from '../../lib/catalog'",
  )

  // react hooks
  src = src.replace(/^import \{ ([^}]*) \} from 'react'$/m, (line) => {
    const names = line.match(/\{ ([^}]*) \}/)[1]
    if (/useEffect/.test(names)) return line
    return line.replace(names, `useEffect, ${names}`)
  })
  if (!/^import \{ [^}]*useEffect[^}]* \} from 'react'$/m.test(src)) {
    problems.push(`${path}: could not add the useEffect import`)
    continue
  }

  // toast
  src = src.replace(
    /^import \{ ([^}]*) \} from '\.\.\/ui\/components'$/m,
    (line) => (line.includes('useToast') ? line : line.replace(' }', ', useToast }')),
  )
  if (!/useToast/.test(src)) {
    // no components import at all: add one after the i18n import
    src = src.replace(
      /^import \{ useT \} from '\.\.\/\.\.\/i18n'$/m,
      "import { useT } from '../../i18n'\nimport { useToast } from '../../ui/components'",
    )
  }

  // lang
  if (!/useI18n/.test(src)) {
    src = src.replace(
      /^import \{ useT \} from '\.\.\/\.\.\/i18n'$/m,
      "import { useT, useI18n } from '../../i18n'",
    )
  }
  if (!/const lang = useI18n\(\)/.test(src)) {
    src = src.replace(/^(\s*)const t = useT\(\)$/m, "$1const t = useT()\n$1const { lang } = useI18n()")
  }

  // The guard, placed after the store selector because it needs nav and toast to
  // already exist - injected above it - and nothing else from the component.
  const anchor = /^(\s*)const settle = useStore\(\(s\) => s\.settle\)$/m
  if (!anchor.test(src)) {
    problems.push(`${path}: could not find the settle selector to anchor on`)
    continue
  }
  src = src.replace(anchor, (line) => `${line}\n${guard(BN)}`)

  writeFileSync(path, src, 'utf8')
  console.log(`guard ${path}`)
  changed++
}

if (problems.length) {
  console.error('\nnot applied cleanly:')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(`\n${changed} file(s) guarded`)