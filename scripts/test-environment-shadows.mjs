import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const { chromium } = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href)
  : await import('playwright')
const base =
  process.env.ENVIRONMENT_BASE_URL ?? 'http://127.0.0.1:5174/cesium-demo/'
const output = path.resolve(
  process.env.ENVIRONMENT_OUTPUT ?? 'test-results/environment-shadows',
)
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
    : {}),
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
})
const report = { passed: false, errors: [], cases: [] }
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  })
  page.on('pageerror', (error) => report.errors.push(String(error)))
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async (base) => {
    const { createEnvironmentDemo } = await import(
      new URL('src/views/environment-lab/runtime.ts', base).href
    )
    const cesiumUrl = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((url) => /(?:^|\/)cesium\.js$/i.test(new URL(url).pathname))
    const C = await import(cesiumUrl)
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;inset:0;z-index:999'
    document.body.append(host)
    const demo = createEnvironmentDemo(host, () => {})
    window.__shadowRegression = { demo, C, host }
    await Promise.all([demo.loadScene('city'), demo.setWeather('day')])
  }, base)
  for (const weather of ['day', 'sunset']) {
    await page.evaluate(
      (weather) => window.__shadowRegression.demo.setWeather(weather),
      weather,
    )
    for (const range of [650, 1100, 1400]) {
      await page.evaluate((range) => {
        const { demo, C } = window.__shadowRegression
        demo.viewer.camera.lookAt(
          C.Cartesian3.fromDegrees(119.0317, 33.5921, 65),
          new C.HeadingPitchRange(C.Math.toRadians(15), -0.7, range),
        )
        demo.viewer.camera.lookAtTransform(C.Matrix4.IDENTITY)
      }, range)
      await page.waitForTimeout(600)
      const frames = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const frames = []
            let previous
            function next(now) {
              if (previous !== undefined) frames.push(now - previous)
              previous = now
              if (frames.length < 90) requestAnimationFrame(next)
              else resolve(frames)
            }
            requestAnimationFrame(next)
          }),
      )
      const state = await page.evaluate(() => {
        const { demo } = window.__shadowRegression
        const scene = demo.viewer.scene,
          shadows = scene._frameState.shadowState
        return {
          near: shadows.nearPlane,
          far: shadows.farPlane,
          shadowSize: scene.shadowMap.size,
          castCommands: scene.shadowMap._passes.reduce(
            (sum, pass) => sum + pass.commandList.length,
            0,
          ),
          shadowEnabled: scene.shadowMap.enabled,
          glError: scene.context._gl.getError(),
          sceneError: demo.getState().error,
        }
      })
      frames.sort((a, b) => a - b)
      const sample = {
        weather,
        range,
        ...state,
        p95Ms: frames[Math.floor(frames.length * 0.95)],
        maxMs: Math.max(...frames),
      }
      report.cases.push(sample)
      assert.equal(state.sceneError, '')
      assert.equal(state.glError, 0)
      assert(
        state.shadowEnabled && state.castCommands > 0,
        'Buildings must still cast real shadows',
      )
      assert(
        state.near > 1 && state.far < 3000,
        'Distant background must not consume the city receiver depth range',
      )
      assert(
        sample.p95Ms <= 25 && sample.maxMs <= 50,
        'City shadow interaction exceeded frame budget',
      )
      if (range === 650 || range === 1100)
        await page.screenshot({
          path: path.join(output, `${weather}-${range}.png`),
        })
    }
  }
  await page.evaluate(() => {
    const { demo, host } = window.__shadowRegression
    demo.dispose()
    host.remove()
  })
  assert.deepEqual(report.errors, [])
  report.passed = true
  console.log(JSON.stringify(report))
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
