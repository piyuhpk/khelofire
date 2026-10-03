import { PATH, HOME_COL, CENTER, QUAD_AREA, BASE_SLOTS, cellFor } from '../../engine/ludoBoard'
import { SAFE_ABS, START_OFFSET, COLORS, FINISH, type LudoState, type PlayerId } from '../../engine/ludo'

const N = 15
const pct = (v: number) => `${(v * 100) / N}%`
const key = (r: number, c: number) => `${r},${c}`

/** mix a hex colour toward white (toward=255) or black (0), amount 0..1 */
function mix(hex: string, toward: number, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const f = (c: number) => Math.round(c + (toward - c) * amount)
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`
}
const lighten = (hex: string, a: number) => mix(hex, 255, a)
const darken = (hex: string, a: number) => mix(hex, 0, a)

/** the same colour as a lit plastic/enamel surface: lit from the top-left */
function glossy(base: string, strength = 1): string {
  return `linear-gradient(160deg, ${lighten(base, 0.42 * strength)} 0%, ${base} 42%, ${darken(base, 0.24 * strength)} 100%)`
}

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
    <svg viewBox="0 0 24 34" className="h-full w-full" style={{ filter: dim ? 'none' : 'drop-shadow(0 3px 3px rgba(0,0,0,.55))' }}>
      <ellipse cx="12" cy="32.6" rx="8.6" ry="1.6" fill="rgba(0,0,0,.38)" />
      {/* body - vertical gradient is what stops it reading as a flat sticker */}
      <defs>
        <linearGradient id={`pin-${color.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lighten(color, 0.5)} />
          <stop offset="45%" stopColor={color} />
          <stop offset="100%" stopColor={darken(color, 0.3)} />
        </linearGradient>
      </defs>
      <path d="M8.9 12.2 C8.3 13.8 7.8 15.8 7.5 17.8 L5.2 29.2 H18.8 L16.5 17.8 C16.2 15.8 15.7 13.8 15.1 12.2 C14.4 13.4 13.3 14.1 12 14.1 C10.7 14.1 9.6 13.4 8.9 12.2 Z" fill={`url(#pin-${color.slice(1)})`} stroke="#fff" strokeWidth="1.7" strokeLinejoin="round" />
      <rect x="4.6" y="28.6" width="14.8" height="3.4" rx="1.7" fill={`url(#pin-${color.slice(1)})`} stroke="#fff" strokeWidth="1.6" />
      <circle cx="12" cy="7.5" r="5.3" fill={`url(#pin-${color.slice(1)})`} stroke="#fff" strokeWidth="1.7" />
      {/* specular highlight + rim light: the 3D read */}
      <ellipse cx="9.8" cy="5.6" rx="2.5" ry="1.7" fill="rgba(255,255,255,.72)" transform="rotate(-28 9.8 5.6)" />
      <path d="M8.6 18.4 C8.3 19.6 8.1 20.6 8 21.6" stroke="rgba(255,255,255,.6)" strokeWidth="1.3" strokeLinecap="round" fill="none" />
    </svg>
  )
}

export function LudoBoard({ state, legal, onToken }: { state: LudoState; legal: number[]; onToken: (i: number) => void }) {
  const tokenAt: Record<string, { p: PlayerId; i: number }[]> = {}
  // Finished tokens all share the single centre square. Fanning them out by
  // token index keeps all four visible instead of burying three under one.
  const FINISHED_SLOT: Record<number, [number, number]> = {
    0: [-0.95, -0.95], 1: [0.95, -0.95], 2: [-0.95, 0.95], 3: [0.95, 0.95],
  }
  state.players.forEach((p) =>
    state.tokens[p].forEach((pos, i) => {
      let [r, c] = cellFor(p, pos, i)
      if (pos >= FINISH) { r += FINISHED_SLOT[i][0]; c += FINISHED_SLOT[i][1] }
      ;(tokenAt[`${r.toFixed(2)},${c.toFixed(2)}`] ||= []).push({ p, i })
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
      // plain track squares are off-white plastic; start squares are the player colour
      const base = hc !== -1 ? COLORS[hc] : start !== -1 ? COLORS[start] : '#FBF7EF'
      const flat = start === -1 && hc === -1

      cells.push(
        <div key={key(r, c)} className="absolute" style={{ top: pct(r), left: pct(c), width: pct(1), height: pct(1) }}>
          <div
            className="grid h-full w-full place-items-center"
            style={{
              background: flat ? 'linear-gradient(150deg,#FFFFFF,#F1E7D6)' : glossy(base),
              borderRadius: '14%',
              // inset light top-left + dark bottom-right reads as a moulded tile
              boxShadow: 'inset 0.5px 0.5px 0 rgba(255,255,255,.95), inset -0.5px -0.5px 0 rgba(0,0,0,.22), 0 1px 2px rgba(0,0,0,.18)',
              boxSizing: 'border-box',
            }}
          >
            {isSafe && start === -1 && (
              <span className="text-[10px] font-black leading-none" style={{ color: 'rgba(120,90,30,.5)' }}>★</span>
            )}
            {start !== -1 && (
              <span className="text-[9px] font-black leading-none" style={{ color: 'rgba(255,255,255,.98)', textShadow: '0 1px 1px rgba(0,0,0,.35)' }}>➜</span>
            )}
          </div>
        </div>
      )
    }
  }

  return (
    // outer frame: gold-trimmed, bevelled, like a physical board
    <div
      className="mx-auto w-full max-w-[420px] p-[7px]"
      style={{
        borderRadius: 20,
        background: 'linear-gradient(155deg,#FFE9A8 0%,#E8B84B 28%,#C98F2E 62%,#8A5E17 100%)',
        boxShadow: '0 20px 44px -14px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.85), inset 0 -2px 6px rgba(90,55,0,.45)',
      }}
    >
      <div
        className="relative aspect-square w-full overflow-hidden"
        style={{
          borderRadius: 14,
          background: 'radial-gradient(130% 130% at 50% -10%, #FFFDF6 0%, #F7EEDA 50%, #E9D9B4 100%)',
          boxShadow: 'inset 0 0 0 2px rgba(255,255,255,.9), inset 0 3px 14px rgba(120,85,20,.28)',
        }}
      >
        {/* four corner yards */}
        {([0, 1, 2, 3] as PlayerId[]).map((p) => {
          const [r0, c0, r1, c1] = QUAD_AREA[p]
          return (
            <div
              key={p}
              className="absolute"
              style={{
                top: pct(r0), left: pct(c0), width: pct(c1 - c0), height: pct(r1 - r0),
                background: glossy(COLORS[p]),
                borderRadius: '10%',
                boxShadow: 'inset 0 0 0 1.5px rgba(255,255,255,.55), inset 0 -3px 10px rgba(0,0,0,.28), 0 2px 6px rgba(0,0,0,.2)',
                boxSizing: 'border-box',
              }}
            >
              {/* inner base plate holding the four start tokens */}
              <div
                className="absolute grid grid-cols-2 grid-rows-2"
                style={{
                  top: '16.667%', left: '16.667%', width: '66.667%', height: '66.667%',
                  borderRadius: '14%',
                  background: 'linear-gradient(160deg,#FFFFFF,#EFE3CC)',
                  boxShadow: 'inset 0 2px 7px rgba(0,0,0,.28), 0 1px 0 rgba(255,255,255,.9)',
                }}
              >
                {BASE_SLOTS[p].map((_, k) => (
                  <div key={k} className="grid place-items-center">
                    <span
                      className="rounded-full"
                      style={{
                        width: '64%', height: '64%',
                        border: `3px solid ${COLORS[p]}`,
                        background: 'radial-gradient(circle at 40% 32%, #FFFFFF, #E4D3B4)',
                        boxShadow: `inset 0 1px 3px rgba(0,0,0,.28), 0 0 7px ${lighten(COLORS[p], 0.45)}`,
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )
        })}

        {/* track */}
        {cells}

        {/* centre: four glossy triangles pointing in, gold trophy on top */}
        <div className="absolute" style={{ top: pct(6), left: pct(6), width: pct(3), height: pct(3) }}>
          {([1, 2, 3, 0] as PlayerId[]).map((p, i) => {
            const clips = [
              'polygon(0 0,100% 0,50% 50%)',
              'polygon(100% 0,100% 100%,50% 50%)',
              'polygon(100% 100%,0 100%,50% 50%)',
              'polygon(0 100%,0 0,50% 50%)',
            ]
            return (
              <div key={p} className="absolute inset-0" style={{ clipPath: clips[i], background: glossy(COLORS[p]), filter: 'saturate(1.06)' }} />
            )
          })}
          <span
            className="absolute inset-0 grid place-items-center text-[13px]"
            style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.5))' }}
          >
            🏆
          </span>
          <div
            className="absolute inset-0"
            style={{ boxShadow: 'inset 0 0 12px rgba(0,0,0,.35)', borderRadius: '4%' }}
          />
        </div>

        {/* tokens */}
        {Object.entries(tokenAt).map(([k, list]) =>
          list.map(({ p, i }, si) => {
            const [r, c] = k.split(',').map(Number)
            const isLegal = p === 0 && p === state.turn && legal.includes(i)
            const n = list.length
            // Two or more tokens on one square are shrunk and fanned out. They
            // used to sit on the exact same pixel, so a pile read as one piece and
            // the rest of the pile was invisible.
            const scale = n > 1 ? 1 / (1 + (n - 1) * 0.22) : 1
            const spread = (si - (n - 1) / 2) * (n > 2 ? 0.46 : 0.42)
            const w = 5.9 * scale
            const h = 7.4 * scale
            return (
              <button
                key={`${p}-${i}`}
                disabled={!isLegal}
                onClick={() => isLegal && onToken(i)}
                className={`absolute ${isLegal ? 'z-20 cursor-pointer' : 'z-10'}`}
                style={{
                  // anchored to the MIDDLE of the square, not its top edge - this is
                  // what made pieces look detached from their cell
                  left: `calc(${pct(c)} + ${pct(0.5)} + ${spread * (100 / N)}%)`,
                  top: `calc(${pct(r)} + ${pct(0.5)})`,
                  width: `${w}%`, height: `${h}%`,
                  transform: 'translate(-50%, -50%)',
                  background: 'transparent', border: 'none', padding: 0,
                }}
                aria-label={`token ${p}-${i}`}
              >
                {isLegal && (
                  <span
                    className="absolute inset-[-30%] rounded-full"
                    style={{ border: '2.5px dashed rgba(255,255,255,.95)', boxShadow: '0 0 10px rgba(255,255,255,.95), inset 0 0 6px rgba(255,255,255,.6)' }}
                  />
                )}
                <span className={`block h-full w-full ${isLegal ? 'animate-bounce-fast' : ''}`}>
                  <PinToken color={COLORS[p]} />
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}