import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
const { chromium } = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href)
  : await import('playwright')
const output = path.resolve('test-results/water-flow-lab/distance')
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
    : {}),
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
})
const checks = [],
  errors = []
try {
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({
      viewport: { width: 900, height: 600 },
      deviceScaleFactor: dpr,
    })
    const page = await context.newPage()
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (e) => {
      if (e.type() === 'error') errors.push(e.text())
    })
    await page.goto(
      (process.env.WATER_FLOW_BASE_URL ??
        'http://127.0.0.1:5198/cesium-demo/') + 'water-flow-lab',
    )
    await page.waitForFunction(
      () => window.__waterFlowLab?.getState().renderedFrames > 4,
    )
    await page.evaluate(() => {
      const lab = window.__waterFlowLab
      lab.setPlaying(false)
      lab.setFixture('bend')
      lab.seek(15)
    })
    for (const camera of ['overview', 'far']) {
      await page.evaluate(
        (camera) => window.__waterFlowLab.setCamera(camera),
        camera,
      )
      await page.waitForTimeout(400)
      const state = await page.evaluate(() => window.__waterFlowLab.getState())
      assert.equal(state.error, '')
      assert.match(state.shaderSource, /normalVariance/)
      assert.match(state.shaderSource, /shoreCoverage/)
      const viewport = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        width: innerWidth,
        canvasWidth: document.querySelector('canvas').width,
      }))
      assert.equal(viewport.scrollWidth, viewport.width)
      assert.equal(viewport.canvasWidth, 900 * dpr)
      await page.screenshot({
        path: path.join(output, 'bend-' + camera + '-dpr' + dpr + '.png'),
      })
      checks.push({ camera, dpr, ...viewport })
    }
    await context.close()
  }
  assert.deepEqual(errors, [])
  await fs.writeFile(
    path.join(output, 'gpu-smoke.json'),
    JSON.stringify(
      {
        passed: true,
        checks,
        errors,
        limits: [
          'The input grid still has finite spatial resolution; smoothing cannot recover absent subgrid shoreline data',
        ],
      },
      null,
      2,
    ),
  )
  console.log(JSON.stringify({ passed: true, checks, errors }))
} finally {
  await browser.close()
}
