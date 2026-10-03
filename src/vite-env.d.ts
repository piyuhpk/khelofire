/// <reference types="vite/client" />

// Vite only exposes env vars that are literally prefixed with VITE_ to the
// client bundle, and it types them as `any` unless declared. Declaring them here
// means a typo in a variable name is a compile error instead of `undefined` at
// runtime - which for the TURN variables is the difference between "voice works"
// and "voice silently never connects".
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** Web: leave unset (uses the site origin). APK: must match an Android intent-filter. */
  readonly VITE_OAUTH_REDIRECT?: string
  /** Set to build the separate admin APK that opens straight into /admin. */
  readonly VITE_ADMIN_BUILD?: string
  /**
   * Comma-separated TURN relay URLs. Optional, but voice chat cannot connect
   * for players behind a symmetric NAT without one - see .env.example.
   */
  readonly VITE_TURN_URLS?: string
  readonly VITE_TURN_USERNAME?: string
  readonly VITE_TURN_CREDENTIAL?: string
  /**
   * Google Web OAuth client id (…apps.googleusercontent.com). Required for
   * in-app Google sign-in on a device - without it the app has to fall back to
   * the system browser. Find it in Google Cloud console → APIs & Services →
   * Credentials → OAuth 2.0 Client IDs → Web application.
   */
  readonly VITE_GOOGLE_CLIENT_ID?: string
  /** iOS-only variant of the above; Android and web ignore it. */
  readonly VITE_GOOGLE_IOS_CLIENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}