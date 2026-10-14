import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const { chromium } = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href)
  : await import('playwright')
const baseUrl = process.env.WATER_FLOW_BASE_URL ?? 'http://127.0.0.1:5198/cesium-demo/'
const output = path.resolve('test-results/water-flow-lab', process.env.WATER_FLOW_RUN_ID ?? 'p1-flow')
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
})
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
  recordVideo: { dir: output, size: { width: 1440, height: 900 } } })
const page = await context.newPage()
const errors = [], failedRequests = [], externalRequests = [], optionalRequests = [], checks = []
let offlineRequired = true
page.on('pageerror', value => errors.push(String(value)))
page.on('console', value => { if (value.type() === 'error') errors.push(value.text()) })
page.on('requestfailed', value => failedRequests.push({ url: value.url(), reason: value.failure()?.errorText }))
await page.route('**/*', route => {
  const url = new URL(route.request().url())
  if (url.protocol.startsWith('http') && url.origin !== new URL(baseUrl).origin) {
    if (!offlineRequired) {
      optionalRequests.push(url.href)
      return route.fulfill({ status: 200, contentType: 'text/css', body: '' })
    }
    externalRequests.push(url.href)
    return route.abort()
  }
  return route.continue()
})
const state = () => page.evaluate(() => window.__waterFlowLab.getState())
const control = (method, value) => page.evaluate(([method, value]) => window.__waterFlowLab[method](value), [method, value])
async function ready() {
  await page.waitForFunction(() => {
    const value = window.__waterFlowLab?.getState()
    return value && value.renderedFrames >= 4 && value.shaderSource && !value.error
  }, null, { timeout: 30000 })
}
async function compareImages(first, second) {
  return page.evaluate(async ([first, second]) => {
    async function decode(data) {
      const img = new Image()
      img.src = 'data:image/png;base64,' + data
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.width; canvas.height = img.height
      const context = canvas.getContext('2d')
      context.drawImage(img, 0, 0)
      return context.getImageData(0, 0, img.width, img.height).data
    }
    const a = await decode(first), b = await decode(second)
    let total = 0, changed = 0
    for (let i = 0; i < a.length; i += 4) {
      const difference = (Math.abs(a[i]-b[i]) + Math.abs(a[i+1]-b[i+1]) + Math.abs(a[i+2]-b[i+2])) / 3
      total += difference
      if (difference > 25) changed++
    }
    return { meanRgbDifference: total / (a.length / 4), changedOver25: changed / (a.length / 4) }
  }, [first.toString('base64'), second.toString('base64')])
}
let report, videoPath
const temporalChecks = []
try {
  await page.goto(new URL('water-flow-lab', baseUrl).href)
  await ready()
  await control('setPlaying', false)
  const gpu = await page.evaluate(() => {
    const canvas = document.querySelector('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    const extension = gl.getExtension('WEBGL_debug_renderer_info')
    return { version: gl.getParameter(gl.VERSION), vendor: gl.getParameter(gl.VENDOR), renderer: gl.getParameter(gl.RENDERER),
      unmaskedRenderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null,
      width: gl.drawingBufferWidth, height: gl.drawingBufferHeight }
  })
  assert.equal((await state()).cesiumVersion, '1.132')
  const assetStatuses = []
  for (const file of ['cesium/Workers/createBoxGeometry.js', 'cesium/Assets/approximateTerrainHeights.json']) {
    const response = await page.request.get(new URL(file, baseUrl).href)
    assetStatuses.push({ file, status: response.status(), contentType: response.headers()['content-type'] })
    assert.equal(response.status(), 200)
    assert(!response.headers()['content-type']?.includes('text/html'), 'Asset must not be Vite HTML fallback')
  }
  for (const fixture of ['slow', 'rapid', 'bend', 'obstacle']) {
    await control('setFixture', fixture)
    await control('setCamera', 'near')
    await control('seek', 15)
    for (const algorithm of ['basic', 'current', 'flow']) {
      await control('setAlgorithm', algorithm)
      await page.waitForTimeout(250)
      await page.screenshot({ path: path.join(output, fixture + '-' + algorithm + '.png') })
      const value = await state()
      assert.equal(value.error, '')
      assert.equal(value.time, 15)
      assert.match(value.shaderSource, /czm_getMaterial/)
      assert.match(value.shaderSource, /floodVisualTime/)
      checks.push({ fixture, algorithm, primitiveCount: value.primitiveCount, time: value.time })
    }
    for (const sourceAlgorithm of ['current', 'flow']) {
      await control('setAlgorithm', sourceAlgorithm)
      for (const diagnostic of ['velocity', 'foam-source', 'foam']) {
      await control('setDiagnostic', diagnostic)
      await page.waitForTimeout(250)
      await page.screenshot({ path: path.join(output, fixture + '-' + sourceAlgorithm + '-' + diagnostic + '.png') })
      assert.equal((await state()).error, '')
    }
    }
    await control('setDiagnostic', 'water')
  }
  await control('setFixture', 'rapid')
  await control('setCamera', 'near')
  await control('setAlgorithm', 'flow')
  await control('setParticles', false)
  const clip = { x: 360, y: 180, width: 980, height: 650 }
  for (const boundary of [0.95, 1.9, 9.5, 15.2]) {
    const images = []
    for (const time of [boundary - 0.001, boundary + 0.001]) {
      await control('seek', time)
      await page.waitForTimeout(150)
      images.push(await page.screenshot({ path: path.join(output, 'phase-' + time.toFixed(3) + '.png'), clip }))
    }
    const comparison = await compareImages(...images)
    temporalChecks.push({ boundary, ...comparison })
    assert(comparison.meanRgbDifference < 3, 'No full-frame flash at phase resets')
    assert(comparison.changedOver25 < 0.01, 'Phase reset must not produce broad high-contrast changes')
  }
  await control('seek', 15)
  const movingA = await page.screenshot({ clip })
  await control('seek', 15.25)
  await page.waitForTimeout(150)
  const movingB = await page.screenshot({ clip })
  const motion = await compareImages(movingA, movingB)
  assert(motion.meanRgbDifference > 0.05, 'Flow detail must actually animate on the GPU')
  temporalChecks.push({ check: 'actual water-detail motion without particles', ...motion })
  await control('setVelocity', false)
  await control('seek', 15)
  assert.equal((await state()).withVelocity, false)
  assert.equal((await state()).error, '')
  await page.screenshot({ path: path.join(output, 'missing-velocity.png') })
  await page.waitForTimeout(250)
  const frozenImage = await page.screenshot({ path: path.join(output, 'frozen-a.png') })
  const frozen = await state()
  await page.waitForTimeout(500)
  assert.equal((await state()).time, frozen.time)
  const frozenAgain = await page.screenshot({ path: path.join(output, 'frozen-b.png') })
  assert(frozenImage.equals(frozenAgain), 'Paused water must have identical rendered pixels')
  checks.push({ check: 'missing velocity and frozen clock', passed: true })
  await control('setVelocity', true)
  const primitiveCount = (await state()).primitiveCount
  const entityCount = (await state()).entityCount
  for (let i = 0; i < 3; i++) {
    await control('recreate')
    await ready()
    const value = await state()
    assert.equal(value.primitiveCount, primitiveCount)
    assert.equal(value.entityCount, entityCount)
    checks.push({ check: 'Viewer recreate', cycle: i + 1, primitiveCount: value.primitiveCount, entityCount: value.entityCount })
  }
  await control('setFixture', 'rapid')
  await control('setCamera', 'near')
  await control('setPlaying', true)
  const dynamicStart = (await state()).time
  for (let second = 0; second < 16; second++) {
    if (second === 5) await control('setCamera', 'overview')
    if (second === 10) await control('setCamera', 'near')
    if (second === 6 || second === 11) {
      await page.mouse.move(950, 440)
      await page.mouse.down()
      await page.mouse.move(1110, 480, { steps: 32 })
      await page.mouse.up()
    }
    await page.waitForTimeout(1000)
  }
  await control('setPlaying', false)
  const dynamicEnd = await state()
  assert(dynamicEnd.time - dynamicStart >= 15, 'At least 15 seconds of actual animation required')
  const finalShader = dynamicEnd.shaderSource
  await fs.writeFile(path.join(output, 'assembled-fragment.glsl'), finalShader)
  const uniformNames = [...finalShader.matchAll(/uniform\s+\w+\s+(\w+)/g)].map(match => match[1])
  assert(uniformNames.length >= 4, 'Inspect actual Cesium-assembled material uniforms')
  assert.equal(new Set(uniformNames).size, uniformNames.length, 'No duplicate assembled uniforms')
  offlineRequired = false
  await page.evaluate(() => { window.__previousLab = window.__waterFlowLab })
  await page.getByRole('link', { name: '← 示例首页' }).click()
  await page.waitForFunction(() => !window.__waterFlowLab)
  const disposed = await page.evaluate(() => window.__previousLab.getState())
  assert.equal(disposed.viewerAlive, false)
  assert.equal(disposed.layerAlive, false)
  await page.locator('.nav-card').filter({ hasText: '水流渲染对照' }).click()
  offlineRequired = true
  await ready()
  checks.push({ check: 'route unmount and reload', passed: true })
  const requestFailures = failedRequests.filter(value => value.reason !== 'net::ERR_ABORTED')
  assert.deepEqual(errors, [])
  assert.deepEqual(requestFailures, [])
  assert.deepEqual(externalRequests, [])
  report = { passed: true, browser: browser.version(), cesium: dynamicEnd.cesiumVersion, gpu,
    assetStatuses, checks, temporalChecks, assembledUniformCount: uniformNames.length, dynamicSeconds: dynamicEnd.time - dynamicStart,
    errors, failedRequests, externalRequests, optionalRequests, video: null,
    limits: ['Opt-in advected-normal and local-foam experiment; final visual acceptance pending', 'No real terrain or 3D Tiles acceptance', 'No GPU timings or final visual-quality acceptance'] }
} catch (error) {
  report = { passed: false, error: String(error), errors, failedRequests, externalRequests, checks }
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  const video = page.video()
  await context.close()
  videoPath = await video?.path()
  report.video = videoPath
  await browser.close()
  await fs.writeFile(path.join(output, 'gpu-smoke.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
