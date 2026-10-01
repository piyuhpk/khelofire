// Money is stored as integer minor units (poisha). 100 poisha = ৳1.
export const toMinor = (taka: number) => Math.round(taka * 100)
export const fromMinor = (minor: number) => minor / 100

// Format minor units to "৳X" (Bengali Taka). No floats in storage.
export function fmt(minor: number): string {
  const taka = minor / 100
  const s = Number.isInteger(taka) ? String(taka) : taka.toFixed(2)
  return `৳${s}`
}
