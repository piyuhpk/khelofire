import { toMinor } from './money'
import type { GameKey } from './store'

export type TileTheme = 'blue' | 'violet' | 'orange' | 'teal' | 'crimson'
export type ModeTag = 'tournament' | 'instant' | 'free'

export interface GameMode {
  id: string
  game: GameKey
  nameKey: string // i18n key
  players: number
  entryMinor: number
  prizeMinor: number
  clock?: string
  desc: { bn: string; en: string }
  practice?: boolean
  // A mode created in the admin panel has no i18n key - it has text the admin typed,
  // in each language. Built-in modes always use nameKey; created modes always use
  // these. Both are optional and exactly one is expected.
  nameBn?: string
  nameEn?: string
  // presentation
  theme: TileTheme
  art: string        // GameEmblem key
  tag: ModeTag
  open?: number      // cosmetic "open matches" count
  // background images (admin configurable)
  backgroundImage?: string  // full card background image URL
  thumbnailImage?: string   // small thumbnail/logo image URL
}

export const MODES: GameMode[] = [
  // ---- Ludo ----
  { id: 'ludo_classic', game: 'ludo', nameKey: 'home.classic1v1', players: 2, entryMinor: toMinor(20), prizeMinor: toMinor(36), theme: 'blue', art: 'ludo1v1', tag: 'tournament', open: 4, desc: { bn: 'মুখোমুখি লড়াই — বিজেতা সব নেয়', en: 'Head to head, winner takes all' } },
  { id: 'ludo_4p', game: 'ludo', nameKey: 'home.4player', players: 4, entryMinor: toMinor(10), prizeMinor: toMinor(34), theme: 'violet', art: 'ludo4p', tag: 'tournament', open: 2, desc: { bn: '৩ জনকে হারান, বড় জিতুন', en: 'Beat 3 players, win big' } },
  { id: 'ludo_quick', game: 'ludo', nameKey: 'home.quickPlay', players: 2, entryMinor: toMinor(5), prizeMinor: toMinor(9), theme: 'orange', art: 'ludoquick', tag: 'instant', open: 8, desc: { bn: 'তাৎক্ষণিক অনলাইন ম্যাচ', en: 'Instant online match' } },
  { id: 'ludo_practice', game: 'ludo', nameKey: 'home.practice', players: 2, entryMinor: 0, prizeMinor: 0, practice: true, theme: 'teal', art: 'ludopractice', tag: 'free', desc: { bn: 'ফ্রি — দক্ষতা বাড়ান', en: 'Free, sharpen your skills' } },
  // A free 4-player board. Added because every 4p mode above is paid, and a paid
  // mode is only playable from a real table - so before this there was no way to
  // play the 4-player engine at all without two opponents and money.
  { id: 'ludo_4p_practice', game: 'ludo', nameKey: 'home.practice4p', players: 4, entryMinor: 0, prizeMinor: 0, practice: true, theme: 'teal', art: 'ludo4p', tag: 'free', desc: { bn: 'ফ্রি ৪ প্লেয়ার — বটের সাথে', en: 'Free 4-player vs bots' } },
  // ---- Chess (Daba) ----
  { id: 'chess_1v1', game: 'chess', nameKey: 'home.chess1v1', players: 2, entryMinor: toMinor(20), prizeMinor: toMinor(36), clock: '5+3', theme: 'violet', art: 'chess1v1', tag: 'tournament', open: 5, desc: { bn: 'আসল ক্যাশ দাবা — চেকমেট!', en: 'Real cash chess — checkmate!' } },
  { id: 'chess_practice', game: 'chess', nameKey: 'home.chessPractice', players: 2, entryMinor: 0, prizeMinor: 0, clock: '10+0', practice: true, theme: 'teal', art: 'chesspractice', tag: 'free', desc: { bn: 'বটের সাথে ফ্রি খেলুন', en: 'Play the computer for free' } },
  // ---- 16 Guti (Sholo Guti) ----
  { id: 'guti_1v1', game: 'guti', nameKey: 'home.guti1v1', players: 2, entryMinor: toMinor(15), prizeMinor: toMinor(27), theme: 'crimson', art: 'guti1v1', tag: 'tournament', open: 4, desc: { bn: 'আসল ক্যাশ ষোল গুটি — কাটাকাটি', en: 'Real cash Sholo Guti — capture!' } },
  { id: 'guti_practice', game: 'guti', nameKey: 'home.gutiPractice', players: 2, entryMinor: 0, prizeMinor: 0, practice: true, theme: 'teal', art: 'gutipractice', tag: 'free', desc: { bn: 'বটের সাথে ফ্রি খেলুন', en: 'Play the computer for free' } },
  // ---- Dice Duel ----
  { id: 'dice_1v1', game: 'dice', nameKey: 'home.diceDuel', players: 2, entryMinor: toMinor(10), prizeMinor: toMinor(18), theme: 'orange', art: 'diceduel', tag: 'instant', open: 6, desc: { bn: 'সেরা ৫ রাউন্ড — বেশি স্কোর জেতে', en: 'Best of 5 — highest score wins' } },
  { id: 'dice_practice', game: 'dice', nameKey: 'home.dicePractice', players: 2, entryMinor: 0, prizeMinor: 0, practice: true, theme: 'teal', art: 'diceduel', tag: 'free', desc: { bn: 'ফ্রি — বটের সাথে গড়ান', en: 'Free, roll against the bot' } },
]

// Modes created in the admin panel. This overlay is what finally makes them
// visible: every mode the app ever showed came from MODES above, and nothing read
// match_modes, so a mode created in the panel was invisible to players while
// start_live_match and settle_match still used its real entry and prize from the
// database. Two sources of truth that disagreed.
let overlay: GameMode[] = []

/** Built-ins plus anything the admin has created. */
export const allModes = (): GameMode[] => [...MODES, ...overlay]

/**
 * Replace the overlay with what the database currently holds.
 *
 * Called on every load. A mode that disappears from the database disappears from
 * the app too - the alternative, merging only in new rows, would leave a deleted
 * or deactivated mode playable forever on a phone that had loaded the old list.
 */
export function applyDbModes(rows: Partial<GameMode>[]) {
  overlay = rows.filter((r) => r && typeof r.id === 'string' && r.id.length > 0).map((r) => ({
    id: r.id!,
    game: (r.game ?? 'ludo') as GameKey,
    nameKey: r.nameKey ?? '',
    nameBn: r.nameBn,
    nameEn: r.nameEn,
    players: r.players ?? 2,
    entryMinor: r.entryMinor ?? 0,
    prizeMinor: r.prizeMinor ?? 0,
    clock: r.clock,
    desc: r.desc ?? { bn: '', en: '' },
    practice: r.practice ?? (r.entryMinor ?? 0) === 0,
    theme: (r.theme ?? 'blue') as TileTheme,
    art: r.art ?? 'ludo1v1',
    tag: (r.tag ?? 'instant') as ModeTag,
    open: r.open ?? 0,
    backgroundImage: r.backgroundImage,
    thumbnailImage: r.thumbnailImage,
  }))
}

// Overlaid first, so a database row wins over the hardcoded row of the same id.
// That is the case that mattered: editing an entry price in the admin has to change
// what is charged, and settle_match already reads the database figure.
export const modeById = (id: string) => overlay.find((m) => m.id === id) ?? MODES.find((m) => m.id === id)

/**
 * The player's name for a mode.
 *
 * A built-in resolves through its i18n key; a created mode has no key at all and
 * falls back to the text the admin typed. Returning the bare id for a created mode
 * would put `ludo_night_2x` on the tile, which is what happened before this existed
 * for every mode the admin made.
 */
export function modeName(m: GameMode, t: (k: string) => string, bn = true): string {
  if (m.nameKey) return t(m.nameKey)
  return (bn ? m.nameBn : m.nameEn) || m.nameBn || m.nameEn || m.id
}

export const GAME_META: Record<GameKey, { nameKey: string; icon: 'ludo' | 'chess' | 'guti' | 'dice' }> = {
  ludo: { nameKey: 'home.ludo', icon: 'ludo' },
  chess: { nameKey: 'home.chess', icon: 'chess' },
  guti: { nameKey: 'home.guti', icon: 'guti' },
  dice: { nameKey: 'home.dice', icon: 'dice' },
}
/**
 * Section order for the in-game hub.
 *
 * Ludo is deliberately absent. It is the one game with a live paid table, and it lives
 * in its own Ludo King category card where a player goes looking for a real opponent -
 * not listed alongside the bot games. Having it in both places meant the King card, the
 * one route to a real match, was no longer the only one.
 *
 * The admin panel keeps its own list and still needs every game, so this is a hub
 * display order rather than the set of games that exist.
 */
export const GAME_ORDER: GameKey[] = ['chess', 'guti', 'dice']

/**
 * Which games actually have a live opponent engine behind them.
 *
 * Only Ludo does. `create_live_match` is the single server entry point for every
 * game, and the only board it can drive is the ludo-game edge function - it speaks
 * Ludo's dice, tokens and turn rules and nothing else. Chess, Guti and Dice play
 * perfectly well against the local bot, which is why they are in the app at all.
 *
 * This exists because the paid modes for those three are reachable, and a paid
 * mode has to lead somewhere real. Routing /live/chess at the live tables screen
 * is worse than having no button: that screen creates a Ludo table, so someone who
 * paid 20tk for chess is handed a Ludo board and a receipt. So the rule is stated
 * here once, and the screens that sell money ask it before they take any.
 */
export const LIVE_GAMES: readonly GameKey[] = ['ludo']
export const hasLiveOpponent = (game: GameKey): boolean => LIVE_GAMES.includes(game)

/**
 * Can this mode be entered for money right now?
 *
 * Free modes always can - they are a local bot game. A paid mode can only be paid
 * for if the server can seat a real opponent for it.
 */
export const canPlayLive = (m: GameMode): boolean =>
  m.practice || m.entryMinor === 0 || hasLiveOpponent(m.game)

export interface Banner {
  id: string
  titleBn: string; titleEn: string
  subBn: string; subEn: string
  bg: string          // banner gradient (fallback)
  glow: string
  art: string         // Hero art key
  ctaKey: string
  go: string          // route
  backgroundImage?: string  // full banner background image URL
}
export const BANNERS: Banner[] = [
  { id: 'b1', titleBn: 'লুডু খেলুন,\nটাকা জিতুন!', titleEn: 'Play Ludo,\nWin Money!', subBn: 'প্রতিদিন টুর্নামেন্ট • বিকাশ / নগদে উইথড্র', subEn: 'Daily tournaments • Withdraw to bKash / Nagad', bg: 'linear-gradient(120deg,#6D28D9 0%,#4C1D95 55%,#2E1065 100%)', glow: 'rgba(139,92,255,.5)', art: 'ludo', ctaKey: 'common.playNow', go: '/join/ludo_classic' },
  { id: 'b2', titleBn: 'বন্ধুকে আনুন,\nবোনাস নিন!', titleEn: 'Refer a friend,\nget a bonus!', subBn: 'রেফার কোড শেয়ার করুন — দুজনেই পুরস্কার পাবেন', subEn: 'Share your code — you both earn rewards', bg: 'linear-gradient(120deg,#F59E0B 0%,#EA580C 55%,#C2410C 100%)', glow: 'rgba(234,88,12,.5)', art: 'refer', ctaKey: 'home.refer', go: '/wallet' },
  { id: 'b3', titleBn: 'দাবা ও ১৬ গুটি\nটুর্নামেন্ট', titleEn: 'Chess & 16 Guti\nTournaments', subBn: 'দক্ষতার খেলা — আসল পুরস্কার জিতুন', subEn: 'Games of skill — win real prizes', bg: 'linear-gradient(120deg,#0891B2 0%,#0E7490 55%,#155E75 100%)', glow: 'rgba(34,211,238,.45)', art: 'chess', ctaKey: 'common.playNow', go: '/play/chess/chess_practice' },
]
