import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const { chromium } = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href)
  : await import('playwright')
const base = process.env.WATER_FLOW_BASE_URL ?? 'http://127.0.0.1:5174/cesium-demo/'
const output = path.resolve('test-results/water-reflection-stability')
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
const checks = []
page.on('pageerror', error => errors.push(String(error)))
let report
try {
  await page.goto(base + 'water-real-terrain', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__realWaterLab?.getState().hasWater, null, { timeout: 90000 })
  await page.evaluate(async moduleUrl => {
    // Vite adds an HMR timestamp to imports after a local renderer edit.
    const loadedUrl = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === moduleUrl)?.name ?? moduleUrl
    const { SceneCapture } = await import(loadedUrl)
    const original = SceneCapture.prototype.render
    const previous = new WeakMap()
    const probe = window.__reflectionStability = { active: false, samples: [], depthPasses: 0, selectionChanges: 0 }
    SceneCapture.prototype.render = function (...args) {
      const surface = this.scene.globe._surface
      const tiles = surface._tilesToRender.slice()
      const result = original.apply(this, args)
      if (probe.active) {
        if (tiles.length !== surface._tilesToRender.length || tiles.some((tile, i) => tile !== surface._tilesToRender[i])) probe.selectionChanges++
        if (this.directDepth) probe.depthPasses++
        else {
          probe.capture = this
          const pixels = this.scene.context.readPixels({ framebuffer: this.framebuffer, width: this.width, height: this.height })
          const last = previous.get(this)
          let difference = 0, changed = 0
          if (last?.length === pixels.length) {
            for (let i = 0; i < pixels.length; i += 4) {
              const delta = (Math.abs(pixels[i] - last[i]) + Math.abs(pixels[i + 1] - last[i + 1]) + Math.abs(pixels[i + 2] - last[i + 2])) / 3
              difference += delta
              if (delta > 10) changed++
            }
            probe.samples.push({ meanRgbDifference: difference / (pixels.length / 4), changedOver10: changed / (pixels.length / 4) })
          }
          previous.set(this, pixels)
        }
        const gl = this.scene.context._gl
        const extension = gl.getExtension('WEBGL_debug_renderer_info')
        probe.renderer = extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
      } else previous.delete(this)
      return result
    }
    window.__realWaterLab.freeze()
    window.__realWaterLab.setOptions({ underwaterOptics: true, reflection: true, foam: false })
  }, new URL('src/water/capture.ts', base).pathname)
  for (const view of ['near', 'shore', 'overview']) {
    await page.evaluate(view => view === 'shore' ? window.__realWaterLab.focusShore() : window.__realWaterLab.focus(view), view)
    await page.waitForFunction(() => window.__realWaterLab.getState().tilesLoaded, null, { timeout: 60000 })
    await page.waitForTimeout(3000)
    await page.evaluate(() => {
      const probe = window.__reflectionStability
      probe.samples = []
      probe.depthPasses = probe.selectionChanges = 0
      probe.active = true
    })
    await page.waitForTimeout(5000)
    const result = await page.evaluate(() => {
      const probe = window.__reflectionStability
      probe.active = false
      return { samples: probe.samples, depthPasses: probe.depthPasses, selectionChanges: probe.selectionChanges, renderer: probe.renderer, diagnostics: window.__realWaterLab.getState().diagnostics }
    })
    const mean = result.samples.reduce((sum, sample) => sum + sample.meanRgbDifference, 0) / result.samples.length
    const max = Math.max(...result.samples.map(sample => sample.meanRgbDifference))
    const changed = Math.max(...result.samples.map(sample => sample.changedOver10))
    checks.push({ view, frames: result.samples.length, depthPasses: result.depthPasses, selectionChanges: result.selectionChanges, meanRgbDifference: mean, maxMeanRgbDifference: max, maxChangedOver10: changed, renderer: result.renderer, diagnostics: result.diagnostics })
    assert(result.samples.length >= 10, `${view}: must sample repeated real reflection draws`)
    assert(result.depthPasses >= 3, `${view}: underwater depth must remain enabled and updating`)
    assert.equal(result.selectionChanges, 0, `${view}: auxiliary passes replaced host terrain selection`)
    assert(mean < 0.1 && max < 1, `${view}: frozen reflection flickers (mean ${mean}, max ${max})`)
    assert.equal(result.diagnostics.reflectionAvailable, true)
    assert.equal(result.diagnostics.underwaterDepthReady, true)
    assert.equal(result.diagnostics.reflectionFailures, 0)
  }
  await page.evaluate(() => {
    const probe = window.__reflectionStability
    const capture = probe.capture
    probe.terrainReference = capture.scene.context.readPixels({ framebuffer: capture.framebuffer, width: capture.width, height: capture.height })
    window.__realWaterLab.setOptions({ reflectGlobe: false })
  })
  await page.waitForTimeout(1000)
  const terrainContribution = await page.evaluate(() => {
    const probe = window.__reflectionStability, capture = probe.capture
    const pixels = capture.scene.context.readPixels({ framebuffer: capture.framebuffer, width: capture.width, height: capture.height })
    let difference = 0
    for (let i = 0; i < pixels.length; i += 4) difference += (Math.abs(pixels[i] - probe.terrainReference[i]) + Math.abs(pixels[i + 1] - probe.terrainReference[i + 1]) + Math.abs(pixels[i + 2] - probe.terrainReference[i + 2])) / 3
    return difference / (pixels.length / 4)
  })
  assert(terrainContribution > 1, 'Terrain must still contribute visible detail to the reflection')
  await page.evaluate(() => window.__realWaterLab.setOptions({ reflectGlobe: true, waveSpeed: 0.5 }))
  const beforeMotion = await page.evaluate(() => window.__realWaterLab.getState())
  await page.evaluate(() => window.__realWaterLab.orbit({ heading: 4.4, pitch: -0.35, range: 500 }))
  await page.waitForTimeout(1500)
  const afterMotion = await page.evaluate(() => window.__realWaterLab.getState())
  assert(afterMotion.visualTime > beforeMotion.visualTime, 'Water animation must continue')
  assert(afterMotion.diagnostics.reflectionFrames > beforeMotion.diagnostics.reflectionFrames, 'Reflection must update with camera motion')
  assert.equal(afterMotion.diagnostics.reflectionAvailable, true)
  assert.equal(afterMotion.diagnostics.underwaterDepthReady, true)
  assert.deepEqual(errors, [])
  report = { passed: true, browser: browser.version(), checks, terrainContribution, animationAdvanced: afterMotion.visualTime > beforeMotion.visualTime, reflectionUpdatedOnMotion: afterMotion.diagnostics.reflectionFrames > beforeMotion.diagnostics.reflectionFrames, errors, evidence: 'Frozen water, fixed cameras, consecutive production reflection framebuffer readbacks with live terrain and underwater depth, terrain on/off comparison and animation/camera motion; no screenshots or subjective appearance acceptance.' }
} catch (error) {
  report = { passed: false, error: String(error), checks, errors }
  process.exitCode = 1
} finally {
  await browser.close()
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
