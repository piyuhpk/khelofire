import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Ship no source maps so the minified production bundle can't be read back to
    // original source. (Minification is on by default via rolldown/oxc.) Client JS
    // is never fully secret — real protection lives server-side in Supabase RLS.
    sourcemap: false,
  },
})
