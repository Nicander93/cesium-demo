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
      // 启用源码替换功能
      rebuildCesium: false,
      // 指定自定义Cesium源码目录
      cesiumBuildPath: './src/cesium',
      cesiumBaseUrl: './src/cesium',
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      cesium: path.resolve(__dirname, 'src/cesium'),
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
