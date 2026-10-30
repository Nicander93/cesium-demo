import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const { chromium } = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href)
  : await import('playwright')
const output = path.resolve(
  process.env.ENVIRONMENT_OUTPUT ?? 'test-results/environment-interaction',
)
const base =
  process.env.ENVIRONMENT_BASE_URL ?? 'http://127.0.0.1:5174/cesium-demo/'
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
    : {}),
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
})
const report = {
  passed: false,
  errors: [],
  samples: [],
  requests: [],
  performanceFailures: [],
}
const percentile = (values, p) =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * p))
  ] ?? 0
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    hasTouch: true,
  })
  page.on('pageerror', (error) => report.errors.push(String(error)))
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /shader|DeveloperError|RuntimeError/i.test(message.text())
    )
      report.errors.push(message.text().slice(0, 1000))
  })
  page.on('request', (request) => report.requests.push(request.url()))
  await page.addInitScript(() => {
    window.__envProbe = { active: false, frames: [], input: [], longTasks: [] }
    let previous
    function frame(now) {
      const probe = window.__envProbe
      if (probe.active && previous !== undefined)
        probe.frames.push(now - previous)
      previous = probe.active ? now : undefined
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
    addEventListener(
      'pointermove',
      () => {
        if (!window.__envProbe.active) return
        const start = performance.now()
        requestAnimationFrame(() =>
          window.__envProbe.input.push(performance.now() - start),
        )
      },
      { passive: true },
    )
    new PerformanceObserver((list) => {
      if (window.__envProbe.active)
        window.__envProbe.longTasks.push(
          ...list.getEntries().map((v) => v.duration),
        )
    }).observe({ type: 'longtask' })
  })
  const ready = async () => {
    await page.waitForFunction(
      () => {
        const s = window.__environmentDemo?.getState()
        return s?.environment.ready && !s.environment.pending && !s.loading
      },
      null,
      { timeout: 60000 },
    )
    const state = await page.evaluate(() => window.__environmentDemo.getState())
    assert.equal(state.error, '')
    assert.equal(state.environment.error, '')
    assert.equal(state.primitiveCount, 1)
    assert.equal(state.postProcessCount, 1)
    assert.equal(state.depthPickingEnabled, false)
    if (state.scene === 'city') {
      assert.equal(state.loadedModels, 25)
      assert.equal(state.environment.attachedModels, 25)
      assert.equal(state.source, null)
    } else {
      assert.equal(state.source.ready, true)
      assert.equal(state.source.error, '')
      assert.equal(state.environment.attachedModels, 0)
      assert.equal(
        state.source.kind,
        state.scene === 'reservoir' ? 'terrain' : 'tileset',
      )
      assert(Number.isFinite(state.source.waterBaseHeight))
      if (state.scene === 'flood') {
        assert(state.source.loadedTiles > 0)
        assert(
          state.source.waterBaseHeight > -100 &&
            state.source.waterBaseHeight < 500,
        )
      }
    }
    return state
  }
  const started = Date.now()
  await page.goto(base + 'environment-lab?scene=city&weather=day', {
    waitUntil: 'domcontentloaded',
  })
  await ready()
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  )
  report.readyMs = Date.now() - started
  report.gpu = await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2')
    const debug = gl?.getExtension('WEBGL_debug_renderer_info')
    return debug
      ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
      : 'unavailable'
  })

  const measure = async (scene, weather, interaction = 'idle') => {
    await page.evaluate(
      async ({ scene, weather }) => {
        if (window.__environmentDemo.getState().scene !== scene)
          await window.__environmentDemo.setScene(scene)
        window.__environmentDemo.setView('overview')
        await window.__environmentDemo.setWeather(weather)
      },
      { scene, weather },
    )
    await ready()
    // Public mesh/terrain refinement belongs to data loading, measured separately from steady interaction.
    await page.waitForTimeout(scene === 'city' ? 1200 : 5000)
    const before = await page.evaluate(() =>
      window.__environmentDemo.getState(),
    )
    await page.evaluate(() =>
      Object.assign(window.__envProbe, {
        active: true,
        frames: [],
        input: [],
        longTasks: [],
      }),
    )
    if (interaction === 'mouse') {
      await page.mouse.move(650, 650)
      await page.mouse.down({ button: 'middle' })
      for (let step = 0; step < 30; step++) {
        await page.mouse.move(
          650 + Math.sin(step / 9) * 85,
          650 - Math.sin(step / 15) * 55,
          { steps: 2 },
        )
      }
      await page.mouse.up({ button: 'middle' })
    } else if (interaction === 'touch') {
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: 170, y: 440, id: 1 }],
      })
      for (let step = 0; step < 25; step++)
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [
            { x: 170 + step * 3, y: 440 + Math.sin(step / 8) * 30, id: 1 },
          ],
        })
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      })
      await cdp.detach()
    }
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          let count = 0
          function next() {
            if (++count === 75) resolve()
            else requestAnimationFrame(next)
          }
          requestAnimationFrame(next)
        }),
    )
    const probe = await page.evaluate(() => {
      window.__envProbe.active = false
      return window.__envProbe
    })
    const after = await ready()
    const record = {
      scene,
      weather,
      interaction,
      buffer: after.buffer,
      source: after.source,
      frameCount: probe.frames.length,
      medianMs: percentile(probe.frames, 0.5),
      p95Ms: percentile(probe.frames, 0.95),
      maxMs: Math.max(...probe.frames),
      over50: probe.frames.filter((v) => v > 50).length,
      inputP95Ms: percentile(probe.input, 0.95),
      longTasks: probe.longTasks,
      cameraMoved:
        JSON.stringify(before.cameraPose) !== JSON.stringify(after.cameraPose),
    }
    assert(record.frameCount >= 60)
    if (interaction !== 'idle')
      assert(record.cameraMoved, 'The actual Cesium camera must respond')
    const [width, height] = after.buffer.match(/\d+/g).map(Number)
    assert(width * height <= 1920 * 1080 + 5000)
    if (record.medianMs > 20 || record.p95Ms > 25 || record.over50 > 0)
      report.performanceFailures.push(record)
    report.samples.push(record)
    console.log(JSON.stringify(record))
  }
  for (const scene of ['city', 'reservoir', 'flood'])
    for (const weather of ['day', 'sunset', 'rain']) {
      await measure(scene, weather, weather === 'day' ? 'mouse' : 'idle')
    }
  const assetsBefore = report.requests.filter((url) =>
    url.includes('/environment-lab/'),
  ).length
  await page.evaluate(() =>
    window.__environmentDemo.setOptions({
      exposure: 1.1,
      fog: 0.4,
      skyRotation: 40,
      rain: 0.3,
    }),
  )
  await page.waitForTimeout(200)
  assert.equal(
    report.requests.filter((url) => url.includes('/environment-lab/')).length,
    assetsBefore,
    'Sliders must not reload environment assets',
  )
  await page.setViewportSize({ width: 3840, height: 2160 })
  await measure('reservoir', 'sunset', 'mouse')
  await page.getByRole('button', { name: '大屏构图', exact: true }).click()
  await page.setViewportSize({ width: 600, height: 900 })
  await measure('city', 'rain', 'touch')
  await page.evaluate(async () => {
    await Promise.all([
      window.__environmentDemo.setScene('city'),
      window.__environmentDemo.setScene('reservoir'),
      window.__environmentDemo.setScene('flood'),
    ])
    await Promise.all([
      window.__environmentDemo.setWeather('day'),
      window.__environmentDemo.setWeather('sunset'),
      window.__environmentDemo.setWeather('rain'),
    ])
  })
  const final = await ready()
  assert.equal(final.scene, 'flood')
  assert.equal(final.environment.preset, 'rain')
  assert(
    !report.requests.some(
      (url) => url.includes('clouds-assets/') || url.includes('cloud-shader'),
    ),
    'This demo must not invoke the volume-cloud pipeline',
  )
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(400)
  assert.equal(
    await page.locator('.cesium-widget canvas').count(),
    0,
    'Leaving the page must destroy its Viewer',
  )
  assert.equal(
    await page.evaluate(() => typeof window.__environmentDemo),
    'undefined',
  )
  assert.deepEqual(report.errors, [])
  assert.deepEqual(
    report.performanceFailures,
    [],
    'Interaction frame budget exceeded; see the complete report',
  )
  report.passed = true
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await fs.writeFile(
    path.join(output, 'report.json'),
    JSON.stringify(report, null, 2),
  )
  await browser.close()
}
