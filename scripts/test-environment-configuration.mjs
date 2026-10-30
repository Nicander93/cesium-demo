import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const { chromium } = await import(
  pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href
)
const base = (
  process.env.ENVIRONMENT_BASE_URL ?? 'http://127.0.0.1:5174/cesium-demo/'
).replace(/\/?$/, '/')
const output =
  process.env.ENVIRONMENT_OUTPUT ?? 'test-results/environment-configuration'
await fs.mkdir(output, { recursive: true })
const report = { passed: false, checks: [], errors: [], interaction: [] }
function check(name, value) {
  assert(value, name)
  report.checks.push(name)
}
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
})
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  })
  page.on('pageerror', (error) => report.errors.push(String(error)))
  const waitReady = () =>
    page.waitForFunction(
      () => {
        const s = window.__environmentDemo?.getState()
        return (
          s &&
          !s.loading &&
          s.environment.ready &&
          !s.environment.pending &&
          (s.scene === 'city' ? s.loadedModels === 25 : s.source?.ready)
        )
      },
      null,
      { timeout: 70000 },
    )
  await page.goto(base + 'environment-lab?scene=city&weather=day', {
    waitUntil: 'domcontentloaded',
  })
  await waitReady()
  await page.locator('#environment-controls details').evaluateAll((elements) =>
    elements.forEach((element) => {
      element.open = true
    }),
  )
  check(
    'city exposes more than 30 applicable visual controls',
    (await page
      .locator('#environment-controls input, #environment-controls select')
      .count()) > 30,
  )
  await page
    .getByRole('checkbox', { name: '启用环境阴影', exact: true })
    .uncheck()
  check(
    'shadow switch changes runtime',
    !(await page.evaluate(() => window.__environmentDemo.getState()))
      .environment.options.shadows,
  )
  await page
    .getByRole('checkbox', { name: '启用环境阴影', exact: true })
    .check()
  await page.getByLabel('画面曝光', { exact: true }).evaluate((input) => {
    input.value = '1.23'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  check(
    'exposure slider changes runtime',
    (await page.evaluate(() => window.__environmentDemo.getState())).environment
      .options.exposure === 1.23,
  )
  await page.getByLabel('贴图尺寸').selectOption('1024')
  await page.getByLabel('演示水位', { exact: true }).evaluate((input) => {
    input.value = '4.2'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const city = await page.evaluate(
    () => window.__environmentDemo.getState().configuration,
  )
  check(
    'water and shadow controls retained',
    city.water.level === 4.2 && city.shadows.size === 1024,
  )
  await page.evaluate(() => window.__environmentDemo.setScene('reservoir'))
  await waitReady()
  check(
    'reservoir starts with independent defaults',
    (await page.evaluate(() => window.__environmentDemo.getState())).environment
      .options.exposure === 1,
  )
  check(
    'reservoir exposes imagery and model source inputs',
    (await page.getByLabel('Tileset URL', { exact: true }).count()) === 1 &&
      (await page.getByText('影像亮度', { exact: false }).count()) > 0,
  )
  await page.evaluate(() => {
    const config = window.__environmentDemo.getConfigurations().reservoir
    config.water.level = 3.5
    config.source.imageryBrightness = 1.2
    config.presentation.showLabels = false
    window.__environmentDemo.setConfiguration(config)
  })
  check(
    'reservoir live water offset applies',
    (await page.evaluate(() => window.__environmentDemo.getState())).source
      .waterOffset === 3.5,
  )
  check(
    'presentation setting changes DOM',
    (await page.locator('.environment-demo__footer').count()) === 0,
  )
  await page.evaluate(() => window.__environmentDemo.setScene('city'))
  await waitReady()
  check(
    'switch restores complete city settings',
    JSON.stringify(
      await page.evaluate(
        () => window.__environmentDemo.getState().configuration,
      ),
    ) === JSON.stringify(city),
  )
  const share = page.url()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitReady()
  check(
    'shared configuration restores after reload',
    JSON.stringify(
      await page.evaluate(
        () => window.__environmentDemo.getState().configuration,
      ),
    ) === JSON.stringify(city),
  )
  check(
    'share includes full config plus legacy parameters',
    new URL(share).searchParams.has('config') &&
      new URL(share).searchParams.get('exposure') === '1.23',
  )
  await page.locator('#environment-controls details').evaluateAll((elements) =>
    elements.forEach((element) => {
      element.open = true
    }),
  )
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 JSON', exact: true }).click()
  const download = await downloadPromise
  const exportPath = path.join(output, 'exported-profiles.json')
  await download.saveAs(exportPath)
  const exported = JSON.parse(await fs.readFile(exportPath, 'utf8'))
  check(
    'export includes independent profiles',
    exported.version === 1 &&
      exported.profiles.city.water.level === 4.2 &&
      exported.profiles.reservoir.water.level === 3.5,
  )
  const before = await page.evaluate(() =>
    window.__environmentDemo.getConfigurations(),
  )
  await page.locator('input[type=file]').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        version: 1,
        profiles: {
          city: { environment: { exposure: 2 } },
          reservoir: { source: { modelUrl: 'javascript:alert(1)' } },
        },
      }),
    ),
  })
  await page.waitForFunction(() =>
    document.body.textContent.includes('导入失败'),
  )
  check(
    'invalid import leaves all profiles unchanged',
    JSON.stringify(before) ===
      JSON.stringify(
        await page.evaluate(() => window.__environmentDemo.getConfigurations()),
      ),
  )
  const changed = structuredClone(exported)
  changed.profiles.city.environment.exposure = 1.11
  await page.locator('input[type=file]').setInputFiles({
    name: 'valid.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(changed)),
  })
  await page.waitForFunction(
    () =>
      window.__environmentDemo.getState().environment.options.exposure === 1.11,
  )
  await waitReady()
  check(
    'valid import applies renderer options',
    (await page.evaluate(() => window.__environmentDemo.getState())).environment
      .options.exposure === 1.11,
  )
  await page.getByRole('button', { name: '重置本场景', exact: true }).click()
  await waitReady()
  check(
    'reset changes only active scene',
    (await page.evaluate(() => window.__environmentDemo.getConfigurations()))
      .reservoir.water.level === 3.5 &&
      (await page.evaluate(() => window.__environmentDemo.getState()))
        .configuration.water.level === 1,
  )
  await page.evaluate(() =>
    Promise.all([
      window.__environmentDemo.setScene('flood'),
      window.__environmentDemo.setScene('city'),
    ]),
  )
  await waitReady()
  check(
    'rapid scene switch keeps last request',
    (await page.evaluate(() => window.__environmentDemo.getState())).scene ===
      'city',
  )
  await page.close()

  const engine = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  })
  engine.on('pageerror', (error) => report.errors.push(String(error)))
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
    window.__configurationProbe = { demo, C, host, createSceneConfiguration }
    await Promise.all([demo.loadScene('city'), demo.setWeather('day')])
  }, base)
  const cityEngine = await engine.evaluate(() => {
    const { demo, C } = window.__configurationProbe
    const config = demo.getState().configuration
    Object.assign(config.environment, {
      sunAuto: false,
      sunHeading: 90,
      sunElevation: 30,
      sunIntensity: 3.2,
      sunColor: '#ffccaa',
      diffuseIntensity: 0.7,
      specularIntensity: 0.9,
      exposure: 1.2,
      skyIntensity: 1.4,
      hdr: false,
      tonemapper: 'reinhard',
    })
    Object.assign(config.shadows, {
      size: 1024,
      distance: 1200,
      darkness: 0.42,
      soft: false,
      depthBias: 0.0003,
      normalOffset: 0.8,
      treeShadows: 'off',
    })
    Object.assign(config.water, {
      color: '#226688',
      waveStrength: 1.5,
      waveScale: 2,
      waveSpeed: 0.5,
      reflection: 0.6,
      flow: 0.4,
    })
    Object.assign(config.quality, { pixelBudget: '720', fxaa: false })
    demo.applyConfiguration(config)
    const scene = demo.viewer.scene,
      collection = scene.primitives.get(0)
    const water = Array.from({ length: collection.length }, (_, i) =>
      collection.get(i),
    ).find((p) => p.appearance?.material?.type === 'EnvironmentPanoramaWater')
    const model = Array.from({ length: collection.length }, (_, i) =>
      collection.get(i),
    ).find((p) => p instanceof C.Model)
    const u = water.appearance.material.uniforms
    return {
      shadows: [
        scene.shadowMap.size,
        scene.shadowMap.maximumDistance,
        scene.shadowMap.darkness,
        scene.shadowMap.softShadows,
        scene.shadowMap._primitiveBias.depthBias,
        scene.shadowMap._primitiveBias.normalOffsetScale,
      ],
      light: scene.light.intensity,
      ibl: [
        model.imageBasedLighting.imageBasedLightingFactor.x,
        model.imageBasedLighting.imageBasedLightingFactor.y,
      ],
      water: [u.u_waveStrength, u.u_waveScale, u.u_reflection],
      color: u.u_waterColor.toCssHexString(),
      hdr: scene.highDynamicRange,
      tone: scene.postProcessStages.tonemapper,
      fxaa: scene.postProcessStages.fxaa.enabled,
      pixels: scene.drawingBufferWidth * scene.drawingBufferHeight,
      error: scene.context._gl.getError(),
    }
  })
  check(
    'shadow configuration reaches native ShadowMap',
    JSON.stringify(cityEngine.shadows) ===
      JSON.stringify([1024, 1200, 0.42, false, 0.0003, 0.8]),
  )
  check(
    'sun and IBL reach native model lighting',
    cityEngine.light === 3.2 && JSON.stringify(cityEngine.ibl) === '[0.7,0.9]',
  )
  check(
    'water controls reach material uniforms',
    JSON.stringify(cityEngine.water) === '[1.5,2,0.6]' &&
      cityEngine.color === '#226688',
  )
  check(
    'quality controls reach native drawing settings',
    !cityEngine.hdr &&
      !cityEngine.fxaa &&
      cityEngine.pixels <= 1280 * 720 &&
      cityEngine.error === 0,
  )
  const realEngine = await engine.evaluate(async () => {
    const { demo, C, createSceneConfiguration } = window.__configurationProbe
    const config = createSceneConfiguration('flood')
    Object.assign(config.quality, {
      cacheMB: 96,
      tilesetError: 24,
      terrainError: 5,
    })
    Object.assign(config.water, { level: 8, waveStrength: 1.8, visible: true })
    Object.assign(config.source, {
      modelHeightOffset: 23,
      imageryBrightness: 1.2,
      terrainLighting: true,
      modelShadows: 'cast',
    })
    await demo.loadScene('flood', undefined, config)
    const scene = demo.viewer.scene,
      collection = scene.primitives.get(0)
    const tileset = Array.from({ length: collection.length }, (_, i) =>
      collection.get(i),
    ).find((p) => p instanceof C.Cesium3DTileset)
    const before = C.Matrix4.getTranslation(
      tileset.modelMatrix,
      new C.Cartesian3(),
    )
    const first = demo.getState().source
    config.source.modelHeightOffset = 17
    demo.applyConfiguration(config)
    const after = C.Matrix4.getTranslation(
      tileset.modelMatrix,
      new C.Cartesian3(),
    )
    const water = Array.from({ length: collection.length }, (_, i) =>
      collection.get(i),
    ).find((p) => p.appearance?.material?.type === 'EnvironmentPanoramaWater')
    const second = demo.getState().source
    const look = {
      cache: tileset.cacheBytes,
      sse: tileset.maximumScreenSpaceError,
      terrainError: scene.globe.maximumScreenSpaceError,
      lighting: scene.globe.enableLighting,
      shadows: tileset.shadows,
      brightness: demo.viewer.imageryLayers.get(
        demo.viewer.imageryLayers.length - 1,
      ).brightness,
      wave: water.appearance.material.uniforms.u_waveStrength,
    }
    config.water.visible = false
    demo.applyConfiguration(config)
    return {
      first,
      second,
      shift: C.Cartesian3.distance(before, after),
      look,
      hidden: !water.show,
      error: scene.context._gl.getError(),
    }
  })
  check(
    'real water baseline follows extra model placement once',
    Math.abs(realEngine.first.waterBaseHeight - 416.1) < 0.01 &&
      Math.abs(realEngine.first.waterHeight - 424.1) < 0.01 &&
      Math.abs(realEngine.second.waterBaseHeight - 410.1) < 0.01 &&
      Math.abs(realEngine.shift - 6) < 0.0001,
  )
  check(
    'real quality source and water settings reach native objects',
    realEngine.look.cache === 96 * 1024 * 1024 &&
      realEngine.look.sse === 24 &&
      realEngine.look.terrainError === 5 &&
      realEngine.look.lighting &&
      realEngine.look.brightness === 1.2 &&
      realEngine.look.wave === 1.8 &&
      realEngine.hidden &&
      realEngine.error === 0,
  )
  await engine.evaluate(() => {
    const { demo, host } = window.__configurationProbe
    demo.dispose()
    host.remove()
  })
  check('no browser runtime errors', report.errors.length === 0)
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
