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
const output = path.resolve(process.env.PRACTICE_OUTPUT ?? path.join(root, 'test-results', 'vegetation-selection'))
await fs.mkdir(output, { recursive: true })

let browser
let failure
const errors = []
const report = { passed: false, viewport: { width: 1440, height: 900 }, surface: 'synthetic', checks: [], errors }

const speciesIds = ['pine', 'broadleaf', 'birch', 'shrub', 'grass']
const apiCall = (page, method, ...args) => page.evaluate(([name, values]) => window.__vegetationLab[name](...values), [method, args])
const exportPlants = async page => {
  const raw = await apiCall(page, 'exportJson')
  return { raw, value: JSON.parse(raw) }
}

async function waitIdle(page, expectedCount, timeout = 120000) {
  try {
    await page.waitForFunction(expected => {
    const api = window.__vegetationLab
    const state = api?.getState()
    return state?.ready && state.terrain.ready && !state.busy && state.pending === 0 && state.heightPending === 0 && state.loadedInstances === expected && state.count === expected
    }, expectedCount, { timeout })
  } catch (error) {
    const state = await apiCall(page, 'getState').catch(() => undefined)
    const diagnostics = await apiCall(page, 'getDiagnostics').catch(() => undefined)
    const exportCount = await page.evaluate(() => { try { return JSON.parse(window.__vegetationLab.exportJson()).plants.length } catch { return undefined } }).catch(() => undefined)
    throw new Error(`${error}\nLast vegetation state: ${JSON.stringify(state)}\nDiagnostics: ${JSON.stringify(diagnostics)}\nExport count: ${exportCount}`)
  }
  const state = await apiCall(page, 'getState')
  assert.equal(state.error, '')
  return state
}

async function dragScene(page, from, to, steps = 20) {
  const canvas = page.locator('.cesium-widget canvas').first()
  const bounds = await canvas.boundingBox()
  assert(bounds, 'Cesium canvas must exist for real pointer input')
  await page.mouse.move(bounds.x + bounds.width * from[0], bounds.y + bounds.height * from[1])
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * to[0], bounds.y + bounds.height * to[1], { steps })
  await page.mouse.up()
}

async function clickScene(page, xRatio, yRatio) {
  const canvas = page.locator('.cesium-widget canvas').first()
  const bounds = await canvas.boundingBox()
  assert(bounds, 'Cesium canvas must exist for real pointer input')
  await page.mouse.click(bounds.x + bounds.width * xRatio, bounds.y + bounds.height * yRatio)
}

async function clearSelection(page) {
  await page.getByRole('button', { name: '取消全选', exact: true }).click()
  for (const label of ['松树', '阔叶乔木', '白桦', '灌木', '草丛']) {
    assert.equal(await page.getByRole('checkbox', { name: label, exact: true }).isChecked(), false)
  }
  assert.deepEqual((await apiCall(page, 'getSettings')).speciesPool, [])
}

async function selectOnly(page, labels) {
  await clearSelection(page)
  for (const label of labels) await page.getByRole('checkbox', { name: label, exact: true }).check()
  const settings = await apiCall(page, 'getSettings')
  const idByLabel = { '松树': 'pine', '阔叶乔木': 'broadleaf', '白桦': 'birch', '灌木': 'shrub', '草丛': 'grass' }
  assert.deepEqual(settings.speciesPool, speciesIds.filter(id => labels.some(label => idByLabel[label] === id)))
  return settings.speciesPool
}

try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(String(error.stack ?? error)))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })

  await page.goto(new URL('vegetation-lab?surface=synthetic', base).href, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForFunction(() => Boolean(window.__vegetationLab), null, { timeout: 30000 })
  await page.evaluate(() => window.__vegetationLab.ready)
  await page.getByRole('heading', { name: '植被种植实验', exact: true }).waitFor({ state: 'visible' })
  const initial = await waitIdle(page, 1000)
  const initiallySelected = await apiCall(page, 'getSettings')
  assert.deepEqual(initiallySelected.speciesPool, speciesIds)
  report.initial = { count: initial.count, selected: initiallySelected.speciesPool }
  report.checks.push('Synthetic scene starts with the default 1,000 plants fully idle and all species selected')

  const seedJson = await exportPlants(page)
  await clearSelection(page)
  await page.evaluate(() => window.__vegetationLab.setSettings({ spacing: 0.5, density: 1, seed: 42, radius: 4 }))
  await page.getByRole('button', { name: '笔刷', exact: true }).click()
  await dragScene(page, [0.67, 0.51], [0.75, 0.59], 18)
  await waitIdle(page, 1000)
  assert.equal((await exportPlants(page)).raw, seedJson.raw, 'Brush with an empty selection must preserve the full planting JSON')
  report.emptySelection = { count: 1000, speciesPool: (await apiCall(page, 'getSettings')).speciesPool }
  report.checks.push('Unchecking every real species checkbox prevents a real brush drag from adding or changing records')

  const selectedPool = await selectOnly(page, ['白桦', '灌木', '草丛'])
  await page.evaluate(() => window.__vegetationLab.setSettings({ spacing: 0.5, density: 5, seed: 81723, radius: 12 }))
  assert.equal((await exportPlants(page)).raw, seedJson.raw, 'Changing checkbox selection must not rewrite existing planting records')
  await dragScene(page, [0.66, 0.51], [0.76, 0.60], 24)
  const strokeState = await apiCall(page, 'getState')
  assert(strokeState.count > 1000, 'The selected species brush should add plants through real pointer input')
  await waitIdle(page, strokeState.count)
  const strokeExport = await exportPlants(page)
  const oldIds = new Set(seedJson.value.plants.map(plant => plant.id))
  const additions = strokeExport.value.plants.filter(plant => !oldIds.has(plant.id))
  const addedSpecies = [...new Set(additions.map(plant => plant.species))].sort()
  assert(additions.length > 0, 'The continuous brush stroke must add plants')
  assert.deepEqual(addedSpecies, ['birch', 'grass', 'shrub'], 'Only checked species may appear in a mixed brush stroke')
  for (const original of seedJson.value.plants) {
    assert.deepEqual(strokeExport.value.plants.find(plant => plant.id === original.id), original, `Existing plant ${original.id} changed after selecting a new species pool`)
  }
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await waitIdle(page, 1000)
  assert.equal((await exportPlants(page)).raw, seedJson.raw, 'One undo must remove the whole continuous stroke')
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await waitIdle(page, strokeExport.value.plants.length)
  assert.equal((await exportPlants(page)).raw, strokeExport.raw, 'One redo must restore the exact same stroke JSON')
  report.mixedBrush = { selectedPool, plantsAdded: additions.length, speciesAdded: addedSpecies, undoRedoExact: true }
  report.checks.push('A real continuous brush stroke randomly uses only the checked birch/shrub/grass; one undo removes and redo restores the exact JSON')

  const beforeReselect = await exportPlants(page)
  await selectOnly(page, ['松树'])
  assert.equal((await exportPlants(page)).raw, beforeReselect.raw, 'Changing the selected species must not alter existing plant records')
  await page.getByRole('button', { name: '清空', exact: true }).click()
  await waitIdle(page, 0)
  await page.evaluate(() => window.__vegetationLab.setSettings({ spacing: 0.5, density: 1, seed: 42, radius: 4 }))
  await page.getByRole('button', { name: '单株', exact: true }).click()
  const singleBefore = await apiCall(page, 'getState')
  await clickScene(page, 0.625, 0.556)
  await page.waitForFunction(before => window.__vegetationLab.getState().count === before + 1, singleBefore.count, { timeout: 15000 })
  await waitIdle(page, 1)
  const singleExport = await exportPlants(page)
  assert.equal(singleExport.value.plants.length, 1)
  assert.equal(singleExport.value.plants[0].species, 'pine')
  report.singlePlant = { count: 1, species: singleExport.value.plants[0].species, actualMouseClick: true }
  report.checks.push('The pine-only checkbox selection creates exactly one pine through a real single-tool click')

  await page.getByRole('button', { name: '清空', exact: true }).click()
  await waitIdle(page, 0)
  await page.getByRole('button', { name: '全选', exact: true }).click()
  assert.deepEqual((await apiCall(page, 'getSettings')).speciesPool, speciesIds)
  await page.evaluate(() => window.__vegetationLab.setSettings({ spacing: 0.5, density: 5, seed: 24681357, radius: 12 }))
  await page.getByRole('combobox', { name: '批量种植数量', exact: true }).selectOption('1000')
  await page.getByRole('button', { name: '追加种植', exact: true }).click()
  await waitIdle(page, 1000, 180000)
  const batchExport = await exportPlants(page)
  const batchSpecies = [...new Set(batchExport.value.plants.map(plant => plant.species))].sort()
  assert.deepEqual(batchSpecies, [...speciesIds].sort(), 'Full-pool batch planting must include all five species')

  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await waitIdle(page, 0)
  assert.equal((await exportPlants(page)).value.plants.length, 0, 'Undo must remove the whole batch edit')
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await waitIdle(page, 1000, 180000)
  assert.equal((await exportPlants(page)).raw, batchExport.raw, 'Redo must restore the exact batch JSON')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click()
  const download = await downloadPromise
  const exportPath = path.join(output, 'vegetation-export.json')
  await download.saveAs(exportPath)
  assert.equal(await fs.readFile(exportPath, 'utf8'), batchExport.raw, 'UI export download must match runtime export JSON')

  await page.getByRole('button', { name: '清空', exact: true }).click()
  await waitIdle(page, 0)
  await page.locator('input[type="file"][accept="application/json,.json"]').setInputFiles(exportPath)
  await waitIdle(page, 1000, 180000)
  assert.equal((await exportPlants(page)).raw, batchExport.raw, 'UI import must restore the exact exported JSON')
  report.batch = { count: 1000, species: batchSpecies, undoRedoExact: true, exported: true, imported: true, exportPath }
  report.checks.push('Full-selection batch yields all five species; undo/redo, downloaded JSON export, and file-input import round-trip exactly')

  assert.deepEqual(errors, [], 'Browser console and page errors must remain empty')
  report.errors = errors
  report.passed = true
} catch (error) {
  failure = error
  report.failure = String(error?.stack ?? error)
} finally {
  await browser?.close()
  report.errors = errors
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
}

console.log(JSON.stringify({ ...report, reportPath: path.join(output, 'report.json') }, null, 2))
if (failure) process.exitCode = 1

