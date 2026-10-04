import type { CapacitorConfig } from '@capacitor/cli';

// The admin console is the same web app behind the same staff check, but it ships
// as a SEPARATE Android package so the operator's phone does not carry the player
// app and so the two can sit on one device without colliding.
//
// Two separate builds, one source tree. `npm run build:admin` sets
// VITE_ADMIN_BUILD=true before vite runs; main.tsx uses that same flag to open
// straight into /admin, and here it changes the launcher name and the package id.
//
// The package id has to differ. Android identifies an installed app by package,
// and installing the admin build over the player build - or vice versa - replaces
// it. Sharing com.khelofire.app would mean handing a client your admin phone.
const admin = process.env.VITE_ADMIN_BUILD === 'true'

const config: CapacitorConfig = {
  appId: admin ? 'com.khelofire.admin' : 'com.khelofire.app',
  appName: admin ? 'KheloFire Admin' : 'KheloFire',
  webDir: 'dist',
  // Native Google Sign-In (@capgo/capacitor-social-login) shows the account
  // chooser as a sheet inside the app, so "Continue with Google" no longer throws
  // the player out into a system browser.
  //
  // It needs a Google Web OAuth client id here, because Android requires the
  // server/web client id even though the credential it returns is a native one.
  // Keep the id in the environment rather than hardcoding it: this file is
  // committed and the value is project-specific. Leave it blank and the app
  // refuses in-app Google sign-in with a message saying why, instead of silently
  // dropping the player into a browser.
  plugins: {
    CapacitorSocialLogin: {
      google: {
        webClientId: process.env.VITE_GOOGLE_CLIENT_ID ?? '',
      },
    },
  },
};

export default config;