import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const { chromium } = await import(
  pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href
)
const base =
  process.env.ENVIRONMENT_BASE_URL ?? 'http://127.0.0.1:5174/cesium-demo/'
const output =
  process.env.ENVIRONMENT_OUTPUT ?? 'test-results/environment-model-lighting'
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
})
const report = { passed: false, checks: [], errors: [] }
function check(name, condition) {
  assert(condition, name)
  report.checks.push(name)
}
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  })
  page.on('pageerror', (e) => report.errors.push(String(e)))
  await page.goto(base + 'environment-lab?scene=city&weather=day', {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForFunction(() => {
    const s = window.__environmentDemo?.getState()
    return (
      s &&
      !s.loading &&
      s.environment.ready &&
      !s.environment.pending &&
      s.loadedModels === 25
    )
  })
  const initial = await page.evaluate(
    () => window.__environmentDemo.getState().configuration,
  )
  check(
    'city starts with reference model lighting defaults',
    initial.environment.modelLighting === 'studio' &&
      initial.environment.tonemapper === 'neutral' &&
      initial.environment.sunIntensity === 1.8 &&
      initial.environment.diffuseIntensity === 0.8 &&
      initial.shadows.buildingShadows === 'cast',
  )
  await page.getByLabel('模型环境光', { exact: true }).selectOption('weather')
  check(
    'UI switches model lighting independently',
    (await page.evaluate(() => window.__environmentDemo.getState())).environment
      .options.modelLighting === 'weather',
  )
  await page
    .getByRole('button', { name: '采用城市展示光照', exact: true })
    .click()
  check(
    'reference look button applies native environment settings',
    (await page.evaluate(() => window.__environmentDemo.getState())).environment
      .options.modelLighting === 'studio',
  )
  await page.getByLabel('建筑接收自阴影', { exact: true }).check()
  check(
    'UI exposes optional building self shadows',
    (await page.evaluate(() => window.__environmentDemo.getState()))
      .configuration.shadows.buildingShadows === 'both',
  )
  await page.close()
  const engine = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  })
  engine.on('pageerror', (e) => report.errors.push(String(e)))
  await engine.goto(base, { waitUntil: 'domcontentloaded' })
  await engine.evaluate(async (base) => {
    const { createEnvironmentDemo } = await import(
      new URL('src/views/environment-lab/runtime.ts', base).href
    )
    const { createSceneConfiguration } = await import(
      new URL('src/views/environment-lab/configuration.ts', base).href
    )
    const url = performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .find((url) => /(?:^|\/)cesium\.js$/i.test(new URL(url).pathname))
    const C = await import(url)
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;inset:0;z-index:999'
    document.body.append(host)
    const demo = createEnvironmentDemo(host, () => {})
    const config = createSceneConfiguration('city')
    await Promise.all([
      demo.loadScene('city', undefined, config),
      demo.setWeather('day'),
    ])
    demo.applyConfiguration(config)
    const collection = demo.viewer.scene.primitives.get(0)
    const models = Array.from({ length: collection.length }, (_, i) =>
      collection.get(i),
    ).filter((p) => p instanceof C.Model)
    window.__modelLook = {
      demo,
      C,
      config,
      host,
      models,
      manifest: await fetch(
        new URL('environment-lab/manifest.json', base),
      ).then((r) => r.json()),
    }
  }, base)
  await engine.waitForFunction(
    () =>
      window.__modelLook.models.every(
        (m) => m.imageBasedLighting._specularEnvironmentMapLoaded,
      ),
    null,
    { timeout: 30000 },
  )
  const defaults = await engine.evaluate(() => {
    const { demo, C, models, manifest } = window.__modelLook
    return {
      models: models.length,
      cast: models.filter((m) => m.shadows === C.ShadowMode.CAST_ONLY).length,
      receive: models.filter((m) => m.shadows === C.ShadowMode.RECEIVE_ONLY)
        .length,
      assets: models.every((m) =>
        m.imageBasedLighting.specularEnvironmentMaps.endsWith(
          'model-rendering/studio-specular.ktx2',
        ),
      ),
      sh: models.every(
        (m) =>
          JSON.stringify(
            m.imageBasedLighting.sphericalHarmonicCoefficients.map((c) => [
              c.x,
              c.y,
              c.z,
            ]),
          ) === JSON.stringify(manifest.studio.sphericalHarmonics),
      ),
      factors: models.every(
        (m) =>
          m.imageBasedLighting.imageBasedLightingFactor.x === 0.8 &&
          m.imageBasedLighting.imageBasedLightingFactor.y === 0.8,
      ),
      state: demo.getState(),
      glError: demo.viewer.scene.context._gl.getError(),
    }
  })
  check(
    'all 25 city models load the reference studio SH and GGX resource',
    defaults.models === 25 &&
      defaults.assets &&
      defaults.sh &&
      defaults.factors,
  )
  check(
    '24 buildings cast shadows while site receives them',
    defaults.cast === 24 && defaults.receive === 1,
  )
  const studioFile = await fs.readFile(
    'public/model-rendering/studio-sh.json',
    'utf8',
  )
  const source = JSON.parse(
    await fs.readFile('public/environment-lab/manifest.json', 'utf8'),
  )
  check(
    'shared studio metadata matches existing asset exactly',
    JSON.stringify(source.studio.sphericalHarmonics) ===
      JSON.stringify(JSON.parse(studioFile)),
  )
  const switching = await engine.evaluate(() => {
    const { demo, C, models, manifest, config } = window.__modelLook
    const panorama = demo.environment.getLighting().panoramaUrl
    config.shadows.buildingShadows = 'both'
    demo.applyConfiguration(config)
    const both = models.filter((m) => m.shadows === C.ShadowMode.ENABLED).length
    config.shadows.buildingShadows = 'cast'
    config.environment.modelLighting = 'weather'
    demo.applyConfiguration(config)
    const weather = models.every(
      (m) =>
        m.imageBasedLighting.specularEnvironmentMaps.endsWith(
          'specular/day.ktx2',
        ) &&
        JSON.stringify(
          m.imageBasedLighting.sphericalHarmonicCoefficients.map((c) => [
            c.x,
            c.y,
            c.z,
          ]),
        ) === JSON.stringify(manifest.day.sphericalHarmonics),
    )
    config.environment.modelLighting = 'studio'
    demo.applyConfiguration(config)
    return {
      both,
      weather,
      panoramaSame: panorama === demo.environment.getLighting().panoramaUrl,
      stageCount: demo.viewer.scene.postProcessStages.length,
      collections: demo.viewer.scene.primitives.length,
      restored: models.filter((m) => m.shadows === C.ShadowMode.CAST_ONLY)
        .length,
      error: demo.viewer.scene.context._gl.getError(),
    }
  })
  check(
    'building self shadow switch updates native models',
    switching.both === 24 && switching.restored === 24,
  )
  check('outdoor model lighting remains available', switching.weather)
  check(
    'model look leaves weather panorama and render pass count intact',
    switching.panoramaSame &&
      switching.stageCount === 1 &&
      switching.collections === 1,
  )
  await engine.waitForTimeout(500)
  const casts = await engine.evaluate(() =>
    window.__modelLook.demo.viewer.scene.shadowMap._passes.reduce(
      (sum, p) => sum + p.commandList.length,
      0,
    ),
  )
  check('real shadow caster commands remain active', casts > 0)
  check(
    'no WebGL or browser errors',
    defaults.glError === 0 &&
      switching.error === 0 &&
      report.errors.length === 0,
  )
  await engine.evaluate(() => {
    const { demo, host } = window.__modelLook
    demo.dispose()
    host.remove()
  })
  report.passed = true
  console.log(JSON.stringify(report))
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await fs.writeFile(
    path.join(output, 'report.json'),
    JSON.stringify(report, null, 2),
  )
  await browser.close()
}
