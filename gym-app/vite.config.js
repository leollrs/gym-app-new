import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'
import { readFileSync, existsSync, readdirSync, mkdirSync, renameSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

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

// ── Source-map archiving ──────────────────────────────────────────────────────
// We build with `sourcemap: 'hidden'`, so every chunk gets a .map (for decoding
// minified crash stacks from error_logs) WITHOUT a sourceMappingURL comment in
// the shipped JS. This plugin then MOVES the .map files out of dist/ into a
// local, git-ignored `sourcemaps/<version>-<buildId>/` archive after each build
// — so the maps are kept for symbolication (scripts/symbolicate.mjs) but NEVER
// deployed to the web (a public .map = full source leak) or embedded in the
// native app bundle.
function archiveSourcemaps() {
  return {
    name: 'archive-sourcemaps',
    apply: 'build',
    closeBundle() {
      try {
        const outDir = fileURLToPath(new URL('./dist', import.meta.url));
        if (!existsSync(outDir)) return;
        const archiveDir = fileURLToPath(new URL(`./sourcemaps/${appVersion}-${buildId}`, import.meta.url));
        let moved = 0;
        const walk = (dir) => {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (!entry.name.endsWith('.map')) continue;
            mkdirSync(archiveDir, { recursive: true });
            renameSync(full, join(archiveDir, entry.name));
            moved++;
          }
        };
        walk(outDir);
        if (moved) console.log(`[vite] archived ${moved} source map(s) → sourcemaps/${appVersion}-${buildId}/`);
      } catch (err) {
        console.warn('[vite] source-map archiving skipped:', err?.message || err);
      }
    },
  };
}

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
        // No SW source map in dist — keeps the deploy free of any .map (app
        // chunk maps are archived out by archiveSourcemaps(); the SW/workbox
        // glue isn't proprietary but we drop its map for a clean guarantee).
        sourcemap: false,
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
            // Exercise demo videos — the <video> thumbnails/players issue HTTP
            // Range requests (206), which Workbox's default cacheableResponse
            // ([0,200]) rejects, so they'd re-download on every page in/out.
            // rangeRequests:true adds the Range plugin + we allow 206 so the
            // clip is served from cache after the first load.
            urlPattern: /^https:\/\/.*\.supabase\.co\/storage\/v1\/.*exercise-videos.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'video-cache',
              rangeRequests: true,
              cacheableResponse: { statuses: [0, 200, 206] },
              expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          {
            // Supabase Storage — cache-first (images, meal/equipment photos,
            // files). Bumped to 1500 entries / 30 days so heavy media browsing
            // (305 exercises + 432 recipes + food/equipment shots) doesn't evict
            // and re-fetch as the user goes in and out of pages.
            urlPattern: /^https:\/\/.*\.supabase\.co\/storage\/v1\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'storage-cache',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 1500, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          // Self-hosted fonts (public/fonts/*.woff2) are part of the app shell
          // and covered by the precache globs — no Google Fonts runtime rules.
        ],
      },
    }),
    archiveSourcemaps(),
  ],
  // Ensure build works for Capacitor native embedding
  build: {
    // Target modern browsers only (iOS 16+, Android 10+)
    target: ['es2020', 'safari16', 'chrome91'],
    // Hidden source maps: every chunk gets a .map (no sourceMappingURL comment
    // in the shipped JS), which the archiveSourcemaps() plugin then moves OUT of
    // dist/ into ./sourcemaps/ so crash stacks in error_logs can be symbolicated
    // (scripts/symbolicate.mjs) without ever publishing source publicly.
    sourcemap: 'hidden',
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
