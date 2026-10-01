import { PATH, HOME_COL, CENTER, QUAD_AREA, BASE_SLOTS, cellFor } from '../../engine/ludoBoard'
import { SAFE_ABS, START_OFFSET, COLORS, type LudoState, type PlayerId } from '../../engine/ludo'

const N = 15
const pct = (v: number) => `${(v * 100) / N}%`
const key = (r: number, c: number) => `${r},${c}`

function homeColOf(r: number, c: number): PlayerId | -1 {
  for (const p of [0, 1, 2, 3] as PlayerId[]) if (HOME_COL[p].some(([hr, hc]) => hr === r && hc === c)) return p
  return -1
}
function startCellOf(onPath: number): PlayerId | -1 {
  for (const p of [0, 1, 2, 3] as PlayerId[]) if (onPath === START_OFFSET[p]) return p
  return -1
}

function PinToken({ color, dim = false }: { color: string; dim?: boolean }) {
  return (
    <svg viewBox="0 0 24 34" className="h-full w-full" style={{ filter: dim ? 'none' : 'drop-shadow(0 2px 2px rgba(0,0,0,.5))' }}>
      <ellipse cx="12" cy="32.6" rx="8.6" ry="1.5" fill="rgba(0,0,0,.35)" />
      <circle cx="12" cy="7.5" r="5.3" fill={color} stroke="#fff" strokeWidth="1.7" />
      <path d="M8.9 12.2 C8.3 13.8 7.8 15.8 7.5 17.8 L5.2 29.2 H18.8 L16.5 17.8 C16.2 15.8 15.7 13.8 15.1 12.2 C14.4 13.4 13.3 14.1 12 14.1 C10.7 14.1 9.6 13.4 8.9 12.2 Z" fill={color} stroke="#fff" strokeWidth="1.7" strokeLinejoin="round" />
      <rect x="4.6" y="28.6" width="14.8" height="3.4" rx="1.7" fill={color} stroke="#fff" strokeWidth="1.6" />
      <circle cx="12" cy="7" r="2.4" fill="rgba(255,255,255,.55)" />
    </svg>
  )
}

export function LudoBoard({ state, legal, onToken }: { state: LudoState; legal: number[]; onToken: (i: number) => void }) {
  const tokenAt: Record<string, { p: PlayerId; i: number }[]> = {}
  state.players.forEach((p) =>
    state.tokens[p].forEach((pos, i) => {
      const [r, c] = cellFor(p, pos, i)
      ;(tokenAt[key(r, c)] ||= []).push({ p, i })
    })
  )

  const cells = []
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const onPath = PATH.findIndex(([pr, pc]) => pr === r && pc === c)
      const hc = homeColOf(r, c)
      const isCenter = r === CENTER[0] && c === CENTER[1]
      if (onPath < 0 && hc === -1 && !isCenter) continue

      const start = startCellOf(onPath)
      const isSafe = onPath >= 0 && SAFE_ABS.has(onPath)
      let bg = '#FFFFFF'
      if (hc !== -1) bg = COLORS[hc]
      else if (start !== -1) bg = COLORS[start]

      cells.push(
        <div key={key(r, c)} className="absolute" style={{ top: pct(r), left: pct(c), width: pct(1), height: pct(1) }}>
          <div className="grid h-full w-full place-items-center" style={{ background: bg, border: '1px solid #B9C2CE', boxSizing: 'border-box' }}>
            {isSafe && start === -1 && <span className="text-[10px] font-black leading-none" style={{ color: 'rgba(0,0,0,.45)' }}>★</span>}
            {start !== -1 && <span className="text-[9px] font-black leading-none" style={{ color: 'rgba(255,255,255,.95)' }}>➜</span>}
          </div>
        </div>
      )
    }
  }

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[380px] overflow-hidden rounded-[6px]"
      style={{ background: '#EEF2F7', border: '3px solid #0E2C6E', boxShadow: '0 16px 40px -14px rgba(0,0,0,.7), 0 0 0 2px rgba(232,182,76,.55)' }}>
      {/* four corner yards */}
      {([0, 1, 2, 3] as PlayerId[]).map((p) => {
        const [r0, c0, r1, c1] = QUAD_AREA[p]
        return (
          <div key={p} className="absolute grid place-items-center" style={{ top: pct(r0), left: pct(c0), width: pct(c1 - c0), height: pct(r1 - r0), background: COLORS[p], border: '1px solid #B9C2CE', boxSizing: 'border-box' }}>
            <div className="absolute grid grid-cols-2 grid-rows-2 rounded-[6px] bg-white" style={{ top: '16.667%', left: '16.667%', width: '66.667%', height: '66.667%', boxShadow: 'inset 0 2px 6px rgba(0,0,0,.22)' }}>
              {BASE_SLOTS[p].map((_, k) => (
                <div key={k} className="grid place-items-center">
                  <span className="rounded-full" style={{ width: '64%', height: '64%', border: `3px solid ${COLORS[p]}`, background: '#F4F7FB' }} />
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {/* track */}
      {cells}

      {/* centre: four triangles pointing in */}
      <div className="absolute" style={{ top: pct(6), left: pct(6), width: pct(3), height: pct(3) }}>
        <div className="absolute inset-0" style={{ clipPath: 'polygon(0 0,100% 0,50% 50%)', background: COLORS[1] }} />
        <div className="absolute inset-0" style={{ clipPath: 'polygon(100% 0,100% 100%,50% 50%)', background: COLORS[2] }} />
        <div className="absolute inset-0" style={{ clipPath: 'polygon(100% 100%,0 100%,50% 50%)', background: COLORS[3] }} />
        <div className="absolute inset-0" style={{ clipPath: 'polygon(0 100%,0 0,50% 50%)', background: COLORS[0] }} />
        <span className="absolute inset-0 grid place-items-center text-sm">🏆</span>
      </div>

      {/* tokens */}
      {Object.entries(tokenAt).map(([k, list]) =>
        list.map(({ p, i }, si) => {
          const [r, c] = k.split(',').map(Number)
          const isLegal = p === 0 && p === state.turn && legal.includes(i)
          const n = list.length
          const off = n > 1 ? (si - (n - 1) / 2) * 1.6 : 0
          return (
            <button key={`${p}-${i}`} disabled={!isLegal} onClick={() => isLegal && onToken(i)}
              className={`absolute ${isLegal ? 'z-20 cursor-pointer' : 'z-10'}`}
              style={{
                left: `calc(${pct(c)} + ${pct(0.5)} + ${off}px)`, top: pct(r),
                width: '5.4%', height: '6.9%', transform: 'translateX(-50%)',
                background: 'transparent', border: 'none', padding: 0,
              }}
              aria-label={`token ${p}-${i}`}>
              {isLegal && <span className="absolute inset-[-28%] rounded-full" style={{ border: '2px dashed rgba(255,255,255,.95)', boxShadow: '0 0 8px rgba(255,255,255,.9)' }} />}
              <span className={`block h-full w-full ${isLegal ? 'animate-bounce-fast' : ''}`}>
                <PinToken color={COLORS[p]} />
              </span>
            </button>
          )
        })
      )}
    </div>
  )
}
