import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
const { chromium } = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href)
  : await import('playwright')
const output = path.resolve(
  process.env.WATER_SHORE_OUTPUT ?? 'test-results/water-flow-lab/shoreline',
)
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
  }),
  page = await context.newPage()
const errors = [],
  probes = [],
  checks = [],
  real = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (e) => {
  if (e.type() === 'error') errors.push(e.text())
})
const base =
  process.env.WATER_FLOW_BASE_URL ?? 'http://127.0.0.1:5198/cesium-demo/'
const optical = (method, value) =>
  page.evaluate(([m, v]) => window.__waterOptics[m](v), [method, value])
const control = (method, value) =>
  page.evaluate(([m, v]) => window.__realWaterLab[m](v), [method, value])
const state = () => page.evaluate(() => window.__realWaterLab.getState())
async function pixel(x, y) {
  const buffer = await page.screenshot({ clip: { x, y, width: 1, height: 1 } })
  return page.evaluate(async (data) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + data
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3)
  }, buffer.toString('base64'))
}
let report
try {
  await page.goto(base + 'water?scene=calibration&shoreline=probe')
  await page.waitForFunction(
    () => window.__waterOptics?.getState().diagnostics.shorelineAvailable,
    null,
    { timeout: 30000 },
  )
  const rejected = await page.evaluate(() => {
    const lab = window.__waterOptics
    const previous = lab.getState().options.waterAlpha
    try {
      lab.setOptions({ waterAlpha: 0.2, foamWidth: 65 })
      return false
    } catch {
      return lab.getState().options.waterAlpha === previous
    }
  })
  assert(
    rejected,
    'Invalid mapped foam range must fail before mutating opacity',
  )
  await optical('prepareProbe')
  await optical('setOptions', {
    shadingMode: 'water-composite',
    shoreFadeDistance: 0,
  })
  await optical('focus', 'overview')
  await page.waitForTimeout(500)
  for (const local of [
    [-10, -18],
    [-10, -12],
    [-10, 4],
    [18, 0],
    [12, 0],
    [-4, 0],
  ]) {
    await optical('setOptions', { shoreFadeDistance: 0 })
    await optical('showWater', true)
    await page.waitForTimeout(100)
    const opaque = await optical('shoreProbe', local)
    assert(opaque.waterPicked, 'Probe must hit water')
    const water = await pixel(opaque.x, opaque.y)
    await optical('showWater', false)
    await page.waitForTimeout(100)
    const background = await pixel(opaque.x, opaque.y)
    await optical('showWater', true)
    await optical('setOptions', { shoreFadeDistance: 16 })
    await page.waitForTimeout(100)
    const probe = await optical('shoreProbe', local),
      actual = await pixel(probe.x, probe.y)
    const expected = water.map(
      (c, i) => c * probe.fade + background[i] * (1 - probe.fade),
    )
    const maxError = Math.max(
      ...actual.map((c, i) => Math.abs(c - expected[i])),
    )
    probes.push({
      local,
      ...probe,
      water,
      background,
      expected,
      actual,
      maxError,
    })
    assert(
      maxError < 4,
      `GPU shoreline alpha differs from analytic distance by ${maxError}`,
    )
  }
  checks.push({
    check: 'GPU mask orientation, metric distance and alpha blending',
    passed: true,
  })
  await page.screenshot({ path: path.join(output, 'analytic-shore-fade.png') })
  const analyticErrors = [...errors]
  assert.deepEqual(analyticErrors, [])

  await page.goto(base + 'water-real-terrain')
  await page.waitForFunction(
    () => window.__realWaterLab?.getState().hasWater,
    null,
    { timeout: 90000 },
  )
  await control('setOptions', { reflection: false, foam: false })
  await control('focusShore')
  await control('freeze')
  await control('setTime', 15)
  await page.waitForFunction(
    () => window.__realWaterLab.getState().tilesLoaded,
    null,
    { timeout: 90000 },
  )
  await page.waitForTimeout(1000)
  const initial = await state(),
    geometry = initial.diagnostics.geometryCreated
  assert.equal(initial.diagnostics.shorelineAvailable, true)
  assert.equal(initial.error, '')
  for (const distance of [0, 8, 16]) {
    await control('setOptions', { shoreFadeDistance: distance, foam: false })
    await page.waitForTimeout(300)
    await page.screenshot({
      path: path.join(output, `real-shore-fade-${distance}.png`),
    })
    const s = await state()
    delete s.shaderSource
    real.push({ distance, state: s })
    assert.equal(s.diagnostics.geometryCreated, geometry)
    assert.equal(
      s.diagnostics.shoreFrames,
      0,
      'Mapped shoreline must not start a terrain depth capture',
    )
  }
  await page.getByLabel(/接水线渐变/).fill('12')
  await page.waitForFunction(
    () => window.__realWaterLab.getState().options.shoreFadeDistance === 12,
  )
  const roi = { x: 355, y: 0, width: 1085, height: 650 }
  const withoutFoam = await page.screenshot({ clip: roi })
  await page.getByLabel(/局部岸边泡沫/).check()
  await page.waitForFunction(
    () => window.__realWaterLab.getState().options.foam,
  )
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(output, 'real-shore-foam.png') })
  await page.getByLabel(/泡沫强度/).fill('1')
  await page.getByLabel(/泡沫带宽/).fill('24')
  await page.waitForFunction(
    () => window.__realWaterLab.getState().options.foamWidth === 24,
  )
  await page.waitForTimeout(200)
  const withFoam = await page.screenshot({ clip: roi })
  const foamDifference = await page.evaluate(
    async ([a, b]) => {
      async function decode(data) {
        const img = new Image()
        img.src = 'data:image/png;base64,' + data
        await img.decode()
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const ctx = c.getContext('2d')
        ctx.drawImage(img, 0, 0)
        return ctx.getImageData(0, 0, c.width, c.height).data
      }
      const [x, y] = await Promise.all([decode(a), decode(b)])
      let sum = 0
      for (let i = 0; i < x.length; i += 4)
        sum +=
          (Math.abs(x[i] - y[i]) +
            Math.abs(x[i + 1] - y[i + 1]) +
            Math.abs(x[i + 2] - y[i + 2])) /
          3
      return sum / (x.length / 4)
    },
    [withoutFoam.toString('base64'), withFoam.toString('base64')],
  )
  assert(
    foamDifference > 0.05,
    'Foam controls must change actual shoreline pixels',
  )
  checks.push({
    check: 'Optional foam changes actual shoreline pixels',
    meanRgbDifference: foamDifference,
  })
  await page.screenshot({
    path: path.join(output, 'real-shore-foam-strong.png'),
  })
  await control('setMode', 'current')
  assert.equal((await state()).options.shoreFadeDistance, 0)
  assert.equal((await state()).options.foam, false)
  await control('setMode', 'enhanced')
  assert.equal((await state()).options.shoreFadeDistance, 12)
  await page.getByLabel(/局部岸边泡沫/).uncheck()
  await control('setOptions', {
    shoreFadeDistance: 8,
    waveSpeed: 0.7,
    reflection: true,
  })
  const start = (await state()).visualTime
  for (let i = 0; i < 12; i++) {
    if (i === 4) await control('focus', 'overview')
    if (i === 8) await control('focusShore')
    await page.waitForTimeout(1000)
  }
  const final = await state()
  delete final.shaderSource
  assert(final.visualTime > start + 5)
  assert.equal(final.diagnostics.geometryCreated, geometry)
  assert.equal(final.diagnostics.shoreFrames, 0)
  assert.equal(final.diagnostics.shorelineAvailable, true)
  assert.equal(final.diagnostics.reflectionAvailable, true)
  assert.equal(final.error, '')
  assert.deepEqual(errors, [])
  checks.push({
    check:
      'Real terrain, native controls, static-mask reuse and combined reflection',
    passed: true,
  })
  await page.getByRole('link', { name: /合成水流对照/ }).click()
  await page.waitForFunction(() => !window.__realWaterLab)
  checks.push({ check: 'Route unmount removes host interface', passed: true })
  report = {
    passed: true,
    browser: browser.version(),
    probes,
    real,
    checks,
    errors,
    finalState: final,
    limits: [
      'Mapped horizontal shoreline distance, not bathymetry, depth fade, physical foam generation or flood wet/dry evolution.',
      'Real-terrain screenshots require visual review; analytic GPU probes only establish the mask and alpha equation.',
    ],
  }
} catch (error) {
  report = {
    passed: false,
    error: String(error),
    probes,
    real,
    checks,
    errors,
    state: await state()
      .then((s) => {
        delete s.shaderSource
        return s
      })
      .catch(() => undefined),
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
  console.log(
    JSON.stringify({
      passed: report.passed,
      error: report.error,
      probes: probes.length,
      report: path.join(output, 'gpu-smoke.json'),
    }),
  )
}
