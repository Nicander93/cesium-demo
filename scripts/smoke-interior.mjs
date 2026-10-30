#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH
const base = process.env.PRACTICE_BASE_URL ?? 'http://127.0.0.1:5175/cesium-demo/'
const origin = new URL(base).origin
const firstPersonUrl = new URL('first-person-lab?scene=living-room', base).href
const output = path.resolve(process.env.PRACTICE_OUTPUT ?? path.join(root, 'test-results/interior'))
const assetDir = path.join(root, 'public/first-person-lab/interior')
await fs.mkdir(output, { recursive: true })

let chromium
let manifest
let probe
let modelBytes
let collisionBytes
let modelHash
let collisionHash
let gltf
let assetEvidence = {}
let browser
let context
let page
let failure = ''
let gpu
const checks = []
const samples = []
const errors = []
const unhandled = []
const externalRequests = []
const requestFailures = []
const networkFailures = []

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function monitor(target, label) {
  target.on('pageerror', error => errors.push({ page: label, type: 'pageerror', message: String(error.stack ?? error) }))
  target.on('console', message => {
    if (message.type() === 'error') errors.push({ page: label, type: 'console', message: message.text() })
  })
  target.on('requestfailed', request => {
    if (/^wss?:/i.test(request.url())) return
    let url
    try { url = new URL(request.url()) } catch { return }
    requestFailures.push({ page: label, url: request.url(), error: request.failure()?.errorText ?? 'unknown' })
    if (url.origin !== origin) networkFailures.push(request.url())
  })
}

async function restrictNetwork(target) {
  await target.route('**/*', async route => {
    const requestUrl = new URL(route.request().url())
    if (['http:', 'https:'].includes(requestUrl.protocol) && requestUrl.origin !== origin) {
      externalRequests.push(requestUrl.origin + requestUrl.pathname)
      await route.abort()
      return
    }
    await route.continue()
  })
}

async function installUnhandledMonitor(target) {
  await target.addInitScript(() => {
    window.__interiorSmokeUnhandled = []
    window.addEventListener('unhandledrejection', event => {
      window.__interiorSmokeUnhandled.push(String(event.reason?.stack ?? event.reason))
    })
  })
}

const state = target => target.evaluate(() => window.__firstPersonLab?.getState() ?? null)
const call = (target, method, ...args) => target.evaluate(
  ([methodName, methodArgs]) => window.__firstPersonLab[methodName](...methodArgs),
  [method, args],
)

async function waitForReady(target, timeout = 90000) {
  await target.waitForFunction(() => Boolean(window.__firstPersonLab), null, { timeout })
  await target.evaluate(async () => window.__firstPersonLab.ready)
  await target.waitForFunction(() => window.__firstPersonLab?.getState().ready === true, null, { timeout })
  const current = await state(target)
  assert.equal(current.fixture, false, 'Real interior suite must never accept the procedural fixture')
  assert.equal(current.error, '')
  return current
}

async function navigate(target) {
  const url = new URL(target, base)
  await page.evaluate(path => {
    history.pushState({}, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, url.pathname + url.search)
}
async function waitForOtherScene() {
  await page.waitForFunction(() => {
    const state = window.__vegetationLab?.getState()
    return state?.ready && !state.busy && state.pending === 0 && state.loadedInstances === state.count
  }, null, { timeout: 90000 })
}

function vectorProgress(start, end, vector) {
  const length = Math.hypot(vector.x, vector.y)
  return ((end.x - start.x) * vector.x + (end.y - start.y) * vector.y) / length
}

function positionDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.footHeight - b.footHeight)
}

async function sampleGpu(target) {
  return target.evaluate(() => {
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
}

try {
  chromium = modulePath
    ? (await import(pathToFileURL(modulePath).href)).chromium
    : (await import('playwright')).chromium
  manifest = JSON.parse(await fs.readFile(path.join(assetDir, 'manifest.json'), 'utf8'))
  probe = JSON.parse(await fs.readFile(path.join(assetDir, 'spawn-probe.json'), 'utf8'))
  modelBytes = await fs.readFile(path.join(assetDir, manifest.model))
  collisionBytes = await fs.readFile(path.join(assetDir, manifest.collision))
  modelHash = sha256(modelBytes)
  collisionHash = sha256(collisionBytes)
  assert.equal(modelBytes.toString('ascii', 0, 4), 'glTF', 'Interior model must be a binary glTF')
  assert.equal(modelBytes.readUInt32LE(4), 2, 'Interior model must use GLB 2.0')
  assert.equal(modelBytes.readUInt32LE(8), modelBytes.length, 'GLB declared length must match the local file')
  assert.equal(modelBytes.readUInt32LE(16), 0x4e4f534a, 'GLB must begin with its JSON chunk')
  const gltfJsonLength = modelBytes.readUInt32LE(12)
  gltf = JSON.parse(modelBytes.toString('utf8', 20, 20 + gltfJsonLength))
  const assetReadme = await fs.readFile(path.join(assetDir, 'README.md'), 'utf8')
  const readmeHash = label => {
    const expression = new RegExp(`\\|\\s*${label}\\s*\\|\\s*\\x60([a-f0-9]{64})\\x60`, 'i')
    return assetReadme.match(expression)?.[1] ?? null
  }
  const upstreamCommit = manifest.sourceUrl.match(/tree\/([a-f0-9]{40})\//i)?.[1] ?? null
  assetEvidence = {
    name: manifest.name, author: manifest.author, sourceUrl: manifest.sourceUrl,
    sourceRevision: upstreamCommit, license: manifest.license,
    modelBytes: modelBytes.length, collisionBytes: collisionBytes.length,
    modelSha256: modelHash, collisionSha256: collisionHash,
    sourceGltfSha256: readmeHash('source `living_room_core\\.gltf`'),
    sourceBinSha256: readmeHash('source LFS `living_room\\.bin`'),
    gltfMaterials: gltf.materials?.length ?? 0, gltfImages: gltf.images?.length ?? 0,
    collisionTriangles: manifest.triangleCount,
  }
  assert.equal(manifest.author, 'Wig42')
  assert.equal(manifest.license, 'CC-BY-3.0')
  assert.equal(manifest.triangleCount, 131989)
  assert.equal(collisionBytes.length, manifest.triangleCount * 9 * 4)
  assert.equal(gltf.materials?.length, 19)
  assert.equal(gltf.images?.length, 5)
  assert.equal(assetEvidence.sourceRevision, '1f47d4c63bcad7582150d68300308b0c913bda6c')
  assert.equal(assetEvidence.sourceGltfSha256, '75210889556a32f5e19d7086b722fb153e584b1d82444b5d43947bc5f78bb55b')
  assert.equal(assetEvidence.sourceBinSha256, '13365708f56b59b2e255070ae392af43df7d15c032da6ffd04bde7750c6e0c7c')
  assert.equal(modelHash, '5cdfba85f6505403552c0980a6d1738443be295d60b3cd40bf7f154b3e3d2656')
  assert.equal(collisionHash, '895d44f43a66f6d7b8d91a5d847c57510d2ba028fb70307ee30db7bc54a6ef3b')

  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  })
  context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  page = await context.newPage()
  page.setDefaultTimeout(20000)
  monitor(page, 'main')
  await installUnhandledMonitor(page)
  await restrictNetwork(page)

  await page.goto(firstPersonUrl, { waitUntil: 'domcontentloaded' })
  let current = await waitForReady(page)
  assert.equal(current.fixture, false)
  assert.equal(current.modelName, manifest.name)
  assert.equal(current.collisionTriangles, manifest.triangleCount)
  assert.equal(current.grounded, true)
  assert(Math.abs(current.player.footHeight - 0.003162) < 0.025, `Unexpected floor height: ${current.player.footHeight}`)
  assert.match(await page.locator('.walk-lab__help').innerText(), /拖动旋转/)

  const localAssets = await page.evaluate(async basePath => {
    const [model, collision] = await Promise.all([
      fetch(`${basePath}model.glb`), fetch(`${basePath}collision.bin`),
    ])
    return {
      modelStatus: model.status, modelType: model.headers.get('content-type'), modelBytes: (await model.arrayBuffer()).byteLength,
      collisionStatus: collision.status, collisionType: collision.headers.get('content-type'), collisionBytes: (await collision.arrayBuffer()).byteLength,
    }
  }, new URL('first-person-lab/interior/', base).href)
  assert.equal(localAssets.modelStatus, 200)
  assert.equal(localAssets.collisionStatus, 200)
  assert.equal(localAssets.modelBytes, modelBytes.length)
  assert.equal(localAssets.collisionBytes, collisionBytes.length)
  checks.push('Local GLB and collider fetch successfully; GLB parses as 19-material/5-image PBR asset and the triangle count matches the 131,989-triangle collision file')

  const panel = await page.locator('.walk-lab__panel').boundingBox()
  assert(panel)
  assert(panel.width <= 320, `Control panel too wide: ${panel.width}`)
  assert(panel.height <= 200, `Collapsed control panel too tall: ${panel.height}`)
  assert.equal(await page.locator('.cesium-widget canvas').count(), 1)
  gpu = await sampleGpu(page)
  const scene = await call(page, 'inspectScene')
  assert.equal(scene.renderer, 'Cesium')
  assert.equal(scene.modelReady, true)
  assert.equal(scene.ibl, 9)
  assert.equal(scene.shadows, true)
  const colliderCenter = scene.collisionBounds.min.map((value, index) => (value + scene.collisionBounds.max[index]) / 2)
  const manifestCenter = manifest.bounds.min.map((value, index) => (value + manifest.bounds.max[index]) / 2)
  assert(scene.modelCenter && Math.hypot(...scene.modelCenter.map((value, index) => value - colliderCenter[index])) < 0.5,
    `Model sphere center ${scene.modelCenter} must correspond to the normalized collider center ${colliderCenter}`)
  const colliderRadius = Math.hypot(...scene.collisionBounds.max.map((value, index) => value - scene.collisionBounds.min[index])) / 2
  assert(scene.modelRadius >= colliderRadius - 0.15, `Model sphere radius ${scene.modelRadius} does not cover collider extent ${colliderRadius}`)
  assert(scene.modelRadius < 6, `Unexpected model scale/radius: ${scene.modelRadius}`)
  assert(scene.collisionBounds.min.every((value, index) => Math.abs(value - manifest.bounds.min[index]) < 1e-4))
  assert(scene.collisionBounds.max.every((value, index) => Math.abs(value - manifest.bounds.max[index]) < 1e-4))
  samples.push({ stage: 'ready-real-model', state: current, scene, panel, localAssets, gpu })
  checks.push('Cesium model sphere matches normalized ENU collider bounds; grounded floor height, one canvas, compact panel and overview hint are present')

  const entryProbe = probe.spawns.find(item => item.spawn.id === 'entry')
  const insideProbe = probe.spawns.find(item => item.spawn.id === 'inside')
  assert(entryProbe && insideProbe, 'Spawn probe must record both entry and inside movement paths')
  assert(entryProbe.path.distance >= 1 && insideProbe.path.distance >= 1)

  await call(page, 'spawnAt', 'entry')
  const entryStart = await state(page)
  const entryPath = entryProbe.path
  const entryLength = Math.hypot(entryPath.velocity.x, entryPath.velocity.y)
  const entryDirection = { x: entryPath.velocity.x / entryLength, y: entryPath.velocity.y / entryLength }
  await page.getByRole('button', { name: '键鼠漫游' }).click()
  await page.waitForFunction(() => window.__firstPersonLab?.getState().mode === 'walking')
  await page.keyboard.down('w')
  await page.waitForTimeout(380)
  await page.keyboard.press('Escape')
  const afterEntryWalk = await state(page)
  await page.keyboard.up('w')
  assert.equal(afterEntryWalk.mode, 'paused')
  assert(afterEntryWalk.grounded)
  const entryProgress = vectorProgress(entryStart.player, afterEntryWalk.player, entryDirection)
  assert(entryProgress > 0.4, `Real W input moved only ${entryProgress.toFixed(3)} m along the recorded safe route`)
  await page.waitForTimeout(150)
  const afterPause = await state(page)
  assert(positionDistance(afterEntryWalk.player, afterPause.player) < 0.02, 'Esc must stop movement at the paused position')
  samples.push({ stage: 'real-enter-keyboard-w-and-escape', start: entryStart.player, afterWAndEscape: afterEntryWalk.player, paused: afterPause.player, route: entryPath, progressMeters: entryProgress })
  checks.push('A real Enter click followed by physical W advances over 0.4 m on the probed route; Esc pauses and keeps position stable')

  const wallProbe = entryProbe.path.wallOrFurnitureBlock
  assert(wallProbe, 'Entry probe must provide a measured static-wall/furniture blocker point')
  await call(page, 'spawnAt', 'entry')
  await call(page, 'look', wallProbe.heading, -0.14)
  const wallStart = await state(page)
  await page.getByRole('button', { name: '键鼠漫游' }).click()
  await page.waitForFunction(() => window.__firstPersonLab?.getState().mode === 'walking')
  await page.keyboard.down('w')
  await page.waitForTimeout(1200)
  const beforeWallPause = await state(page)
  await page.keyboard.press('Escape')
  await page.keyboard.up('w')
  const wallPaused = await state(page)
  const expectedBlockDistance = wallProbe.distanceBeforeBlock
  const actualWallProgress = vectorProgress(wallStart.player, beforeWallPause.player, wallProbe.velocity)
  assert(beforeWallPause.grounded)
  assert(Math.abs(beforeWallPause.player.footHeight - wallStart.player.footHeight) < 0.025)
  assert(actualWallProgress > 0.15, `Movement did not reach the measured wall/furniture collider (${actualWallProgress.toFixed(3)} m)`)
  assert(actualWallProgress <= expectedBlockDistance + 0.2,
    `Player passed the measured static blocker: actual=${actualWallProgress.toFixed(3)} m, probe=${expectedBlockDistance.toFixed(3)} m`)
  assert(positionDistance(beforeWallPause.player, wallPaused.player) < 0.02)
  samples.push({ stage: 'real-wall-furniture-block', start: wallStart.player, velocity: wallProbe.velocity, expectedBlockDistance, expectedBlockPoint: wallProbe.point, actualProgress: actualWallProgress, blocked: beforeWallPause.player, grounded: beforeWallPause.grounded })
  checks.push('Real W input reaches the recorded wall/furniture collider without crossing it and remains grounded')

  await call(page, 'spawnAt', 'entry')
  let located = await state(page)
  assert(positionDistance(located.player, { x: manifest.spawns[0].position[0], y: manifest.spawns[0].position[1], footHeight: manifest.spawns[0].position[2] }) < 0.02)
  await call(page, 'look', manifest.spawns[0].heading, manifest.spawns[0].pitch)
  let looked = await state(page)
  assert(Math.abs(looked.player.pitch - manifest.spawns[0].pitch) < 1e-6)
  await call(page, 'spawnAt', 'inside')
  located = await state(page)
  const insideSpawn = manifest.spawns.find(spawn => spawn.id === 'inside')
  assert(insideSpawn)
  assert(positionDistance(located.player, { x: insideSpawn.position[0], y: insideSpawn.position[1], footHeight: insideSpawn.position[2] }) < 0.02)
  await call(page, 'look', insideSpawn.heading, insideSpawn.pitch)
  looked = await state(page)
  assert(Math.abs(looked.player.pitch - insideSpawn.pitch) < 1e-6)

  await page.getByRole('button', { name: '场景与画质' }).click()
  await page.getByRole('button', { name: '剖切总览' }).click()
  assert.equal((await state(page)).mode, 'inspect')
  const exposureInput = page.locator('.walk-lab__settings label:has-text("曝光") input[type="range"]')
  await exposureInput.focus()
  await exposureInput.press('ArrowRight')
  await page.waitForFunction(() => Math.abs(window.__firstPersonLab.inspectScene().exposure - 1.2) < 0.001)
  const aoToggle = page.locator('.walk-lab__settings label:has-text("环境遮蔽") input[type="checkbox"]')
  await aoToggle.uncheck()
  assert.equal((await call(page, 'inspectScene')).occlusion, false)
  await aoToggle.check()
  const sceneAfterControls = await call(page, 'inspectScene')
  current = await state(page)
  assert(current.ready && current.error === '')
  assert.equal(sceneAfterControls.modelReady, true)
  assert.equal(sceneAfterControls.exposure, current.exposure)
  samples.push({ stage: 'spawns-look-inspection-lighting-and-ao', entry: manifest.spawns.find(spawn => spawn.id === 'entry'), inside: insideSpawn, state: current, scene: sceneAfterControls })
  checks.push('Entry/inside spawn and look work; overview, exposure and AO controls leave the real Cesium model ready')

  await call(page, 'spawnAt', 'entry')
  await page.getByRole('button', { name: '键鼠漫游' }).click()
  await page.waitForFunction(() => window.__firstPersonLab?.getState().mode === 'walking')
  await page.keyboard.down('w')
  await page.waitForTimeout(100)
  // Escape releases pointer lock and clears runtime input while physical W stays held.
  await page.keyboard.press('Escape')
  // Keep the physical W key down while a real RouterLink unmounts the Cesium page.
  await navigate('vegetation-lab?surface=synthetic')
  await page.waitForFunction(() => !window.__firstPersonLab)
  await page.keyboard.up('w')
  await waitForOtherScene()
  assert.equal(await page.locator('.cesium-widget canvas').count(), 1)
  await navigate('first-person-lab?scene=living-room')
  current = await waitForReady(page)
  assert.equal(current.mode, 'inspect')
  assert.equal(current.fixture, false)
  assert.equal(await page.locator('.cesium-widget canvas').count(), 1)
  samples.push({ stage: 'route-unmount-remount', state: current, canvases: await page.locator('.cesium-widget canvas').count() })
  checks.push('SPA navigation unmounts the first-person runtime while W is physically held; returning remounts in overview with one Cesium canvas')

  let releaseCollision
  let resolveCollisionRequested
  const collisionGate = new Promise(resolve => { releaseCollision = resolve })
  const collisionRequested = new Promise(resolve => { resolveCollisionRequested = resolve })
  await page.route('**/first-person-lab/interior/collision.bin', async route => {
    resolveCollisionRequested()
    await collisionGate
    await route.continue()
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await collisionRequested
  await page.waitForFunction(() => window.__firstPersonLab && window.__firstPersonLab.getState().ready === false)
  const delayedState = await state(page)
  assert.equal(delayedState.fixture, false)
  assert.equal(delayedState.ready, false)
  await navigate('vegetation-lab?surface=synthetic')
  await page.waitForFunction(() => !window.__firstPersonLab)
  const delayedCollisionFinished = page.waitForEvent('requestfinished', {
    predicate: request => new URL(request.url()).pathname.endsWith('/first-person-lab/interior/collision.bin'),
    timeout: 15000,
  })
  releaseCollision()
  await delayedCollisionFinished
  await page.waitForTimeout(100)
  await waitForOtherScene()
  assert.equal(await page.locator('.cesium-widget canvas').count(), 1)
  const delayedUnhandled = await page.evaluate(() => window.__interiorSmokeUnhandled)
  assert.deepEqual(delayedUnhandled, [])
  assert.equal(await page.evaluate(() => Boolean(window.__firstPersonLab)), false)
  checks.push('Delayed local collision fetch released after route unmount produces no stale debug API or unhandled rejection')

  assert.deepEqual(externalRequests, [], `Unexpected external resource requests: ${externalRequests.join(', ')}`)
  assert.deepEqual(networkFailures, [], `Unexpected external request failures: ${networkFailures.join(', ')}`)
  assert.deepEqual(requestFailures, [], `Unexpected request failures: ${JSON.stringify(requestFailures)}`)
  assert.deepEqual(errors, [], `Browser page/render errors: ${JSON.stringify(errors)}`)
  assert.equal((await page.evaluate(() => window.__interiorSmokeUnhandled)).length, 0)
} catch (error) {
  failure = String(error.stack ?? error)
  if (page && !page.isClosed()) {
    try { samples.push({ stage: 'failure-state', url: page.url(), firstPerson: await state(page) }) }
    catch { /* keep the first failure and report what was captured */ }
  }
} finally {
  const unhandledOnMain = page && !page.isClosed()
    ? await page.evaluate(() => window.__interiorSmokeUnhandled ?? []).catch(() => [])
    : []
  if (browser) await browser.close().catch(error => { if (!failure) failure = String(error) })
  const report = {
    passed: !failure,
    checks,
    samples,
    assets: assetEvidence,
    gpu,
    errors,
    unhandled: [...unhandled, ...unhandledOnMain],
    externalRequests,
    networkFailures,
    requestFailures,
    failure,
    browser: browser ? browser.version() : null,
    environment: { platform: process.platform, architecture: process.arch, baseUrl: base },
    note: 'Behavioral Cesium/Playwright acceptance only. No screenshots or recordings were created. FPS is recorded only as runtime state; no fixed performance target is claimed.',
  }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
}

if (failure) {
  console.error(failure)
  process.exitCode = 1
} else {
  console.log(JSON.stringify({ passed: true, checks, report: path.join(output, 'report.json') }, null, 2))
}

