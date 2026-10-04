/**
 * Stop the mode lists from offering paid modes that no live engine can seat.
 *
 * Both screens list every mode the database returned and link to /join/<id> for the
 * paid ones. Chess, guti and dice have paid modes in match_modes, but the only live
 * board server-side is ludo-game, so every one of those links was a promise the
 * server cannot keep. ConfirmJoin now refuses them and explains, but a tile that
 * leads to a refusal is still a dead end the player can see - so they are not
 * listed at all.
 *
 * Free practice modes stay: those are a real local game against the bot and they
 * work. This is the difference between "coming soon" and "not offered".
 *
 * Idempotent.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const TARGETS = [
  {
    path: 'src/features/lobby/Lobby.tsx',
    old: "const modes = allModes().filter((m) => m.game === gk && !m.practice && (m.game !== 'chess' || chessEnabled))",
    next: "const modes = allModes().filter((m) => m.game === gk && !m.practice && canPlayLive(m) && (m.game !== 'chess' || chessEnabled))",
    importFrom: "import { allModes, modeName, GAME_META } from '../../lib/catalog'",
    importTo: "import { allModes, modeName, GAME_META, canPlayLive } from '../../lib/catalog'",
  },
  {
    path: 'src/features/hub/InGame.tsx',
    old: "const modes = allModes().filter((m) => m.game === game && (m.game !== 'chess' || chessEnabled))",
    next: "const modes = allModes().filter((m) => m.game === game && canPlayLive(m) && (m.game !== 'chess' || chessEnabled))",
    importFrom: "import { allModes, modeName, GAME_META } from '../../lib/catalog'",
    importTo: "import { allModes, modeName, GAME_META, canPlayLive } from '../../lib/catalog'",
  },
]

const problems = []
let changed = 0

for (const t of TARGETS) {
  let src = readFileSync(t.path, 'utf8')

  if (src.includes(t.next)) {
    console.log(`skip  ${t.path} (already filtered)`)
    continue
  }
  if (!src.includes(t.old)) {
    problems.push(`${t.path}: the filter line did not match - check it by hand`)
    continue
  }

  src = src.replace(t.old, t.next)

  // the catalog import line may name the bindings in any order
  const m = src.match(/^import \{ ([^}]*) \} from '\.\.\/\.\.\/lib\/catalog'$/m)
  if (!m) {
    problems.push(`${t.path}: no catalog import found`)
    continue
  }
  if (!/\bcanPlayLive\b/.test(m[1])) {
    src = src.replace(m[0], `import { ${m[1]}, canPlayLive } from '../../lib/catalog'`)
  }

  writeFileSync(t.path, src, 'utf8')
  console.log(`filter ${t.path}`)
  changed++
}

if (problems.length) {
  console.error('\nnot applied cleanly:')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(`\n${changed} mode list(s) filtered`)