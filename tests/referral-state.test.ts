import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// "Naya account banao, refer to kichu kiya nahi - phir bhi referral dikha raha hai."
//
// The store's initial state is demo seed data - two named referrals and ৳40
// already earned - and loadUserData() overwrote the balance, the name, the code and
// the win counts from the server profile, but left the referral fields exactly as
// it found them. So those two fake referrals were read as the account's real
// referral history, on every fresh account, forever.
//
// The referral list and the earned total belong to the profile, so signing in has
// to replace them the way it replaces the balance. Silently keeping the app's own
// placeholder is the same class of bug as showing a demo balance.

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8')
const sync = read('src/lib/sync.ts')

describe('referral state on a real profile', () => {
  it('replaces the referral list when a profile loads', () => {
    // it must be assigned, not merged, and not left alone
    expect(sync).toMatch(/referrals:\s*\[\]/)
  })

  it('zeroes the referral income rather than keeping the seeded amount', () => {
    // toMinor(40) in the seed is what a new account was showing as already earned
    expect(sync).toMatch(/referralEarnedMinor:\s*0/)
  })

  it('does it inside the profile branch, so a failed read cannot wipe real data', () => {
    // If this moved outside `if (prof)`, a denied or empty profile read would clear
    // a real player's referrals. The overwrite belongs with the other profile fields.
    const block = /if \(prof\)\s*\{[\s\S]*?\n {4}\}/.exec(sync)
    expect(block, 'no `if (prof)` branch found in sync.ts').toBeTruthy()
    expect(block![0]).toMatch(/referrals:\s*\[\]/)
    expect(block![0]).toMatch(/referralEarnedMinor:\s*0/)
  })

  it('still sets the referral code from the server, which is a real value', () => {
    // the code is assigned from the profile and must stay that way - this is the
    // one referral field that is genuinely per-account
    expect(sync).toMatch(/referralCode:\s*prof\.referral_code/)
  })
})
