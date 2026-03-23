import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Disable PWA service worker on Capacitor native builds.
      // On native, Capacitor handles caching and the SW conflicts with
      // the native webview and Capgo OTA updates.
      disabled: process.env.CAPACITOR_BUILD === 'true',
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      manifest: {
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
        globPatterns: ['**/*.{js,css,html,ico,svg}', 'icon-*.png', 'apple-touch-icon.png'],
        globIgnores: ['muscles/**'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'supabase-api', networkTimeoutSeconds: 10 },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts' },
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
    sourcemap: true,
  },
})
