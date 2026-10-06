/**
 * What the phone's back button does.
 *
 * WHY THIS FILE EXISTS AT ALL
 *
 * `@capacitor/app` ships a backButton event and nothing in this app had ever
 * listened to it, so Android did what it does with an unhandled back: nothing. On
 * the home screen the button visibly did nothing, and inside a game the only thing
 * listening was a popstate guard in ExitModal that re-armed itself, so a press
 * opened the leave dialog, another press re-opened it, and the stack grew - which a
 * player described as the back button not working.
 *
 * So the listener decides, in this order:
 *
 *   1. a leave-confirm dialog is on screen -> close it. Back dismisses a dialog
 *      on every platform; leaving from under an open dialog is how a player quits
 *      a paid match by accident.
 *   2. inside a game -> ask to leave, through the same `game-exit` event the in-app
 *      arrow dispatches. One code path for "leave?", so the game cannot be exited
 *      two different ways with two different rules - resigning a live match is a
 *      forfeit and must go through giveUp().
 *   3. anywhere else with somewhere to go -> history.back(), which is what the
 *      button is supposed to mean.
 *   4. home with nowhere to go -> leave the app. That is the Android contract: the
 *      first screen back closes. Doing nothing there was the report.
 *
 * Native only. In a browser the button does not exist and the browser's own back
 * works, so registering there would take over history handling for no reason.
 */

import { App } from '@capacitor/app'
import { isNativeApp } from './auth'

/** routes where leaving is a forfeit and must be confirmed first */
const GAME_ROUTE = /^\/play\//

/** the dialog ExitModal puts up; see GameShell */
const GUARD = '[data-back-guard="open"]'

let started = false

export function initBackButton(goHome: () => void): void {
  if (started || !isNativeApp()) return
  started = true

  void App.addListener('backButton', () => {
    // 1. dismiss what is on top rather than acting underneath it
    if (document.querySelector(GUARD)) {
      window.dispatchEvent(new CustomEvent('back-dismiss'))
      return
    }

    // 2. a game is running: confirm, do not navigate
    if (GAME_ROUTE.test(location.pathname)) {
      window.dispatchEvent(new CustomEvent('game-exit'))
      return
    }

    // 3. a screen the player navigated to: go back the way they came
    if (location.pathname !== '/' && history.length > 1) {
      history.back()
      return
    }

    // 3b. a deep link straight into a screen, with no history to go back to:
    //     staying in the app is right, closing it is not
    if (location.pathname !== '/') {
      goHome()
      return
    }

    // 4. home: the button closes the app
    void App.exitApp()
  })
}
