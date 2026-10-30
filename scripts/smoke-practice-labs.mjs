import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const modulePath = process.env.PLAYWRIGHT_MODULE_PATH
const { chromium } = modulePath
  ? await import(pathToFileURL(modulePath).href)
  : await import('playwright')
const base = process.env.PRACTICE_BASE_URL ?? 'http://127.0.0.1:5175/cesium-demo/'
const origin = new URL(base).origin
const output = path.resolve(
  process.env.PRACTICE_OUTPUT ?? path.join(root, 'test-results', 'practice-labs'),
)
await fs.mkdir(output, { recursive: true })

let browser
let page
let failure
let gpu
const checks = []
const samples = []
const errors = []
const externalRequests = []
const networkFailures = []

function monitor(target) {
  target.on('pageerror', error => errors.push(String(error.stack ?? error)))
  target.on('console', message => {
    if (message.type() === 'error') errors.push(message.text())
  })
  target.on('requestfailed', request => {
    if (/^wss?:/i.test(request.url())) return
    const requestOrigin = new URL(request.url()).origin
    if (requestOrigin !== origin) networkFailures.push(request.url())
  })
}

async function restrictNetwork(target) {
  await target.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) {
      externalRequests.push(url.origin + url.pathname)
      await route.abort()
      return
    }
    await route.continue()
  })
}

const vegetationState = () => page.evaluate(() => window.__vegetationLab?.getState())
const vegetationCall = (method, ...args) =>
  page.evaluate(
    ([method, args]) => window.__vegetationLab[method](...args),
    [method, args],
  )
const walkingState = () => page.evaluate(() => window.__firstPersonLab?.getState())
const walkingCall = (method, ...args) =>
  page.evaluate(
    ([method, args]) => window.__firstPersonLab[method](...args),
    [method, args],
  )

async function waitVegetationLoaded(count, timeout = 90000) {
  await page.waitForFunction(
    expected => {
      const state = window.__vegetationLab?.getState()
      return state && state.count === expected && state.pending === 0 && state.loadedInstances === expected
    },
    count,
    { timeout },
  )
  const state = await vegetationState()
  assert.equal(state.error, '')
  return state
}

async function waitForVegetationIdle(timeout = 90000) {
  await page.waitForFunction(
    () => {
      const state = window.__vegetationLab?.getState()
      return state && state.pending === 0 && state.loadedInstances === state.count
    },
    null,
    { timeout },
  )
  const state = await vegetationState()
  assert.equal(state.error, '')
  return state
}

function plantingSnapshot(state) {
  const { fps, frameP95, ...stable } = state
  return stable
}

async function nextFrames(count = 8) {
  await page.evaluate(frames => new Promise(resolve => {
    const step = () => --frames <= 0 ? resolve() : requestAnimationFrame(step)
    requestAnimationFrame(step)
  }), count)
}

async function clickScene(points) {
  const canvas = page.locator('.cesium-widget canvas').first()
  const bounds = await canvas.boundingBox()
  assert(bounds, 'Cesium scene canvas must be present')
  for (const [x, y] of points) {
    await page.mouse.click(bounds.x + x, bounds.y + y)
    await page.waitForTimeout(150)
  }
}

async function dragScene(start, end, steps = 12) {
  const canvas = page.locator('.cesium-widget canvas').first()
  const bounds = await canvas.boundingBox()
  assert(bounds, 'Cesium scene canvas must be present')
  await page.mouse.move(bounds.x + start[0], bounds.y + start[1])
  await page.mouse.down()
  await page.mouse.move(bounds.x + end[0], bounds.y + end[1], { steps })
  await page.mouse.up()
}

try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  page = await context.newPage()
  monitor(page)
  await restrictNetwork(page)

  const syntheticVegetationUrl = new URL('vegetation-lab?surface=synthetic', base).href
  await page.goto(syntheticVegetationUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => Boolean(window.__vegetationLab), null, { timeout: 30000 })
  await page.evaluate(() => window.__vegetationLab.ready)
  await page.evaluate(async url => {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Local pine texture unavailable: ${response.status}`)
  }, new URL('vegetation-lab/pine_tree_01/twig_basecolor_alpha_1k.png', base).href)
  await page.getByRole('heading', { name: '植被种植实验' }).waitFor({ state: 'visible' })
  await page.getByTestId('plant-count').waitFor({ state: 'visible' })
  await waitVegetationLoaded(1000)
  assert.equal((await vegetationState()).terrain.kind, 'synthetic', 'Offline behavior suite must use the synthetic surface')
  await nextFrames(200)
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
  samples.push({ stage: 'initial-1000-steady', gpu, state: await vegetationState() })
  checks.push('Vegetation route initializes 1,000 plants and resolves all chunks and instances')

  const spacing = page.locator('.vegetation-lab__panel input[type="range"]').nth(2)
  await spacing.evaluate(element => {
    element.value = '0.5'
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.getByRole('button', { name: '单株', exact: true }).click()
  let mouseBefore = (await vegetationState()).count
  await clickScene([[900, 500], [1060, 570], [1160, 680], [760, 690]])
  await page.waitForFunction(before => window.__vegetationLab.getState().count > before, mouseBefore, { timeout: 10000 })
  const singleState = await waitForVegetationIdle()
  assert(singleState.count > mouseBefore)
  samples.push({ stage: 'real-single-plant-click', state: singleState })
  checks.push('A real mouse click through the Single tool creates a plant on the scene surface')

  await page.getByRole('button', { name: '笔刷', exact: true }).click()
  mouseBefore = (await vegetationState()).count
  await clickScene([[980, 470], [1120, 600]])
  await page.waitForFunction(before => window.__vegetationLab.getState().count > before, mouseBefore, { timeout: 10000 })
  await waitForVegetationIdle()
  checks.push('A real brush press stamps more vegetation through pointer input')

  mouseBefore = (await vegetationState()).count
  await dragScene([900, 510], [1100, 620], 16)
  await page.waitForFunction(before => window.__vegetationLab.getState().count > before, mouseBefore, { timeout: 10000 })
  const strokeState = await waitForVegetationIdle()
  assert(strokeState.count > mouseBefore)
  await vegetationCall('undo')
  const afterStrokeUndo = await waitVegetationLoaded(mouseBefore)
  assert.equal(afterStrokeUndo.count, mouseBefore)
  checks.push('Continuous brush drag is recorded as one undoable planting stroke')

  await page.getByRole('button', { name: '框选', exact: true }).click()
  mouseBefore = (await vegetationState()).count
  await dragScene([910, 440], [1090, 590], 10)
  await page.waitForFunction(() => !window.__vegetationLab.getState().busy, null, { timeout: 30000 })
  const areaState = await waitForVegetationIdle()
  assert(areaState.count > mouseBefore, `Area selection did not add plants (${mouseBefore} -> ${areaState.count})`)
  await vegetationCall('undo')
  const afterAreaUndo = await waitVegetationLoaded(mouseBefore)
  assert.equal(afterAreaUndo.count, mouseBefore)
  checks.push('A real rectangular mouse drag plants an area and one undo removes the whole fill')

  let baseCount = (await vegetationState()).count
  let planted
  for (let index = 0; index < 100 && !planted; index++) {
    const x = 220 - index % 10 * 1.5
    const y = 220 - Math.floor(index / 10) * 1.5
    planted = await vegetationCall('add', x, y)
  }
  assert(planted, 'A deterministic low-density spot should accept a single API plant')
  assert.equal((await vegetationState()).count, baseCount + 1)
  assert.equal(await vegetationCall('erase', planted.x, planted.y, 0.6), 1)
  assert.equal((await vegetationState()).count, baseCount)
  await vegetationCall('undo')
  assert.equal((await vegetationState()).count, baseCount + 1)
  await vegetationCall('redo')
  assert.equal((await vegetationState()).count, baseCount)
  planted = await vegetationCall('add', 220, 220)
  if (!planted) {
    for (let index = 1; index < 100 && !planted; index++) {
      planted = await vegetationCall('add', 220 - index % 10 * 1.5, 220 - Math.floor(index / 10) * 1.5)
    }
  }
  assert(planted)
  await waitForVegetationIdle()
  const exported = await vegetationCall('exportJson')
  const parsedExport = JSON.parse(exported)
  assert.equal(parsedExport.plants.length, (await vegetationState()).count)
  const exportPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click()
  const download = await exportPromise
  await download.saveAs(path.join(output, 'vegetation-export.json'))
  const beforeBadImport = await vegetationState()
  const badImportError = await page.evaluate(() => {
    try { window.__vegetationLab.importJson('{bad-json') } catch (error) { return String(error) }
    return ''
  })
  assert.match(badImportError, /JSON|position|Unexpected/i)
  assert.deepEqual(plantingSnapshot(await vegetationState()), plantingSnapshot(beforeBadImport), 'Invalid JSON must preserve planting state')
  await vegetationCall('clear')
  await waitVegetationLoaded(0)
  const input = page.locator('input[type="file"][accept="application/json,.json"]')
  await input.setInputFiles({ name: 'vegetation.json', mimeType: 'application/json', buffer: Buffer.from(exported) })
  await waitVegetationLoaded(parsedExport.plants.length)
  checks.push('Single add, erase, undo, redo, downloaded export, invalid import preservation and valid import restore work')

  const raceImport = structuredClone(parsedExport)
  const nextId = Math.max(0, ...raceImport.plants.map(plant => plant.id)) + 1
  const raceX = 232
  const raceY = 232
  raceImport.plants.push({
    id: nextId,
    species: 'pine',
    x: raceX,
    y: raceY,
    z: 3 + 2.4 * Math.sin(raceX / 65) * Math.cos(raceY / 75),
    scale: 1,
    yaw: 0,
  })
  await vegetationCall('clear')
  await waitVegetationLoaded(0)
  const beforeImportRace = await page.evaluate(async json => {
    const api = window.__vegetationLab
    await api.fill(250)
    const state = api.getState()
    api.importJson(json)
    return state
  }, JSON.stringify(raceImport))
  assert.equal(beforeImportRace.count, 250)
  const afterImportRace = await waitVegetationLoaded(raceImport.plants.length, 120000)
  samples.push({ stage: 'fill-while-import-replaces-pending-tiles', beforeImport: beforeImportRace, state: afterImportRace })
  await vegetationCall('clear')
  await waitVegetationLoaded(0, 120000)
  const beforeClearRace = await page.evaluate(async () => {
    const api = window.__vegetationLab
    await api.fill(250)
    const state = api.getState()
    api.clear()
    return state
  })
  assert.equal(beforeClearRace.count, 250)
  const afterClearRace = await waitVegetationLoaded(0, 120000)
  samples.push({ stage: 'clear-while-fill-chunk-loads', beforeClear: beforeClearRace, state: afterClearRace })
  checks.push('Import replacement and clear settle correctly while batch-built tile models are loading')

  await vegetationCall('clear')
  await waitVegetationLoaded(0)
  await vegetationCall('setSettings', { spacing: 1 })
  for (const target of [5000, 20000]) {
    const started = performance.now()
    const added = await vegetationCall('fill', target)
    const elapsedMs = performance.now() - started
    assert.equal(added, target, `Expected ${target} plants, got ${added}`)
    await waitVegetationLoaded(target, 120000)
    await nextFrames(200)
    const state = await vegetationState()
    assert.equal(state.pending, 0)
    assert.equal(state.loadedInstances, target)
    samples.push({
      stage: `batch-${target}`,
      elapsedMs: Math.round(elapsedMs),
      fps: state.fps,
      frameP95: state.frameP95,
      triangles: state.triangles,
      batches: state.batches,
      state,
    })
    await vegetationCall('clear')
    await waitVegetationLoaded(0, 120000)
  }
  checks.push('Batch planting resolves and reports count, chunks, triangles, FPS and frame P95 at 5,000 and 20,000 plants')

  await vegetationCall('setSettings', { spacing: 1 })
  await vegetationCall('fill', 5000)
  await waitVegetationLoaded(5000, 120000)
  await vegetationCall('closeView')
  await page.waitForTimeout(900)
  let lodState = await waitForVegetationIdle(120000)
  samples.push({ stage: 'vegetation-close-view-lod', triangles: lodState.triangles, state: lodState })
  await vegetationCall('overview')
  await page.waitForTimeout(900)
  lodState = await waitForVegetationIdle(120000)
  assert.equal(lodState.loadedInstances, lodState.count)
  await vegetationCall('setSettings', { shadows: true })
  await nextFrames(24)
  let shadowState = await vegetationState()
  assert.equal(shadowState.loadedInstances, shadowState.count)
  samples.push({ stage: 'vegetation-shadows-enabled', state: shadowState })
  await vegetationCall('setSettings', { shadows: false })
  await nextFrames(12)
  shadowState = await vegetationState()
  assert.equal(shadowState.loadedInstances, shadowState.count)
  checks.push('Near/overview LOD and both shadow states leave every plant instance loaded')

  await page.evaluate(path => {
    history.pushState({}, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, new URL('first-person-lab', base).pathname + '?fixture=procedural')
  await page.waitForFunction(() => Boolean(window.__firstPersonLab), null, { timeout: 30000 })
  await page.waitForFunction(() => !window.__vegetationLab)
  assert.equal(await page.locator('.cesium-widget canvas').count(), 1)
  const walkingButtons = ['进入行走', '暂停', '室外出生点', '室内出生点', '俯视检查']
  for (const name of walkingButtons) await page.getByRole('button', { name, exact: true }).waitFor({ state: 'visible' })
  await page.getByText('W A S D', { exact: false }).waitFor({ state: 'visible' })
  let walk = await walkingState()
  assert.equal(walk.mode, 'paused')
  assert.equal(walk.roofVisible, true)
  samples.push({ stage: 'first-person-initial', state: walk })

  await walkingCall('spawnOutdoor')
  await page.getByRole('button', { name: '进入行走', exact: true }).click()
  const beforeDoor = await walkingState()
  await page.keyboard.down('W')
  await page.waitForTimeout(2500)
  await page.keyboard.up('W')
  let afterDoor = await walkingState()
  assert.equal(afterDoor.mode, 'walking')
  assert(afterDoor.player.y > beforeDoor.player.y + 2, `WASD did not move the player: ${JSON.stringify({ beforeDoor, afterDoor })}`)
  assert(afterDoor.player.y > -5.1, `Player did not pass the entrance doorway: y=${afterDoor.player.y}`)
  samples.push({ stage: 'real-keyboard-through-doorway', before: beforeDoor, state: afterDoor })
  checks.push('Real Playwright W input moves from the outdoor spawn through the doorway')

  await walkingCall('spawnIndoor')
  await page.keyboard.down('W')
  await page.waitForTimeout(6000)
  await page.keyboard.up('W')
  walk = await walkingState()
  assert(walk.player.y <= 6.85, `Forward movement crossed the north wall: ${walk.player.y}`)
  assert(walk.player.y > 5, `Forward movement did not reach the interior wall: ${walk.player.y}`)
  samples.push({ stage: 'real-keyboard-wall-collision', state: walk })

  await walkingCall('spawnIndoor')
  await page.keyboard.down('W')
  await page.waitForTimeout(300)
  await walkingCall('pause')
  const paused = await walkingState()
  await page.waitForTimeout(350)
  const stillPaused = await walkingState()
  await page.keyboard.up('W')
  assert.equal(paused.mode, 'paused')
  assert.deepEqual(stillPaused.player, paused.player, 'Pause must clear held movement input')
  await walkingCall('enter')
  await page.keyboard.press('Escape')
  assert.equal((await walkingState()).mode, 'paused', 'Escape must leave walking mode')
  await walkingCall('spawnOutdoor')
  const outdoorSpawn = await walkingState()
  assert.equal(outdoorSpawn.roofVisible, true)
  await walkingCall('spawnIndoor')
  const indoorSpawn = await walkingState()
  assert.equal(outdoorSpawn.player.y, -8.1)
  assert.equal(indoorSpawn.player.y, -2.7)
  assert.equal(indoorSpawn.roofVisible, true)
  await walkingCall('inspect')
  const inspectState = await walkingState()
  assert.equal(inspectState.mode, 'inspect')
  assert.equal(inspectState.roofVisible, false)
  samples.push({ stage: 'pause-spawns-and-inspect', outdoorSpawn, indoorSpawn, state: inspectState })
  checks.push('Indoor wall blocks real keyboard motion; pause clears held input; spawns and top-down inspection are available')

  await walkingCall('enter')
  await page.keyboard.down('W')
  await page.waitForTimeout(200)
  await page.evaluate(path => {
    history.pushState({}, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, new URL(syntheticVegetationUrl).pathname + new URL(syntheticVegetationUrl).search)
  await page.waitForFunction(() => !window.__firstPersonLab && Boolean(window.__vegetationLab), null, { timeout: 30000 })
  await page.evaluate(() => window.__vegetationLab.ready)
  assert.equal((await vegetationState()).terrain.kind, 'synthetic')
  await page.keyboard.up('W')
  assert.equal(await page.locator('.cesium-widget canvas').count(), 1)
  await page.evaluate(path => {
    history.pushState({}, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, new URL('first-person-lab', base).pathname + '?fixture=procedural')
  await page.waitForFunction(() => Boolean(window.__firstPersonLab), null, { timeout: 30000 })
  assert.equal((await walkingState()).mode, 'paused')
  checks.push('SPA route changes remove the previous first-person debug API and mount a fresh paused runtime')

  assert.equal(errors.length, 0, errors.join('\n'))
  assert.equal(externalRequests.length, 0, externalRequests.join('\n'))
  assert.equal(networkFailures.length, 0, networkFailures.join('\n'))
} catch (error) {
  failure = String(error.stack ?? error)
  if (page && !page.isClosed()) {
    try {
      samples.push({ stage: 'failure-state', url: page.url(), vegetation: await vegetationState(), firstPerson: await walkingState() })
    } catch { /* preserve the first failure */ }
  }
} finally {
  const report = {
    passed: !failure,
    checks,
    samples,
    gpu,
    errors,
    externalRequests,
    networkFailures,
    failure,
    browser: browser ? await browser.version() : null,
    environment: { platform: process.platform, architecture: process.arch },
    note: 'Behavioral/WebGL acceptance only. No screenshots or recordings were created. FPS and P95 are observations for this run, not a device-independent performance promise.',
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
