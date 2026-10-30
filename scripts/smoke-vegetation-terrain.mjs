import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH
let chromium
const base = process.env.PRACTICE_BASE_URL ?? 'http://127.0.0.1:5175/cesium-demo/'
const output = path.resolve(process.env.PRACTICE_OUTPUT ?? path.join(root, 'test-results', 'vegetation-terrain'))
const allowedExternal = new Set(['https://3d.geo.admin.ch', 'https://wmts.geo.admin.ch'])
await fs.mkdir(output, { recursive: true })

let browser
let page
let failure
let gpu
const checks = []
const samples = []
const errors = []
const requests = []
const blockedRequests = []
const networkFailures = []

function monitor(target) {
  target.on('pageerror', error => errors.push(String(error.stack ?? error)))
  target.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  target.on('request', request => {
    const url = new URL(request.url())
    requests.push({ url: url.href, origin: url.origin, resourceType: request.resourceType() })
  })
  target.on('requestfailed', request => {
    if (!/^wss?:/i.test(request.url())) networkFailures.push({ url: request.url(), failure: request.failure()?.errorText })
  })
}

async function restrictNetwork(target) {
  await target.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== new URL(base).origin && !allowedExternal.has(url.origin)) {
      blockedRequests.push(url.href)
      await route.abort()
      return
    }
    await route.continue()
  })
}

const state = () => page.evaluate(() => window.__vegetationLab?.getState())
const call = (method, ...args) => page.evaluate(([method, args]) => window.__vegetationLab[method](...args), [method, args])

async function waitFor(predicate, message, timeout = 120000) {
  await page.waitForFunction(predicate, null, { timeout })
  const current = await state()
  assert(current, message)
  return current
}

async function waitIdle(timeout = 180000) {
  return waitFor(() => {
    const api = window.__vegetationLab
    const value = api?.getState(), diagnostics = api?.getDiagnostics()
    return value && value.ready && !value.busy && value.heightPending === 0 && value.pending === 0 && value.loadedInstances === value.count && diagnostics?.alignmentPending === 0 && diagnostics.terrainTilesLoaded
  }, 'Vegetation tiles and terrain root refinements should settle', timeout)
}

async function sceneClick(xRatio = 0.64, yRatio = 0.54) {
  const canvas = page.locator('.cesium-widget canvas').first()
  const bounds = await canvas.boundingBox()
  assert(bounds, 'Cesium canvas is present')
  await page.mouse.click(bounds.x + bounds.width * xRatio, bounds.y + bounds.height * yRatio)
}

try {
  ;({ chromium } = modulePath ? await import(pathToFileURL(modulePath).href) : await import('playwright'))
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  page = await context.newPage()
  monitor(page)
  await restrictNetwork(page)
  await page.goto(new URL('vegetation-lab', base).href, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForFunction(() => Boolean(window.__vegetationLab), null, { timeout: 30000 })
  await page.evaluate(() => window.__vegetationLab.ready)
  await page.getByRole('heading', { name: '植被种植实验' }).waitFor({ state: 'visible' })
  let current = await waitFor(() => {
    const value = window.__vegetationLab?.getState()
    return value?.ready && value.terrain.ready
  }, 'Real terrain and vegetation assets become ready', 120000)
  assert.equal(current.terrain.kind, 'terrain')
  assert.match(current.terrain.terrainUrl, /^https:\/\/3d\.geo\.admin\.ch\//)
  assert.equal(current.terrain.sampleCount, 4225)
  assert(current.terrain.maxHeight - current.terrain.minHeight > 80, `Expected uneven terrain, got ${current.terrain.minHeight}..${current.terrain.maxHeight}`)
  await page.waitForFunction(() => {
    const images = performance.getEntriesByType('resource').map(entry => entry.name)
    return ['twig_basecolor_alpha_1k.png', 'bark_diff_1k.jpg', 'bark_nor_gl_1k.jpg'].every(name => images.some(url => url.includes(name)))
  }, null, { timeout: 30000 })
  checks.push('Default route waits for Swiss terrain sampling and all three local pine textures')
  current = await waitIdle()
  assert(current.count > 0)
  assert.equal(current.heightPending, 0)
  assert.equal(current.pending, 0)
  assert.equal(current.loadedInstances, current.count)
  samples.push({ stage: 'real-terrain-ready', state: current })

  const textureUris = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name).filter(url => /vegetation-lab\/pine_tree_01\//.test(url)))
  assert(textureUris.some(url => url.includes('twig_basecolor_alpha_1k.png')))
  gpu = await page.evaluate(() => {
    const canvas = document.querySelector('.cesium-widget canvas')
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl')
    const extension = gl?.getExtension('WEBGL_debug_renderer_info')
    return {
      version: gl?.getParameter(gl.VERSION) ?? null,
      vendor: gl?.getParameter(gl.VENDOR) ?? null,
      renderer: gl?.getParameter(gl.RENDERER) ?? null,
      unmaskedVendor: gl && extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : null,
      unmaskedRenderer: gl && extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null,
    }
  })

  await page.getByRole('button', { name: '单株', exact: true }).click()
  let before = (await state()).count
  let added = false
  for (const [x, y] of [[0.64, 0.52], [0.72, 0.58], [0.58, 0.62], [0.78, 0.46], [0.52, 0.48]]) {
    await sceneClick(x, y)
    await page.waitForTimeout(250)
    if ((await state()).count > before) { added = true; break }
  }
  assert(added, 'A real single-plant scene click should add a plant')
  current = await waitIdle()
  assert.equal(current.count, before + 1)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  current = await waitIdle()
  assert.equal(current.count, before, 'Undo restores the pre-click plant count')
  checks.push('A real scene click adds one plant and the DOM undo button restores the previous count')

  await page.getByRole('button', { name: '笔刷', exact: true }).click()
  const canvasBounds = await page.locator('.cesium-widget canvas').first().boundingBox()
  assert(canvasBounds)
  before = (await state()).count
  await page.mouse.move(canvasBounds.x + canvasBounds.width * 0.64, canvasBounds.y + canvasBounds.height * 0.52)
  await page.mouse.down()
  await page.mouse.move(canvasBounds.x + canvasBounds.width * 0.68, canvasBounds.y + canvasBounds.height * 0.58, { steps: 16 })
  await page.mouse.up()
  current = await waitIdle()
  assert(current.count > before, 'A continuous real-terrain brush stroke should plant trees')
  const brushGrounding = await call('checkGrounding', 64)
  assert(brushGrounding.checked > 0, 'At least one unoccluded visible root should be compared with the displayed terrain mesh')
  assert(brushGrounding.maxGap < 0.1, `Visible brush roots should follow the selected terrain mesh: ${brushGrounding.maxGap} m`)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  current = await waitIdle()
  assert.equal(current.count, before, 'One undo removes the entire terrain brush stroke')
  samples.push({ stage: 'real-terrain-brush', grounding: brushGrounding, state: current })
  checks.push('A continuous brush drag plants on real terrain, keeps roots grounded and undoes as one edit')

  await call('clear')
  await waitIdle()
  await call('fill', 250)
  current = await waitIdle()
  assert.equal(current.count, 250)
  assert.equal(current.heightPending, 0)
  assert.equal(current.pending, 0)
  assert.equal(current.loadedInstances, current.count)
  const plants = await call('getPlants', 64)
  assert(plants.length >= 2)
  assert(new Set(plants.map(plant => plant.height.toFixed(2))).size > 1, 'Plant root heights should follow varying terrain')
  const grounding = await call('checkGrounding', 250)
  assert.equal(grounding.count, 250)
  assert(grounding.checked > 0, 'At least one unoccluded visible root should be checked against the selected terrain mesh')
  assert(grounding.maxGap < 0.1, `Visible terrain root mismatch ${grounding.maxGap} m`)
  samples.push({ stage: 'batch-250-grounded', state: current, rootHeightRange: [Math.min(...plants.map(plant => plant.height)), Math.max(...plants.map(plant => plant.height))], grounding })
  checks.push('A 250 plant fill finishes high-detail source sampling and rendered-mesh alignment with visible roots within 35 cm')

  const exported = JSON.parse(await call('exportJson'))
  assert.equal(exported.version, 2)
  assert.equal(exported.plants.length, 250)
  assert.equal(exported.reference.longitude, current.terrain.longitude)
  assert.equal(exported.reference.latitude, current.terrain.latitude)
  assert.equal(exported.reference.terrainUrl, current.terrain.terrainUrl)
  await call('clear')
  current = await waitIdle()
  assert.equal(current.count, 0)
  await call('importJson', JSON.stringify(exported))
  current = await waitIdle()
  assert.equal(current.count, 250)
  const beforeRejectedImport = current
  for (const field of ['longitude', 'terrainUrl']) {
    const incompatible = structuredClone(exported)
    incompatible.reference[field] = field === 'longitude' ? incompatible.reference.longitude + 0.01 : incompatible.reference.terrainUrl + 'other/'
    const rejection = await page.evaluate(json => {
      try { window.__vegetationLab.importJson(JSON.stringify(json)); return '' }
      catch (error) { return String(error) }
    }, incompatible)
    assert.match(rejection, /坐标|地形服务/)
    assert.equal((await state()).count, beforeRejectedImport.count, `Rejected ${field} import must preserve existing plants`)
  }
  checks.push('Terrain-scoped JSON v2 round trips and rejects mismatched region and terrain references without changing state')

  await page.getByRole('button', { name: '近看', exact: true }).click()
  const shadows = page.getByLabel('投射树木阴影（增加渲染开销）')
  if (await shadows.isChecked()) await shadows.uncheck()
  await shadows.check()
  await waitIdle()
  await shadows.uncheck()
  await waitIdle()
  current = await state()
  assert.equal(current.loadedInstances, current.count)
  samples.push({ stage: 'near-and-shadow-toggle', state: current })
  checks.push('Near camera movement and shadow toggles leave all vegetation instances ready')

  let releaseTerrain
  let samplingRequestHeld = false
  const terrainGate = new Promise(resolve => { releaseTerrain = resolve })
  const terrainPattern = 'https://3d.geo.admin.ch/**/*.terrain*'
  await page.route(terrainPattern, async route => {
    samplingRequestHeld = true
    await terrainGate
    await route.fallback()
  })
  await page.evaluate(() => window.__vegetationLab.reproject())
  await page.waitForFunction(() => window.__vegetationLab.getState().heightPending > 0, null, { timeout: 10000 })
  const heldUntil = Date.now() + 10000
  while (!samplingRequestHeld && Date.now() < heldUntil) await new Promise(resolve => setTimeout(resolve, 20))
  assert(samplingRequestHeld, 'A real terrain request must be pending during the lifecycle test')
  assert((await state()).heightPending > 0, 'Terrain refinement should remain pending before navigation')
  await page.getByRole('link', { name: '进入室内行走示例 →' }).click()
  await page.waitForFunction(() => !window.__vegetationLab && Boolean(window.__firstPersonLab), null, { timeout: 30000 })
  releaseTerrain()
  await page.unroute(terrainPattern)
  await page.waitForTimeout(500)
  assert.equal(errors.length, 0, errors.join('\n'))
  checks.push('Leaving the page while source terrain refinement is pending disposes the viewer without page errors')

  const localOrigin = new URL(base).origin
  const origins = [...new Set(requests.map(request => request.origin).filter(origin => origin !== localOrigin))]
  assert(origins.length > 0, 'Terrain test should contact an external Swiss geodata host')
  assert(origins.every(origin => allowedExternal.has(origin)), `Unexpected external origins: ${origins.join(', ')}`)
  assert.equal(blockedRequests.length, 0, blockedRequests.join('\n'))
} catch (error) {
  failure = String(error.stack ?? error)
  if (page && !page.isClosed()) {
    try { samples.push({ stage: 'failure-state', url: page.url(), state: await state() }) } catch { /* preserve first failure */ }
  }
} finally {
  const report = {
    passed: !failure,
    checks,
    samples,
    gpu,
    requests,
    externalRequests: requests.filter(request => request.origin !== new URL(base).origin),
    allowedExternalOrigins: [...allowedExternal],
    terrainSource: 'https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1/; © swisstopo',
    imagerySource: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg; © swisstopo SWISSIMAGE',
    vegetationTextureSource: 'https://polyhaven.com/a/pine_tree_01; CC0 https://polyhaven.com/license',
    blockedRequests,
    networkFailures,
    errors,
    failure,
    browser: browser ? await browser.version() : null,
    environment: { platform: process.platform, architecture: process.arch },
    note: 'Behavioral runtime and terrain checks only. No screenshots or recordings. GPU and FPS values are observations, not visual acceptance or a device-independent performance guarantee.',
  }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  if (browser) await browser.close()
}

if (failure) {
  console.error(failure)
  process.exitCode = 1
} else {
  console.log(JSON.stringify({ passed: true, checks, report: path.join(output, 'report.json') }, null, 2))
}
