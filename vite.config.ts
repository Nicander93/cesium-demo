/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vite'
import { cpSync, existsSync } from 'node:fs'
import path from 'path'
import vue from '@vitejs/plugin-vue'
import cesium from 'vite-plugin-cesium'

/** vite-plugin-cesium 1.2 copies the deployment prefix into the output path. */
function normalizeCesiumOutput(): Plugin {
  let outputDir = ''
  let deploymentPath = ''
  return {
    name: 'cesium-runtime-output',
    configResolved(config) {
      outputDir = path.resolve(config.root, config.build.outDir)
      deploymentPath = config.base.replace(/^\/+|\/+$/g, '')
    },
    closeBundle: {
      order: 'post',
      sequential: true,
      handler() {
        const source = path.resolve(outputDir, deploymentPath, 'cesium')
        const destination = path.resolve(outputDir, 'cesium')
        const relative = path.relative(outputDir, source)
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Cesium output must stay within build output')
        if (source !== destination && existsSync(source)) cpSync(source, destination, { recursive: true })
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: '/cesium-demo/',
  plugins: [
    vue(),
    cesium({
      rebuildCesium: false,
      cesiumBaseUrl: 'cesium',
    }),
    normalizeCesiumOutput(),
  ],
  assetsInclude: ['**/*.geojson'],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@cesium-geospatial/core': path.resolve(__dirname, 'src/vendor/cesium-geospatial/core/experimental.ts'),
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
