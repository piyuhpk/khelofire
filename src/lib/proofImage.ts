// Turning the payment screenshot into something that can travel with the request.
//
// It exists because request_deposit (supabase/017_deposit_screenshot.sql) refuses
// anything over 700KB, and a picture straight off a phone camera is several
// megabytes - so without this step the player's own screenshot would be the
// reason their deposit fails. The image is resized and re-encoded here, in the
// browser, before it ever becomes a string.
//
// The admin is reading a transaction confirmation, not inspecting a photograph:
// 1000px on the long edge is more than enough to read an amount and a reference.

/** The ceiling request_deposit enforces, in characters of the data URL. */
export const PROOF_MAX_CHARS = 700000

/** Long edge the picture is scaled down to before encoding. */
const PROOF_MAX_EDGE = 1000

export const PROOF_NOT_IMAGE = 'that file is not an image - attach a screenshot of the payment'
export const PROOF_TOO_LARGE = 'that screenshot is too large - attach an image under 500 KB'

/** Does this look like the data URL the server will accept? */
export function looksLikeProof(v: string | null | undefined): boolean {
  if (!v) return false
  if (v.length > PROOF_MAX_CHARS) return false
  // the exact shape request_deposit checks for
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(v)
}

/** Why this picture cannot be sent, or null if it can. Exported for the tests. */
export function proofProblem(v: string | null | undefined): string | null {
  if (!v) return PROOF_NOT_IMAGE
  if (!v.startsWith('data:image/')) return PROOF_NOT_IMAGE
  if (v.length > PROOF_MAX_CHARS) return PROOF_TOO_LARGE
  return null
}

/**
 * Read an image file and return a data URL small enough to store.
 *
 * Rejects rather than returns an oversized result: the caller gates the submit
 * button on this, and a picture that came back too big has to be told so while
 * the player can still pick another one.
 */
export async function readProofDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error(PROOF_NOT_IMAGE)

  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error(PROOF_NOT_IMAGE))
      el.src = objectUrl
    })

    const long = Math.max(img.naturalWidth || 0, img.naturalHeight || 0)
    if (!long) throw new Error(PROOF_NOT_IMAGE)
    const scale = Math.min(1, PROOF_MAX_EDGE / long)
    const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale))
    const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error(PROOF_NOT_IMAGE)
    ctx.drawImage(img, 0, 0, w, h)

    // Walk the quality down before giving up on size - a screenshot with a lot
    // of text re-encodes poorly, and dropping quality once or twice usually
    // lands it well inside the limit without becoming unreadable.
    let out = canvas.toDataURL('image/jpeg', 0.62)
    for (let q = 0.5; out.length > PROOF_MAX_CHARS && q >= 0.2; q -= 0.1) {
      out = canvas.toDataURL('image/jpeg', Number(q.toFixed(1)))
    }
    if (out.length > PROOF_MAX_CHARS) throw new Error(PROOF_TOO_LARGE)
    if (proofProblem(out)) throw new Error(PROOF_NOT_IMAGE)
    return out
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
