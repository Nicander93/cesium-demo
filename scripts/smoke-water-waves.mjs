import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
const { chromium } = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href)
  : await import('playwright')
const output = path.resolve(
  process.env.WATER_WAVES_OUTPUT ??
    'test-results/water-flow-lab/wave-transition',
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
})
const page = await context.newPage(),
  errors = [],
  probes = [],
  snapshots = [],
  checks = []
page.on('pageerror', (e) => errors.push(e.stack ?? String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
const base =
  process.env.WATER_FLOW_BASE_URL ?? 'http://127.0.0.1:5198/cesium-demo/'
const call = (lab, method, arg) =>
  page.evaluate(([lab, m, a]) => window[lab][m](a), [lab, method, arg])
const optics = (m, a) => call('__waterOptics', m, a),
  real = (m, a) => call('__realWaterLab', m, a)
async function pixel(x, y) {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } })
  return page.evaluate(async (data) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + data
    await img.decode()
    const c = document.createElement('canvas')
    c.width = c.height = 1
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3)
  }, png.toString('base64'))
}
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
function reference(
  bands,
  p,
  footprint,
  { waveStrength, detailStrength, roughness, time },
) {
  let variance = 0
  const waves = []
  bands.forEach((band, b) => {
    for (let i = 0; i < 4; i++) {
      const [kx, ky, omega, phase] = band
        .slice(i * 4, i * 4 + 4)
        .map(Math.fround)
      const a = b === 4 ? 0.025 * detailStrength : 0.05 / 1.35 ** b
      const px = kx * footprint,
        py = ky * footprint
      const attenuation =
        Math.exp(-(px * px + py * py) / 24) *
        (1 - smooth(Math.PI / 2, Math.PI, Math.max(Math.abs(px), Math.abs(py))))
      variance +=
        0.5 *
        a *
        a *
        (1 - attenuation * attenuation) *
        waveStrength *
        waveStrength
      waves.push({ kx, ky, omega, phase, a, attenuation })
    }
  })
  // Independent finite differences of height, rather than the shader's analytic slope formula.
  const height = (x, y) =>
    waves.reduce(
      (sum, w) =>
        sum +
        (w.a / Math.hypot(w.kx, w.ky)) *
          Math.sin(w.kx * x + w.ky * y - time * w.omega + w.phase) *
          w.attenuation,
      0,
    )
  const h = 0.001,
    sx =
      ((height(p.x + h, p.y) - height(p.x - h, p.y)) / (2 * h)) * waveStrength,
    sy =
      ((height(p.x, p.y + h) - height(p.x, p.y - h)) / (2 * h)) * waveStrength
  const length = Math.hypot(sx, 1, sy),
    normal = [-sx / length, 1 / length, sy / length]
  return {
    normal,
    rgb: [normal[0] * 0.5 + 0.5, normal[2] * 0.5 + 0.5, normal[1]].map(
      (x) => x * 255,
    ),
    roughness: Math.min(1, roughness ** 4 + 0.5 * variance) ** 0.25,
    variance,
  }
}
const common = {
  waveLength: 48,
  waveDirection: 55,
  waveSpread: 35,
  waveIrregularity: 0.35,
  waveStrength: 0.8,
  detailStrength: 0.35,
  roughness: 0.18,
  lightingModel: 'microfacet',
}
let report
try {
  await page.goto(base + 'water?scene=calibration')
  await page.waitForFunction(
    () => window.__waterOptics?.getState().diagnostics.readyMs != null,
  )
  await optics('prepareProbe')
  const options = {
    waveStrength: 1.2,
    detailStrength: 0.5,
    roughness: 0.12,
    time: 15,
  }
  await optics('setOptions', {
    waveModel: 'spectrum',
    waveLength: 37,
    waveSpread: 65,
    waveIrregularity: 0.8,
    ...options,
  })
  await optics('freeze')
  await optics('orbit', { heading: 4.7, pitch: -0.5, range: 300 })
  const sample = await optics('lightingProbe')
  assert(sample.waterPicked, 'Wave probe must hit water')
  const bands = await optics('getWaveBands')
  for (const p of [
    { x: 0, y: 0 },
    { x: 23.7, y: -14.2 },
    { x: -90.4, y: 37.6 },
  ])
    for (const footprint of [0, 0.3, 2, 10, 100]) {
      const expected = reference(bands, p, footprint, options)
      await optics('setWaveProbe', { mode: 3, ...p, footprint })
      await page.waitForTimeout(70)
      const actual = await pixel(sample.x, sample.y)
      const normalError = Math.max(
        ...actual.map((v, i) => Math.abs(v - expected.rgb[i])),
      )
      assert(
        normalError < 1.6,
        'Finite-difference wave normal mismatch ' + normalError,
      )
      await optics('setWaveProbe', { mode: 4, ...p, footprint })
      await page.waitForTimeout(70)
      const actualRoughness = await pixel(sample.x, sample.y)
      const roughnessError = Math.max(
        ...actualRoughness.map((v) => Math.abs(v - expected.roughness * 255)),
      )
      assert(
        roughnessError < 1.6,
        'Unresolved slope roughness mismatch ' + roughnessError,
      )
      probes.push({
        p,
        footprint,
        expected,
        actual,
        normalError,
        actualRoughness,
        roughnessError,
      })
    }
  for (const detailStrength of [0, 0.5]) {
    await optics('setOptions', { detailStrength, waveStrength: 0 })
    await optics('setWaveProbe', { mode: 3, x: 23, y: 17, footprint: 0 })
    await page.waitForTimeout(70)
    const rgb = await pixel(sample.x, sample.y)
    assert(
      rgb[2] >= 254 &&
        Math.abs(rgb[0] - 127.5) < 1 &&
        Math.abs(rgb[1] - 127.5) < 1,
    )
  }
  const roughnessByFootprint = probes
    .filter((p) => p.p.x === 0)
    .map((p) => p.expected.roughness)
  assert(roughnessByFootprint.every((x, i, a) => i === 0 || x >= a[i - 1]))
  assert(
    roughnessByFootprint.at(-1) > roughnessByFootprint[0] + 0.05,
    'Far-field waves must retain statistical roughness',
  )
  checks.push(
    '15 CPU finite-difference/GPU normal probes and 15 unresolved-variance roughness probes; zero-strength flat normals',
  )
  await optics('setWaveProbe', { mode: 0 })
  await optics('restore')
  await optics('freeze')
  await optics('setOptions', common)
  await page.waitForFunction(
    () => window.__waterOptics.getState().diagnostics.environmentAvailable,
  )
  for (const pose of [
    { name: 'near', heading: 4.7, pitch: -0.3, range: 160 },
    { name: 'far', heading: 4.7, pitch: -0.3, range: 2500 },
  ]) {
    await optics('orbit', pose)
    for (const waveModel of ['multiscale', 'spectrum']) {
      await optics('setOptions', { waveModel })
      await page.waitForTimeout(500)
      await page.screenshot({
        path: path.join(output, `calibration-${pose.name}-${waveModel}.png`),
      })
      const s = await optics('getState')
      delete s.shaderSource
      assert.equal(s.diagnostics.geometryCreated, 1)
      snapshots.push({ scene: 'calibration', pose, waveModel, state: s })
    }
  }
  await page.getByRole('button', { name: /返回主页/ }).click()
  await page.waitForFunction(() => !window.__waterOptics)
  assert.deepEqual(errors, [])
  await page.goto(base + 'water-real-terrain?lighting=microfacet')
  await page.waitForFunction(
    () => window.__realWaterLab?.getState().diagnostics?.environmentAvailable,
    null,
    { timeout: 90000 },
  )
  await real('setOptions', common)
  await real('freeze')
  await real('setTime', 15)
  for (const pose of [
    { name: 'near', heading: 4.7, pitch: -0.3, range: 350 },
    { name: 'middle', heading: 4.7, pitch: -0.7, range: 1400 },
    { name: 'far', heading: 4.7, pitch: -0.7, range: 6000 },
    { name: 'opposite', heading: 1.56, pitch: -0.7, range: 1400 },
  ]) {
    if (pose.name === 'near' || pose.name === 'far') {
      await page
        .getByRole('button', {
          name: pose.name === 'near' ? '近景' : '远景',
          exact: true,
        })
        .click()
    } else await real('orbit', pose)
    await page.waitForFunction(
      () => window.__realWaterLab.getState().tilesLoaded,
      null,
      { timeout: 90000 },
    )
    for (const waveModel of ['multiscale', 'spectrum']) {
      await page.getByLabel('波纹算法', { exact: true }).selectOption(waveModel)
      await page.waitForTimeout(700)
      await page.screenshot({
        path: path.join(output, `real-${pose.name}-${waveModel}.png`),
      })
      const s = await real('getState')
      delete s.shaderSource
      assert.equal(s.options.waveModel, waveModel)
      assert.equal(s.visualTime, 15)
      assert.equal(s.diagnostics.geometryCreated, 1)
      assert.equal(s.diagnostics.reflectionAvailable, true)
      assert.equal(s.error, '')
      snapshots.push({ scene: 'real-terrain', pose, waveModel, state: s })
      if (pose.name === 'near' || pose.name === 'far') {
        await real('setWaveProbe', { mode: pose.name === 'far' ? 2 : 1 })
        await page.waitForTimeout(100)
        await page.screenshot({
          path: path.join(output, `diagnostic-${pose.name}-${waveModel}.png`),
        })
        await real('setWaveProbe', { mode: 0 })
      }
    }
  }
  await real('setOptions', { waveModel: 'spectrum', waveSpeed: 0.7 })
  for (let i = 0; i < 40; i++) {
    await real('orbit', {
      heading: 4.7,
      pitch: -0.3 - i * 0.01,
      range: 350 * (6000 / 350) ** (i / 39),
    })
    await page.waitForTimeout(200)
  }
  const finalState = await real('getState')
  delete finalState.shaderSource
  assert(finalState.visualTime > 18)
  assert.equal(finalState.diagnostics.reflectionTargetsCreated, 1)
  await page.getByRole('link', { name: /合成水流对照/ }).click()
  await page.waitForFunction(() => !window.__realWaterLab)
  await page.waitForTimeout(300)
  assert.deepEqual(errors, [])
  checks.push(
    'Fixed near/far calibration and real-terrain A/B; 40 continuous distance poses; stable geometry and reflection resources; route destruction',
  )
  report = {
    passed: true,
    checks,
    probes,
    snapshots,
    finalState,
    errors,
    limits: [
      'Finite waves with deep-water dispersion; no geometry displacement, calibrated ocean energy spectrum or flood solver.',
      'Isotropic GGX roughness from unresolved directional slopes is an approximation; A/B screenshots require visual review.',
    ],
  }
} catch (e) {
  report = {
    passed: false,
    error: String(e),
    probes,
    checks,
    snapshots,
    errors,
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
      snapshots: snapshots.length,
      output,
    }),
  )
}
