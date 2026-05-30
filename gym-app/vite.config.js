import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const isCapacitor = process.env.CAPACITOR_BUILD === 'true';

// Pulled from package.json so a single source of truth (the package version)
// is what every API call compares against. Bumping package.json on release
// is enough to roll the gate forward.
const pkgUrl = new URL('./package.json', import.meta.url);
const appVersion = JSON.parse(readFileSync(fileURLToPath(pkgUrl), 'utf8')).version || '0.0.0';

// Build identifier — every build gets a fresh value so the React Query
// persisted cache buster (in main.jsx) auto-invalidates on every deploy.
// Without this, an old persisted cache with an incompatible row shape
// keeps poisoning the app until the user manually clears storage.
//   Priority: explicit env var (CI sets VITE_BUILD_ID=$GITHUB_SHA) →
//   git short hash (local builds) → wall-clock timestamp (last resort,
//   guaranteed unique per build).
let buildId = process.env.VITE_BUILD_ID;
if (!buildId) {
  try {
    buildId = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch { /* not a git repo or git unavailable — fall through */ }
}
if (!buildId) buildId = String(Date.now());
// eslint-disable-next-line no-console
console.log(`[vite] BUILD_ID = ${buildId}`);

// https://vite.dev/config/
export default defineConfig({
  define: {
    // Available at runtime as `__BUILD_ID__` (string literal). Used as the
    // React Query persist buster + as a debug label in stuck-loading recovery.
    __BUILD_ID__: JSON.stringify(buildId),
    // Bundled app version (from package.json). The app-version check (see
    // lib/appVersionCheck.js) compares this against `min_required_version`
    // returned by the `get_app_version` RPC to decide whether to hard-gate
    // the user behind the update modal.
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // On Capacitor the web assets are already on-device (bundled natively
      // / managed by Capgo) — a service worker only adds a redundant runtime
      // cache layer AND a real footgun: a stale SW survives `devicectl
      // install` (the data container isn't wiped on reinstall) and can keep
      // serving old chunks, leaving the app stuck on a blank screen.
      // `selfDestroying` on Capacitor builds ships a SW that unregisters
      // itself and clears its caches on next launch — which also cleans up
      // any stale SW already sitting on field devices. Web/PWA keeps the
      // real SW. React Query's localStorage persistence + the offline queue
      // already cover offline on native, so nothing is lost.
      selfDestroying: isCapacitor,
      registerType: 'autoUpdate',
      includeAssets: isCapacitor ? [] : ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      manifest: isCapacitor ? false : {
        name: 'IronForge',
        short_name: 'IronForge',
        description: 'Track workouts, compete, and stay accountable.',
        theme_color: '#05070B',
        background_color: '#05070B',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // 3 MiB
        // On Capacitor, skip precaching (Capgo handles app shell updates).
        // On web, precache the app shell as before.
        globPatterns: isCapacitor ? [] : ['**/*.{js,css,html,ico,svg}', 'icon-*.png', 'apple-touch-icon.png'],
        globIgnores: ['muscles/**'],
        // Runtime caching — active on both web and Capacitor
        runtimeCaching: [
          {
            // Supabase REST API — network-first with offline fallback
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 15,
              expiration: { maxEntries: 200, maxAgeSeconds: 24 * 60 * 60 },
            },
          },
          {
            // Supabase Storage — cache-first (images, videos, files)
            urlPattern: /^https:\/\/.*\.supabase\.co\/storage\/v1\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'storage-cache',
              expiration: { maxEntries: 500, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
          {
            // Google Fonts stylesheets
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'font-stylesheets' },
          },
          {
            // Google Fonts files (woff2, etc.)
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'font-files',
              expiration: { maxEntries: 30, maxAgeSeconds: 365 * 24 * 60 * 60 },
            },
          },
        ],
      },
    }),
  ],
  // Ensure build works for Capacitor native embedding
  build: {
    // Target modern browsers only (iOS 16+, Android 10+)
    target: ['es2020', 'safari16', 'chrome91'],
    // Generate source maps for Capgo crash reporting
    sourcemap: false,
    // Warn about chunks exceeding 1000 kB
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Per-language pages.json chunk so we can lazy-load only the active
          // locale's strings (~376/404 KB raw each, ~50/65 KB gz).
          if (id.includes('/locales/en/pages.json')) return 'i18n-pages-en';
          if (id.includes('/locales/es/pages.json')) return 'i18n-pages-es';
          // leaflet + react-leaflet only ship with LiveCardio's RouteMap. Splitting
          // them into a dedicated chunk keeps cardio start-up snappy by deferring
          // ~40 KB gz until the user actually opens a cardio session.
          // Framework code in dedicated long-lived vendor chunks so it stays
          // cached across deploys (the app entry hash changes every build, but
          // React/Router/Query rarely change) — keeps it out of the volatile
          // entry chunk and off the re-download path on each OTA update.
          if (id.includes('node_modules/react-router') ||
              id.includes('node_modules/react-dom/') ||
              id.includes('node_modules/react/') ||
              id.includes('node_modules/scheduler/')) return 'vendor-react';
          if (id.includes('node_modules/@tanstack/')) return 'vendor-query';
          if (id.includes('node_modules/leaflet/') || id.includes('node_modules/react-leaflet/')) return 'leaflet';
          if (id.includes('node_modules/recharts/')) return 'recharts';
          if (id.includes('node_modules/framer-motion/')) return 'framer-motion';
          if (id.includes('node_modules/@supabase/supabase-js/')) return 'supabase';
          if (id.includes('node_modules/date-fns/')) return 'date-fns';
          if (id.includes('node_modules/i18next/') ||
              id.includes('node_modules/react-i18next/') ||
              id.includes('node_modules/i18next-browser-languagedetector/')) return 'i18n';
          return undefined;
        },
        chunkFileNames: 'js/[name]-[hash].js',
        entryFileNames: 'js/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
