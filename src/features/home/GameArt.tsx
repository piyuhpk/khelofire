import type { ReactNode } from 'react'
import { Zap, Trophy } from 'lucide-react'

// ---- 3D-style game tokens rendered as crisp inline SVG (no external assets) ----

const PIN_HEX: Record<string, [string, string]> = {
  red: ['#FF6B6B', '#E11D48'],
  blue: ['#5B9BFF', '#2563EB'],
  green: ['#4ADE80', '#16A34A'],
  yellow: ['#FDE047', '#EAB308'],
}

/** Google-maps style teardrop player token with a glossy 3D body. */
export function Pin({ color = 'red', size = 46, className = '', style }: { color?: keyof typeof PIN_HEX; size?: number; className?: string; style?: React.CSSProperties }) {
  const [lit, dark] = PIN_HEX[color] ?? PIN_HEX.red
  const id = `pin-${color}`
  return (
    <svg width={size} height={size * 1.28} viewBox="0 0 40 52" className={className} style={{ filter: 'drop-shadow(0 6px 6px rgba(0,0,0,.4))', ...style }}>
      <defs>
        <radialGradient id={id} cx="38%" cy="30%" r="75%">
          <stop offset="0%" stopColor={lit} />
          <stop offset="100%" stopColor={dark} />
        </radialGradient>
      </defs>
      <path d="M20 1C10 1 2 8.7 2 18.4 2 31 20 51 20 51S38 31 38 18.4C38 8.7 30 1 20 1Z" fill={`url(#${id})`} stroke="rgba(0,0,0,.18)" strokeWidth="1" />
      <circle cx="20" cy="18.5" r="7.5" fill="#fff" />
      <circle cx="20" cy="18.5" r="7.5" fill="none" stroke="rgba(0,0,0,.12)" strokeWidth="1" />
      <ellipse cx="15" cy="10" rx="5" ry="3" fill="rgba(255,255,255,.35)" />
    </svg>
  )
}

/** Glossy white die tilted for depth. */
export function Die({ size = 34, className = '', style }: { size?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} style={{ filter: 'drop-shadow(0 5px 5px rgba(0,0,0,.35))', ...style }}>
      <defs>
        <linearGradient id="die-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#D8DCEC" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="40" height="40" rx="11" fill="url(#die-g)" stroke="rgba(0,0,0,.12)" />
      <g fill="#5B2CC9">
        <circle cx="15" cy="15" r="3.4" /><circle cx="33" cy="15" r="3.4" />
        <circle cx="24" cy="24" r="3.4" />
        <circle cx="15" cy="33" r="3.4" /><circle cx="33" cy="33" r="3.4" />
      </g>
    </svg>
  )
}

/** Stacked checker disc — the Sholo Guti / 16 Guti token. */
export function Disc({ color = 'red', size = 40, className = '', style }: { color?: keyof typeof PIN_HEX; size?: number; className?: string; style?: React.CSSProperties }) {
  const [lit, dark] = PIN_HEX[color] ?? PIN_HEX.red
  const id = `disc-${color}`
  return (
    <svg width={size} height={size} viewBox="0 0 48 40" className={className} style={{ filter: 'drop-shadow(0 5px 5px rgba(0,0,0,.4))', ...style }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={lit} /><stop offset="100%" stopColor={dark} /></linearGradient>
      </defs>
      <ellipse cx="24" cy="30" rx="18" ry="7" fill={dark} />
      <rect x="6" y="18" width="36" height="12" fill={dark} />
      <ellipse cx="24" cy="18" rx="18" ry="7" fill={`url(#${id})`} stroke="rgba(0,0,0,.15)" />
      <ellipse cx="19" cy="16" rx="7" ry="2.4" fill="rgba(255,255,255,.4)" />
    </svg>
  )
}

/** Cute practice bot with glowing cyan eyes (matches the cyan/teal accent). */
export function RobotHead({ size = 56, className = '', style }: { size?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} style={{ filter: 'drop-shadow(0 6px 7px rgba(0,0,0,.4))', ...style }}>
      <defs>
        <linearGradient id="bot-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#EAF0FF" /><stop offset="100%" stopColor="#AEB9DA" /></linearGradient>
        <radialGradient id="bot-eye" cx="50%" cy="45%" r="60%"><stop offset="0%" stopColor="#8FF5FF" /><stop offset="100%" stopColor="#22D3EE" /></radialGradient>
      </defs>
      <line x1="32" y1="6" x2="32" y2="14" stroke="#AEB9DA" strokeWidth="3" strokeLinecap="round" />
      <circle cx="32" cy="6" r="4" fill="#22D3EE" />
      <rect x="12" y="14" width="40" height="34" rx="13" fill="url(#bot-g)" stroke="rgba(0,0,0,.12)" />
      <rect x="17" y="21" width="30" height="18" rx="9" fill="#171436" />
      <circle cx="26" cy="30" r="4.6" fill="url(#bot-eye)" />
      <circle cx="38" cy="30" r="4.6" fill="url(#bot-eye)" />
      <rect x="24" y="48" width="16" height="6" rx="3" fill="#8593BC" />
    </svg>
  )
}

/** Gold "VS" coin. */
export function VsCoin({ size = 34, className = '', style }: { size?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" className={className} style={{ filter: 'drop-shadow(0 4px 6px rgba(0,0,0,.4))', ...style }}>
      <defs><radialGradient id="vs-g" cx="40%" cy="32%" r="70%"><stop offset="0%" stopColor="#FFE9A8" /><stop offset="100%" stopColor="#F0A020" /></radialGradient></defs>
      <circle cx="22" cy="22" r="20" fill="url(#vs-g)" stroke="#B9791A" strokeWidth="2" />
      <circle cx="22" cy="22" r="15" fill="none" stroke="rgba(255,255,255,.5)" strokeWidth="1.5" />
      <text x="22" y="28" textAnchor="middle" fontSize="15" fontWeight="900" fill="#7A4E06" fontFamily="Sora, sans-serif">VS</text>
    </svg>
  )
}

/** Large chess unicode glyph with a 3D drop-shadow. */
export function ChessGlyph({ glyph, dark = false, size = 52, className = '' }: { glyph: string; dark?: boolean; size?: number; className?: string }) {
  return (
    <span className={className} style={{ fontSize: size, lineHeight: 1, color: dark ? '#1A1730' : '#fff', filter: `drop-shadow(0 5px 6px rgba(0,0,0,${dark ? .45 : .5}))` }}>{glyph}</span>
  )
}

export { Zap, Trophy }

// ---- per-tile background themes (radial "burst" + glow) ----
export const TILE_THEME: Record<string, { bg: string; glow: string; rays?: boolean }> = {
  blue:    { bg: 'radial-gradient(125% 95% at 50% 12%, #3B82F6 0%, #1E40AF 62%, #172554 100%)', glow: 'rgba(59,130,246,.5)' },
  violet:  { bg: 'radial-gradient(125% 95% at 50% 12%, #A855F7 0%, #6D28D9 60%, #3B0764 100%)', glow: 'rgba(139,92,255,.55)' },
  orange:  { bg: 'radial-gradient(125% 95% at 50% 12%, #FBA94C 0%, #EA580C 60%, #9A3412 100%)', glow: 'rgba(234,88,12,.5)', rays: true },
  teal:    { bg: 'radial-gradient(125% 95% at 50% 12%, #34E0C8 0%, #0891B2 60%, #0E4C5A 100%)', glow: 'rgba(45,212,191,.5)', rays: true },
  crimson: { bg: 'radial-gradient(125% 95% at 50% 12%, #FB7185 0%, #E11D48 58%, #881337 100%)', glow: 'rgba(225,29,72,.5)', rays: true },
}

const goldGlow = { color: '#FFD873', filter: 'drop-shadow(0 4px 8px rgba(245,166,35,.55))' } as const

/** Composed 3D-token emblem for each game mode's card. */
export function GameEmblem({ art }: { art: string }): ReactNode {
  const wrap = (children: ReactNode) => <div className="relative flex h-[86px] items-center justify-center">{children}</div>
  switch (art) {
    case 'ludo1v1':
      return wrap(<>
        <Pin color="red" size={44} style={{ transform: 'rotate(-10deg)' }} />
        <VsCoin size={32} className="mx-0.5 -translate-y-1" />
        <Pin color="blue" size={44} style={{ transform: 'rotate(10deg)' }} />
        <Die size={30} className="absolute bottom-0 right-8" style={{ transform: 'rotate(12deg)' }} />
      </>)
    case 'ludo4p':
      return wrap(<>
        <Pin color="green" size={34} style={{ transform: 'rotate(-14deg)' }} />
        <Trophy className="mx-1 h-11 w-11 -translate-y-1" strokeWidth={1.6} fill="#FFCB4D" style={goldGlow} />
        <Pin color="yellow" size={34} style={{ transform: 'rotate(14deg)' }} />
        <Pin color="red" size={28} className="absolute bottom-0 left-10" />
        <Pin color="blue" size={28} className="absolute bottom-0 right-10" />
      </>)
    case 'ludoquick':
      return wrap(<>
        <Pin color="green" size={42} style={{ transform: 'rotate(-10deg)' }} />
        <Zap className="mx-0.5 h-11 w-11 -translate-y-1" strokeWidth={1.6} fill="#FFE066" style={goldGlow} />
        <Pin color="yellow" size={42} style={{ transform: 'rotate(10deg)' }} />
        <Die size={28} className="absolute bottom-0 right-9" style={{ transform: 'rotate(-12deg)' }} />
      </>)
    case 'ludopractice':
      return wrap(<>
        <Pin color="red" size={40} style={{ transform: 'rotate(-12deg)' }} />
        <RobotHead size={58} className="mx-1" />
        <Die size={28} className="absolute bottom-0 right-10" style={{ transform: 'rotate(10deg)' }} />
      </>)
    case 'chess1v1':
      return wrap(<>
        <ChessGlyph glyph="♔" size={50} />
        <VsCoin size={30} className="mx-1 -translate-y-1" />
        <ChessGlyph glyph="♚" dark size={50} />
      </>)
    case 'chesspractice':
      return wrap(<>
        <ChessGlyph glyph="♞" size={50} className="-rotate-6" />
        <RobotHead size={56} className="ml-2" />
      </>)
    case 'guti1v1':
      return wrap(<>
        <Disc color="red" size={40} style={{ transform: 'rotate(-8deg)' }} />
        <VsCoin size={32} className="mx-1 -translate-y-1" />
        <Disc color="blue" size={40} style={{ transform: 'rotate(8deg)' }} />
      </>)
    case 'gutipractice':
      return wrap(<>
        <Disc color="red" size={38} />
        <RobotHead size={56} className="ml-2" />
      </>)
    case 'diceduel':
      return wrap(<>
        <Die size={46} style={{ transform: 'rotate(-14deg)' }} />
        <VsCoin size={30} className="mx-1 -translate-y-1" />
        <Die size={46} style={{ transform: 'rotate(14deg)' }} />
      </>)
    default:
      return wrap(<Die size={44} />)
  }
}
