import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
const { chromium } = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href)
  : await import('playwright')
const out = path.resolve(
  process.env.ENVIRONMENT_OUTPUT ?? 'test-results/environment-links',
)
const base = (
  process.env.ENVIRONMENT_BASE_URL ?? 'http://127.0.0.1:5174/cesium-demo/'
).replace(/\/?$/, '/')
const production = (
  process.env.ENVIRONMENT_PRODUCTION_URL ?? 'http://127.0.0.1:5198/cesium-demo/'
).replace(/\/?$/, '/')
await fs.mkdir(out, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
    : {}),
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
})
const result = { passed: false, errors: [] }
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  })
  page.on('pageerror', (error) => result.errors.push(String(error)))
  const query =
    '?scene=reservoir&weather=sunset&exposure=0.73&fog=0.21&rotation=-30&rain=0.12&water=5.5&waterReference=offset&envVersion=2&presentation=screen'
  await page.goto(base + 'environment-lab' + query, {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForFunction(
    () => {
      const s = window.__environmentDemo?.getState()
      return (
        s?.environment.ready &&
        !s.environment.pending &&
        !s.loading &&
        s.environment.options.exposure === 0.73
      )
    },
    null,
    { timeout: 60000 },
  )
  const restored = await page.evaluate(() =>
    window.__environmentDemo.getState(),
  )
  assert.equal(restored.source.kind, 'terrain')
  assert.equal(restored.source.ready, true)
  assert.equal(restored.source.waterOffset, 5.5)
  assert(Number.isFinite(restored.source.waterBaseHeight))
  assert.equal(restored.environment.preset, 'sunset')
  assert.equal(restored.environment.options.fog, 0.21)
  assert.equal(restored.environment.options.skyRotation, -30)
  assert.equal(restored.environment.options.rain, 0.12)
  if (!(await page.locator('#environment-controls').isVisible()))
    await page.getByRole('button', { name: '环境设置', exact: true }).click()
  assert.equal(
    await page.getByLabel('演示水位', { exact: true }).inputValue(),
    '5.5',
  )
  await page.getByLabel('画面曝光', { exact: true }).evaluate((element) => {
    element.value = '0.91'
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.waitForFunction(
    () =>
      window.__environmentDemo.getState().environment.options.exposure === 0.91,
  )
  assert.equal(new URL(page.url()).searchParams.get('exposure'), '0.91')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => {
      const state = window.__environmentDemo?.getState()
      return (
        state?.environment.ready &&
        !state.environment.pending &&
        !state.loading &&
        state.environment.options.exposure === 0.91
      )
    },
    null,
    { timeout: 60000 },
  )
  result.restored = (
    await page.evaluate(() => window.__environmentDemo.getState())
  ).environment
  assert.equal(result.restored.preset, 'sunset')
  assert.equal(result.restored.pending, null)
  await page.goto(
    production + 'environment-lab?scene=reservoir&weather=sunset',
    { waitUntil: 'domcontentloaded' },
  )
  await page.waitForFunction(
    () =>
      document
        .querySelector('.environment-demo__metrics')
        ?.textContent.includes('环境就绪'),
    null,
    { timeout: 60000 },
  )
  await page.waitForTimeout(1800)
  assert.equal(
    await page.evaluate(() => typeof window.__environmentDemo),
    'undefined',
  )
  assert.deepEqual(await page.locator('[role=alert]').allTextContents(), [])
  if (process.env.ENVIRONMENT_SCREENSHOTS === '1')
    await page.screenshot({ path: out + '/production-reservoir-sunset.png' })
  result.production = {
    url: page.url(),
    diagnosticsExposed: false,
    metrics: await page.locator('.environment-demo__metrics').innerText(),
  }
  assert.deepEqual(result.errors, [])
  result.passed = true
  console.log(JSON.stringify(result))
} catch (error) {
  result.failure = String(error)
  throw error
} finally {
  await fs.writeFile(out + '/report.json', JSON.stringify(result, null, 2))
  await browser.close()
}
