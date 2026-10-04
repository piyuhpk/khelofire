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
  // The VITE_GOOGLE_* ids are gone. Google sign-in was removed rather than left
  // behind half-wired: it needed a Web-application OAuth client id that the build
  // did not have, so on a device the button failed every time with a Google error
  // that named nothing the player could act on. Email and password cover sign-in,
  // signup and password reset, so nothing is lost that actually worked.
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}