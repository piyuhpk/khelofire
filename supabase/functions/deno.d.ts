// Minimal stand-ins for the two things a Deno edge function gets from its runtime.
//
// This file is NOT used at runtime - it exists so `npm run typecheck:functions`
// can check the edge functions with the TypeScript that is already installed,
// without asking anybody to install Deno. It catches the mistakes that would
// otherwise only surface on deploy: a mistyped field, a null that was never
// handled, a Date sent in the wrong shape.

// the supabase-js client is any-ish: the interesting types are the JWT, the state
// object we built ourselves, and the engine's LudoState, not PostgREST's builders.
declare module 'jsr:@supabase/supabase-js@2' {
  export function createClient(url: string, key: string, opts?: unknown): any
}

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
  env: { get(key: string): string | undefined }
}