import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { unrollLoops } from '../src/vendor/cesium-geospatial/core/unrollLoops.ts'

const { chromium } = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href)
  : await import('playwright')
const source = await fs.readFile(new URL('../src/vendor/cesium-geospatial/clouds/glsl/cloudsResolve.frag', import.meta.url), 'utf8')
const offsets = source.slice(source.indexOf('const ivec2 neighborOffsets'), source.indexOf('const ivec4[4] bayerIndices'))
const closest = unrollLoops(source.slice(source.indexOf('vec4 getClosestFragment('), source.indexOf('void temporalUpscale(')))
const marchSource = await fs.readFile(new URL('../src/vendor/cesium-geospatial/clouds/glsl/clouds.frag', import.meta.url), 'utf8')
const depthSample = marchSource.slice(marchSource.indexOf('vec2 getCloudDepthSample('), marchSource.indexOf('float getOpticalDepthStep('))
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
})
try {
  const page = await browser.newPage()
  await page.setContent('<canvas width="3" height="3"></canvas>')
  const results = await page.evaluate(({ offsets, closest }) => {
    const gl = document.querySelector('canvas').getContext('webgl2')
    if (!gl) throw new Error('WebGL 2 is required')
    function shader(type, source) {
      const shader = gl.createShader(type)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader))
      return shader
    }
    const program = gl.createProgram()
    gl.attachShader(program, shader(gl.VERTEX_SHADER, `#version 300 es
      void main() {
        vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
        gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
      }`))
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      precision highp sampler2D;
      uniform sampler2D depthVelocityBuffer;
      layout(location = 0) out vec4 outputColor;
      ${offsets}
      ${closest}
      void main() {
        vec4 selected = getClosestFragment(ivec2(gl_FragCoord.xy));
        outputColor = vec4(selected.r / 100.0, selected.gb, 1.0);
      }`))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program))
    gl.useProgram(program)
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.viewport(0, 0, 3, 3)
    const fixtures = [
      { name: 'nearby cloud borrows the closer compatible velocity', center: 10, neighbor: 8, expected: [8, 0.7, 0.2] },
      { name: 'a different near layer cannot donate velocity', center: 10, neighbor: 1, expected: [10, 0.3, 0.4] },
      { name: 'a different far layer cannot donate velocity', center: 10, neighbor: 40, expected: [10, 0.3, 0.4] },
      { name: 'the half-depth boundary is compatible', center: 10, neighbor: 5, expected: [5, 0.7, 0.2] },
      { name: 'no-cloud pixels keep their own velocity', center: 1e9, neighbor: 8, expected: [100, 0.3, 0.4] },
      { name: 'viewport corners use valid neighboring texels', center: 10, neighbor: 8, expected: [8, 0.7, 0.2], corner: true },
    ]
    return fixtures.map(fixture => {
      const pixels = new Float32Array(3 * 3 * 4)
      for (let i = 0; i < 9; i++) pixels.set([fixture.center, 0.3, 0.4, 1], i * 4)
      pixels.set([fixture.neighbor, 0.7, 0.2, 1], (fixture.corner ? 1 : 3) * 4)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 3, 3, 0, gl.RGBA, gl.FLOAT, pixels)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      const selected = new Uint8Array(4)
      gl.readPixels(fixture.corner ? 0 : 1, fixture.corner ? 0 : 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, selected)
      return { name: fixture.name, expected: fixture.expected.map((v, i) => Math.round(v * (i === 0 ? 2.55 : 255))), actual: [...selected].slice(0, 3), glError: gl.getError() }
    })
  }, { offsets, closest })
  for (const result of results) {
    assert.equal(result.glError, 0, result.name)
    assert(result.actual.every((v, i) => Math.abs(v - result.expected[i]) <= 1), JSON.stringify(result))
  }
  const depthResults = await page.evaluate(depthSample => {
    const gl = document.querySelector('canvas').getContext('webgl2')
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Float framebuffer is required')
    function shader(type, source) {
      const result = gl.createShader(type)
      gl.shaderSource(result, source)
      gl.compileShader(result)
      if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result))
      return result
    }
    const program = gl.createProgram()
    gl.attachShader(program, shader(gl.VERTEX_SHADER, `#version 300 es
      void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`))
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      uniform vec4 segment;
      uniform int divisions;
      layout(location = 0) out vec4 outputColor;
      ${depthSample}
      void main() {
        float stepSize = segment.y / float(divisions);
        float cellT = exp(-segment.z * stepSize);
        float incomingT = segment.w;
        vec2 accumulated = vec2(0.0);
        for (int i = 0; i < divisions; ++i) {
          accumulated += getCloudDepthSample(segment.x + float(i) * stepSize, stepSize, segment.z, cellT, incomingT);
          incomingT *= cellT;
        }
        outputColor = vec4(accumulated.x / accumulated.y, accumulated.y, 0.0, 1.0);
      }`))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program))
    gl.useProgram(program)
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, null)
    const framebuffer = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Float framebuffer is incomplete')
    gl.viewport(0, 0, 1, 1)
    const fixtures = [
      { name: 'an opaque first cell retains finite cloud depth', segment: [0, 1000, 0.2, 1], expected: [5, 1] },
      { name: 'an optically thin cell retains its midpoint depth', segment: [100, 25, 0.00001, 1], expected: [112.499479167, 0.000249968753] },
      { name: 'a moderate cell uses the conditional extinction depth', segment: [12, 10, 0.1, 1], expected: [16.180232931, 0.632120559] },
      { name: 'subdividing a homogeneous cell preserves mean depth', segment: [0, 100, 0.2, 1], divisions: 2, expected: [4.999999794, 0.999999998] },
      { name: 'a later segment keeps its incoming visibility weight', segment: [12, 10, 0.1, 0.25], expected: [16.180232931, 0.158030140] },
    ]
    return fixtures.map(fixture => {
      gl.uniform4fv(gl.getUniformLocation(program, 'segment'), fixture.segment)
      gl.uniform1i(gl.getUniformLocation(program, 'divisions'), fixture.divisions ?? 1)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      const pixels = new Float32Array(4)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, pixels)
      return { name: fixture.name, actual: [...pixels].slice(0, 2), expected: fixture.expected, glError: gl.getError() }
    })
  }, depthSample)
  for (const result of depthResults) {
    assert.equal(result.glError, 0, result.name)
    assert(result.actual.every((v, i) => Number.isFinite(v) && Math.abs(v - result.expected[i]) < Math.max(0.0001, Math.abs(result.expected[i]) * 0.001)), JSON.stringify(result))
  }
  console.log(JSON.stringify({ passed: true, checks: [...results, ...depthResults] }, null, 2))
} finally {
  await browser.close()
}
