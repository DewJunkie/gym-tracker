import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // For GitHub Pages project sites the app is served under /<repo-name>/.
  // The deploy workflow sets PAGES_BASE automatically from the repo name,
  // so no manual config is needed. (A user/org site repo, <name>.github.io,
  // is served from /, which is the default.)
  base: process.env.PAGES_BASE ?? '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-512.png'],
      manifest: {
        name: 'Gym Tracker',
        short_name: 'GymTrack',
        description: 'Local-first gym workout tracker: scan a machine, log your sets.',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#101418',
        theme_color: '#101418',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
      workbox: {
        // Cache the wa-sqlite WASM + worker chunks and the Tesseract OCR
        // assets (core wasm, worker script, traineddata) for offline use.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm}', '**/*.traineddata'],
        // WASM files can be large; raise the precache size cap.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
  worker: {
    // Emit the DB worker as a separate chunk (Vite default for `new Worker(new URL(...))`).
    format: 'es',
  },
})
