import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
const { chromium } = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href)
  : await import('playwright')
const base =
  process.env.WATER_FLOW_BASE_URL ?? 'http://127.0.0.1:5198/cesium-demo/'
const output = path.resolve('test-results/flood-dynamic/real-lighting')
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
  deviceScaleFactor: 1,
})
const page = await context.newPage(),
  errors = [],
  responses = [],
  failures = []
let expectedFailure = false,
  report = { passed: false }
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (e) => {
  if (e.type() === 'error' && !expectedFailure) errors.push(e.text())
})
page.on('response', (r) => {
  if (r.url().includes('geo.admin.ch'))
    responses.push({ url: r.url(), status: r.status() })
})
page.on('requestfailed', (r) =>
  failures.push({ url: r.url(), reason: r.failure()?.errorText }),
)
await page.route('**/font-awesome/**', (route) =>
  route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
)
const control = (method, value) =>
  page.evaluate(
    ([method, value]) => window.__floodDynamicLab[method](value),
    [method, value],
  )
const state = () => control('getState')
const rendered = () =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
      ),
  )
async function settled() {
  await page.waitForFunction(
    () => window.__floodDynamicLab?.getState().tilesLoaded,
    null,
    { timeout: 60000 },
  )
}
async function capture(name) {
  await rendered()
  return (
    await page.screenshot({
      path: path.join(output, name + '.png'),
      clip: { x: 360, y: 0, width: 1080, height: 880 },
    })
  ).toString('base64')
}
async function compare(a, b) {
  return page.evaluate(
    async ([a, b]) => {
      async function decode(data) {
        const img = new Image()
        img.src = 'data:image/png;base64,' + data
        await img.decode()
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const c = canvas.getContext('2d')
        c.drawImage(img, 0, 0)
        return c.getImageData(0, 0, img.width, img.height).data
      }
      const first = await decode(a),
        second = await decode(b)
      let sum = 0,
        changed = 0
      for (let i = 0; i < first.length; i += 4) {
        const d =
          (Math.abs(first[i] - second[i]) +
            Math.abs(first[i + 1] - second[i + 1]) +
            Math.abs(first[i + 2] - second[i + 2])) /
          3
        sum += d
        if (d > 10) changed++
      }
      return {
        meanRgbDifference: sum / (first.length / 4),
        changedOver10: changed / (first.length / 4),
      }
    },
    [a, b],
  )
}
try {
  await page.goto(new URL('flood-dynamic-lab?environment=real', base).href)
  await page.waitForFunction(
    () => {
      const s = window.__floodDynamicLab?.getState()
      return (
        s &&
        !s.loading &&
        s.diagnostics?.ready &&
        s.lighting?.environmentAvailable
      )
    },
    null,
    { timeout: 90000 },
  )
  await page.evaluate(() => {
    const { layer } = window.__floodDynamicLab.getTestContext(),
      lut = layer.environment.brdfTexture
    if (
      !lut ||
      lut.isDestroyed() ||
      layer.waterMaterial._textures.waterBrdfLut !== lut
    )
      throw Error('Shared BRDF LUT not bound alive')
    window.__floodBorrowedLut = lut
  })
  console.log('Real terrain sampled and environment ready')
  await settled()
  const initial = await state()
  assert.equal(initial.environment, 'real')
  assert.equal(initial.error, '')
  assert.equal(initial.foam, false)
  assert.equal(initial.lighting.model, 'microfacet')
  assert.equal(initial.outlet, 'north')
  assert(
    responses.some((r) => r.url.includes('.terrain') && r.status === 200),
    'Actual terrain responses required',
  )
  assert(
    responses.some(
      (r) => r.url.includes('wmts.geo.admin.ch') && r.status === 200,
    ),
    'Actual imagery responses required',
  )
  const grid = await page.evaluate(() =>
    structuredClone(window.__floodDynamicLab.getTestContext().grid),
  )
  assert.equal(grid.elevation.length, 4096)
  assert(Math.max(...grid.elevation) - Math.min(...grid.elevation) > 5)
  const checks = []
  for (const time of [30, 60, 120, 300, 600]) {
    await control('seek', time)
    await rendered()
    const value = await state()
    assert(Math.abs(value.metrics.balanceError) < 1e-7)
    assert.equal(value.diagnostics.geometryCreated, 1)
    assert.equal(value.diagnostics.texturesCreated, 2)
    assert.equal(value.diagnostics.surfaceBackend, 'gpu')
    assert.equal(value.error, '')
    checks.push(value)
  }
  assert(checks[0].metrics.frontRow < checks[2].metrics.frontRow)
  assert(checks[4].metrics.dischargedVolume > 0)
  assert(checks[4].metrics.storedVolume < checks[2].metrics.storedVolume)
  await control('seek', 120)
  const hydraulic = await control('getFrame')
  for (const camera of ['near', 'far']) {
    await control('camera', camera)
    await settled()
    await capture('simulation-' + camera)
  }
  // A known horizontal connected stage isolates material lighting from solver surface shape.
  await control('setFrameMode', 'level')
  const beforeLevel = await control('getFrame')
  await control('seek', 200)
  assert.deepEqual(
    await control('getFrame'),
    beforeLevel,
    'Static lighting mode must not advance the solver',
  )
  const parity = []
  for (const camera of ['near', 'far']) {
    await control('camera', camera)
    await settled()
    await control('setBackend', 'gpu')
    await rendered()
    const gpu = await capture('level-' + camera + '-gpu')
    await control('setBackend', 'primitive')
    await rendered()
    const primitive = await capture('level-' + camera + '-primitive')
    const delta = await compare(gpu, primitive)
    assert(delta.meanRgbDifference < 2, JSON.stringify(delta))
    parity.push({ camera, ...delta })
  }
  await control('setBackend', 'gpu')
  assert.deepEqual(await control('getFrame'), beforeLevel)
  assert.deepEqual(
    await page.evaluate(() =>
      structuredClone(window.__floodDynamicLab.getTestContext().grid),
    ),
    grid,
    'Camera LOD must not change the calculation DEM',
  )
  // Hide only the test host's globe while measuring water response, so terrain darkening cannot make the assertion pass.
  await page.evaluate(
    () =>
      (window.__floodDynamicLab.getTestContext().viewer.scene.globe.show = false),
  )
  await control('camera', 'near')
  // Place a test light at the flat surface's mirror direction, ensuring a measurable specular lobe.
  // The real-scene screenshots above retain the fixed SunLight; this is only a controlled radiometric check.
  await page.evaluate(() => {
    const { viewer, layer, grid } = window.__floodDynamicLab.getTestContext(),
      m = layer.modelMatrix
    window.__savedFloodSun = viewer.scene.light
    const seed = grid.elevation.indexOf(Math.min(...grid.elevation)),
      x = ((seed % grid.columns) + 0.5) * grid.cellSize,
      y = (Math.floor(seed / grid.columns) + 0.5) * grid.cellSize,
      z = grid.elevation[seed] + 2
    const p = [
      m[0] * x + m[4] * y + m[8] * z + m[12],
      m[1] * x + m[5] * y + m[9] * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14],
    ]
    const camera = viewer.camera.positionWC,
      v = [camera.x - p[0], camera.y - p[1], camera.z - p[2]],
      length = Math.hypot(...v)
    for (let i = 0; i < 3; i++) v[i] /= length
    const n = [m[8], m[9], m[10]],
      cosine = v.reduce((sum, c, i) => sum + c * n[i], 0),
      L = n.map((c, i) => 2 * cosine * c - v[i])
    viewer.scene.light = {
      direction: { x: -L[0], y: -L[1], z: -L[2] },
      color: viewer.scene.light.color,
      intensity: 0,
    }
  })
  await control('setLighting', {
    environmentIntensity: 0,
    specularIntensity: 1,
    skyEnvironment: false,
    intensity: 0,
  })
  const unlit = await capture('water-direct-zero')
  await control('setLighting', { intensity: 2 })
  const lit = await capture('water-direct-two'),
    directResponse = await compare(unlit, lit)
  console.log('Direct light response', JSON.stringify(directResponse))
  assert(
    directResponse.meanRgbDifference > 0.02,
    'Direct light must respond to the host intensity',
  )
  await control('setLighting', { specularIntensity: 0 })
  const disabled = await capture('water-direct-disabled'),
    directDisabled = await compare(unlit, disabled)
  assert(
    directDisabled.meanRgbDifference < 0.01,
    'Disabled direct light must match zero incident light',
  )
  await page.evaluate(() => {
    const { viewer } = window.__floodDynamicLab.getTestContext()
    viewer.scene.globe.show = true
    viewer.scene.light = window.__savedFloodSun
    delete window.__savedFloodSun
  })
  await control('setLighting', {
    environmentIntensity: 1,
    specularIntensity: 1,
    skyEnvironment: true,
    intensity: 1.5,
    roughness: 0.5,
  })
  await page.waitForFunction(
    () => window.__floodDynamicLab.getState().lighting.environmentAvailable,
  )
  assert.deepEqual(await control('getFrame'), beforeLevel)
  assert.equal(
    (await state()).diagnostics.geometryCreated,
    1,
    'Lighting changes must reuse GPU geometry',
  )
  const toggles = []
  for (let i = 0; i < 3; i++) {
    await control('setLighting', { model: 'legacy' })
    await rendered()
    const legacy = await state()
    await control('setLighting', { model: 'microfacet' })
    await page.waitForFunction(
      () => window.__floodDynamicLab.getState().lighting.environmentAvailable,
    )
    const microfacet = await state()
    assert.equal(microfacet.error, '')
    assert.equal(microfacet.primitiveCount, initial.primitiveCount)
    toggles.push({
      legacy: legacy.primitiveCount,
      microfacet: microfacet.primitiveCount,
    })
  }
  await page.evaluate(async (base) => {
    const { viewer, layer, grid } = window.__floodDynamicLab.getTestContext()
    const { createCesiumFloodLayer } = await import(
      new URL('src/flood/cesium/index.ts', base).href
    )
    const other = createCesiumFloodLayer({
      viewer,
      grid,
      showGround: false,
      surfaceBackend: 'gpu',
      lighting: { model: 'microfacet' },
    })
    other.update({ time: 0, depth: Array(grid.elevation.length).fill(1) })
    await new Promise((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
    )
    other.destroy()
    if (
      window.__floodBorrowedLut.isDestroyed() ||
      layer.environment.brdfTexture !== window.__floodBorrowedLut
    )
      throw Error('Other material destroyed Scene LUT')
  }, base)
  assert.deepEqual(errors, [])
  console.log('Light response and material ownership checks passed')
  await control('setFrameMode', 'simulation')
  await control('seek', 120)
  await control('camera', 'near')
  await settled()
  await capture('final-real-near')
  // Explicit service failure must leave no synthetic/old water under a "real" label.
  expectedFailure = true
  await page.route('**/ch.swisstopo.terrain.3d/v1/layer.json*', (route) =>
    route.fulfill({ status: 503, body: 'Injected terrain failure' }),
  )
  await control('loadEnvironment', 'real')
  const missing = await state()
  assert.match(missing.terrainStatus, /停止生成/)
  assert.equal(missing.diagnostics, undefined)
  await page.unroute('**/ch.swisstopo.terrain.3d/v1/layer.json*')
  expectedFailure = false
  await control('loadEnvironment', 'synthetic')
  await rendered()
  const synthetic = await state()
  assert.equal(synthetic.environment, 'synthetic')
  assert.equal(synthetic.error, '')
  assert.equal(synthetic.diagnostics.surfaceBackend, 'gpu')
  await page.evaluate(() => {
    if (window.__floodBorrowedLut.isDestroyed())
      throw Error('Environment switch destroyed shared LUT')
    delete window.__floodBorrowedLut
  })
  await control('dispose', true)
  await control('recreate')
  await rendered()
  assert.equal((await state()).error, '')
  report = {
    passed: true,
    browser: browser.version(),
    initial,
    checks,
    parity,
    directResponse,
    directDisabled,
    toggles,
    missing,
    sampledGrid: {
      origin: grid.origin,
      columns: grid.columns,
      rows: grid.rows,
      cellSize: grid.cellSize,
      minimum: Math.min(...grid.elevation),
      maximum: Math.max(...grid.elevation),
    },
    terrainResponses: responses.filter(
      (r) => r.url.includes('.terrain') && r.status === 200,
    ).length,
    imageryResponses: responses.filter(
      (r) => r.url.includes('wmts') && r.status === 200,
    ).length,
    errors,
    failures,
    limits: [
      'Hypothetical discharge; no surveyed bathymetry, hydrometric calibration or engineering prediction',
      'Provider-height display space, vertical datum not calibrated against observed water levels',
      'Atmospheric reflection only; no terrain/building reflection, refraction or volumetric flood scattering',
      '8 m DEM surface can differ from camera terrain LOD; no depth-test bypass',
    ],
  }
  console.log(
    JSON.stringify({
      passed: true,
      directResponse,
      directDisabled,
      parity,
      toggles,
      terrainResponses: report.terrainResponses,
      imageryResponses: report.imageryResponses,
    }),
  )
} catch (error) {
  report = {
    ...report,
    error: String(error),
    state: await state().catch(() => null),
    errors,
    failures,
    responses: responses.slice(-10),
  }
  throw error
} finally {
  await fs.writeFile(
    path.join(output, 'report.json'),
    JSON.stringify(report, null, 2),
  )
  await context.close()
  await browser.close()
}
