import { defineConfig } from 'vitest/config'

// Standalone from vite.config.js on purpose: the app config pulls in the PWA
// plugin, a git `execSync`, and the React plugin — none of which the pure-logic
// unit tests need. We only re-declare the two compile-time `define` globals so
// any module that references them imports cleanly under the test runner.
export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify('test'),
    __APP_VERSION__: JSON.stringify('test'),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
    // Dummy values so any module that transitively imports src/lib/supabase.js
    // doesn't throw on its init-time env check. Tests must NOT hit a real
    // backend — these are placeholders; real values are .env.local only.
    env: {
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test_anon_key',
    },
  },
})
