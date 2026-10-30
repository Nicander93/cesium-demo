import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const { chromium } = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href)
  : await import('playwright')
const baseUrl = (
  process.env.ENVIRONMENT_BASE_URL ?? 'http://127.0.0.1:5174/cesium-demo/'
).replace(/\/?$/, '/')
const output = path.resolve(
  process.env.ENVIRONMENT_OUTPUT ?? 'test-results/environment-lifecycle',
)
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
    : {}),
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
})

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const browserErrors = []
  page.on('pageerror', (error) => browserErrors.push(String(error)))
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /webgl|shader|framebuffer|rendering has stopped|developererror/i.test(
        message.text(),
      )
    )
      browserErrors.push(message.text())
  })
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
  const report = await page.evaluate(async (base) => {
    const checks = []
    const check = (name, condition, detail = '') => {
      if (!condition)
        throw new Error(`${name} failed${detail ? `: ${detail}` : ''}`)
      checks.push({ name, passed: true })
    }
    const near = (a, b, epsilon = 1e-8) => Math.abs(a - b) <= epsilon
    const { createEnvironment } = await import(
      new URL('src/environment/index.ts', base).href
    )
    const cesiumUrl = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => {
        try {
          return /(?:^|\/)cesium\.js$/i.test(new URL(name).pathname)
        } catch {
          return false
        }
      })
    if (!cesiumUrl)
      throw new Error('Vite cesium.js was not found in resource entries')
    const Cesium = await import(cesiumUrl)
    const container = document.createElement('div')
    Object.assign(container.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: '960px',
      height: '600px',
    })
    document.body.append(container)
    const viewer = new Cesium.Viewer(container, {
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      animation: false,
      timeline: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      skyBox: false,
      skyAtmosphere: false,
      shouldAnimate: false,
      contextOptions: { webgl: { alpha: false } },
    })
    viewer.resize()
    const scene = viewer.scene
    scene.skyAtmosphere = new Cesium.SkyAtmosphere()
    scene.skyAtmosphere.show = true
    const pixel =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p0sAAAAASUVORK5CYII='
    const originalSky = new Cesium.SkyBox({
      show: false,
      sources: {
        positiveX: pixel,
        negativeX: pixel,
        positiveY: pixel,
        negativeY: pixel,
        positiveZ: pixel,
        negativeZ: pixel,
      },
    })
    scene.skyBox = originalSky
    scene.fog.enabled = true
    scene.fog.density = 0.00037
    scene.fog.renderable = false
    scene.fog.minimumBrightness = 0.17
    scene.globe.showGroundAtmosphere = true
    scene.globe.enableLighting = false
    viewer.shadows = false
    scene.highDynamicRange = false
    scene.postProcessStages.exposure = 1.23
    scene.postProcessStages.tonemapper = Cesium.Tonemapper.REINHARD
    scene.light = new Cesium.DirectionalLight({
      direction: new Cesium.Cartesian3(0.2, 0.3, -1),
      intensity: 0.7,
    })
    const originalLight = scene.light
    const sceneErrors = []
    const removeRenderError = scene.renderError.addEventListener(
      (_scene, error) => sceneErrors.push(String(error)),
    )
    const frames = { count: 0 }
    const removePostRender = scene.postRender.addEventListener(
      () => frames.count++,
    )
    const initialStages = scene.postProcessStages.length
    const initialClock = Cesium.JulianDate.clone(viewer.clock.currentTime)
    const initialCamera = {
      position: Cesium.Cartesian3.clone(viewer.camera.position),
      direction: Cesium.Cartesian3.clone(viewer.camera.direction),
      up: Cesium.Cartesian3.clone(viewer.camera.up),
    }
    const anchor = Cesium.Cartesian3.fromDegrees(119.0317, 33.5921, 30)
    const assetBaseUrl = new URL('environment-lab/', base).href
    const model = await Cesium.Model.fromGltfAsync({
      url: new URL('city-rendering/kenney/city/building-a.glb', base).href,
      modelMatrix: Cesium.Transforms.eastNorthUpToFixedFrame(anchor),
      upAxis: Cesium.Axis.Y,
      forwardAxis: Cesium.Axis.X,
      enableVerticalExaggeration: false,
      shadows: Cesium.ShadowMode.ENABLED,
    })
    scene.primitives.add(model)
    const originalReference = Cesium.Matrix4.clone(Cesium.Matrix4.IDENTITY)
    model.referenceMatrix = originalReference
    const originalSH = Array.from(
      { length: 9 },
      (_, i) => new Cesium.Cartesian3(i + 0.1, i + 0.2, i + 0.3),
    )
    const originalSpecular = new URL(
      'environment-lab/specular/sunset.ktx2',
      base,
    ).href
    model.imageBasedLighting.sphericalHarmonicCoefficients = originalSH
    model.imageBasedLighting.specularEnvironmentMaps = originalSpecular
    model.imageBasedLighting.imageBasedLightingFactor = new Cesium.Cartesian2(
      0.3,
      0.45,
    )
    model.environmentMapManager.enabled = true
    const originalFactor = Cesium.Cartesian2.clone(
      model.imageBasedLighting.imageBasedLightingFactor,
    )
    const sameViewerState = () =>
      Cesium.JulianDate.equals(viewer.clock.currentTime, initialClock) &&
      Cesium.Cartesian3.equalsEpsilon(
        viewer.camera.position,
        initialCamera.position,
        1e-8,
      ) &&
      Cesium.Cartesian3.equalsEpsilon(
        viewer.camera.direction,
        initialCamera.direction,
        1e-8,
      ) &&
      Cesium.Cartesian3.equalsEpsilon(viewer.camera.up, initialCamera.up, 1e-8)
    const originalSceneRestored = () =>
      scene.skyBox === originalSky &&
      scene.skyAtmosphere?.show === true &&
      scene.light === originalLight &&
      scene.highDynamicRange === false &&
      scene.postProcessStages.exposure === 1.23 &&
      scene.postProcessStages.tonemapper === Cesium.Tonemapper.REINHARD &&
      scene.fog.enabled === true &&
      near(scene.fog.density, 0.00037) &&
      scene.fog.renderable === false &&
      near(scene.fog.minimumBrightness, 0.17) &&
      scene.globe.showGroundAtmosphere === true &&
      scene.globe.enableLighting === false &&
      viewer.shadows === false &&
      scene.postProcessStages.length === initialStages
    const originalModelRestored = () =>
      model.referenceMatrix === originalReference &&
      model.imageBasedLighting.sphericalHarmonicCoefficients === originalSH &&
      model.imageBasedLighting.specularEnvironmentMaps === originalSpecular &&
      near(model.imageBasedLighting.imageBasedLightingFactor.x, 0.3) &&
      near(model.imageBasedLighting.imageBasedLightingFactor.y, 0.45) &&
      model.environmentMapManager.enabled === true
    async function waitForFrames(count) {
      const target = frames.count + count
      scene.requestRender()
      const start = performance.now()
      while (frames.count < target && performance.now() - start < 20000)
        await new Promise((resolve) => setTimeout(resolve, 30))
      if (frames.count < target)
        throw new Error('Cesium render loop did not advance')
    }
    async function cycle(number, forceNonHdr) {
      const environment = createEnvironment(viewer, { anchor, assetBaseUrl })
      check(
        `cycle ${number}: adds one post-process stage`,
        scene.postProcessStages.length === initialStages + 1,
      )
      environment.setOptions({ fog: 0.27, rain: 0.04 })
      environment.setOptions({ fog: 0.33, exposure: 1.1 })
      check(
        `cycle ${number}: options do not add stages`,
        scene.postProcessStages.length === initialStages + 1,
      )
      check(
        `cycle ${number}: day panorama loads`,
        await environment.setPreset('day'),
      )
      check(
        `cycle ${number}: leaves Viewer clock and camera unchanged`,
        sameViewerState(),
      )
      const detach = environment.attachModel(model)
      const daySpecular = new URL('environment-lab/specular/day.ktx2', base)
        .href
      check(
        `cycle ${number}: Kenney model receives shared IBL`,
        model.referenceMatrix !== originalReference &&
          model.imageBasedLighting.sphericalHarmonicCoefficients?.length ===
            9 &&
          model.imageBasedLighting.specularEnvironmentMaps === daySpecular &&
          model.environmentMapManager.enabled === false,
      )
      const results = await Promise.all(
        ['sunset', 'rain', 'day'].map((preset) =>
          environment.setPreset(preset),
        ),
      )
      check(
        `cycle ${number}: latest rapid preset request wins`,
        results[0] === false &&
          results[1] === false &&
          results[2] === true &&
          environment.getState().preset === 'day',
        JSON.stringify(results),
      )
      check(
        `cycle ${number}: final preset refreshes model IBL`,
        model.imageBasedLighting.specularEnvironmentMaps === daySpecular,
      )
      environment.setOptions({ modelLighting: 'studio' })
      check(
        `cycle ${number}: studio mode reuses the host model frame`,
        model.referenceMatrix === originalReference &&
          model.imageBasedLighting.specularEnvironmentMaps.endsWith(
            'model-rendering/studio-specular.ktx2',
          ),
      )
      environment.setOptions({ modelLighting: 'weather' })
      check(
        `cycle ${number}: outdoor mode restores shared weather IBL`,
        model.referenceMatrix !== originalReference &&
          model.imageBasedLighting.specularEnvironmentMaps === daySpecular,
      )
      environment.setOptions({ modelLighting: 'studio' })
      if (forceNonHdr) {
        scene.highDynamicRange = false
        await waitForFrames(2)
        check(
          `cycle ${number}: forced non-HDR render has no Cesium error`,
          sceneErrors.length === 0,
          JSON.stringify(sceneErrors),
        )
      }
      check(
        `cycle ${number}: options preserve Viewer clock and camera`,
        sameViewerState(),
      )
      check(
        `cycle ${number}: no render errors before destroy`,
        sceneErrors.length === 0,
        JSON.stringify(sceneErrors),
      )
      detach()
      environment.destroy()
      check(
        `cycle ${number}: restores scene state and post-process count`,
        originalSceneRestored(),
        JSON.stringify({
          sky: scene.skyBox === originalSky,
          atmosphere: scene.skyAtmosphere?.show === true,
          light: scene.light === originalLight,
          hdr: scene.highDynamicRange === false,
          exposure: scene.postProcessStages.exposure,
          tonemapper: scene.postProcessStages.tonemapper,
          fog: scene.fog.enabled,
          groundAtmosphere: scene.globe.showGroundAtmosphere,
          lighting: scene.globe.enableLighting,
          shadows: viewer.shadows,
          stages: scene.postProcessStages.length,
          initialStages,
        }),
      )
      check(
        `cycle ${number}: restores model IBL and reference frame`,
        originalModelRestored(),
      )
      check(
        `cycle ${number}: destroy preserves Viewer clock and camera`,
        sameViewerState(),
      )
    }
    await cycle(1, true)
    await cycle(2, false)
    await waitForFrames(2)
    removeRenderError()
    removePostRender()
    scene.primitives.remove(model)
    viewer.destroy()
    container.remove()
    check(
      'two create/destroy cycles have no Cesium render errors',
      sceneErrors.length === 0,
      JSON.stringify(sceneErrors),
    )
    return {
      passed: true,
      checks,
      sceneErrors,
      initialStages,
      finalStages: initialStages,
    }
  }, baseUrl)
  assert.equal(report.passed, true)
  assert.ok(
    report.checks.length >= 15,
    `Expected lifecycle checks, got ${report.checks.length}`,
  )
  assert.deepEqual(
    browserErrors,
    [],
    `Browser WebGL errors: ${browserErrors.join('\n')}`,
  )
  const result = {
    ...report,
    browserErrors,
    baseUrl,
    generatedAt: new Date().toISOString(),
  }
  await fs.writeFile(
    path.join(output, 'report.json'),
    JSON.stringify(result, null, 2),
  )
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser.close()
}
