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

export const modeById = (id: string) => MODES.find((m) => m.id === id)

export const GAME_META: Record<GameKey, { nameKey: string; icon: 'ludo' | 'chess' | 'guti' | 'dice' }> = {
  ludo: { nameKey: 'home.ludo', icon: 'ludo' },
  chess: { nameKey: 'home.chess', icon: 'chess' },
  guti: { nameKey: 'home.guti', icon: 'guti' },
  dice: { nameKey: 'home.dice', icon: 'dice' },
}
export const GAME_ORDER: GameKey[] = ['ludo', 'chess', 'guti', 'dice']

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
  { id: 'b3', titleBn: 'দাবা ও ১৬ গুটি\nটুর্নামেন্ট', titleEn: 'Chess & 16 Guti\nTournaments', subBn: 'দক্ষতার খেলা — আসল পুরস্কার জিতুন', subEn: 'Games of skill — win real prizes', bg: 'linear-gradient(120deg,#0891B2 0%,#0E7490 55%,#155E75 100%)', glow: 'rgba(34,211,238,.45)', art: 'chess', ctaKey: 'common.playNow', go: '/join/chess_1v1' },
]
