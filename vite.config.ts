import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/health-app/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable.png'],
      manifest: {
        name: '健康追踪',
        short_name: '健康追踪',
        description: '本地优先、支持多设备同步的个人健康追踪工具',
        lang: 'zh-CN',
        start_url: '/health-app/',
        scope: '/health-app/',
        display: 'standalone',
        background_color: '#f5f7f6',
        theme_color: '#0f9d6c',
        icons: [
          { src: '/health-app/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/health-app/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/health-app/icons/icon-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/health-app/index.html',
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: './tests/setup.ts',
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    coverage: { provider: 'v8', reporter: ['text', 'html'] },
  },
});
