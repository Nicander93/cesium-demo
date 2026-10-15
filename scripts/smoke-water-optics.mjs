import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const { chromium } = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href)
  : await import('playwright')
const output = path.resolve(
  process.env.WATER_OPTICS_OUTPUT ?? 'test-results/water-flow-lab/optics',
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
const page = await context.newPage()
const errors = [],
  probes = [],
  comparisons = [],
  checks = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})
const state = () => page.evaluate(() => window.__waterOptics.getState())
const control = (method, value) =>
  page.evaluate(
    ([method, value]) => window.__waterOptics[method](value),
    [method, value],
  )
const clip = { x: 0, y: 0, width: 1100, height: 850 }

async function pixels(buffer) {
  return page.evaluate(async (data) => {
    const image = new Image()
    image.src = 'data:image/png;base64,' + data
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    return Array.from(ctx.getImageData(0, 0, image.width, image.height).data)
  }, buffer.toString('base64'))
}
async function difference(a, b) {
  return page.evaluate(
    async ([a, b]) => {
      const decode = async (data) => {
        const image = new Image()
        image.src = 'data:image/png;base64,' + data
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(image, 0, 0)
        return ctx.getImageData(0, 0, image.width, image.height).data
      }
      const [x, y] = await Promise.all([decode(a), decode(b)])
      let sum = 0,
        changed = 0
      for (let i = 0; i < x.length; i += 4) {
        const d =
          (Math.abs(x[i] - y[i]) +
            Math.abs(x[i + 1] - y[i + 1]) +
            Math.abs(x[i + 2] - y[i + 2])) /
          3
        sum += d
        if (d > 10) changed++
      }
      return {
        meanRgbDifference: sum / (x.length / 4),
        changedOver10: changed / (x.length / 4),
      }
    },
    [a.toString('base64'), b.toString('base64')],
  )
}
async function settle() {
  await page.waitForTimeout(400)
  let previous = await page.screenshot({ clip })
  for (let attempt = 0; attempt < 12; attempt++) {
    await page.waitForTimeout(250)
    const current = await page.screenshot({ clip })
    const noise = await difference(previous, current)
    if (noise.meanRgbDifference < 0.05) return { image: current, noise }
    previous = current
  }
  throw new Error('Frozen calibration scene did not settle')
}
async function sample() {
  await page.waitForTimeout(150)
  const probe = await control('probe')
  assert(probe.waterPicked, 'Numeric probe must hit water, not an occluder')
  const data = await pixels(
    await page.screenshot({
      clip: { x: probe.x - 2, y: probe.y - 2, width: 5, height: 5 },
    }),
  )
  const actual = [0, 1, 2].map((channel) => {
    const values = []
    for (let i = channel; i < data.length; i += 4) values.push(data[i])
    return values.sort((a, b) => a - b)[Math.floor(values.length / 2)]
  })
  return {
    ...probe,
    actual,
    maxError: Math.max(
      ...actual.map((value, channel) =>
        Math.abs(value - probe.expected[channel]),
      ),
    ),
  }
}
let report
try {
  await page.goto(
    (process.env.WATER_FLOW_BASE_URL ?? 'http://127.0.0.1:5198/cesium-demo/') +
      'water?scene=calibration',
  )
  await page.waitForFunction(
    () => {
      const s = window.__waterOptics?.getState()
      return (
        s?.diagnostics?.readyMs != null && s.diagnostics.reflectionAvailable
      )
    },
    null,
    { timeout: 30000 },
  )
  const initial = await state()
  assert.equal(initial.options.shadingMode, 'legacy-phong')
  assert.equal(initial.hdr, false)
  assert.equal(initial.error, '')
  const geometry = initial.diagnostics.geometryCreated

  // A flat normal, black water color and disabled highlight yield an analytic
  // constant body term. Ray angle independently supplies Schlick's cosine.
  await control('prepareProbe')
  await control('setOptions', { shadingMode: 'water-composite' })
  for (const camera of ['near', 'overview', 'far']) {
    await control('focus', camera)
    for (const f0 of [0, 0.04, 0.3, 1]) {
      await control('setOptions', { reflectivity: f0, reflectionStrength: 1 })
      const result = await sample()
      probes.push({ camera, f0, strength: 1, ...result })
      assert(
        result.maxError <= 2,
        `${camera}, F0=${f0}: GPU color differs from reference by ${result.maxError}`,
      )
    }
    await control('setOptions', { reflectivity: 0.3, reflectionStrength: 0 })
    const body = await sample()
    probes.push({ camera, f0: 0.3, strength: 0, ...body })
    assert(body.maxError <= 2, 'Zero reflection must reproduce the body term')
    await control('setOptions', { reflectionStrength: 0.5 })
    const half = await sample()
    probes.push({ camera, f0: 0.3, strength: 0.5, ...half })
    assert(
      half.maxError <= 2,
      'Reflection-strength scaling must match the existing mix equation',
    )
  }
  await control('focus', 'near')
  await control('setOptions', {
    reflectionStrength: 0,
    shadingMode: 'water-composite',
  })
  const direct = await sample()
  await control('setOptions', { shadingMode: 'legacy-phong' })
  const phong = await sample()
  assert(
    Math.max(
      ...direct.actual.map((value, channel) =>
        Math.abs(value - phong.actual[channel]),
      ),
    ) > 2,
    'Controlled probe must demonstrate the additional Cesium lighting',
  )
  checks.push({
    check: 'additional Phong lighting observed in actual pixels',
    direct: direct.actual,
    phong: phong.actual,
  })

  await control('restore')
  await control('freeze')
  await page.waitForTimeout(1000)
  for (const camera of ['near', 'overview', 'far']) {
    await control('focus', camera)
    const images = {},
      frozenNoise = {}
    const cameraPosition = (await state()).cameraPosition
    for (const mode of ['legacy-phong', 'water-composite']) {
      await page.getByLabel('颜色输出', { exact: true }).selectOption(mode)
      assert.equal((await state()).options.shadingMode, mode)
      const frozen = await settle()
      images[mode] = frozen.image
      frozenNoise[mode] = frozen.noise
      await page.screenshot({
        path: path.join(output, camera + '-' + mode + '.png'),
      })
      const current = await state()
      assert.deepEqual(current.cameraPosition, cameraPosition)
      assert.equal(current.diagnostics.geometryCreated, geometry)
      assert.equal(current.options.waveModel, 'legacy')
      assert.equal(current.visualTime, 15)
      assert.equal(current.diagnostics.reflectionAvailable, true)
      assert.equal(current.diagnostics.error, null)
    }
    comparisons.push({
      camera,
      cameraPosition,
      frozenNoise,
      response: await difference(
        images['legacy-phong'],
        images['water-composite'],
      ),
    })
  }
  const assembled = (await state()).shaderSource
  const uniforms = [...assembled.matchAll(/uniform\s+\w+\s+(\w+)/g)].map(
    (match) => match[1],
  )
  assert(uniforms.length > 20)
  assert.equal(uniforms.length, new Set(uniforms).size)
  await fs.writeFile(path.join(output, 'assembled-fragment.glsl'), assembled)

  await control('focus', 'near')
  await control('play')
  const start = (await state()).visualTime
  for (let i = 0; i < 16; i++) {
    if (i === 5) await control('focus', 'overview')
    if (i === 10) await control('focus', 'far')
    if (i === 6 || i === 11) {
      await page.mouse.move(880, 430)
      await page.mouse.down()
      await page.mouse.move(1000, 460, { steps: 24 })
      await page.mouse.up()
    }
    await page.waitForTimeout(1000)
  }
  const finalState = await state()
  assert(finalState.visualTime > start + 9)
  assert.equal(finalState.diagnostics.geometryCreated, geometry)
  assert.equal(finalState.diagnostics.reflectionAvailable, true)
  assert.equal(finalState.error, '')
  assert.deepEqual(errors, [])
  delete finalState.shaderSource
  await page.getByRole('button', { name: /返回主页/ }).click()
  await page.waitForFunction(() => !window.__waterOptics)
  await page.waitForTimeout(250)
  assert.deepEqual(errors, [])
  checks.push({
    check:
      'route unmount removes the development control and raises no renderer error',
    passed: true,
  })
  const renderer = await page.evaluate(() => {
    const canvas = document.createElement('canvas'),
      gl = canvas.getContext('webgl2')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unavailable'
  })
  report = {
    passed: true,
    browser: browser.version(),
    renderer,
    probes,
    comparisons,
    checks,
    finalState,
    errors,
    assembledUniformCount: uniforms.length,
    limits: [
      'Analytic probes validate the existing color equation and its output path, not a physically complete water model.',
      'Calibration disables HDR, atmosphere and network assets; real-terrain HDR/color-space behavior requires separate validation.',
      'Pixel differences and GPU compilation do not establish artistic superiority.',
    ],
  }
} catch (error) {
  report = {
    passed: false,
    error: String(error),
    probes,
    comparisons,
    checks,
    errors,
    state: await state()
      .then((value) => {
        delete value.shaderSource
        return value
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
      report: path.join(output, 'gpu-smoke.json'),
    }),
  )
}
