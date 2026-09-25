import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Μετάφρασις',
        short_name: 'Μετάφρασις',
        lang: 'el',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#2f6fed',
        background_color: '#ffffff',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
        navigateFallback: '/index.html',
        // Τα δεδομένα μένουν πάντα ζωντανά: τίποτα κάτω από /api δεν αποθηκεύεται ούτε
        // απαντάται από το cache — αλλιώς δύο μεταφραστές θα έβλεπαν διαφορετική εικόνα.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [{ urlPattern: /^\/api\//, handler: 'NetworkOnly' }],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    port: 5173,
    // Το cookie συνεδρίας είναι httpOnly· το proxy κρατά client και API στην ίδια origin.
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
