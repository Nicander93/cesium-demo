import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH
const { chromium } = modulePath
  ? await import(pathToFileURL(modulePath).href)
  : await import('playwright')
const base =
  process.env.ANIMATION_BASE_URL ?? 'http://127.0.0.1:5174/cesium-demo/'
const output = path.resolve(
  process.env.ANIMATION_OUTPUT ?? path.join(root, 'test-results', 'animation'),
)
const consumer = path.join(
  root,
  'test-results',
  'animation-package',
  'consumer',
)
const installedSdk = path.join(
  consumer,
  'node_modules',
  '@gis-animation',
  'cesium',
  'dist',
)
const installedCesium = path.join(
  consumer,
  'node_modules',
  'cesium',
  'Build',
  'Cesium',
)
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
})
const page = await context.newPage()
const errors = []
const externalRequests = []
const optionalHomeRequests = []
const checks = []
const samples = []
let failure
let consumerServer
function monitor(target) {
  target.on('pageerror', (error) => errors.push(String(error.stack ?? error)))
  target.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
}
monitor(page)
await page.route('**/*', async (route) => {
  const url = new URL(route.request().url())
  if (
    ['http:', 'https:'].includes(url.protocol) &&
    url.origin !== new URL(base).origin
  ) {
    if (
      url.hostname === 'cdnjs.cloudflare.com' &&
      new URL(page.url()).pathname === new URL(base).pathname
    ) {
      optionalHomeRequests.push(url.origin + url.pathname)
      await route.fulfill({ contentType: 'text/css', body: '' })
    } else {
      externalRequests.push(url.origin + url.pathname)
      await route.abort()
    }
  } else await route.continue()
})
const state = () => page.evaluate(() => window.__animationLab.getState())
const call = (method, value) =>
  page.evaluate(
    ([method, value]) => window.__animationLab[method](value),
    [method, value],
  )
const frames = (count = 6, target = page) =>
  target.evaluate(
    (count) =>
      new Promise((resolve) => {
        function frame() {
          if (--count <= 0) resolve()
          else requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)
      }),
    count,
  )
async function waitParticles() {
  await page.waitForFunction(
    () =>
      window.__animationLab
        .getState()
        .resources.effects.some(
          (effect) => effect.kind === 'fountain' && effect.particleCount > 5,
        ),
    null,
    { timeout: 15000 },
  )
}
async function numberControl(label, value) {
  const controller = page
    .locator('.lil-gui .controller')
    .filter({ hasText: label })
    .filter({ visible: true })
    .first()
  const input = controller.locator('input').first()
  await input.fill(String(value))
  await input.press('Tab')
  await frames(2)
}
async function startPackageServer() {
  const source = await fs.readFile(path.join(installedSdk, 'index.js'), 'utf8')
  const names = new Set()
  for (const match of source.matchAll(
    /import\s*\{([\s\S]*?)\}\s*from\s*['"]cesium['"]/g,
  )) {
    for (const value of match[1].split(','))
      names.add(value.trim().split(/\s+as\s+/)[0])
  }
  assert(
    names.has('Cartesian3'),
    'Installed tarball must import the host Cesium peer',
  )
  const peerFacade = [...names]
    .map(
      (name) => 'export const ' + name + ' = globalThis.Cesium.' + name + ';',
    )
    .join('\n')
  const mime = {
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }
  consumerServer = http.createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(
        new URL(request.url, 'http://localhost').pathname,
      )
      if (pathname === '/cesium-module.js') {
        response.setHeader('Content-Type', 'application/javascript')
        response.end(peerFacade)
        return
      }
      let filename
      if (pathname === '/')
        filename = path.join(
          root,
          'scripts',
          'fixtures',
          'animation-consumer.html',
        )
      else if (pathname === '/main.js')
        filename = path.join(
          root,
          'scripts',
          'fixtures',
          'animation-consumer.mjs',
        )
      else {
        const directory = pathname.startsWith('/sdk/')
          ? installedSdk
          : pathname.startsWith('/cesium/')
            ? installedCesium
            : undefined
        if (!directory) {
          response.writeHead(404)
          response.end()
          return
        }
        const relative = pathname.slice(pathname.indexOf('/', 1) + 1)
        filename = path.resolve(directory, relative)
        if (!filename.startsWith(path.resolve(directory) + path.sep))
          throw new Error('Invalid fixture asset path')
      }
      const bytes = await fs.readFile(filename)
      response.setHeader(
        'Content-Type',
        mime[path.extname(filename)] ??
          (filename.endsWith('.html')
            ? 'text/html'
            : 'application/octet-stream'),
      )
      response.end(bytes)
    } catch {
      response.writeHead(404)
      response.end()
    }
  })
  await new Promise((resolve) => consumerServer.listen(0, '127.0.0.1', resolve))
  return 'http://127.0.0.1:' + consumerServer.address().port + '/'
}
try {
  await page.goto(base + 'animation-lab', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => window.__animationLab?.getState().ready,
    null,
    { timeout: 30000 },
  )
  await page.locator('.lil-gui').first().waitFor({ state: 'visible' })
  let current = await state()
  assert.equal(current.definition.tracks.length, 3)
  assert.equal(current.resources.effectCount, 3)
  assert.equal(current.resources.timelineCount, 1)
  assert.equal(current.resources.schedulerPending, false)
  const gpu = await page.evaluate(() => {
    const gl = document
      .querySelector('.cesium-widget canvas')
      .getContext('webgl2')
    const extension = gl.getExtension('WEBGL_debug_renderer_info')
    return {
      version: gl.getParameter(gl.VERSION),
      renderer: gl.getParameter(
        extension?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER,
      ),
    }
  })
  samples.push({ stage: 'editor-initial', gpu, state: current })

  await page.getByRole('button', { name: '＋ 飞线', exact: true }).click()
  current = await state()
  const createdId = current.selectedId
  assert.equal(current.definition.tracks.length, 4)
  await numberControl('流动 / 次每秒', 0.65)
  await numberControl('开始时间 / 秒', 1.5)
  current = await state()
  const edited = current.definition.tracks.find(
    (track) => track.id === createdId,
  )
  assert.equal(edited.options.speed, 0.65)
  assert.equal(edited.at, 1.5)
  await page
    .locator('.lil-gui .title')
    .filter({ hasText: /^路径节点 \/ WGS84$/ })
    .click()
  await page
    .locator('.lil-gui .title')
    .filter({ hasText: /^节点 1$/ })
    .click()
  const longitude = edited.options.positions[0].lon + 0.0001
  await numberControl('经度 / 度', longitude)
  current = await state()
  assert(
    Math.abs(
      current.definition.tracks.find((track) => track.id === createdId).options
        .positions[0].lon - longitude,
    ) < 0.00002,
  )
  checks.push(
    'Real lil-gui controls create a track and edit its timing, pattern speed and geographic node',
  )

  await page.getByRole('button', { name: '播放', exact: true }).click()
  await call('seek', 12)
  await waitParticles()
  const clock = (await state()).clock
  await call('action', 'pause')
  current = await state()
  const pausedTime = current.timeline.timeSeconds
  assert.equal(current.resources.schedulerPending, false)
  assert(
    current.resources.effects
      .filter((effect) => effect.kind === 'fountain')
      .every((effect) => effect.particleCount === 0),
  )
  await frames(20)
  assert.equal((await state()).timeline.timeSeconds, pausedTime)
  await call('action', 'resume')
  await waitParticles()
  assert.deepEqual((await state()).clock, clock)
  await call('action', 'pause')
  await call('seek', 14)
  const exactA = (await state()).resources.effects.filter((effect) =>
    ['fly', 'arrow'].includes(effect.kind),
  )
  await call('seek', 20)
  await call('seek', 14)
  const exactB = (await state()).resources.effects.filter((effect) =>
    ['fly', 'arrow'].includes(effect.kind),
  )
  assert.deepEqual(exactB, exactA)
  assert((await state()).seekReport.reset.some((id) => id.includes('fountain')))
  await page.waitForFunction(
    () => window.__animationLab.getState().sceneTilesLoaded,
  )
  await frames(12)
  const renderBaseline = (await state()).renderedFrames
  await frames(24)
  assert.equal(
    (await state()).renderedFrames,
    renderBaseline,
    'Paused UI must not cause a postRender/requestRender feedback loop',
  )
  checks.push(
    'Internal Timeline seek/pause/resume, particle reset reports, frozen Clock and idle render demand',
  )

  await call('action', 'stop')
  await page.getByRole('button', { name: '＋ 相机', exact: true }).click()
  current = await state()
  const cameraId = current.selectedId
  await call('seek', 4)
  await call('setView', 'side')
  await call('captureCameraKeyframe', 4)
  current = await state()
  assert.equal(
    current.definition.tracks.find((track) => track.id === cameraId).options
      .keyframes.length,
    3,
  )
  await call('seek', 3)
  const cameraA = (await state()).camera
  await call('seek', 7)
  await call('seek', 3)
  assert.deepEqual((await state()).camera, cameraA)
  await call('action', 'play')
  await frames()
  assert.equal((await state()).cameraInputsEnabled, false)
  await call('action', 'pause')
  assert.equal((await state()).cameraInputsEnabled, true)
  await call('action', 'resume')
  assert.equal((await state()).cameraInputsEnabled, false)
  await call('action', 'stop')
  assert.equal((await state()).cameraInputsEnabled, true)
  checks.push(
    'Camera keyframe capture and repeatable seek; camera interaction restored on pause and stop',
  )

  const exported = await call('exportDefinition')
  const beforeInvalid = JSON.parse(exported)
  const invalid = { ...beforeInvalid, duration: 1 }
  assert.equal(await call('setDefinition', invalid), false)
  current = await state()
  assert.deepEqual(current.definition, beforeInvalid)
  assert.equal(current.ready, true)
  assert(current.validationError.length > 0)
  await call('importDefinition', '{broken-json')
  assert.deepEqual((await state()).definition, beforeInvalid)
  const minimal = {
    schemaVersion: 1,
    duration: 10,
    tracks: [
      {
        id: 'minimal',
        kind: 'fly-line',
        at: 0,
        duration: 10,
        options: {
          positions: [
            { lon: 106.63, lat: 26.647, height: 100 },
            { lon: 106.64, lat: 26.65, height: 200 },
          ],
        },
      },
    ],
  }
  assert.equal(await call('setDefinition', minimal), true)
  assert.equal((await state()).validationError, '')
  await page
    .locator('input[type="file"]')
    .setInputFiles({
      name: 'animation.json',
      mimeType: 'application/json',
      buffer: Buffer.from(exported),
    })
  await page.waitForFunction(
    (count) =>
      window.__animationLab.getState().definition.tracks.length === count,
    beforeInvalid.tracks.length,
  )
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click()
  const download = await downloadPromise
  const exportPath = path.join(output, 'exported-animation.json')
  await download.saveAs(exportPath)
  assert.deepEqual(
    JSON.parse(await fs.readFile(exportPath, 'utf8')),
    beforeInvalid,
  )
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__animationLab?.getState().ready)
  assert.deepEqual((await state()).definition, beforeInvalid)
  checks.push(
    'JSON export/download/local persistence; invalid input preserves the current animation; omitted options get working GUI defaults',
  )

  for (const location of ['equator', 'guiyang', 'high-latitude']) {
    await call('setLocation', location)
    await call('action', 'play')
    await call('seek', 12)
    await waitParticles()
    for (const view of ['overview', 'side', 'fountain']) {
      await call('setView', view)
      await frames(5)
    }
    current = await state()
    const fountain = current.resources.effects.find(
      (effect) => effect.kind === 'fountain',
    )
    const lon =
      location === 'equator' ? 0 : location === 'guiyang' ? 106.6302 : 18.9553
    const lat =
      location === 'equator' ? 0 : location === 'guiyang' ? 26.647 : 69.6492
    const radians = Math.PI / 180
    const up = {
      x: Math.cos(lat * radians) * Math.cos(lon * radians),
      y: Math.cos(lat * radians) * Math.sin(lon * radians),
      z: Math.sin(lat * radians),
    }
    const dot = Object.keys(up).reduce(
      (sum, axis) => sum + up[axis] * fountain.gravityDirection[axis],
      0,
    )
    assert(Math.abs(dot + 1) < 1e-8)
    samples.push({ stage: location, state: current })
    await call('action', 'stop')
  }
  checks.push(
    'Timeline-driven ENU particles at three locations and three camera views',
  )

  for (let index = 0; index < 20; index++) {
    await call('action', 'destroy')
    current = await state()
    assert.equal(current.primitiveCount, 0)
    assert.equal(current.resources.effectCount, 0)
    assert.equal(current.resources.timelineCount, 0)
    assert.equal(current.resources.schedulerPending, false)
    await call('action', 'create')
    await call('action', 'play')
    await call('seek', 12)
    await waitParticles()
    await call('action', 'pause')
    await call('action', 'resume')
    await frames(2)
    await call('action', 'stop')
  }
  checks.push(
    '20 create/play/seek/pause/resume/stop/dispose cycles restore resource and scheduler baselines',
  )

  const loopDefinition = {
    schemaVersion: 1,
    duration: 2,
    loop: 'repeat',
    tracks: [
      {
        id: 'loop-fly',
        kind: 'fly-line',
        at: 0,
        duration: 2,
        options: minimal.tracks[0].options,
      },
      {
        id: 'loop-water',
        kind: 'fountain',
        at: 0,
        duration: 2,
        options: { position: { lon: 106.63, lat: 26.647, height: 0 } },
      },
    ],
  }
  await call('setDefinition', loopDefinition)
  await call('setSpeed', 4)
  await call('action', 'play')
  for (let index = 0; index < 20; index++) {
    await call('seek', 1.98)
    await page.waitForFunction(
      () => window.__animationLab.getState().timeline.timeSeconds < 1,
    )
    current = await state()
    assert.equal(current.resources.effectCount, 2)
    assert.equal(current.primitiveCount, 2)
    assert.equal(current.resources.timelineCount, 1)
  }
  await call('action', 'stop')
  assert.equal((await state()).resources.schedulerPending, false)
  checks.push(
    '20 repeat boundaries reset stateful effects without accumulating resources',
  )

  const consumerBase = await startPackageServer()
  const independent = await context.newPage()
  monitor(independent)
  await independent.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      url.origin !== new URL(consumerBase).origin
    ) {
      externalRequests.push(url.origin + url.pathname)
      await route.abort()
    } else await route.continue()
  })
  await independent.goto(consumerBase, { waitUntil: 'domcontentloaded' })
  await independent.waitForFunction(
    () => window.__animationConsumer?.getState().ready,
    null,
    { timeout: 30000 },
  )
  const independentState = () =>
    independent.evaluate(() => window.__animationConsumer.getState())
  const seekReport = await independent.evaluate(() =>
    window.__animationConsumer.seek(5),
  )
  assert.deepEqual(seekReport, {
    exact: ['fly', 'arrow', 'camera'],
    reset: ['water'],
  })
  const pose = (await independentState()).camera
  await independent.evaluate(() => {
    window.__animationConsumer.seek(1)
    window.__animationConsumer.seek(5)
  })
  assert.deepEqual((await independentState()).camera, pose)
  await independent.evaluate(() => {
    window.__animationConsumer.play()
    window.__animationConsumer.seek(4)
  })
  await frames(24, independent)
  let consumerState = await independentState()
  assert(consumerState.timeline.timeSeconds > 4)
  assert.equal(consumerState.clockUnchanged, true)
  assert.equal(consumerState.hostResourcesPreserved, true)
  await independent.evaluate(() => window.__animationConsumer.destroy())
  consumerState = await independentState()
  assert.deepEqual(consumerState.resources, consumerState.baseline)
  await independent.evaluate(() => {
    window.__animationConsumer.setExternal()
    window.__animationConsumer.setTime(4)
  })
  await frames(16, independent)
  assert.equal((await independentState()).timeline.timeSeconds, 4)
  const rejected = await independent.evaluate(() => {
    try {
      window.__animationConsumer.play()
      return ''
    } catch (error) {
      return String(error)
    }
  })
  assert.match(rejected, /External/)
  await independent.evaluate(() => window.__animationConsumer.setTime(5))
  await frames(4, independent)
  assert.equal((await independentState()).clockUnchanged, true)
  samples.push({
    stage: 'installed-tarball-browser-consumer',
    state: await independentState(),
  })
  await independent.evaluate(() =>
    window.__animationConsumer.viewerFirstDestroy(),
  )
  assert(
    (await independentState()).effects.every(
      (effect) => effect.state === 'destroyed',
    ),
  )
  assert.deepEqual((await independentState()).errors, [])
  await independent.close()
  checks.push(
    'Actual installed tgz in a separate framework-free browser host: camera seek, playback, external setTime and host resource preservation',
  )

  await call('action', 'create')
  await call('action', 'play')
  await call('viewerFirstDestroy')
  assert.equal((await state()).ready, false)
  await call('recreateViewer')
  await page.waitForFunction(() => window.__animationLab.getState().ready)
  await call('action', 'play')
  await page.getByRole('link', { name: '← 示例首页' }).click()
  await page.waitForFunction(() => !window.__animationLab)
  await frames()
  assert.equal(await page.locator('.cesium-widget canvas').count(), 0)
  checks.push(
    'Viewer-first destruction, recreation and route unmount release animation resources and UI subscriptions',
  )

  assert.equal(errors.length, 0, errors.join('\n'))
  assert.equal(externalRequests.length, 0, externalRequests.join('\n'))
} catch (error) {
  failure = String(error.stack ?? error)
} finally {
  const report = {
    passed: !failure,
    checks,
    samples,
    errors,
    externalRequests,
    optionalHomeRequests,
    failure,
    browser: await browser.version(),
    environment: { platform: process.platform, architecture: process.arch },
    note: 'Behavioral/WebGL acceptance only; no screenshots, recording or subjective visual acceptance. This is not a long-duration particle performance baseline.',
  }
  await fs.writeFile(
    path.join(output, 'report.json'),
    JSON.stringify(report, null, 2),
  )
  await browser.close()
  if (consumerServer) {
    consumerServer.closeAllConnections()
    await new Promise((resolve) => consumerServer.close(resolve))
  }
}
if (failure) {
  console.error(failure)
  process.exitCode = 1
} else
  console.log(
    JSON.stringify(
      { passed: true, checks, report: path.join(output, 'report.json') },
      null,
      2,
    ),
  )
