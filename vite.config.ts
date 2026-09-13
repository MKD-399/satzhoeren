import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Satzhören — sentence-listening language trainer.
// No API key is ever bundled: all audio is pre-generated (scripts/generate-audio.mjs)
// and served as static MP3 files from public/audio.
export default defineConfig({
  base: '/satzhoeren/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Satzhören',
        short_name: 'Satzhören',
        description: 'Sprachen lernen durch Hören ganzer Sätze.',
        lang: 'de',
        start_url: '/satzhoeren/',
        scope: '/satzhoeren/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#F6F4EF',
        theme_color: '#1F6F8B',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/audio/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'satzhoeren-audio',
              expiration: { maxEntries: 20000 },
              cacheableResponse: { statuses: [0, 200] },
              rangeRequests: true,
            },
          },
        ],
      },
    }),
  ],
  server: { port: 3003, host: '0.0.0.0' },
});
