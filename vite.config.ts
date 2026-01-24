/// <reference types="vitest" />
import { defineConfig } from 'vite'
import path from 'path'
import vue from '@vitejs/plugin-vue'
import cesium from 'vite-plugin-cesium'

// https://vite.dev/config/
export default defineConfig({
  base: '/cesium-demo/',
  plugins: [
    vue(),
    cesium({
      rebuildCesium: false,
      cesiumBuildPath: './src/cesium',
      cesiumBaseUrl: 'cesium',
    }),
  ],
  assetsInclude: ['**/*.geojson'],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      cesium: path.resolve(__dirname, 'src/cesium'),
    },
  },
  server: {
    proxy: {
      '/mapServer': {
        target: 'http://58.42.237.175:6080',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/mapServer/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // setupFiles: ['./src/__spec___/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
})
