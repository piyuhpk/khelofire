import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.khelofire.app',
  appName: 'KheloFire',
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