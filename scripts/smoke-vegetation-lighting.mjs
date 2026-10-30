#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = process.env.PRACTICE_OUTPUT ?? path.join(root, 'test-results/vegetation-lighting')
const base = process.env.PRACTICE_BASE_URL ?? 'http://127.0.0.1:5175/cesium-demo/'
const capture = process.env.VEGETATION_CAPTURE === '1'
const { chromium } = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH))
  : await import('playwright')
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const errors = [], checks = []
let metrics
page.on('pageerror', error => errors.push(String(error)))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
const call = (method, ...args) => page.evaluate(([name, values]) => window.__vegetationLab[name](...values), [method, args])
async function idle() {
  await page.waitForFunction(() => {
    const state = window.__vegetationLab?.getState()
    return state?.ready && !state.busy && !state.pending && !state.heightPending && state.loadedInstances === state.count
  }, null, { timeout: 90000 })
}
async function shot(name) {
  await page.evaluate(() => new Promise(resolve => {
    let frames = 12
    function tick() { if (--frames === 0) resolve(); else requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  }))
  const png = await page.screenshot()
  if (capture) await fs.writeFile(path.join(output, name + '.png'), png)
  return png.toString('base64')
}
try {
  await page.goto(new URL('vegetation-lab?surface=synthetic', base).href)
  await page.waitForFunction(() => window.__vegetationLab?.getState().count > 0, null, { timeout: 90000 })
  await idle()
  await call('clear')
  await idle()
  await call('setSettings', { species: 'pine', seed: 12, spacing: 4, lod: false, shadows: false, foliageLighting: false })
  for (let y = -12; y <= 12; y += 8) for (let x = -20; x <= 20; x += 8) await call('add', x, y)
  await call('setAmbientProfile', 'studio')
  await call('closeView')
  await idle()
  const planted = await call('exportJson')
  await page.locator('.vegetation-lab__header,.vegetation-lab__panel').evaluateAll(nodes => nodes.forEach(node => { node.style.visibility = 'hidden' }))
  const baseline = await shot('baseline-studio')
  await call('setAmbientProfile', 'outdoor')
  const outdoor = await shot('outdoor-only')
  await call('setSettings', { foliageLighting: true })
  const treated = await shot('foliage-on')
  await call('setLightIntensity', 0)
  await call('setAmbientIntensity', 0)
  const zeroOn = await shot('zero-light-on')
  await call('setSettings', { foliageLighting: false })
  const zeroOff = await shot('zero-light-off')
  assert.equal(await call('exportJson'), planted)
  checks.push('all lighting comparisons retain identical plants and source heights')

  metrics = await page.evaluate(async images => {
    const decoded = {}
    for (const [name, base64] of Object.entries(images)) {
      const response = await fetch('data:image/png;base64,' + base64)
      const bitmap = await createImageBitmap(await response.blob())
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width; canvas.height = bitmap.height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(bitmap, 0, 0)
      decoded[name] = context.getImageData(0, 0, canvas.width, canvas.height)
      bitmap.close()
    }
    const before = decoded.baseline, after = decoded.treated
    let count = 0, beforeLuma = 0, outdoorLuma = 0, afterLuma = 0, sumSquares = 0, beforeDark = 0, afterDark = 0
    let zeroDifference = 0, backgroundDifference = 0, backgroundValues = 0
    const luma = (array, index) => array[index] * 0.2126 + array[index + 1] * 0.7152 + array[index + 2] * 0.0722
    for (let i = 0; i < before.data.length; i += 4) {
      const delta = Math.max(...[0, 1, 2].map(c => Math.abs(before.data[i + c] - after.data[i + c])))
      if (delta > 2) {
        const a = luma(before.data, i), b = luma(after.data, i)
        count++; beforeLuma += a; afterLuma += b; outdoorLuma += luma(decoded.outdoor.data, i)
        sumSquares += b * b; beforeDark += Number(a < 35); afterDark += Number(b < 35)
      }
      const y = Math.floor(i / 4 / before.width)
      for (let c = 0; c < 3; c++) {
        zeroDifference += Math.abs(decoded.zeroOn.data[i + c] - decoded.zeroOff.data[i + c])
        if (y < 250 || y > 750) { backgroundDifference += Math.abs(before.data[i + c] - after.data[i + c]); backgroundValues++ }
      }
    }
    return {
      affectedPixels: count, beforeLuma: beforeLuma / count, outdoorLuma: outdoorLuma / count, afterLuma: afterLuma / count,
      beforeDarkFraction: beforeDark / count, afterDarkFraction: afterDark / count,
      afterLumaStd: Math.sqrt(sumSquares / count - (afterLuma / count) ** 2),
      zeroLightMeanDifference: zeroDifference / (before.width * before.height * 3),
      backgroundMeanDifference: backgroundDifference / backgroundValues,
    }
  }, { baseline, outdoor, treated, zeroOn, zeroOff })
  assert.ok(metrics.affectedPixels > 3000)
  assert.ok(metrics.afterLuma > metrics.beforeLuma * 1.45, 'foliage should visibly brighten beyond the dark baseline')
  assert.ok(metrics.afterDarkFraction < metrics.beforeDarkFraction * 0.5, 'dense near-black foliage should be reduced')
  assert.ok(metrics.afterLumaStd > 12, 'texture and lighting variation should remain')
  assert.ok(metrics.backgroundMeanDifference < 0.05, 'terrain/sky must retain their original exposure')
  assert.ok(metrics.zeroLightMeanDifference < 0.05, 'leaf treatment must not self-illuminate without incident light')
  checks.push('pine foliage visibly brightens while retaining texture and unchanged terrain/sky exposure')
  checks.push('all-light-off comparison confirms treatment is responsive to illumination')
  assert.deepEqual(errors, [])
} catch (error) {
  errors.push(String(error.stack ?? error)); process.exitCode = 1
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: errors.length === 0, checks, metrics, errors }, null, 2))
  console.log(JSON.stringify({ checks, metrics, errors }))
  await browser.close()
}
