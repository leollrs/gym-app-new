import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const isCapacitor = process.env.CAPACITOR_BUILD === 'true';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      selfDestroying: false,
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
    sourcemap: 'hidden',
  },
})
