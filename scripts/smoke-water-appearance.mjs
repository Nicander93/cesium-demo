import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
const { chromium } = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href)
  : await import('playwright')
const output = path.resolve('test-results/water-flow-lab/tunable-water')
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
  checks = [],
  comparisons = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (e) => {
  if (e.type() === 'error') errors.push(e.text())
})
const state = () => page.evaluate(() => window.__realWaterLab.getState())
const control = (method, value) =>
  page.evaluate(
    ([method, value]) => window.__realWaterLab[method](value),
    [method, value],
  )
async function freezeAt(time = 15) {
  await control('freeze')
  await control('setTime', time)
  await page.waitForTimeout(250)
}
async function compare(a, b) {
  return page.evaluate(
    async ([a, b]) => {
      async function decode(data) {
        const image = new Image()
        image.src = 'data:image/png;base64,' + data
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(image, 0, 0)
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data
      }
      const x = await decode(a),
        y = await decode(b)
      let sum = 0,
        changed = 0
      for (let i = 0; i < x.length; i += 4) {
        const d =
          (Math.abs(x[i] - y[i]) +
            Math.abs(x[i + 1] - y[i + 1]) +
            Math.abs(x[i + 2] - y[i + 2])) /
          3
        sum += d
        if (d > 10) changed++
      }
      return {
        meanRgbDifference: sum / (x.length / 4),
        changedOver10: changed / (x.length / 4),
      }
    },
    [a.toString('base64'), b.toString('base64')],
  )
}
async function settledImage(clip) {
  let previous = await page.screenshot({ clip }),
    stable = 0
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(500)
    const current = await page.screenshot({ clip }),
      noise = await compare(previous, current)
    stable = noise.meanRgbDifference < 0.05 ? stable + 1 : 0
    if (stable >= 2) return current
    previous = current
  }
  throw new Error(
    'Frozen water image did not settle; terrain/reflection changes prevent an animation comparison',
  )
}
async function settledCamera() {
  let previous = (await state()).cameraPosition,
    stable = 0
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(500)
    const current = (await state()).cameraPosition
    const distance = Math.hypot(
      current.x - previous.x,
      current.y - previous.y,
      current.z - previous.z,
    )
    stable = distance < 0.01 ? stable + 1 : 0
    if (stable >= 3) return current
    previous = current
  }
  throw new Error('Main camera did not settle after terrain loading')
}
let report
try {
  await page.goto(
    (process.env.WATER_FLOW_BASE_URL ?? 'http://127.0.0.1:5198/cesium-demo/') +
      'water-real-terrain',
  )
  await page.waitForFunction(
    () => {
      const s = window.__realWaterLab?.getState()
      return s?.hasWater && s.diagnostics?.reflectionAvailable && s.tilesLoaded
    },
    null,
    { timeout: 90000 },
  )
  const initial = await state()
  assert.equal(initial.error, '')
  assert.equal(initial.options.waveModel, 'multiscale')
  assert.equal(initial.options.reflectGlobe, true)
  const geometryCount = initial.diagnostics.geometryCreated
  for (const camera of ['near', 'overview', 'far']) {
    await control('focus', camera)
    // Load the main camera independently of the reflected globe's competing LOD requests.
    await control('setOptions', { reflection: false })
    await page.waitForFunction(
      () => window.__realWaterLab.getState().tilesLoaded,
      null,
      { timeout: 90000 },
    )
    await control('setOptions', { reflection: true })
    await page.waitForTimeout(500)
    const cameraPosition = await settledCamera()
    const clip = await page.evaluate(() =>
      window.__realWaterLab.getWaterBounds(),
    )
    assert(
      clip && clip.width > 10 && clip.height > 10,
      'Projected water region must be visible',
    )
    const images = {}
    for (const mode of ['imagery', 'current', 'enhanced']) {
      await control('setMode', mode)
      await freezeAt()
      images[mode] = await settledImage(clip)
      await page.screenshot({
        path: path.join(output, camera + '-' + mode + '.png'),
      })
      assert.equal((await state()).diagnostics.geometryCreated, geometryCount)
    }
    const appearance = await compare(images.current, images.enhanced)
    assert(
      appearance.meanRgbDifference > 1,
      'Enhanced water must differ in the projected region',
    )
    await page.waitForTimeout(1000)
    const baseline = await page.screenshot({ clip })
    const frozenNoise = await compare(images.enhanced, baseline)
    await freezeAt(17)
    const moving = await page.screenshot({ clip })
    const animation = await compare(images.enhanced, moving)
    assert(
      animation.meanRgbDifference >
        Math.max(0.02, frozenNoise.meanRgbDifference * 1.2),
      'Waves must remain visible in actual pixels, including far view',
    )
    comparisons.push({
      camera,
      clip,
      appearance,
      animation,
      frozenNoise,
      reflectionAvailable: (await state()).diagnostics.reflectionAvailable,
      fps: (await state()).fps,
      cameraPosition,
    })
  }
  await control('focus', 'near')
  await freezeAt()
  const clip = await page.evaluate(() => window.__realWaterLab.getWaterBounds())
  await control('setOptions', { waveStrength: 0, detailStrength: 0 })
  await freezeAt()
  const flat = await page.screenshot({ clip })
  await control('setOptions', { waveStrength: 1.5, detailStrength: 0.7 })
  await freezeAt()
  const waves = await page.screenshot({ clip })
  const response = await compare(flat, waves)
  assert(response.meanRgbDifference > 0.5)
  checks.push({ check: 'wave controls change actual pixels', ...response })
  const length = page.getByLabel(/主波长/)
  assert.equal(await length.evaluate((element) => element.tagName), 'INPUT')
  await length.focus()
  await length.press('End')
  await page.waitForFunction(
    () => window.__realWaterLab.getState().options.waveLength === 160,
  )
  assert.equal((await state()).options.waveLength, 160)
  checks.push({
    check: 'native slider keyboard updates the public API',
    passed: true,
  })
  await page.getByLabel('默认预设').selectOption('windy-lake')
  assert.equal((await state()).options.waveLength, 28)
  await page.getByRole('button', { name: '恢复预设', exact: true }).click()
  assert.equal((await state()).options.waveStrength, 1.5)
  await control('setPreset', 'calm-lake')
  assert.equal((await state()).options.waveLength, 48)
  checks.push({ check: 'editable presets and restore', passed: true })
  await page.getByLabel('反射质量').selectOption('low')
  await page.waitForTimeout(500)
  assert.equal((await state()).options.reflectionMaxSize, 512)
  await page.getByLabel('反射质量').selectOption('high')
  await page.waitForTimeout(500)
  assert.equal((await state()).options.reflectionMaxSize, 1536)
  await control('setPreset', 'calm-lake')
  const geometryAfter = (await state()).diagnostics.geometryCreated
  assert.equal(geometryAfter, geometryCount)
  checks.push({
    check: 'quality changes target budget without rebuilding water geometry',
    passed: true,
  })
  const assembled = (await state()).shaderSource
  const names = [...assembled.matchAll(/uniform\s+\w+\s+(\w+)/g)].map(
    (x) => x[1],
  )
  assert(names.length > 20)
  assert.equal(names.length, new Set(names).size)
  await fs.writeFile(path.join(output, 'assembled-fragment.glsl'), assembled)
  await control('focus', 'near')
  await control('setOptions', { waveSpeed: 0.7 })
  const start = (await state()).visualTime
  for (let i = 0; i < 16; i++) {
    if (i === 5) await control('focus', 'overview')
    if (i === 10) await control('focus', 'far')
    if (i === 6 || i === 11) {
      await page.mouse.move(950, 440)
      await page.mouse.down()
      await page.mouse.move(1070, 470, { steps: 24 })
      await page.mouse.up()
    }
    await page.waitForTimeout(1000)
  }
  const final = await state()
  assert(final.visualTime > start + 9)
  assert.equal(final.error, '')
  assert.equal(final.diagnostics.reflectionAvailable, true)
  assert.deepEqual(errors, [])
  delete final.shaderSource
  report = {
    passed: true,
    browser: browser.version(),
    comparisons,
    checks,
    finalState: final,
    errors,
    assembledUniformCount: names.length,
    limits: [
      'Pixel differences prove a visible response, not final artistic acceptance',
      'Planar reflection is tested only on this local water plane and Cesium 1.132',
      'FPS is observed main-view rate during recorded dev-browser testing, not GPU timing',
    ],
  }
} catch (error) {
  report = {
    passed: false,
    error: String(error),
    errors,
    checks,
    comparisons,
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
  console.log(JSON.stringify(report, null, 2))
}
