// Separate from vite.config.ts on purpose: the production build must not depend
// on vitest being installed.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // the app's tsconfig puts JSX behind the app project reference, which vitest
  // does not read, so without this the classic runtime is assumed and every
  // test file dies with "React is not defined"
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.{ts,tsx}'],
    // a full Ludo match is simulated second by second, which is thousands of
    // act() round trips. The 5s default is not enough.
    testTimeout: 120_000,
    hookTimeout: 30_000,
  },
})