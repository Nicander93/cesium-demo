import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const { chromium } = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href)
  : await import('playwright')
const baseUrl = process.env.WATER_TRANSPORT_BASE_URL ?? 'http://127.0.0.1:5199/cesium-demo/'
const reportDir = path.resolve('test-results/render-transport-20261025')
await fs.mkdir(reportDir, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', error => errors.push(String(error)))
try {
  await page.goto(baseUrl + 'water-real-terrain', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => Boolean(window.__realWaterLab), { timeout: 30000 })
  await page.waitForFunction(() => {
    const state = window.__realWaterLab?.getState()
    return state?.hasWater && state.diagnostics?.underwaterDepthReady
  }, null, { timeout: 120000 })
  const initial = await page.evaluate(() => window.__realWaterLab.getState())
  assert.equal(initial.options.lightingModel, 'microfacet')
  assert.equal(initial.options.underwaterOptics, true)
  assert.equal(initial.options.foam, false)
  assert.match(initial.shaderSource, /waterDepthTransport/)
  assert.match(initial.shaderSource, /underwaterOpticsEnabled/)
  const depthFrames = initial.diagnostics.shoreFrames
  await page.evaluate(() => window.__realWaterLab.setOptions({ foam: false }))
  await page.waitForTimeout(1500)
  const noFoam = await page.evaluate(() => window.__realWaterLab.getState())
  assert.equal(noFoam.options.foam, false)
  assert.equal(noFoam.diagnostics.underwaterOpticsEnabled, true)
  assert.equal(noFoam.diagnostics.underwaterDepthReady, initial.diagnostics.underwaterDepthReady)
  assert.match(initial.diagnostics.shoreError ?? '', /^$|unsupported|framebuffer|context|render/i)

  await page.evaluate(() => window.__realWaterLab.setOptions({ foam: true }))
  await page.waitForTimeout(750)
  const beforeHide = await page.evaluate(() => window.__realWaterLab.getState().diagnostics.shoreFrames)
  await page.evaluate(() => window.__realWaterLab.setMode('imagery'))
  await page.waitForTimeout(1500)
  const hidden = await page.evaluate(() => window.__realWaterLab.getState())
  assert.equal(hidden.hasWater, true)
  assert.equal(hidden.diagnostics.shoreFrames, beforeHide)
  await page.evaluate(() => window.__realWaterLab.setMode('enhanced'))
  await page.waitForTimeout(1500)
  assert.deepEqual(errors, [])
  const gpu = await page.evaluate(({ source }) => {
    const helper = source.match(/vec3 waterDepthTransport\([\s\S]*?\n\}/)?.[0]
    if (!helper) throw new Error('Production transport helper was not found in assembled Cesium shader')
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    if (!gl) throw new Error('WebGL2 is unavailable')
    const compile = (type, text) => {
      const shader = gl.createShader(type)
      gl.shaderSource(shader, text)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader))
      return shader
    }
    const program = gl.createProgram()
    gl.attachShader(program, compile(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}'))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;\n'+helper+'\nout vec4 color;\nvoid main(){color=vec4(waterDepthTransport(vec3(0.8,0.3,0.1),vec3(0.2,0.6,0.8),vec3(0.16,0.06,0.025),vec3(0.025,0.015,0.01),4.0,0.5,1.0),1.0);}'))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program))
    gl.useProgram(program)
    gl.viewport(0,0,1,1)
    gl.drawArrays(gl.TRIANGLES,0,3)
    const actual = new Uint8Array(4)
    gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,actual)
    const renderer = gl.getExtension('WEBGL_debug_renderer_info')
    return { actual: Array.from(actual.slice(0,3)), renderer: renderer ? gl.getParameter(renderer.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) }
  }, { source: initial.shaderSource })
  const transmission = [0,1,2].map(i => Math.exp(-([0.16,0.06,0.025][i]+[0.025,0.015,0.01][i])*8))
  const scatterWeight = [0,1,2].map(i => [0.025,0.015,0.01][i]/([0.16,0.06,0.025][i]+[0.025,0.015,0.01][i])*(1-transmission[i]))
  const expected = [0,1,2].map(i => Math.round(([0.8,0.3,0.1][i]*transmission[i]+[0.2,0.6,0.8][i]*scatterWeight[i])*255))
  const maxError = Math.max(...expected.map((value,index) => Math.abs(value-gpu.actual[index])))
  assert(maxError <= 1, 'Production water transport GLSL diverged from the independent Beer-Lambert reference')
  const browserReport = {
    pass: true,
    evidence: 'Real terrain page: production Cesium material shader assembled and rendered; DEM-derived vertical depth was ready. Lake DEM can flatten the water surface, so readiness does not establish nonzero physical bathymetry.',
    initial: { depthFrames, depthReady: initial.diagnostics.underwaterDepthReady, foam: initial.options.foam, optics: initial.options.underwaterOptics },
    foamOff: { framesContinued: noFoam.diagnostics.shoreFrames > depthFrames, depthReady: noFoam.diagnostics.underwaterDepthReady, foam: noFoam.options.foam },
    hidePausedFrames: beforeHide === hidden.diagnostics.shoreFrames,
    diagnostics: { shoreError: initial.diagnostics.shoreError, shoreTargetsCreated: initial.diagnostics.shoreTargetsCreated },
    errors,
  }
  const gpuReport = { pass: true, renderer: gpu.renderer, helper: 'waterDepthTransport extracted from production Cesium shader', verticalDepthM: 4, viewCosine: 0.5, pathLengthM: 8, expected, actual: gpu.actual, maxError, input: { substrate: [0.8,0.3,0.1], scatteringRadiance: [0.2,0.6,0.8], absorption: [0.16,0.06,0.025], scattering: [0.025,0.015,0.01] } }
  await Promise.all([
    fs.writeFile(path.join(reportDir, 'water-browser.json'), JSON.stringify(browserReport, null, 2)),
    fs.writeFile(path.join(reportDir, 'water-gpu.json'), JSON.stringify(gpuReport, null, 2)),
  ])
  console.log(JSON.stringify({ browser: browserReport, gpu: gpuReport }, null, 2))
} finally {
  await browser.close()
}
