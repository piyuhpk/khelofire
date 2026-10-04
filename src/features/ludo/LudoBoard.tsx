import { PATH, cellFor } from '../../engine/ludoBoard'
import { START_OFFSET, FINISH, type LudoState, type PlayerId } from '../../engine/ludo'
import boardArt from '../../assets/ludoking/ludofinalboard2.png'
import redPiece from '../../assets/ludoking/redpiece.png'
import greenPiece from '../../assets/ludoking/greenpiece.png'
import yellowPiece from '../../assets/ludoking/yellowpiece.png'
import bluePiece from '../../assets/ludoking/bluepiece.png'

const PIECE_ART: Record<PlayerId, string> = { 0: redPiece, 1: greenPiece, 2: yellowPiece, 3: bluePiece }

const N = 15
const pct = (v: number) => `${(v * 100) / N}%`
const key = (r: number, c: number) => `${r},${c}`

/** which player's start square this path index is, or -1 */
function startCellOf(onPath: number): PlayerId | -1 {
  for (const p of [0, 1, 2, 3] as PlayerId[]) if (onPath === START_OFFSET[p]) return p
  return -1
}

/**
 * The piece art from the supplied Ludo King assets, keyed by player.
 *
 * These are PNGs with alpha and a portrait aspect (~80x106), so they drop
 * straight into the token box the board already reserves. The previous inline
 * SVG looked close but was not the real thing, and a token is the thing the
 * player looks at for the entire match.
 */
function PinToken({ p, dim = false }: { p: PlayerId; dim?: boolean }) {
  return (
    <img
      src={PIECE_ART[p]}
      alt=""
      draggable={false}
      className="h-full w-full select-none"
      style={{ filter: dim ? 'none' : 'drop-shadow(0 3px 3px rgba(0,0,0,.55))' }}
    />
  )
}

export function LudoBoard({ state, legal, onToken, youSeat = 0 }: { state: LudoState; legal: number[]; onToken: (i: number) => void; youSeat?: PlayerId }) {
  const tokenAt: Record<string, { p: PlayerId; i: number; pos: number }[]> = {}
  // Finished tokens all share the single centre square. Fanning them out by
  // token index keeps all four visible instead of burying three under one.
  const FINISHED_SLOT: Record<number, [number, number]> = {
    0: [-0.95, -0.95], 1: [0.95, -0.95], 2: [-0.95, 0.95], 3: [0.95, 0.95],
  }
  state.players.forEach((p) =>
    state.tokens[p].forEach((pos, i) => {
      let [r, c] = cellFor(p, pos, i)
      if (pos >= FINISH) { r += FINISHED_SLOT[i][0]; c += FINISHED_SLOT[i][1] }
      ;(tokenAt[`${r.toFixed(2)},${c.toFixed(2)}`] ||= []).push({ p, i, pos })
    })
  )

  // The artwork draws its start squares as a flat field of the player's colour -
  // sampling the centre of all four comes back perfectly uniform, no glyph at
  // all - so the entry arrow is the one thing laid on top of it. It is pointed
  // down the direction that player actually travels: sampling PATH showed 0
  // goes right from (6,1), 1 down from (1,8), 2 left from (8,13), 3 up from
  // (13,6), so a single un-turned arrow would have been lying three times out
  // of four. The safe stars need no help: all four are already in the art.
  const arrows = PATH.map(([r, c], onPath) => {
    const p = startCellOf(onPath)
    if (p === -1) return null
    return (
      <div
        key={key(r, c)}
        className="absolute grid place-items-center"
        style={{ top: pct(r), left: pct(c), width: pct(1), height: pct(1) }}
      >
        <span
          className="text-[9px] font-black leading-none"
          style={{
            color: 'rgba(255,255,255,.98)',
            textShadow: '0 1px 1px rgba(0,0,0,.35)',
            transform: `rotate(${p * 90}deg)`,
          }}
        >
          ➜
        </span>
      </div>
    )
  })

  return (
    // outer frame: gold-trimmed, bevelled, like a physical board
    <div
      className="mx-auto w-full max-w-[420px] p-[4px]"
      style={{
        borderRadius: 18,
        background: 'linear-gradient(155deg,#3A4034 0%,#262B23 55%,#171B16 100%)',
        boxShadow: '0 18px 40px -16px rgba(0,0,0,.78)',
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
        {/*
          The supplied board art IS the board - the yards, the track, the home
          columns, the safe stars and the centre are all drawn in it, and the
          code-drawn tiles that used to sit over it are gone. They were opaque
          and on top, so this bitmap was completely invisible before: the
          "background layer" was never actually seen.

          It is rotated 90 degrees on purpose. The PNG's own 15x15 cell centres
          give yards of green / yellow / red / blue from the top-left, while
          this engine puts red / green / yellow / blue there, so the artwork is
          the same board a quarter turn off. That the rotation is right is not
          an assumption - sampling confirmed all four quadrants, all four home
          column strips and all four start squares land where the engine says
          they should, and the grid lines between cells come back at lum 149
          against an interior of 255, so cells stay separated under a piece.

          No scale factor. A square art in a square container rotated by a
          quarter turn needs exactly none; the old scale(1.42) would have put
          every cell 42% off the engine's grid, and nothing caught it only
          because the art was hidden under the tiles.
        */}
        <img
          src={boardArt}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          style={{ transform: 'rotate(90deg)', transformOrigin: 'center' }}
        />

        {/* entry arrows: the one mark the artwork does not carry */}
        {arrows}

        {/* tokens */}
        {Object.entries(tokenAt).map(([k, list]) =>
          list.map(({ p, i, pos }, si) => {
            const [r, c] = k.split(',').map(Number)
            // `p === 0` here made seat 0 the only tappable player in every
            // match. In a real 1v1 the joiner plays seat 2, and in 4p seats 1/2/3,
            // so those players could roll the die and then not be able to move
            // anything - a paid board nobody could finish. The seat is now passed
            // in, defaulting to 0 so a local game needs no prop.
            const isLegal = p === youSeat && p === state.turn && legal.includes(i)
            const n = list.length
            // Two or more tokens on one square are shrunk and fanned out. They
            // used to sit on the exact same pixel, so a pile read as one piece and
            // the rest of the pile was invisible.
            const scale = n > 1 ? 1 / (1 + (n - 1) * 0.22) : 1
            const spread = (si - (n - 1) / 2) * (n > 2 ? 0.46 : 0.42)
            // Two sizes, because the two places a token sits have different boxes.
            // In the yard the white circle is ~0.98 cells across and the pin's
            // head has to fill it edge to edge: 7.8% puts the 74px head at 1.08
            // cells, and -38.2% lands that head dead on the circle centre
            // (measured off the PNGs: the pin's head centre is 0.382 of its
            // height, and the art's circle centres are BASE_SLOTS+0.5 to six
            // hundredths of a cell). On the track there is no circle, just the
            // 1-cell box, and that same tall pin sticks out of it top and
            // bottom - so there it renders at 5.9/7.4, whose visible height is
            // 1.03 cells: fully inside the box, centred in it.
            const inYard = pos === 0
            const w = (inYard ? 7.8 : 5.9) * scale
            const h = (inYard ? 10.3 : 7.4) * scale
            // The head is not at the middle of the PNG: its centre is 0.382
            // down. In the yard BASE_SLOTS points at the centre of a circle
            // and only -38.2% puts the head on that centre; -50% drops it
            // 0.18 cells high and leaves the bottom of the circle showing
            // through. On the track the pin's own middle sits on the cell
            // middle instead, which is also what keeps a pin on row 14 from
            // being cut off by the board edge.
            const ty = inYard ? '-38.2%' : '-50%'
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
                  transform: `translate(-50%, ${ty})`,
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
                  <PinToken p={p} />
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}