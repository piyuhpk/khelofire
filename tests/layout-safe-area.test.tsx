import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// "The bottom row of every tab screen sits under the navigation bar."
//
// The cause was two Tailwind classes on the same element doing the same job:
// `pb-24 pb-[env(safe-area-inset-bottom)]`. They both set padding-bottom, and a
// CSS property has one value - the later rule won, so the intended 96px of
// clearance was actually whatever the gesture bar happens to be, 0px on most
// phones. Nothing failed; the spacing was just quietly not what anyone wrote.
//
// So this asserts the value rather than the class list: the clearance has to be
// both the nav's height and the safe area, in one declaration.

vi.mock('../src/i18n', () => ({
  useT: () => (k: string) => k,
  useI18n: () => ({ lang: 'en', theme: 'dark', toggleLang: vi.fn(), toggleTheme: vi.fn() }),
}))

import { AppLayout } from '../src/app/AppLayout'

const mount = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<div>page content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

const main = () => document.querySelector('main')!

afterEach(cleanup)

describe('clearing the bottom navigation', () => {
  it('leaves room for the nav and the gesture bar in a single padding value', () => {
    mount()
    const pb = (main() as HTMLElement).style.paddingBottom
    expect(pb, 'main has no padding-bottom at all').toBeTruthy()
    // the nav itself, not just the space under it
    expect(pb, 'content must clear the nav bar').toMatch(/6rem|96px/)
    // and the gesture bar / home indicator
    expect(pb, 'content must clear the gesture bar').toContain('env(safe-area-inset-bottom')
  })

  it('does not put the two on separate classes, where one silently wins', () => {
    mount()
    const cls = main().className
    // A `pb-*` utility alongside an inline value is how this broke: the utility
    // and the inline style fight, and which one shows up depends on where Tailwind
    // put it in the stylesheet.
    expect(cls, `padding-bottom classes found on main: ${cls}`).not.toMatch(/(^|\s)pb-/)
  })

  it('gives the same clearance on a phone with no gesture bar', () => {
    // env() falls back to 0px there, so a class that only carried the env() value
    // would leave nothing at all - which is the reported state.
    mount()
    const pb = (main() as HTMLElement).style.paddingBottom
    const withoutInset = pb.replace(/env\(safe-area-inset-bottom[^)]*\)/g, '0px')
    expect(withoutInset).toMatch(/calc\(6rem \+ 0px\)|calc\(96px \+ 0px\)/)
  })

  it('keeps the navs own inset padding, which is what sits over the home row', () => {
    // Not read from the DOM: jsdom's CSSOM drops a bare env() value, so an inline
    // style check would pass or fail on the parser rather than on the code.
    const source = readFileSync(resolve(process.cwd(), 'src/app/AppLayout.tsx'), 'utf8')
    const nav = /<nav[\s\S]*?<\/nav>/.exec(source)
    expect(nav, 'no <nav> found').toBeTruthy()
    expect(nav![0], 'the nav must carry its own gesture-bar padding').toContain(
      'env(safe-area-inset-bottom',
    )
  })
})
