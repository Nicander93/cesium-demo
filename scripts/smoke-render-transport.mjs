import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const { chromium } = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href)
  : await import('playwright')
const output = path.resolve('test-results/render-transport-20261025')
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  args: ['--enable-webgl', '--ignore-gpu-blocklist'] })
const checks = [], errors = []
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } })
  await page.addInitScript(() => {
    window.__transportUniforms = {}
    const locations = new WeakMap()
    const proto = WebGL2RenderingContext.prototype
    const get = proto.getUniformLocation, set = proto.uniform1f
    proto.getUniformLocation = function(program, name) {
      const location = get.call(this, program, name)
      if (location && ['u_groundShadowOnly', 'u_groundShadowStrength'].includes(name)) locations.set(location, name)
      return location
    }
    proto.uniform1f = function(location, value) {
      const name = locations.get(location)
      if (name) window.__transportUniforms[name] = value
      return set.call(this, location, value)
    }
  })
  await page.route('**/cdnjs.cloudflare.com/**', route => route.fulfill({ body: '', contentType: 'text/css' }))
  page.on('pageerror', error => errors.push(String(error)))
  page.on('console', message => {
    if (message.type() === 'error' && /shader|rendering has stopped|RuntimeError|DeveloperError|framebuffer|cleanup failed/i.test(message.text())) errors.push(message.text())
  })
  const state = () => page.evaluate(() => window.__atmosphereLab.getState())
  const ready = async provider => {
    await page.waitForFunction(provider => {
      const state = window.__atmosphereLab?.getState()
      return state?.diagnostic.status === 'failed' || state?.state.provider === provider && state?.diagnostic.status === 'ready' && state?.postProcess.ready
    }, provider, { timeout: 90000 })
    const snapshot = await state()
    assert.equal(snapshot.diagnostic.status, 'ready', JSON.stringify(snapshot.errors))
    assert.deepEqual(snapshot.errors, [])
    return snapshot
  }
  const set = async options => {
    await page.evaluate(options => window.__atmosphereLab.setOptions(options), options)
    return ready('community')
  }
  await page.goto((process.env.ATMOSPHERE_BASE_URL ?? 'http://127.0.0.1:5174/cesium-demo/') + 'cloud-atmosphere-lab?provider=community&quality=balanced&cloudPresentation=full&view=ground', { waitUntil: 'domcontentloaded' })
  await ready('community')
  await page.waitForFunction(() => window.__atmosphereLab.getState().diagnostic.activeEffect?.groundShadowReady === true, null, { timeout: 45000 })
  await page.waitForFunction(() => window.__transportUniforms.u_groundShadowOnly === 1 && Math.abs(window.__transportUniforms.u_groundShadowStrength - 0.7) < 1e-5)
  const enabled = await state()
  const count = enabled.postProcess.count
  checks.push({ name: 'Cloud shadow BSM reaches the assembled atmosphere shader', passed: true, diagnostic: enabled.diagnostic.activeEffect, uniforms: await page.evaluate(() => window.__transportUniforms) })
  await set({ cloudShadows: false })
  await page.waitForFunction(() => window.__transportUniforms.u_groundShadowStrength === 0 && window.__atmosphereLab.getState().diagnostic.activeEffect?.groundShadowEnabled === false)
  const disabled = await state()
  assert.equal(disabled.state.coverage, enabled.state.coverage)
  assert.equal(disabled.postProcess.count, count)
  assert.equal(disabled.diagnostic.activeEffect.groundShadowEnabled, false)
  checks.push({ name: 'Shadow comparison preserves density and stage count', passed: true })
  await set({ cloudShadows: true, animated: true })
  await page.waitForFunction(() => Math.abs(window.__transportUniforms.u_groundShadowStrength - 0.7) < 1e-5)
  assert.equal((await state()).diagnostic.activeEffect.temporalResolve, true)
  checks.push({ name: 'Animated weather retains temporal cloud resolve with shadows', passed: true })
  await page.evaluate(() => window.__atmosphereLab.setView('cloudscape'))
  await ready('community')
  assert.equal((await state()).scene.cloudVisible, true)
  checks.push({ name: 'Full cloud field remains visible above the cloud deck', passed: true })
  await page.evaluate(() => window.__atmosphereLab.setProvider('basic'))
  const basic = await ready('basic')
  assert(basic.postProcess.count < count)
  assert.equal(basic.scene.fogRendered, true)
  await page.evaluate(() => window.__atmosphereLab.setProvider('community'))
  const restored = await ready('community')
  assert.equal(restored.postProcess.count, count)
  checks.push({ name: 'Provider teardown restores the host and re-entry does not accumulate stages', passed: true })
  const previousWidth = restored.canvas.clientWidth
  await page.setViewportSize({ width: 800, height: 600 })
  await ready('community')
  await page.waitForFunction(previousWidth => { const canvas = window.__atmosphereLab.getState().canvas; return canvas.clientWidth > 0 && canvas.clientWidth !== previousWidth }, previousWidth)
  assert.deepEqual(errors, [])
  checks.push({ name: 'Resize retains a valid cloud/atmosphere pipeline', passed: true })
  await page.goto('about:blank')
  await page.waitForTimeout(150)
  assert.deepEqual(errors, [])
  const report = { passed: true, checks, errors }
  await fs.writeFile(path.join(output, 'browser.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ passed: true, checks: checks.length }))
} catch (error) {
  await fs.writeFile(path.join(output, 'browser.json'), JSON.stringify({ passed: false, checks, errors, failure: String(error) }, null, 2))
  throw error
} finally { await browser.close() }
