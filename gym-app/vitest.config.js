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
  },
})
