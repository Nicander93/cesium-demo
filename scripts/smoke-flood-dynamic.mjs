import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
const { chromium } = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href)
  : await import('playwright')
const baseUrl =
  process.env.WATER_FLOW_BASE_URL ?? 'http://127.0.0.1:5198/cesium-demo/'
const output = path.resolve('test-results/flood-dynamic')
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
  deviceScaleFactor: 1,
  recordVideo: { dir: output, size: { width: 1440, height: 900 } },
})
const page = await context.newPage(),
  errors = [],
  externalRequests = [],
  optionalRequests = []
page.on('pageerror', (value) => errors.push(String(value)))
page.on('console', (value) => {
  if (value.type() === 'error') errors.push(value.text())
})
await page.route('**/*', (route) => {
  const url = new URL(route.request().url())
  if (
    url.protocol.startsWith('http') &&
    url.origin !== new URL(baseUrl).origin
  ) {
    if (
      url.href ===
      'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
    ) {
      optionalRequests.push(url.href)
      return route.fulfill({ status: 200, contentType: 'text/css', body: '' })
    }
    externalRequests.push(url.href)
    return route.abort()
  }
  return route.continue()
})
const control = (method, value) =>
  page.evaluate(
    ([method, value]) => window.__floodDynamicLab[method](value),
    [method, value],
  )
const state = () => control('getState')
const rendered = () =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
      ),
  )
async function compare(a, b) {
  return page.evaluate(
    async ([a, b]) => {
      async function decode(value) {
        const img = new Image()
        img.src = 'data:image/png;base64,' + value
        await img.decode()
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const context = canvas.getContext('2d')
        context.drawImage(img, 0, 0)
        return context.getImageData(0, 0, img.width, img.height).data
      }
      const first = await decode(a),
        second = await decode(b)
      let difference = 0,
        changed = 0
      for (let i = 0; i < first.length; i += 4) {
        const d =
          (Math.abs(first[i] - second[i]) +
            Math.abs(first[i + 1] - second[i + 1]) +
            Math.abs(first[i + 2] - second[i + 2])) /
          3
        difference += d
        if (d > 25) changed++
      }
      return {
        meanRgbDifference: difference / (first.length / 4),
        changedOver25: changed / (first.length / 4),
      }
    },
    [a.toString('base64'), b.toString('base64')],
  )
}
const checks = [],
  parity = []
let gpu, resources, updateReuse
try {
  await page.goto(new URL('flood-dynamic-lab?environment=synthetic', baseUrl).href)
  await page.waitForFunction(
    () => window.__floodDynamicLab?.getState().diagnostics?.ready,
  )
  await control('setLighting', {model: 'legacy'})
  gpu = await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2'),
      extension = gl.getExtension('WEBGL_debug_renderer_info')
    return {
      version: gl.getParameter(gl.VERSION),
      renderer: extension
        ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
    }
  })
  for (const time of [0, 10, 35, 60, 120, 180]) {
    await control('seek', time)
    await rendered()
    const value = await state()
    assert.equal(value.error, '')
    assert.equal(value.diagnostics.surfaceBackend, 'gpu')
    assert.equal(value.diagnostics.geometryCreated, 1)
    assert.equal(value.diagnostics.texturesCreated, 2)
    assert.equal(value.diagnostics.legacyMeshBuilds, 0)
    assert.equal(value.primitiveCount, 3)
    assert(Math.abs(value.metrics.balanceError) < 1e-8)
    checks.push(value)
    await page.screenshot({ path: path.join(output, 'gpu-' + time + '.png') })
  }
  assert(checks[1].metrics.frontRow < checks[2].metrics.frontRow)
  assert(checks[3].metrics.storedVolume < checks[2].metrics.storedVolume)
  assert(checks[5].metrics.storedVolume < 20)
  await control('seek', 35)
  await control('setDepthMode', true)
  await rendered()
  const hydraulic = await control('getFrame')
  const clip = { x: 360, y: 0, width: 1080, height: 880 }
  for (const camera of ['near', 'far']) {
    await control('camera', camera)
    for (const time of [10, 35, 60, 120]) {
      await control('seek', time)
      await control('setBackend', 'gpu')
      await rendered()
      const a = await page.screenshot({
        clip,
        path: path.join(output, `${camera}-${time}-gpu.png`),
      })
      const frame = await control('getFrame')
      await control('setBackend', 'primitive')
      await rendered()
      assert.deepEqual(
        await control('getFrame'),
        frame,
        'Backend changes must not change hydraulic state',
      )
      const b = await page.screenshot({
        clip,
        path: path.join(output, `${camera}-${time}-primitive.png`),
      })
      const difference = await compare(a, b)
      parity.push({ camera, time, ...difference })
      assert(difference.meanRgbDifference < 2, JSON.stringify(parity.at(-1)))
      assert(difference.changedOver25 < 0.01, JSON.stringify(parity.at(-1)))
    }
  }
  await control('setBackend', 'gpu')
  await control('seek', 35)
  await control('setDepthMode', false)
  await rendered()
  const before = await state()
  for (let i = 0; i < 120; i++) {
    await control('seek', 35)
    await rendered()
  }
  updateReuse = await state()
  assert.equal(updateReuse.diagnostics.geometryCreated, 1)
  assert.equal(updateReuse.diagnostics.texturesCreated, 2)
  assert.equal(
    updateReuse.diagnostics.shaderChanges,
    before.diagnostics.shaderChanges,
  )
  assert.equal(updateReuse.primitiveCount, before.primitiveCount)
  assert(
    updateReuse.diagnostics.textureUploads >=
      before.diagnostics.textureUploads + 120,
  )
  assert.deepEqual(await control('getFrame'), hydraulic)
  for (const enabled of [false, true]) {
    await control('setVelocity', enabled)
    await control('setVisuals', {
      foam: enabled,
      flow: enabled,
      particles: enabled,
    })
    await rendered()
    assert.deepEqual(await control('getFrame'), hydraulic)
    assert.equal((await state()).error, '')
  }
  await control('setVisuals', { particles: false })
  for (const camera of ['near', 'far']) {
    await control('camera', camera)
    await rendered()
    await page.screenshot({
      path: path.join(output, 'water-' + camera + '.png'),
    })
  }
  for (const camera of ['near', 'far']) {
    await control('camera', camera)
    await control('setBackend', 'gpu'); await rendered()
    const a=await page.screenshot({clip})
    await control('setBackend', 'primitive'); await rendered()
    const b=await page.screenshot({clip}), difference=await compare(a,b)
    parity.push({camera,time:35,mode:'water',...difference})
    assert(difference.meanRgbDifference<2,JSON.stringify(parity.at(-1)))
  }
  await control('setBackend', 'gpu'); await rendered()
  // Exercise the public factory against the actual host Scene, separately from the page's solver.
  resources = await page.evaluate(async (base) => {
    const { createCesiumFloodLayer } = await import(
      new URL('src/flood/cesium/index.ts', base).href
    )
    const { createCrossValleyWall } = await import(
      new URL('src/flood/core/index.ts', base).href
    )
    const { viewer, grid } = window.__floodDynamicLab.getTestContext(),
      scene = viewer.scene
    const wait = () =>
      new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
      )
    // Adding the first Entity lazily creates a Viewer-owned visualization collection.
    const marker = viewer.entities.add({
      position: viewer.camera.positionWC,
      point: { pixelSize: 1 },
    })
    await wait()
    viewer.entities.remove(marker)
    await wait()
    const baseline = scene.primitives.length,
      count = grid.columns * grid.rows
    const frame = {
      time: 10,
      depth: Array(count).fill(1),
      velocityEast: Array(count).fill(1),
      velocityNorth: Array(count).fill(0),
    }
    const second = createCesiumFloodLayer({
      viewer,
      grid,
      showGround: false,
      surfaceBackend: 'gpu',
      visuals: { particles: false },
    })
    second.update(frame)
    await wait()
    if (
      second.getDiagnostics().surfaceBackend !== 'gpu' ||
      !second.getDiagnostics().ready
    )
      throw Error('Second layer not ready')
    const owned = second.dynamicSurface,
      textures = [owned.surfaceTexture, owned.foamTexture],
      vertexArray = owned.vertexArray,
      buffer = owned.vertexBuffer
    const updates = second.getDiagnostics().surfaceUpdates
    let rejected = false
    try {
      second.update({ ...frame, depth: [NaN] })
    } catch {
      rejected = true
    }
    if (!rejected || second.getDiagnostics().surfaceUpdates !== updates)
      throw Error('Invalid frame changed render state')
    second.update({ time: 11, depth: Array(count).fill(0) })
    await wait()
    if (owned.state.surface.filter((_, i) => i % 4 !== 0).some((v) => v !== 0))
      throw Error('Missing velocity retained old data')
    second.updateAnalysis(Array(count).fill(1))
    await wait()
    if (!owned.isDestroyed())
      throw Error('Analysis did not release dynamic surface')
    second.update(frame)
    await wait()
    second.destroy()
    second.destroy()
    await wait()
    if (
      !textures.every((t) => t.isDestroyed()) ||
      !vertexArray.isDestroyed() ||
      !buffer.isDestroyed()
    )
      throw Error('Owned resources leaked')
    if (scene.primitives.length !== baseline)
      throw Error('Primitive count did not return to baseline')
    const fallback = createCesiumFloodLayer({
      viewer,
      grid,
      showGround: false,
      surfaceBackend: 'gpu',
      barriers: createCrossValleyWall(grid, 20, 8),
    })
    fallback.update(frame)
    await wait()
    const barrierFallback = fallback.getDiagnostics()
    if (
      barrierFallback.surfaceBackend !== 'primitive' ||
      !barrierFallback.fallbackReason
    )
      throw Error('Barrier fallback missing')
    fallback.destroy()
    const incapable = createCesiumFloodLayer({
      viewer,
      grid,
      showGround: false,
      surfaceBackend: 'gpu',
    })
    const gl = scene.context._gl,
      original = gl.getParameter
    gl.getParameter = function (parameter) {
      return parameter === gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS
        ? 0
        : original.call(this, parameter)
    }
    try {
      incapable.update(frame)
    } finally {
      gl.getParameter = original
    }
    await wait()
    const capabilityFallback = incapable.getDiagnostics()
    if (
      capabilityFallback.surfaceBackend !== 'primitive' ||
      !capabilityFallback.fallbackReason
    )
      throw Error('Capability fallback missing')
    incapable.destroy()
    await wait()
    if (scene.primitives.length !== baseline)
      throw Error('Fallback resources leaked')
    const failed = createCesiumFloodLayer({
      viewer,
      grid,
      showGround: false,
      surfaceBackend: 'gpu',
    })
    failed.update(frame)
    await wait()
    const failedSurface = failed.dynamicSurface,
      failedTexture = failedSurface.surfaceTexture
    failedTexture.copyFrom = () => {
      throw Error('Injected upload failure')
    }
    failed.update({ ...frame, time: 12 })
    await wait()
    const uploadFallback = failed.getDiagnostics()
    if (
      uploadFallback.surfaceBackend !== 'primitive' ||
      !uploadFallback.fallbackReason?.includes('Injected')
    )
      throw Error('Deferred fallback missing')
    if (!failedSurface.isDestroyed() || !failedTexture.isDestroyed())
      throw Error('Failed GPU resources leaked')
    failed.destroy()
    await wait()
    const main = window.__floodDynamicLab.getState()
    if (
      main.error ||
      !main.diagnostics.ready ||
      main.diagnostics.surfaceBackend !== 'gpu'
    )
      throw Error('Other layers disturbed the host water')
    return {
      barrierFallback,
      capabilityFallback,
      uploadFallback,
      baseline,
      finalCount: scene.primitives.length,
      resourcesDestroyed: true,
      otherLayerAlive: true,
    }
  }, baseUrl)
  // All-dry after a wet frame must not leave old surface fragments.
  await control('setDepthMode', true)
  await control('camera', 'far')
  await control('seek', 0)
  await rendered()
  const dryGpu = await page.screenshot({ clip })
  await control('setBackend', 'primitive')
  await rendered()
  const dryPrimitive = await page.screenshot({ clip }),
    dryParity = await compare(dryGpu, dryPrimitive)
  assert(dryParity.meanRgbDifference < 0.1)
  parity.push({ camera: 'far', time: 0, ...dryParity })
  await control('setBackend', 'gpu')
  await control('seek', 35)
  await rendered()
  await page.evaluate(async () => {
    const { viewer } = window.__floodDynamicLab.getTestContext()
    viewer.scene.morphTo2D(0)
    await new Promise((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
    )
  })
  assert.equal((await state()).diagnostics.surfaceBackend, 'primitive')
  assert.match((await state()).diagnostics.fallbackReason, /三维/)
  await control('dispose', true)
  assert.equal((await state()).viewerAlive, false)
  await control('recreate')
  await rendered()
  assert.equal((await state()).error, '')
  assert.equal((await state()).diagnostics.surfaceBackend, 'gpu')
  assert.deepEqual(errors, [])
  assert.deepEqual(externalRequests, [])
  console.log(JSON.stringify({ gpu, parity, updateReuse, resources }, null, 2))
} finally {
  await fs.writeFile(
    path.join(output, 'report.json'),
    JSON.stringify(
      {
        gpu,
        checks,
        parity,
        updateReuse,
        resources,
        errors,
        externalRequests,
        optionalRequests,
      },
      null,
      2,
    ),
  )
  await context.close()
  await browser.close()
}
