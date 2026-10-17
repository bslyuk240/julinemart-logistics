import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Firebase SW is manually placed in public/ — don't let vite-plugin-pwa overwrite it
      filename: 'sw.js',
      manifest: {
        name: 'JulineMart Vendor Portal',
        short_name: 'JLM Vendors',
        description: 'Manage your JulineMart store, products, orders and earnings.',
        theme_color: '#77088a',
        background_color: '#ffffff',
        display: 'standalone',
        // No orientation lock — vendors use this on tablets in landscape too.
        id: '/',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/admin-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/admin-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
      workbox: {
        // Only one service worker can control scope '/'. Push handling lives in
        // firebase-messaging-sw.js and is pulled into this generated sw.js, so
        // the install/offline worker and the push worker are the same worker.
        importScripts: ['/firebase-messaging-sw.js'],
        // Cache app shell — exclude the Firebase SW path
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/firebase-messaging-sw\.js/],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
    }),
  ],
  server: { port: 5174 },
});
