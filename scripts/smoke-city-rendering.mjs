import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const { chromium } = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href)
  : await import('playwright')
const base = process.env.CITY_BASE_URL ?? 'http://127.0.0.1:5174/cesium-demo/'
const output = path.resolve('test-results/city-rendering-recovery')
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = [], checks = [], resources = []
page.on('pageerror', error => errors.push(String(error)))
page.on('response', response => {
  if (/studio-(sh\.json|specular\.ktx2)/.test(response.url())) resources.push({ url: response.url(), status: response.status() })
})
let report
try {
  await page.goto(base + 'city-rendering', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelector('.city-lab__status')?.textContent.includes('65/65'), null, { timeout: 90000 })
  assert.deepEqual(await page.locator('.city-lab__error').allTextContents(), [], 'City startup must render without shader errors')
  await page.waitForFunction(() => document.querySelector('.city-lab__status')?.textContent.includes('体积云已就绪'), null, { timeout: 90000 })
  await page.evaluate(async modulePath => {
    const loadedUrl = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === modulePath)?.name ?? modulePath
    const { SceneCapture } = await import(loadedUrl)
    const original = SceneCapture.prototype.render
    const probe = window.__cityRenderProbe = { frames: 0, reflectionDraws: 0, errors: [] }
    SceneCapture.prototype.render = function (...args) {
      const result = original.apply(this, args)
      if (!probe.scene) {
        probe.scene = this.scene
        this.scene.postRender.addEventListener(() => { probe.frames++ })
        this.scene.renderError.addEventListener((_scene, error) => probe.errors.push(String(error)))
      }
      if (this.uniform === 'reflexTexture') probe.reflectionDraws++
      return result
    }
  }, new URL('src/water/capture.ts', base).pathname)
  await page.waitForFunction(() => window.__cityRenderProbe?.scene, null, { timeout: 10000 })
  for (const [weather, view] of [['晴天', '河岸看云'], ['夕照', '街区总览'], ['雨天', '街道积水']]) {
    const before = await page.evaluate(() => ({ frames: window.__cityRenderProbe.frames, reflections: window.__cityRenderProbe.reflectionDraws }))
    await page.getByRole('button', { name: weather, exact: true }).click()
    await page.getByRole('button', { name: view, exact: true }).click()
    if (weather === '雨天') await page.getByLabel('局部积水实验').check()
    await page.waitForTimeout(2500)
    const state = await page.evaluate(() => {
      const probe = window.__cityRenderProbe, scene = probe.scene
      const models = Array.from({ length: scene.primitives.length }, (_, i) => scene.primitives.get(i)).filter(p => p.imageBasedLighting)
      const gl = scene.context._gl, extension = gl.getExtension('WEBGL_debug_renderer_info')
      return {
        frames: probe.frames, reflectionDraws: probe.reflectionDraws, errors: probe.errors,
        models: models.length,
        studioIBLModels: models.filter(model => model.imageBasedLighting.sphericalHarmonicCoefficients?.length === 9 && model.imageBasedLighting.specularEnvironmentMaps?.includes('model-rendering/studio-specular.ktx2')).length,
        hdr: scene.highDynamicRange,
        renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      }
    })
    assert(state.frames > before.frames + 3, `${weather}: main view must continue drawing`)
    assert(state.reflectionDraws > before.reflections, `${weather}: water reflection must continue updating`)
    assert.equal(state.models, 65)
    assert.equal(state.studioIBLModels, 65, 'City models must use the shared model-rendering SH and specular environment')
    assert.deepEqual(state.errors, [])
    assert.deepEqual(await page.locator('.city-lab__error').allTextContents(), [])
    checks.push({ weather, view, ...state })
  }
  assert(resources.some(resource => resource.url.includes('studio-sh.json') && resource.status === 200))
  assert(resources.some(resource => resource.url.includes('studio-specular.ktx2') && resource.status === 200))
  await page.getByRole('link', { name: /演示目录/ }).click()
  await page.waitForFunction(() => window.__cityRenderProbe.scene.isDestroyed(), null, { timeout: 30000 })
  assert.deepEqual(errors, [])
  report = { passed: true, browser: browser.version(), checks, resources, errors, disposed: true }
} catch (error) {
  report = { passed: false, error: String(error), checks, errors, alerts: await page.locator('.city-lab__error').allTextContents().catch(() => []) }
  process.exitCode = 1
} finally {
  await browser.close()
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
