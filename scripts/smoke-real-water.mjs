import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
const { chromium } = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href)
  : await import('playwright')
const output = path.resolve('test-results/water-flow-lab/real-terrain')
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
    : {}),
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
})
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: output, size: { width: 1440, height: 900 } },
})
const page = await context.newPage(),
  errors = [],
  responses = [],
  failures = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (e) => {
  if (e.type() === 'error') errors.push(e.text())
})
page.on('response', (r) => {
  if (r.url().includes('geo.admin.ch'))
    responses.push({ url: r.url(), status: r.status() })
})
page.on('requestfailed', (r) =>
  failures.push({ url: r.url(), reason: r.failure()?.errorText }),
)
const base =
  process.env.WATER_FLOW_BASE_URL ?? 'http://127.0.0.1:5198/cesium-demo/'
let report
try {
  await page.goto(base + 'water-real-terrain')
  await page.waitForFunction(
    () => window.__realWaterLab?.getState().hasWater,
    null,
    { timeout: 90000 },
  )
  await page.waitForFunction(
    () => window.__realWaterLab?.getState().tilesLoaded,
    null,
    { timeout: 30000 },
  )
  const state = await page.evaluate(() => window.__realWaterLab.getState())
  assert.equal(state.error, '')
  assert(state.terrainProvider)
  assert(state.positions >= 3)
  assert(state.height > 560 && state.height < 575)
  assert(
    responses.some((r) => r.url.includes('.terrain') && r.status === 200),
    'Real DEM tiles must succeed',
  )
  assert(
    responses.some(
      (r) => r.url.includes('wmts.geo.admin.ch') && r.status === 200,
    ),
    'Real imagery tiles must succeed',
  )
  await page.screenshot({ path: path.join(output, 'real-overview.png') })
  await page.evaluate(() => window.__realWaterLab.focus(true))
  await page.waitForTimeout(1200)
  await page.screenshot({ path: path.join(output, 'real-shore.png') })
  assert.deepEqual(errors, [])
  const renderErrors = [...errors]
  await page.route('**/water/brienz-water.geojson', (route) =>
    route.fulfill({ status: 404, body: 'not found' }),
  )
  await page.evaluate(() => window.__realWaterLab.load())
  const missing = await page.evaluate(() => window.__realWaterLab.getState())
  assert.equal(missing.hasWater, false)
  assert(missing.terrainProvider)
  assert.match(missing.waterStatus, /停止生成/)
  report = {
    passed: true,
    browser: browser.version(),
    state,
    missingBoundaryCheck: missing,
    renderErrors,
    terrainResponses: responses.filter((r) => r.url.includes('.terrain'))
      .length,
    imageryResponses: responses.filter((r) => r.url.includes('wmts')).length,
    failures,
    limits: [
      'Mapped DEM lake-surface height, not observed hydrological level',
      'Static lake; no measured flow field or bathymetry',
      'Local crop from official boundary; not full river/flood acceptance',
    ],
  }
} catch (error) {
  report = {
    passed: false,
    error: String(error),
    state: await page
      .evaluate(() => window.__realWaterLab?.getState())
      .catch(() => undefined),
    errors,
    failures,
    failedResponses: responses.filter((r) => r.status >= 400),
    responses: responses.slice(-10),
  }
  process.exitCode = 1
  await page
    .screenshot({ path: path.join(output, 'failure.png') })
    .catch(() => {})
} finally {
  const video = page.video()
  await context.close()
  report.video = await video?.path()
  await browser.close()
  await fs.writeFile(
    path.join(output, 'gpu-smoke.json'),
    JSON.stringify(report, null, 2),
  )
  console.log(JSON.stringify(report, null, 2))
}
