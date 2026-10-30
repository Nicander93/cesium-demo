import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const { chromium } = await import(
  pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href
)
const base = (
  process.env.ENVIRONMENT_BASE_URL ?? 'http://127.0.0.1:5174/cesium-demo/'
).replace(/\/?$/, '/')
const out =
  process.env.ENVIRONMENT_OUTPUT ?? 'test-results/environment-real-scenes'
await fs.mkdir(out, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
})
const report = { passed: false, errors: [], checks: [] }
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  })
  page.on('pageerror', (error) => report.errors.push(String(error)))
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() =>
    Boolean(document.getElementById('app').__vue_app__),
  )
  const before = await page.evaluate(async (base) => {
    const router =
      document.getElementById('app').__vue_app__.config.globalProperties.$router
    const resource = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .find((url) => /(?:^|\/)cesium\.js$/i.test(new URL(url).pathname))
    const C = await import(resource)
    window.__realSceneProbe = { router, C }
    const { createRealScene } = await import(
      new URL('src/views/environment-lab/real-scenes.ts', base).href
    )
    const fixtureHost = document.createElement('div')
    fixtureHost.style.cssText = 'position:fixed;width:64px;height:64px'
    document.body.append(fixtureHost)
    const viewer = new C.Viewer(fixtureHost, {
      baseLayer: false,
      animation: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      useDefaultRenderLoop: false,
      terrainProvider: new C.EllipsoidTerrainProvider(),
    })
    let undergroundColorProbe
    try {
      const inputColor = new C.Color(0.23, 0.34, 0.45, 0.76)
      const colorValues = (color) => [
        color.red,
        color.green,
        color.blue,
        color.alpha,
      ]
      viewer.scene.globe.undergroundColor = inputColor
      const originalColor = viewer.scene.globe.undergroundColor
      const originalValues = colorValues(originalColor)
      const environment = {
        getState: () => ({ preset: 'day' }),
        subscribe: () => () => {},
        getAnchor: () => new C.Cartesian3(1, 2, 3),
        setAnchor: () => {},
      }
      const scene = createRealScene({
        viewer,
        environment,
        kind: 'flood',
        collection: viewer.scene.primitives,
        onChange: () => {},
      })
      scene.ready.catch(() => {})
      const activeValues = colorValues(viewer.scene.globe.undergroundColor)
      scene.dispose()
      const restoredColor = viewer.scene.globe.undergroundColor
      const restoredValues = colorValues(restoredColor)
      scene.dispose()
      const repeatedDisposeValues = colorValues(
        viewer.scene.globe.undergroundColor,
      )
      const inputValues = colorValues(inputColor)
      const sameValues = (left, right) =>
        left.every((value, index) => Math.abs(value - right[index]) < 1e-7)
      if (
        !sameValues(activeValues, [0, 0, 0, 0]) ||
        !sameValues(restoredValues, originalValues) ||
        !sameValues(repeatedDisposeValues, originalValues) ||
        !sameValues(inputValues, originalValues) ||
        restoredColor !== originalColor
      ) {
        throw new Error('Real-scene underground color restoration failed')
      }
      undergroundColorProbe = { activeValues, restoredValues, inputValues }
    } finally {
      if (!viewer.isDestroyed()) viewer.destroy()
      fixtureHost.remove()
    }
    return {
      serverLimits: { ...C.RequestScheduler.requestsByServer },
      undergroundColorProbe,
    }
  }, base)
  report.undergroundColorProbe = before.undergroundColorProbe
  report.checks.push(
    'Real-scene underground color is transparent while active and fully restored on dispose',
  )
  await page.evaluate(() =>
    window.__realSceneProbe.router.push(
      '/environment-lab?scene=city&weather=day&fog=0.32&water=13',
    ),
  )
  const ready = async () => {
    await page.waitForFunction(
      () => {
        const s = window.__environmentDemo?.getState()
        return Boolean(
          s?.error ||
            s?.environment.error ||
            (s?.environment.ready && !s.environment.pending && !s.loading),
        )
      },
      null,
      { timeout: 90000 },
    )
    const state = await page.evaluate(() => window.__environmentDemo.getState())
    assert.equal(state.error, '')
    assert.equal(state.environment.error, '')
    return state
  }
  let state = await ready()
  assert.equal(state.environment.options.fog, 0.16)
  assert.equal(state.globeVisible, false)
  assert.equal(state.imageryLayerCount, 0)
  report.checks.push(
    'Legacy sunny link migrates to calibrated fog; city owns no real-data layers',
  )
  await page.evaluate(() => window.__environmentDemo.setScene('reservoir'))
  state = await ready()
  assert.equal(state.source.kind, 'terrain')
  assert.equal(state.source.ready, true)
  assert(Number.isFinite(state.source.waterBaseHeight))
  assert.equal(state.imageryLayerCount, 1)
  assert.equal(state.globeVisible, true)
  await page.evaluate(() => window.__environmentDemo.setWaterLevel(5.5))
  state = await ready()
  assert.equal(state.source.waterOffset, 5.5)
  assert.equal(state.source.waterHeight, state.source.waterBaseHeight + 5.5)
  await page.evaluate(() => window.__environmentDemo.setWaterLevel(-20))
  assert.equal((await ready()).source.waterOffset, 0)
  await page.evaluate(() => window.__environmentDemo.setWaterLevel(200))
  assert.equal((await ready()).source.waterOffset, 20)
  report.checks.push(
    'Official terrain and shoreline load; relative water height is finite and bounded',
  )
  await page.evaluate(async () => {
    await Promise.all([
      window.__environmentDemo.setScene('flood'),
      window.__environmentDemo.setScene('city'),
    ])
  })
  state = await ready()
  assert.equal(state.scene, 'city')
  assert.equal(state.source, null)
  assert.equal(state.globeVisible, false)
  assert.equal(state.imageryLayerCount, 0)
  assert.equal(state.environment.attachedModels, 25)
  report.checks.push(
    'Cancelled terrain/tileset loading cannot retain imagery, hide city models, or overwrite the new scene',
  )
  await page.evaluate(() => window.__environmentDemo.setScene('flood'))
  state = await ready()
  assert.equal(state.source.kind, 'tileset')
  assert(state.source.loadedTiles > 0)
  assert(Number.isFinite(state.source.waterBaseHeight))
  assert.equal(state.source.waterOffset, 0)
  report.model = state.source
  report.checks.push(
    'Public oblique mesh is visible before ready; its explicit display water reference is finite',
  )
  await page.route('**/missing-real-tiles.json', (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
  )
  await page.evaluate(
    (base) =>
      window.__environmentDemo.setTilesetUrl(
        new URL('missing-real-tiles.json', base).href,
      ),
    base,
  )
  await page.waitForFunction(() => {
    const s = window.__environmentDemo?.getState()
    return s && !s.loading && Boolean(s.error)
  })
  state = await page.evaluate(() => window.__environmentDemo.getState())
  assert.equal(state.source.ready, false)
  assert.equal(state.source.loadedTiles, 0)
  assert.equal(state.source.waterBaseHeight, null)
  assert.equal(
    await page.getByLabel('演示水位', { exact: true }).isDisabled(),
    true,
  )
  report.checks.push(
    'An unavailable custom tileset reports an error and disables water without substituting fake geometry',
  )
  await page.evaluate(() => window.__realSceneProbe.router.push('/'))
  await page.waitForTimeout(300)
  assert.equal(await page.locator('.cesium-widget canvas').count(), 0)
  assert.equal(
    await page.evaluate(() => typeof window.__environmentDemo),
    'undefined',
  )
  assert.deepEqual(
    await page.evaluate(() => ({
      ...window.__realSceneProbe.C.RequestScheduler.requestsByServer,
    })),
    before.serverLimits,
  )
  assert.deepEqual(report.errors, [])
  report.checks.push(
    'SPA unmount destroys the Viewer and restores per-server request limits',
  )
  report.passed = true
  console.log(JSON.stringify(report))
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await fs.writeFile(
    path.join(out, 'report.json'),
    JSON.stringify(report, null, 2),
  )
  await browser.close()
}
