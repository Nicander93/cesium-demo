import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Matrix4, PerspectiveFrustum } from 'cesium'
import { buildTonemapFragmentShader } from '../src/vendor/cesium-geospatial/core/cesium/tonemap.frag.ts'

const require = createRequire(import.meta.url)
const engineEntry = require.resolve('@cesium/engine', { paths: [path.dirname(require.resolve('cesium'))] })
const eyeShader = await fs.readFile(path.join(path.dirname(engineEntry), 'Source/Shaders/Builtin/Functions/windowToEyeCoordinates.glsl'), 'utf8')
const cloudShader = await fs.readFile(new URL('../src/vendor/cesium-geospatial/clouds/glsl/clouds.frag', import.meta.url), 'utf8')
const shadowTransportShader = await fs.readFile(new URL('../src/vendor/cesium-geospatial/core/cesium/cloudShadowTransport.glsl', import.meta.url), 'utf8')
const groundFillShader = cloudShader.slice(cloudShader.indexOf('vec3 getGroundAmbientRadiance('), cloudShader.indexOf('#ifdef GROUND_BOUNCE'))
const skyAmbientShader = cloudShader.slice(cloudShader.indexOf('vec3 getCloudSkyAmbientRadiance('), cloudShader.indexOf('// Uniform ground hemisphere'))
const densitySource = await fs.readFile(new URL('../src/vendor/cesium-geospatial/clouds/glsl/clouds.glsl', import.meta.url), 'utf8')
const cumulusShader = densitySource.slice(densitySource.indexOf('vec4 getCumulusHeightEnvelope('), densitySource.indexOf('vec4 shapeAlteringFunction('))
const cameraLayerShader = cloudShader.slice(cloudShader.indexOf('  float camHeightLocal ='), cloudShader.indexOf('  g_fogInLayer ='))
const opticalStepShader = cloudShader.slice(cloudShader.indexOf('float getOpticalDepthStep('), cloudShader.indexOf('float getLayerGapExitDistance('))
const gapShader = cloudShader.slice(cloudShader.indexOf('float getLayerGapExitDistance('), cloudShader.indexOf('vec4 marchClouds('))
const sphereShader = await fs.readFile(new URL('../src/vendor/cesium-geospatial/core/glsl/raySphereIntersection.glsl', import.meta.url), 'utf8')
const { chromium } = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href)
  : await import('playwright')
const near = 1, far = 1e9
const frustum = new PerspectiveFrustum({ fov: Math.PI / 3, aspectRatio: 1, near, far })
const inverseProjection = Matrix4.toArray(Matrix4.inverse(frustum.projectionMatrix, new Matrix4()))
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
})
try {
  const page = await browser.newPage()
  await page.setContent('<canvas width="1" height="1"></canvas>')
  const results = await page.evaluate(({ eyeShader, toneShader, groundFillShader, skyAmbientShader, cumulusShader, cameraLayerShader, opticalStepShader, gapShader, sphereShader, shadowTransportShader, inverseProjection, near, far }) => {
    const gl = document.querySelector('canvas').getContext('webgl2')
    if (!gl?.getExtension('EXT_color_buffer_float')) throw new Error('Float WebGL 2 framebuffer required')
    function shader(type, source) {
      const result = gl.createShader(type)
      gl.shaderSource(result, source)
      gl.compileShader(result)
      if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result))
      return result
    }
    function program(fragment) {
      const result = gl.createProgram()
      gl.attachShader(result, shader(gl.VERTEX_SHADER, `#version 300 es
        out vec2 v_textureCoordinates;
        void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
          v_textureCoordinates = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`))
      gl.attachShader(result, shader(gl.FRAGMENT_SHADER, `#version 300 es
        precision highp float; precision highp int; precision highp sampler2D;
        layout(location=0) out vec4 out_FragColor;
        ${fragment}`))
      gl.linkProgram(result)
      if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(result))
      gl.useProgram(result)
      return result
    }
    function texture(data) {
      const result = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, result)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, data)
      return result
    }
    const framebuffer = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture(null), 0)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete float framebuffer')
    function draw() {
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      const result = new Float32Array(4)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, result)
      if (gl.getError()) throw new Error('WebGL draw/readback error')
      return [...result]
    }
    const depthProgram = program(`#define LOG_DEPTH
      uniform vec4 czm_viewport; uniform mat4 czm_viewportTransformation;
      uniform mat4 czm_inverseProjection; uniform vec4 czm_frustumPlanes;
      uniform vec2 czm_currentFrustum; uniform float czm_log2FarDepthFromNearPlusOne;
      uniform float logDepth;
      ${eyeShader}
      void main() { vec4 eye = czm_windowToEyeCoordinates(gl_FragCoord.xy, logDepth);
        out_FragColor = vec4(-eye.z / eye.w, eye.w, 0.0, 1.0); }`)
    gl.uniform4f(gl.getUniformLocation(depthProgram, 'czm_viewport'), 0, 0, 1, 1)
    gl.uniformMatrix4fv(gl.getUniformLocation(depthProgram, 'czm_viewportTransformation'), false, [0.5,0,0,0, 0,0.5,0,0, 0,0,0.5,0, 0.5,0.5,0.5,1])
    gl.uniformMatrix4fv(gl.getUniformLocation(depthProgram, 'czm_inverseProjection'), false, inverseProjection)
    gl.uniform2f(gl.getUniformLocation(depthProgram, 'czm_currentFrustum'), near, far)
    gl.uniform1f(gl.getUniformLocation(depthProgram, 'czm_log2FarDepthFromNearPlusOne'), Math.log2(far - near + 1))
    const checks = [10, 1300, 30000, 1e6, 18e6].map(distance => {
      gl.uniform1f(gl.getUniformLocation(depthProgram, 'logDepth'), Math.log2(distance - near + 1) / Math.log2(far - near + 1))
      return { name: `Cesium log depth reconstructs ${distance}m`, actual: draw().slice(0, 2), expected: [distance, 1 / distance] }
    })
    const fillProgram = program(`const float RECIPROCAL_PI = 0.3183098861837907;
      uniform vec3 sun; uniform vec3 sky; uniform vec4 column; uniform float albedo; uniform vec3 transport;
      ${groundFillShader}
      void main() { out_FragColor = vec4(getGroundAmbientRadiance(sun, sky, column.x, column.y, column.z, column.w, albedo, transport.x, transport.y, transport.z), 1.0); }`)
    const fixtures = [
      { name: 'Disabled ground fill preserves the old radiance', sun: [1,1,1], sky: [1,1,1], column: [1,0,0,1], albedo: 0, expected: [0,0,0] },
      { name: 'A white Lambertian ground integrates over one hemisphere', sun: [1,1,1], sky: [0,0,0], column: [1,0,0,1], albedo: 0.2, expected: [1,1,1].map(x => x * 0.2 / (2 * Math.PI)) },
      { name: 'Vertical optical depth attenuates reflected light', sun: [1,1,1], sky: [0,0,0], column: [1,0,100,0.02], albedo: 0.2, expected: [1,1,1].map(x => x * 0.2 / (2 * Math.PI) * Math.exp(-2)) },
      { name: 'Overcast removes direct ground illumination but retains sky light', sun: [1,1,1], sky: [1,2,3], column: [1,1,0,1], albedo: 0.2, expected: [1,2,3].map(x => x * 0.2 / (4 * Math.PI * Math.PI)) },
      { name: 'Ground fill adds no emissive light in darkness', sun: [0,0,0], sky: [0,0,0], column: [-1,0,0,1], albedo: 0.2, expected: [0,0,0] },
      { name: 'A sun below the ground cannot illuminate it directly', sun: [1,1,1], sky: [0,0,0], column: [-0.5,0,0,1], albedo: 0.2, expected: [0,0,0] },
      { name: 'Conservative diffuse transport retains redirected ground light', sun: [1,1,1], sky: [0,0,0], column: [1,0,100,0.02], albedo: 0.2, transport: [1,0,1], expected: [1,1,1].map(x=>x*0.2/(2*Math.PI)*0.4) },
      { name: 'Pure absorption retains Beer attenuation with diffuse transport enabled', sun: [1,1,1], sky: [0,0,0], column: [1,0,100,0.02], albedo: 0.2, transport: [0,0,1], expected: [1,1,1].map(x=>x*0.2/(2*Math.PI)*Math.exp(-2)) },
      { name: 'Diffuse transport creates no light at night', sun: [0,0,0], sky: [0,0,0], column: [1,0,100,0.02], albedo: 0.2, transport: [1,0.5,1], expected: [0,0,0] },
    ]
    for (const fixture of fixtures) {
      gl.uniform3fv(gl.getUniformLocation(fillProgram, 'sun'), fixture.sun)
      gl.uniform3fv(gl.getUniformLocation(fillProgram, 'sky'), fixture.sky)
      gl.uniform4fv(gl.getUniformLocation(fillProgram, 'column'), fixture.column)
      gl.uniform1f(gl.getUniformLocation(fillProgram, 'albedo'), fixture.albedo)
      gl.uniform3fv(gl.getUniformLocation(fillProgram, 'transport'), fixture.transport??[1,0,0])
      checks.push({ name: fixture.name, actual: draw().slice(0, 3), expected: fixture.expected })
    }
    const skyProgram=program(`const float RECIPROCAL_PI4=0.07957747154594767;
      uniform vec3 sky; uniform vec4 transport; uniform float saturation;
      ${skyAmbientShader}
      void main(){out_FragColor=vec4(getCloudSkyAmbientRadiance(sky,transport.x,transport.y,transport.z,transport.w,saturation),1.0);}`)
    for(const fixture of [
      {name:'Disabled diffuse sky closure preserves legacy illumination',sky:[1,2,3],transport:[0.5,20,1,0],saturation:1,expected:[1,2,3].map(x=>x*0.5/(4*Math.PI))},
      {name:'Thick conservative sky scattering has bounded twofold gain',sky:[1,1,1],transport:[0.5,1000,1,1],saturation:1,expected:[1,1,1].map(x=>x/(4*Math.PI))},
      {name:'Diffuse sky closure is black without incident light',sky:[0,0,0],transport:[1,1000,1,1],saturation:0.5,expected:[0,0,0]},
      {name:'Diffuse sky desaturation preserves photometric luminance',sky:[1,2,3],transport:[1,0,1,1],saturation:0,expected:[1,1,1].map(()=>((0.2126+2*0.7152+3*0.0722)/(4*Math.PI)))},
    ]){
      gl.uniform3fv(gl.getUniformLocation(skyProgram,'sky'),fixture.sky)
      gl.uniform4fv(gl.getUniformLocation(skyProgram,'transport'),fixture.transport)
      gl.uniform1f(gl.getUniformLocation(skyProgram,'saturation'),fixture.saturation)
      checks.push({name:fixture.name,actual:draw().slice(0,3),expected:fixture.expected})
    }
    const shadowRatioProgram = program(`uniform vec3 direct; uniform vec3 sky; uniform vec2 controls;
      ${shadowTransportShader}
      void main(){out_FragColor=vec4(getCloudShadowRatio(direct,sky,controls.x,controls.y),1.0);}`)
    for (const fixture of [
      { name: 'Cloud shadow off preserves already lit surfaces', sun: [1,1,1], sky: [0.2,0.2,0.2], controls: [0,0], expected: [1,1,1] },
      { name: 'Clear sky is an identity transport', sun: [1,1,1], sky: [0.2,0.2,0.2], controls: [1,1], expected: [1,1,1] },
      { name: 'Cloud shadow preserves diffuse sky irradiance', sun: [1,0.5,0.25], sky: [0.25,0.5,1], controls: [0,1], expected: [0.2,0.5,0.8] },
      { name: 'Shadow strength interpolates the direct fraction once', sun: [1,0.5,0.25], sky: [0.25,0.5,1], controls: [0,0.7], expected: [0.44,0.65,0.86] },
      { name: 'Night does not multiply scene colors to black', sun: [0,0,0], sky: [0,0,0], controls: [0,1], expected: [1,1,1] },
    ]) {
      gl.uniform3fv(gl.getUniformLocation(shadowRatioProgram,'direct'),fixture.sun)
      gl.uniform3fv(gl.getUniformLocation(shadowRatioProgram,'sky'),fixture.sky)
      gl.uniform2fv(gl.getUniformLocation(shadowRatioProgram,'controls'),fixture.controls)
      checks.push({name:fixture.name,actual:draw().slice(0,3),expected:fixture.expected})
    }
    const erosionProgram=program(`uniform vec4 erosionInput; ${cumulusShader}
      void main(){out_FragColor=erodeCumulusDensity(vec4(erosionInput.x),erosionInput.y,vec4(erosionInput.z),vec4(erosionInput.w));}`)
    for(const fixture of [
      {name:'Cloud erosion preserves a dense core',input:[1,0,1,1],expected:1},
      {name:'Cloud erosion is disabled at zero detail amount',input:[0.5,0,1,0],expected:0.5},
      {name:'Cloud erosion retains empty space',input:[0,0,1,1],expected:0},
      {name:'Lower cloud wisps use a different detail profile',input:[0.5,0,0,1],expected:0.5},
      {name:'Upper cloud rims retain bounded fine erosion',input:[0.5,0,1,1],expected:0.3781094527363184},
    ]){
      gl.uniform4fv(gl.getUniformLocation(erosionProgram,'erosionInput'),fixture.input)
      checks.push({name:fixture.name,actual:draw(),expected:Array(4).fill(fixture.expected)})
    }
    const hullProgram = program(`uniform vec4 hullInput; ${cumulusShader}
      void main(){out_FragColor=getCumulusHull(vec4(hullInput.x),vec4(hullInput.y),hullInput.z,vec4(hullInput.w),vec4(1.0));}`)
    for (const fixture of [
      { name: 'Cumulus has no density below its condensation base', input: [-0.1,1,0.9,0.5], expected: 0 },
      { name: 'Cumulus closes at its locally varying cloud top', input: [0.8,0.8,0.9,0.5], expected: 0 },
      { name: 'Zero coverage remains empty at saturated shape noise', input: [0.3,1,1,0], expected: 0 },
      { name: 'Cumulus hull responds to three-dimensional shape noise', input: [0.3,1,0.9,0.5], expected: 0.8042361787116918 },
      { name: 'Sparse cumulus retains an upper volume instead of collapsing to a flat slice', input: [0.7,1,0.9,0.25], expected: 0.39579067503608595 },
      { name: 'The biased shape volume median does not fill sparse clear space', input: [0.3,1,0.8039215686,0.32], expected: 0 },
        { name: 'The same weather envelope preserves clear space between lobes', input: [0.3,1,0.4,0.5], expected: 0 },
    ]) {
      gl.uniform4fv(gl.getUniformLocation(hullProgram, 'hullInput'), fixture.input)
      checks.push({ name: fixture.name, actual: draw(), expected: Array(4).fill(fixture.expected) })
    }
          const coverageProgram = program(`uniform vec2 weatherInput; ${cumulusShader}
        void main(){out_FragColor=getCumulusCoverage(vec4(weatherInput.x),weatherInput.y);}`)
      for (const [weather, coverage, expected] of [[0.05,0.32,0],[0.325,0.32,0.16],[0.8,0.32,0.32],[1,0,0]]) {
        gl.uniform2f(gl.getUniformLocation(coverageProgram,'weatherInput'), weather, coverage)
        checks.push({name:`Weather ${weather} preserves bounded coverage ${coverage}`,actual:draw(),expected:Array(4).fill(expected)})
      }
      const cameraProgram=program(`uniform float cameraHeight; uniform float bottomRadius;
      uniform vec3 rayOrigin; uniform float u_inLayerFog;
      uniform vec4 minLayerHeights; uniform vec4 maxLayerHeights;
      void main(){${cameraLayerShader} out_FragColor=vec4(inLayerCam);}`)
    gl.uniform4fv(gl.getUniformLocation(cameraProgram,'minLayerHeights'),[1800,2280,7500,0])
    gl.uniform4fv(gl.getUniformLocation(cameraProgram,'maxLayerHeights'),[3000,3120,8000,0])
    gl.uniform1f(gl.getUniformLocation(cameraProgram,'bottomRadius'),6360000)
    for(const [height,entry,enabled,expected] of [[150,1800.1,1,0],[4500,7500.1,1,0],[37600,7999.9,1,0],[2400,2400,1,1],[2400,2400,0,0]]){
      gl.uniform1f(gl.getUniformLocation(cameraProgram,'cameraHeight'),height)
      gl.uniform1f(gl.getUniformLocation(cameraProgram,'u_inLayerFog'),enabled)
      gl.uniform3f(gl.getUniformLocation(cameraProgram,'rayOrigin'),0,0,6360000+entry)
      checks.push({name:`Camera ${height}m uses camera altitude instead of shell entry ${entry}m, fog ${enabled}`,actual:draw(),expected:Array(4).fill(expected)})
    }
    const stepProgram=program(`uniform vec3 stepInput; ${opticalStepShader}
      void main(){out_FragColor=vec4(getOpticalDepthStep(stepInput.x,stepInput.y,stepInput.z));}`)
    for(const [step,extinction,tau,expected] of [[25,0.2,0.5,2.5],[25,10,0.5,1],[25,0,0.5,25],[25,0.2,0,25],[0.25,1,0.5,0.25]]){
      gl.uniform3f(gl.getUniformLocation(stepProgram,'stepInput'),step,extinction,tau)
      checks.push({name:`Optical cell ${step}m, extinction ${extinction}, max tau ${tau}`,actual:draw(),expected:Array(4).fill(expected)})
    }
    const gapProgram=program(`uniform float bottomRadius; uniform vec3 minIntervalHeights; uniform vec3 maxIntervalHeights;
      uniform vec3 origin; uniform vec3 direction; uniform float height;
      ${sphereShader} ${gapShader}
      void main(){out_FragColor=vec4(getLayerGapExitDistance(origin,direction,height));}`)
    gl.uniform1f(gl.getUniformLocation(gapProgram,'bottomRadius'),6360000)
    gl.uniform3f(gl.getUniformLocation(gapProgram,'minIntervalHeights'),0,3120,0)
    gl.uniform3f(gl.getUniformLocation(gapProgram,'maxIntervalHeights'),1800,7500,0)
    for(const [height,direction,expected] of [[5000,[0,0,-1],1880],[5000,[0,0,1],2500],[2500,[0,0,-1],0]]){
      gl.uniform3f(gl.getUniformLocation(gapProgram,'origin'),0,0,6360000+height)
      gl.uniform3fv(gl.getUniformLocation(gapProgram,'direction'),direction)
      gl.uniform1f(gl.getUniformLocation(gapProgram,'height'),height)
      checks.push({name:`Analytic layer gap from ${height}m in direction ${direction}`,actual:draw(),expected:Array(4).fill(expected),tolerance:0.75})
    }
    const toneProgram = program(toneShader)
    const input = [0.2, 0.6, 0.9, 1]
    texture(new Float32Array(input))
    gl.uniform1i(gl.getUniformLocation(toneProgram, 'colorTexture'), 0)
    gl.uniform1f(gl.getUniformLocation(toneProgram, 'u_ditherScale'), 0)
    for (const mode of [6, 7, 8, 9, 10, 14]) {
      gl.uniform1f(gl.getUniformLocation(toneProgram, 'u_debugMode'), mode)
      checks.push({ name: `Tone mapping diagnostic ${mode} retains its declared scale`, actual: draw().slice(0, 3), expected: input.slice(0, 3).map(value => mode === 7 ? value / 5 : value) })
    }
    gl.uniform1f(gl.getUniformLocation(toneProgram, 'u_debugMode'), 0)
    checks.push({ name: 'Normal output retains ACES and display gamma', actual: draw().slice(0, 3), expected: input.slice(0, 3).map(x => Math.pow(Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14))), 1 / 2.2)) })
    return checks
  }, { eyeShader, toneShader: buildTonemapFragmentShader(), groundFillShader, skyAmbientShader, cumulusShader, cameraLayerShader, opticalStepShader, gapShader, sphereShader, shadowTransportShader, inverseProjection, near, far })
  for (const result of results) {
    assert(result.actual.every((value, index) => Number.isFinite(value) && Math.abs(value - result.expected[index]) <= Math.max(result.tolerance ?? 0, Math.abs(result.expected[index]) * 0.00001, 1e-8)), JSON.stringify(result))
  }
  console.log(JSON.stringify({ passed: true, checks: results }, null, 2))
} finally {
  await browser.close()
}
