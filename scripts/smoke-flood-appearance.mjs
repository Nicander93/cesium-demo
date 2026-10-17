import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
const { chromium } = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href)
  : await import('playwright')
const base =
  process.env.WATER_FLOW_BASE_URL ?? 'http://127.0.0.1:5198/cesium-demo/'
const output = path.resolve('test-results/flood-dynamic/appearance')
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
    : {}),
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
})
const errors = [],
  images = {},
  report = { passed: false }
page.on('pageerror', (e) => errors.push(String(e)))
await page.route('**/font-awesome/**', (r) =>
  r.fulfill({ status: 200, contentType: 'text/css', body: '' }),
)
const call = (method, value) =>
  page.evaluate(([m, v]) => window.__floodDynamicLab[m](v), [method, value])
const state = () => call('getState')
async function rendered() {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
      ),
  )
}
async function capture(name) {
  await rendered()
  const buffer = await page.screenshot({
    path: path.join(output, name + '.png'),
    clip: { x: 360, y: 0, width: 1080, height: 880 },
  })
  return (images[name] = buffer.toString('base64'))
}
async function difference(first, second) {
  return page.evaluate(
    async ([first, second]) => {
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
      const a = await decode(first),
        b = await decode(second)
      let sum = 0,
        changed = 0,
        changedOver2 = 0
      for (let i = 0; i < a.length; i += 4) {
        const d =
          (Math.abs(a[i] - b[i]) +
            Math.abs(a[i + 1] - b[i + 1]) +
            Math.abs(a[i + 2] - b[i + 2])) /
          3
        sum += d
        if (d > 10) changed++
        if (d > 2) changedOver2++
      }
      return {
        meanRgbDifference: sum / (a.length / 4),
        changedOver10: changed / (a.length / 4),
        changedOver2: changedOver2 / (a.length / 4),
      }
    },
    [first, second],
  )
}
const counters = (s) =>
  Object.fromEntries(
    [
      'geometryCreated',
      'texturesCreated',
      'textureUploads',
      'shaderChanges',
      'surfaceUpdates',
      'legacyMeshBuilds',
    ].map((k) => [k, s.diagnostics[k]]),
  )
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
  await call('seek', 120)
  const hydraulicFrame = await call('getFrame'),
    initial = await state(),
    muddy = initial.appearance
  assert.equal(muddy.shallowColor, '#a18758')
  report.views = {}
  for (const view of ['near', 'far']) {
    await call('camera', view)
    await page.waitForFunction(
      () => window.__floodDynamicLab.getState().tilesLoaded,
      null,
      { timeout: 60000 },
    )
    await rendered()
    const before = await state()
    const brown = await capture(view + '-muddy')
    await call('setAppearance', {
      shallowColor: '#287a85',
      deepColor: '#062b46',
      colorDepth: 3,
    })
    const blue = await capture(view + '-blue')
    await call('setAppearance', { opacity: 0 })
    const hidden = await capture(view + '-hidden')
    const color = await difference(brown, blue),
      opacity = await difference(blue, hidden)
    console.log(view, { color, opacity })
    assert(color.changedOver2 > 0.001, view + ' color must visibly change')
    assert(opacity.changedOver2 > 0.001, view + ' opacity must visibly change')
    assert.deepEqual(
      counters(await state()),
      counters(before),
      'Uniform changes must not upload geometry/state',
    )
    assert.deepEqual(await call('getFrame'), hydraulicFrame)
    await call('restoreAppearance')
    assert.deepEqual((await state()).appearance, muddy)
    report.views[view] = { color, opacity }
  }
  await page.getByLabel('浅水颜色', { exact: true }).fill('#9b7045')
  assert.equal((await state()).appearance.shallowColor, '#9b7045')
  await page.getByLabel(/^细波强度/).fill('0')
  assert.equal((await state()).appearance.waveStrength, 0)
  await page.getByRole('button', { name: '恢复黄褐浑水外观' }).click()
  assert.deepEqual((await state()).appearance, muddy)
  const rollback = await page.evaluate(() => {
    const { layer } = window.__floodDynamicLab.getTestContext(),
      old = layer.getAppearanceOptions()
    let rejected = false
    try {
      layer.setAppearanceOptions({ shallowColor: '#ffffff', opacity: NaN })
    } catch {
      rejected = true
    }
    const copy = layer.getAppearanceOptions()
    copy.deepColor = '#ffffff'
    return { rejected, old, current: layer.getAppearanceOptions() }
  })
  assert(rollback.rejected)
  assert.deepEqual(rollback.old, rollback.current)
  for (const backend of ['primitive', 'gpu']) {
    await call('setBackend', backend)
    await rendered()
    await call('setDepthMode', true)
    await rendered()
    const diagnostic = await capture(backend + '-depth')
    await call('setAppearance', {
      opacity: 0,
      shallowColor: '#ffffff',
      waveStrength: 0,
      flowStrength: 0,
    })
    assert(
      (await difference(diagnostic, await capture(backend + '-depth-hidden')))
        .meanRgbDifference < 0.2,
      'Diagnostic colors must be independent',
    )
    await call('setDepthMode', false)
    await call('restoreAppearance')
    await rendered()
    const before = await state()
    const visible = await capture(backend + '-water')
    await call('setAppearance', { opacity: 0 })
    assert(
      (await difference(visible, await capture(backend + '-water-hidden')))
        .changedOver2 > 0.001,
    )
    assert.deepEqual(counters(await state()), counters(before))
    await call('restoreAppearance')
  }
  await call('setVisuals', { foam: false, particles: true })
  const particles = await page.evaluate(() => {
    const { layer } = window.__floodDynamicLab.getTestContext()
    for (let i = 0; i < 12; i++) layer.animate(120 + i * 0.25)
    const count = layer.pointPool.filter(
      (item) => item.point.show && item.color.alpha > 0,
    ).length
    const before = layer.pointPool.map((item) => item.color.alpha)
    layer.setVisualOptions({ foamIntensity: 0 })
    layer.animate(122.75)
    return {
      show: layer.points.show,
      count,
      before,
      after: layer.pointPool.map((item) => item.color.alpha),
    }
  })
  assert(
    particles.show && particles.count > 0,
    'Particles must remain visible with foam disabled',
  )
  assert.deepEqual(
    particles.before,
    particles.after,
    'Foam intensity must not dim particles',
  )
  assert.deepEqual(await call('getFrame'), hydraulicFrame)
  assert.deepEqual((await state()).metrics, initial.metrics)
  await call('setVisuals', { particles: false })
  await call('camera', 'near')
  await capture('final-near')
  await call('camera', 'far')
  await capture('final-far')
  assert.equal((await state()).error, '')
  assert.deepEqual(errors, [])
  report.particles = { show: particles.show, count: particles.count }
  report.final = await state()
  report.passed = true
} catch (error) {
  report.error = String(error)
  report.stack = error.stack
  report.state = await state().catch(() => null)
  await page
    .screenshot({ path: path.join(output, 'failure.png') })
    .catch(() => {})
  process.exitCode = 1
} finally {
  report.errors = errors
  await fs.writeFile(
    path.join(output, 'report.json'),
    JSON.stringify(report, null, 2),
  )
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
}
