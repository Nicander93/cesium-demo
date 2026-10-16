import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
const { chromium } = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href)
  : await import('playwright')
const output = path.resolve(
  process.env.WATER_LIGHTING_OUTPUT ?? 'test-results/water-flow-lab/lighting',
)
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
    : {}),
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
})
const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: output, size: { width: 1440, height: 900 } },
  }),
  page = await context.newPage()
const errors = [],
  probes = [],
  angles = [],
  checks = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
const base =
  process.env.WATER_FLOW_BASE_URL ?? 'http://127.0.0.1:5198/cesium-demo/'
const command = (lab, method, value) =>
  page.evaluate(([lab, m, v]) => window[lab][m](v), [lab, method, value])
const optics = (m, v) => command('__waterOptics', m, v),
  real = (m, v) => command('__realWaterLab', m, v)
const state = (lab) => command(lab, 'getState')
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0)
function reference({ V, L, intensity }, roughness, ior) {
  const nv = V[1],
    nl = L[1]
  if (nv <= 0 || nl <= 0 || ior === 1) return 0
  const H = V.map((v, i) => v + L[i]),
    length = Math.hypot(...H)
  const nh = H[1] / length,
    vh = dot(V, H) / length,
    a = Math.max(roughness ** 2, 0.0025),
    a2 = a * a
  const D = a2 / (Math.PI * (nh * nh * (a2 - 1) + 1) ** 2)
  const lambda = (v) => (Math.sqrt(1 + (a2 * (1 - v * v)) / (v * v)) - 1) / 2
  const G = 1 / (1 + lambda(nv) + lambda(nl)),
    f0 = ((ior - 1) / (ior + 1)) ** 2
  const F = f0 + (1 - f0) * (1 - vh) ** 5
  return (intensity * D * G * F) / (4 * nv)
}
const encode = (x) =>
  255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)
async function rgb(x, y) {
  const b = await page.screenshot({ clip: { x, y, width: 1, height: 1 } })
  return page.evaluate(async (data) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + data
    await img.decode()
    const c = document.createElement('canvas')
    c.width = c.height = 1
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3)
  }, b.toString('base64'))
}
let report, renderer
try {
  await page.goto(base + 'water?scene=calibration')
  await page.waitForFunction(
    () => window.__waterOptics?.getState().diagnostics.readyMs != null,
  )
  renderer = await page.evaluate(() => {
    const canvas = document.querySelector('.cesium-widget canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    const debug = gl.getExtension('WEBGL_debug_renderer_info')
    return {
      version: gl.getParameter(gl.VERSION),
      renderer: gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER),
    }
  })
  await optics('prepareProbe')
  await optics('setOptions', {
    lightingModel: 'microfacet',
    skyEnvironment: false,
    reflectionStrength: 0,
    specularIntensity: 1,
  })
  for (const heading of [0, 1.4, 3]) {
    await optics('orbit', { heading, pitch: -0.5, range: 300 })
    let p = await optics('lightingProbe')
    await optics('setLight', {
      direction: [-p.V[0], p.V[1], -p.V[2]],
      intensity: 0.02,
    })
    for (const roughness of [0.18, 0.4, 0.75])
      for (const ior of [1, 1.333, 1.5]) {
        await optics('setOptions', { roughness, indexOfRefraction: ior })
        await page.waitForTimeout(80)
        p = await optics('lightingProbe')
        const expected = encode(reference(p, roughness, ior)),
          actual = await rgb(p.x, p.y)
        const error = Math.max(
          ...actual.map((v) => Math.abs(v - Math.min(255, expected))),
        )
        probes.push({
          heading,
          roughness,
          ior,
          expected,
          actual,
          error,
          V: p.V,
          L: p.L,
        })
        assert(error < 2, `GGX GPU/reference mismatch ${error}`)
      }
  }
  checks.push({
    check: '27 independent GGX/Smith/Fresnel and sRGB probes',
    passed: true,
  })
  await optics('restore')
  await optics('freeze')
  await optics('setOptions', {
    lightingModel: 'microfacet',
    skyEnvironment: true,
    roughness: 0.25,
    indexOfRefraction: 1.333,
  })
  await optics('setLight', { direction: [0.3, 0.8, 0.4], intensity: 1 })
  await page.waitForFunction(
    () => window.__waterOptics.getState().diagnostics.environmentAvailable,
    null,
    { timeout: 30000 },
  )
  const environmentBefore = (await state('__waterOptics')).diagnostics
    .environmentGenerations
  for (let i = 0; i < 32; i++) {
    const heading = (i * Math.PI * 2) / 32
    await optics('orbit', { heading, pitch: -0.5, range: 300 })
    await optics('setDebug', 3)
    await page.waitForTimeout(80)
    const p = await optics('lightingProbe'),
      coverage = await rgb(p.x, p.y),
      s = await state('__waterOptics')
    assert.equal(s.diagnostics.reflectionAvailable, true)
    assert.equal(s.diagnostics.environmentAvailable, true)
    assert.equal(s.diagnostics.geometryCreated, 1)
    assert.equal(
      s.diagnostics.environmentGenerations,
      environmentBefore,
      'Camera rotation must not change environmental lighting',
    )
    if (!p.waterPicked) {
      angles.push({ heading, occluded: true, coverage })
      await optics('setDebug', 0)
      continue
    }
    assert(
      coverage.every((v) => v >= 250),
      'Center reflection projection must stay inside valid coverage',
    )
    angles.push({ heading, coverage })
    await optics('setDebug', 0)
    if (i % 8 === 0)
      await page.screenshot({
        path: path.join(output, `calibration-rotation-${i}.png`),
      })
  }
  assert(
    angles.filter((a) => !a.occluded).length >= 24,
    'Coverage checks need visible water samples',
  )
  const ldrBefore = await state('__waterOptics')
  await optics('setHdr', true)
  await page.waitForFunction(
    () => {
      const d = window.__waterOptics.getState().diagnostics
      return d.environmentAvailable && d.reflectionAvailable
    },
    null,
    { timeout: 30000 },
  )
  const hdrState = await state('__waterOptics')
  assert.equal(hdrState.hdr, true, 'Water capture must restore host HDR state')
  assert.equal(hdrState.diagnostics.environmentAvailable, true)
  assert.equal(hdrState.diagnostics.reflectionAvailable, true)
  await page.screenshot({ path: path.join(output, 'calibration-hdr.png') })
  await optics('setHdr', false)
  await page.waitForFunction(
    () => {
      const d = window.__waterOptics.getState().diagnostics
      return d.environmentAvailable && d.reflectionAvailable
    },
    null,
    { timeout: 30000 },
  )
  assert.equal((await state('__waterOptics')).hdr, ldrBefore.hdr)
  checks.push({
    check:
      'Host HDR on/off compiles, preserves host state and keeps reflection/environment available; no HDR radiance accuracy claim',
    passed: true,
  })
  await optics('setOptions', { skyEnvironment: false })
  await page.waitForFunction(
    () => !window.__waterOptics.getState().diagnostics.environmentAvailable,
  )
  assert.equal(
    (await state('__waterOptics')).diagnostics.environmentError,
    null,
  )
  await optics('setOptions', { skyEnvironment: true })
  await page.waitForFunction(
    () => window.__waterOptics.getState().diagnostics.environmentAvailable,
  )
  const generation = (await state('__waterOptics')).diagnostics
    .environmentGenerations
  await optics('setLight', { direction: [-0.4, 0.7, 0.2], intensity: 0.8 })
  await page.waitForFunction((before) => {
    const d = window.__waterOptics.getState().diagnostics
    return d.environmentAvailable && d.environmentGenerations > before
  }, generation)
  checks.push({
    check:
      'Environment toggles without error and regenerates after host light changes',
    passed: true,
  })
  await optics('createCompanion')
  await page.waitForFunction(
    () => window.__waterOptics.getState().companion?.environmentAvailable,
    null,
    { timeout: 30000 },
  )
  await optics('destroyCompanion')
  await page.waitForTimeout(500)
  assert.equal(
    (await state('__waterOptics')).diagnostics.environmentAvailable,
    true,
  )
  checks.push({
    check: 'Shared scene BRDF survives destruction of a second water instance',
    passed: true,
  })

  await page.goto(base + 'water-real-terrain?lighting=microfacet')
  await page.waitForFunction(
    () => window.__realWaterLab?.getState().diagnostics?.environmentAvailable,
    null,
    { timeout: 90000 },
  )
  await real('setOptions', { reflection: false })
  await real('focus', 'near')
  await page.waitForFunction(
    () => window.__realWaterLab.getState().tilesLoaded,
    null,
    { timeout: 90000 },
  )
  await real('freeze')
  await real('setTime', 15)
  await real('setOptions', { reflection: true })
  const snapshots = []
  for (const pose of [
    { name: 'near', heading: 4.7, pitch: -0.7, range: 1400 },
    { name: 'opposite', heading: 1.56, pitch: -0.7, range: 1400 },
    { name: 'low', heading: 4.7, pitch: -0.3, range: 1400 },
  ]) {
    await real('orbit', pose)
    for (const model of ['legacy', 'microfacet']) {
      await page.getByLabel('光照模型', { exact: true }).selectOption(model)
      await page.waitForTimeout(500)
      await page.screenshot({
        path: path.join(output, `real-${pose.name}-${model}.png`),
      })
      const s = await state('__realWaterLab')
      delete s.shaderSource
      assert.equal(s.error, '')
      assert.equal(s.diagnostics.reflectionAvailable, true)
      if (model === 'microfacet')
        assert.equal(s.diagnostics.environmentAvailable, true)
      snapshots.push({ pose, model, state: s })
    }
  }
  await real('setOptions', {
    lightingModel: 'microfacet',
    reflection: false,
    specularIntensity: 0,
  })
  await page.waitForTimeout(300)
  await page.screenshot({
    path: path.join(output, 'real-environment-without-sun-glint.png'),
  })
  await real('setOptions', {
    reflection: true,
    specularIntensity: 0.7,
    waveSpeed: 0.7,
  })
  const start = (await state('__realWaterLab')).visualTime
  for (let i = 0; i < 12; i++) {
    await real('orbit', { heading: 4.7 + i * 0.03, pitch: -0.7, range: 1400 })
    await page.waitForTimeout(1000)
  }
  const finalState = await state('__realWaterLab')
  delete finalState.shaderSource
  assert(finalState.visualTime > start + 5)
  assert.equal(finalState.diagnostics.reflectionTargetsCreated, 1)
  assert.deepEqual(errors, [])
  await page.getByRole('link', { name: /合成水流对照/ }).click()
  await page.waitForFunction(() => !window.__realWaterLab)
  await page.waitForTimeout(300)
  assert.deepEqual(errors, [])
  checks.push({
    check:
      'Real terrain A/B, no-glint environment, continuous camera and route destruction',
    passed: true,
  })
  report = {
    passed: true,
    browser: browser.version(),
    renderer,
    probes,
    angles,
    checks,
    snapshots,
    finalState,
    errors,
    limits: [
      'Atmosphere and planar reflection are LDR approximations, not full HDR radiance or volumetric water.',
      'Numerical direct-light correctness and stable reflection coverage do not establish final visual acceptance.',
    ],
  }
} catch (error) {
  report = {
    passed: false,
    error: String(error),
    probes,
    angles,
    checks,
    errors,
    state: await state('__waterOptics')
      .catch(() => state('__realWaterLab'))
      .then((s) => {
        delete s.shaderSource
        return s
      })
      .catch(() => undefined),
  }
  process.exitCode = 1
  await page
    .screenshot({ path: path.join(output, 'failure.png') })
    .catch(() => {})
} finally {
  const video = page.video()
  await context.close()
  report.video = await video?.path()
  await browser.close()
  await fs.writeFile(
    path.join(output, 'gpu-smoke.json'),
    JSON.stringify(report, null, 2),
  )
  console.log(
    JSON.stringify({
      passed: report.passed,
      error: report.error,
      probes: probes.length,
      angles: angles.length,
      report: path.join(output, 'gpu-smoke.json'),
    }),
  )
}
