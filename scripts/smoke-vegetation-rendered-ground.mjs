import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH ?? 'C:/Users/PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
const { chromium } = await import(pathToFileURL(modulePath).href)
const base = process.env.PRACTICE_BASE_URL ?? 'http://127.0.0.1:5175/cesium-demo/'
const output = path.resolve(process.env.PRACTICE_OUTPUT ?? 'test-results/vegetation-rendered-ground')
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}), args: ['--enable-webgl', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', error => errors.push(String(error.stack ?? error)))
const read = () => page.evaluate(() => ({ state: window.__vegetationLab.getState(), diagnostics: window.__vegetationLab.getDiagnostics() }))
async function idle(timeout = 120000) {
  await page.waitForFunction(() => {
    const api = window.__vegetationLab
    const state = api?.getState(), diagnostics = api?.getDiagnostics()
    return state?.ready && state.terrain.ready && !state.busy && !state.pending && !state.heightPending && state.loadedInstances === state.count && diagnostics?.alignmentPending === 0 && diagnostics.terrainTilesLoaded
  }, null, { timeout })
  return read()
}
try {
  await page.goto(new URL('vegetation-lab', base).href, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForFunction(() => Boolean(window.__vegetationLab), null, { timeout: 20000 })
  await page.evaluate(() => window.__vegetationLab.ready)
  await page.waitForFunction(() => window.__vegetationLab.getState().count > 0, null, { timeout: 60000 })
  await idle()
  await page.evaluate(() => window.__vegetationLab.clear())
  await page.waitForFunction(() => window.__vegetationLab.getState().count === 0, null, { timeout: 10000 })
  await idle()
  const beforeFill = await read()
  await page.evaluate(() => window.__vegetationLab.fill(100))
  await page.waitForFunction(() => window.__vegetationLab.getState().count === 100, null, { timeout: 30000 })
  let afterFill = await idle()
  let grounding = await page.evaluate(() => window.__vegetationLab.checkGrounding(100))
  assert(grounding.checked > 0, `Expected an unoccluded on-screen root sample, got ${JSON.stringify(grounding)}`)
  assert(grounding.maxGap < 0.1, `Visible roots should match the currently rendered terrain mesh: ${grounding.maxGap} m`)
  const fillGrounding = grounding
  const sourcePlants = await page.evaluate(() => window.__vegetationLab.getPlants(100))
  const exportedSource = JSON.parse(await page.evaluate(() => window.__vegetationLab.exportJson()))
  const exportedById = new Map(exportedSource.plants.map(plant => [plant.id, plant]))
  assert(sourcePlants.every(plant => exportedById.get(plant.id)?.z === plant.z), 'Rendered mesh offsets must not overwrite source elevations in exported JSON')
  const renderOverrides = sourcePlants.filter(plant => plant.renderHeight !== undefined).length
  const sourceHeightsBeforeCamera = new Map(exportedSource.plants.map(plant => [plant.id, plant.z]))
  await page.evaluate(() => window.__vegetationLab.overview())
  await page.waitForTimeout(900)
  const afterOverview = await idle()
  const exportedAfterCamera = JSON.parse(await page.evaluate(() => window.__vegetationLab.exportJson()))
  assert(exportedAfterCamera.plants.every(plant => sourceHeightsBeforeCamera.get(plant.id) === plant.z), 'Camera movement and mesh alignment must not change exported source elevations')
  const overviewGrounding = await page.evaluate(() => window.__vegetationLab.checkGrounding(100))
  assert(overviewGrounding.checked > 0 && overviewGrounding.maxGap < 0.1, `Overview roots should remain within the selected terrain mesh tolerance: ${overviewGrounding.maxGap} m`)
  const fillRebuilds = afterFill.diagnostics.rebuilds - beforeFill.diagnostics.rebuilds
  assert(fillRebuilds <= afterFill.state.batches + 1, `Fill rebuilt touched chunks more than once: ${fillRebuilds} builds for ${afterFill.state.batches} chunks`)
  assert.equal(afterFill.diagnostics.staleBuilds, beforeFill.diagnostics.staleBuilds, 'Fill should not upload obsolete chunk models')

  await page.getByRole('button', { name: '笔刷', exact: true }).click()
  const canvas = page.locator('.cesium-widget canvas').first()
  const bounds = await canvas.boundingBox()
  assert(bounds)
  const beforeBrush = await read()
  await page.mouse.move(bounds.x + bounds.width * 0.66, bounds.y + bounds.height * 0.52)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * 0.70, bounds.y + bounds.height * 0.57, { steps: 16 })
  await page.mouse.up()
  await page.waitForFunction(() => window.__vegetationLab.getState().count > 100, null, { timeout: 10000 })
  const afterBrush = await idle()
  const brushBuilds = afterBrush.diagnostics.rebuilds - beforeBrush.diagnostics.rebuilds
  assert(brushBuilds <= afterBrush.state.batches + 1, `Brush rebuilt touched chunks more than once: ${brushBuilds} builds for ${afterBrush.state.batches} chunks`)
  assert.equal(afterBrush.diagnostics.staleBuilds, beforeBrush.diagnostics.staleBuilds, 'Brush should not upload obsolete chunk models')
  grounding = await page.evaluate(() => window.__vegetationLab.checkGrounding(100))
  assert(grounding.checked > 0)
  assert(grounding.maxGap < 0.1, `Visible brushed roots should match the rendered terrain mesh: ${grounding.maxGap} m`)
  assert.deepEqual(errors, [])
  const report = { passed: true, terrain: afterBrush.state.terrain, gl: await page.evaluate(() => { const canvas = document.querySelector('.cesium-widget canvas'); const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl'); const ext = gl?.getExtension('WEBGL_debug_renderer_info'); return { version: gl?.getParameter(gl.VERSION) ?? null, renderer: gl && ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER) ?? null } }), fill: { plants: 100, rebuilds: fillRebuilds, chunks: afterFill.state.batches, rootOverrides: renderOverrides, sourceElevationPreserved: true, surfaceCorrections: afterFill.diagnostics.surfaceCorrections - beforeFill.diagnostics.surfaceCorrections, grounding: { count: 100, visible: fillGrounding.visible, checked: fillGrounding.checked, occluded: fillGrounding.occluded, maxGap: fillGrounding.maxGap, meanGap: fillGrounding.meanGap } }, camera: { batches: afterOverview.state.batches, rebuilds: afterOverview.diagnostics.rebuilds - afterFill.diagnostics.rebuilds, staleBuilds: afterOverview.diagnostics.staleBuilds - afterFill.diagnostics.staleBuilds, sourceElevationPreserved: true, surfaceCorrections: afterOverview.diagnostics.surfaceCorrections - afterFill.diagnostics.surfaceCorrections, grounding: { checked: overviewGrounding.checked, occluded: overviewGrounding.occluded, maxGap: overviewGrounding.maxGap } }, brush: { plants: afterBrush.state.count - 100, rebuilds: brushBuilds, chunks: afterBrush.state.batches, staleBuilds: afterBrush.diagnostics.staleBuilds, surfaceCorrections: afterBrush.diagnostics.surfaceCorrections - beforeBrush.diagnostics.surfaceCorrections, grounding: { checked: grounding.checked, occluded: grounding.occluded, maxGap: grounding.maxGap } }, terrainLodNote: "Near fill, overview, and brush roots are asserted within 0.1 m of the current rendered mesh after globe.tilesLoaded.", fps: afterBrush.state.fps, frameP95: afterBrush.state.frameP95, errors }
  await fs.mkdir(output, { recursive: true })
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ...report, report: path.join(output, 'report.json') }, null, 2))
} finally { await browser.close() }
