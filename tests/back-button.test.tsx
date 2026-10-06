import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'

// The report was "the phone's back button does nothing" - and it did nothing
// because nothing in the app had ever subscribed to Capacitor's backButton event.
// Android fell back to history.back(), which does nothing at all on the first
// screen, and the only other thing listening was ExitModal's self-rearming guard,
// which re-opened a dialog that was already open.
//
// So this covers the order the presses are handled in, and the dialog's own guard.

let native = true
let handler: (() => void) | null = null
const exitApp = vi.fn()
const goHome = vi.fn()

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (_event: string, cb: () => void) => {
      handler = cb
      return { remove: vi.fn(async () => {}) }
    }),
    exitApp: (...a: unknown[]) => exitApp(...(a as [])),
  },
}))
// backButton.ts reads exactly this one name from auth.ts
vi.mock('../src/lib/auth', () => ({ isNativeApp: () => native }))

import { initBackButton } from '../src/lib/backButton'

// initBackButton registers once and refuses a second registration, so the listener
// is taken here and every press below replays it. Re-registering per test would
// silently leave handler null and pass nothing at all.
beforeAll(() => { initBackButton(goHome) })

const goto = (path: string) => window.history.replaceState({}, '', path)
const press = () => {
  expect(handler, 'no backButton listener was registered').toBeTruthy()
  handler!()
}

describe('the Android back button', () => {
  let back: ReturnType<typeof vi.spyOn>
  let onGameExit: ReturnType<typeof vi.fn>
  let onBackDismiss: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // handler is deliberately not cleared: the listener registered in beforeAll is
    // the one under test, and initBackButton refuses to register twice
    native = true
    exitApp.mockClear()
    goHome.mockClear()
    // history.back() in jsdom queues real traversal; the question is only whether
    // it was asked for, not where it lands.
    back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    onGameExit = vi.fn()
    onBackDismiss = vi.fn()
    window.addEventListener('game-exit', onGameExit)
    window.addEventListener('back-dismiss', onBackDismiss)
    goto('/')
    // a real install has more than one entry once the player has moved around
    if (window.history.length < 2) window.history.pushState({}, '', '/')
  })

  afterEach(() => {
    cleanup()
    window.removeEventListener('game-exit', onGameExit)
    window.removeEventListener('back-dismiss', onBackDismiss)
    back.mockRestore()
  })

  it('registers on a native app, and takes the press over from the browser', () => {
    expect(handler, 'no backButton listener was registered').toBeTruthy()
  })

  it('exits the app at home - the Android contract for the first screen', () => {
    goto('/')
    press()
    expect(exitApp).toHaveBeenCalledTimes(1)
    expect(back).not.toHaveBeenCalled()
    expect(onGameExit).not.toHaveBeenCalled()
  })

  it('asks before leaving a game instead of navigating out of it', () => {
    goto('/play/ludo/ludo_quick')
    press()
    expect(onGameExit).toHaveBeenCalledTimes(1)
    expect(back).not.toHaveBeenCalled()
    expect(exitApp, 'a paid match must never be exited without confirming').not.toHaveBeenCalled()
  })

  it('closes the leave dialog that is already on screen, rather than acting under it', () => {
    const host = document.createElement('div')
    host.setAttribute('data-back-guard', 'open')
    document.body.appendChild(host)
    try {
      goto('/play/ludo/ludo_quick')
      press()
      expect(onBackDismiss).toHaveBeenCalledTimes(1)
      expect(onGameExit, 'back must dismiss the dialog, not re-open it').not.toHaveBeenCalled()
    } finally {
      host.remove()
    }
  })

  it('goes back on a screen the player navigated to', () => {
    goto('/wallet')
    press()
    expect(back).toHaveBeenCalledTimes(1)
    expect(exitApp).not.toHaveBeenCalled()
  })

  it('returns home rather than closing when a deep link opened a screen with no history', () => {
    window.history.replaceState({}, '', '/profile')
    Object.defineProperty(window.history, 'length', { value: 1, configurable: true })
    press()
    expect(goHome).toHaveBeenCalledTimes(1)
    expect(exitApp, 'a deep link must not close the app').not.toHaveBeenCalled()
  })

  it('leaves the browser alone on the web build', async () => {
    // a fresh module instance, because initBackButton registers once and the native
    // registration above is already in place
    vi.resetModules()
    native = false
    const before = handler
    const fresh = await import('../src/lib/backButton')
    fresh.initBackButton(goHome)
    expect(handler, 'the web build must not take over the browser back button').toBe(before)
    native = true
  })
})

describe('the leave dialog in a browser', () => {
  // On Android backButton owns the press; the web has only history, so ExitModal
  // arms one entry itself.
  beforeEach(() => {
    native = false
    goto('/play/ludo/ludo_quick')
  })
  afterEach(() => { cleanup(); native = true })

  it('opens on back, closes on the next back, and never grows the stack', async () => {
    const { ExitModal } = await import('../src/features/game/GameShell')
    render(<ExitModal onLeave={vi.fn()} />)

    const guarded = () => document.querySelector('[data-back-guard="open"]')
    expect(guarded()).toBeNull()

    // one entry armed on mount
    const armed = window.history.length
    await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')) })
    expect(guarded(), 'back must open the leave dialog').not.toBeNull()

    // pressing back again closes it - it used to re-open, which is what made the
    // button look dead
    await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')) })
    expect(guarded(), 'back must close the dialog it just opened').toBeNull()

    // and the stack held: each press consumed one entry and pushed one back
    expect(window.history.length).toBeLessThanOrEqual(armed + 1)
  })

  it('still answers the native back button while it is on screen', async () => {
    const { ExitModal } = await import('../src/features/game/GameShell')
    render(<ExitModal onLeave={vi.fn()} />)
    await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')) })
    expect(document.querySelector('[data-back-guard="open"]'), 'back must open the dialog').not.toBeNull()

    // and the dialog still answers the native back button that dismisses it
    await act(async () => { window.dispatchEvent(new CustomEvent('back-dismiss')) })
    expect(document.querySelector('[data-back-guard="open"]'), 'back-dismiss must close it').toBeNull()
  })
})
