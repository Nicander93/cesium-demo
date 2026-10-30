#!/usr/bin/env node
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'

const { chromium } = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH))
  : await import('playwright')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = process.env.PRACTICE_OUTPUT ?? path.join(root, 'test-results/interior-browsing')
const base = process.env.PRACTICE_BASE_URL ?? 'http://127.0.0.1:5175/cesium-demo/'
const capture = process.env.INTERIOR_CAPTURE === '1'
const manifest = JSON.parse(await fs.readFile(path.join(root, 'public/first-person-lab/modern-hall/manifest.json'), 'utf8'))
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const errors = [], checks = [], samples = []
page.on('pageerror', error => errors.push(String(error)))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
const call = (method, ...args) => page.evaluate(([name, values]) => window.__firstPersonLab[name](...values), [method, args])
async function ready() {
  await page.waitForFunction(() => window.__firstPersonLab?.getState().ready, null, { timeout: 90000 })
  return call('getState')
}
async function snapshot(name) {
  if (capture) await page.screenshot({ path: path.join(output, name + '.png') })
}

try {
  await page.goto(new URL('first-person-lab?scene=modern-hall', base).href)
  let state = await ready()
  samples.push(state)
  assert.equal(state.mode, 'inspect')
  assert.equal(state.sliced, true)
  assert.equal(state.collisionTriangles, manifest.triangleCount)
  checks.push('large real model loads in cutaway overview')

  let scene = await call('inspectScene')
  samples.push(scene)
  assert.equal(scene.fxaa, true)
  assert.equal(scene.msaaSupported, true)
  assert.equal(scene.msaaSamples, 4)
  assert.equal(scene.resolutionScale, 2)
  assert.ok(scene.drawingBuffer[0] >= scene.cssSize[0] * 1.99)
  checks.push('DPR 2 drawing buffer, FXAA and supported 4x MSAA')
  await page.waitForTimeout(1800)
  await snapshot('hall-cutaway')

  for (const spawn of state.spawns) {
    await call('spawnAt', spawn.id)
    const located = await call('getState')
    assert.equal(located.grounded, true)
    assert.ok(Math.abs(located.player.footHeight) < 0.12)
  }
  checks.push('all three real mesh viewpoints are safely grounded')

  await call('spawnAt', 'inside')
  await call('navigate')
  await page.waitForTimeout(1800)
  await snapshot('hall-inside')
  samples.push(await call('getState'), await call('inspectScene'))
  const goal = [-1, 0, 0]
  const screen = await call('projectPoint', goal)
  assert.ok(screen && screen.y > 0 && screen.y < 900)
  const hit = await call('pickPoint', screen.x, screen.y)
  samples.push({ goal, screen, actualDepthPick: hit })
  assert.ok(hit && Math.hypot(...hit.map((value, i) => value - goal[i])) < 0.1, 'rendered floor must match collision position')
  const bounds = await page.locator('.cesium-widget canvas').boundingBox()
  await page.mouse.click(bounds.x + screen.x, bounds.y + screen.y)
  await page.waitForFunction(() => window.__firstPersonLab?.getState().navigationMessage.startsWith('已到达'), null, { timeout: 10000 })
  state = await call('getState')
  assert.ok(Math.abs(state.player.x - goal[0]) < 0.07)
  checks.push('rendered floor aligns with collision; real mouse click arrives')

  await call('inspect')
  await call('setSlice', true)
  await call('setSliceHeight', 3.1)
  assert.equal((await call('getState')).sliceHeight, 3.1)
  await call('navigate')
  assert.equal((await call('getState')).sliced, false)
  checks.push('cutaway is restored before entering indoor navigation')

  await call('setQuality', 'performance')
  scene = await call('inspectScene')
  assert.equal(scene.resolutionScale, 1)
  assert.equal(scene.msaaSamples, 1)
  checks.push('performance preset changes actual drawing scale and samples')

  await page.getByRole('button', { name: '场景与画质' }).click()
  await page.getByLabel('示范场景').selectOption('living-room')
  assert.equal((await ready()).collisionTriangles, 131989)
  await page.getByLabel('示范场景').selectOption('modern-hall')
  assert.equal((await ready()).collisionTriangles, manifest.triangleCount)
  checks.push('same controller switches between independent real manifests')
  assert.deepEqual(errors, [])
} catch (error) {
  errors.push(String(error.stack ?? error))
  process.exitCode = 1
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, samples, errors }, null, 2))
  console.log(JSON.stringify({ checks, errors }))
  await browser.close()
}
