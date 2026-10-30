import { build } from 'vite'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../', import.meta.url))
await build({
  configFile: false,
  root,
  build: {
    lib: {
      entry: fileURLToPath(new URL('../src/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    rollupOptions: { external: ['cesium'] },
  },
})
const result = spawnSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    '-p',
    fileURLToPath(new URL('../tsconfig.json', import.meta.url)),
  ],
  { cwd: root, stdio: 'inherit' },
)
if (result.error) throw result.error
process.exitCode = result.status ?? 1
