import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const { chromium } = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href)
  : await import('playwright')
const base = (
  process.env.SHOWCASE_BASE_URL ?? 'http://127.0.0.1:5174/cesium-demo/'
).replace(/\/?$/, '/')
const output = process.env.SHOWCASE_OUTPUT ?? 'test-results/landscape-showcase'
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
})
const report = { passed: false, checks: [], errors: [], samples: [] }
function check(name, condition) {
  assert(condition, name)
  report.checks.push(name)
}
try {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    hasTouch: true,
  })
  const page = await context.newPage()
  const officeRequests = new Set()
  page.on('response', (response) => {
    const pathname = new URL(response.url()).pathname
    if (/\/landscape-showcase\/offices\/office-\d+\.glb$/.test(pathname)) {
      officeRequests.add(pathname)
      if (response.status() >= 400)
        report.errors.push(
          'Office asset HTTP ' + response.status() + ': ' + pathname,
        )
    }
  })
  page.on('pageerror', (e) => report.errors.push(String(e)))
  page.on('console', (m) => {
    if (
      m.type() === 'error' &&
      /shader|webgl|developererror|rendering has stopped/i.test(m.text())
    )
      report.errors.push(m.text().slice(0, 1200))
  })
  await page.addInitScript(() => {
    window.__showcaseFrames = { active: false, frames: [] }
    window.__showcaseStartup = { active: true, frames: [] }
    let previousStartup
    let previous
    const step = (now) => {
      const startup = window.__showcaseStartup
      if (
        startup.active &&
        previousStartup !== undefined &&
        startup.frames.length < 3000
      )
        startup.frames.push(now - previousStartup)
      previousStartup = now
      if (window.__showcaseFrames.active && previous !== undefined)
        window.__showcaseFrames.frames.push(now - previous)
      previous = window.__showcaseFrames.active ? now : undefined
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
  const state = () => page.evaluate(() => window.__landscapeShowcase.getState())
  const ready = () =>
    page.waitForFunction(
      () => {
        const s = window.__landscapeShowcase?.getState()
        return (
          s &&
          !s.loading &&
          s.water?.reflectionAvailable &&
          s.environment.ready &&
          !s.environment.pending &&
          !s.error
        )
      },
      null,
      { timeout: 90000 },
    )
  await page.goto(base + 'landscape-showcase?scene=mountain', {
    waitUntil: 'domcontentloaded',
  })
  await ready()
  let current = await state()
  check(
    'real mountain water uses a finite terrain-derived display level',
    current.waterHeight > 1900 && current.waterHeight < 2050,
  )
  check(
    'shore mask and reflection run without an underwater depth pass',
    current.water.shorelineAvailable &&
      current.water.reflectionAvailable &&
      current.water.shoreFrames === 0,
  )
  await page.getByRole('button', { name: '画面调校', exact: true }).click()
  await page.getByLabel('画面曝光', { exact: true }).evaluate((input) => {
    input.value = '1.12'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  check(
    'exposure control reaches actual environment',
    (await state()).environment.options.exposure === 1.12,
  )
  await page.getByLabel('渲染档位', { exact: true }).selectOption('low')
  await page.waitForFunction(() => {
    const water = window.__landscapeShowcase.getState().water
    return water?.quality === 'low' && water.reflectionWidth <= 640
  })
  await ready()
  check(
    'low reflection quality stays bounded',
    (await state()).water.reflectionWidth <= 640,
  )
  await page.getByLabel('渲染档位', { exact: true }).selectOption('balanced')
  await page.getByRole('button', { name: '关闭画面调校', exact: true }).click()

  async function measure(scene, weather, input = 'mouse') {
    if ((await state()).scene !== scene)
      await page.evaluate(
        (scene) => window.__landscapeShowcase.setScene(scene),
        scene,
      )
    await page.evaluate(
      (weather) => window.__landscapeShowcase.setWeather(weather),
      weather,
    )
    await ready()
    await page.evaluate(() => window.__landscapeShowcase.setView('hero'))
    await page.waitForTimeout(scene === 'mountain' ? 12000 : 1600)
    const before = await state()
    const viewport = page.viewportSize()
    const dragX = viewport.width * 0.5,
      dragY = viewport.height * 0.65
    const amplitudeX = Math.min(90, viewport.width * 0.035),
      amplitudeY = Math.min(55, viewport.height * 0.035)
    await page.evaluate(() => {
      window.__showcaseFrames.frames = []
      window.__showcaseFrames.active = true
    })
    if (input === 'mouse') {
      await page.mouse.move(dragX, dragY)
      await page.mouse.down({ button: 'middle' })
      for (let i = 0; i < 24; i++)
        await page.mouse.move(
          dragX + Math.sin(i / 8) * amplitudeX,
          dragY - Math.sin(i / 11) * amplitudeY,
          { steps: 2 },
        )
      await page.mouse.up({ button: 'middle' })
    } else if (input === 'touch') {
      const cdp = await context.newCDPSession(page)
      const touchX = viewport.width * 0.42,
        touchY = viewport.height * 0.67
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: touchX, y: touchY, id: 1 }],
      })
      for (let i = 0; i < 24; i++)
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [
            { x: touchX + i * 2, y: touchY + Math.sin(i / 8) * 12, id: 1 },
          ],
        })
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      })
      await cdp.detach()
    }
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          let frames = 0
          const step = () => {
            if (++frames === 90) resolve()
            else requestAnimationFrame(step)
          }
          requestAnimationFrame(step)
        }),
    )
    const frames = await page.evaluate(() => {
      window.__showcaseFrames.active = false
      return window.__showcaseFrames.frames
    })
    const after = await state(),
      sorted = [...frames].sort((a, b) => a - b)
    const sample = {
      scene,
      weather,
      input,
      buffer: after.buffer,
      viewport,
      frameCount: frames.length,
      p95: sorted[Math.floor(sorted.length * 0.95)],
      max: Math.max(...frames),
      over50: frames.filter((v) => v > 50).length,
      cameraBefore: before.camera,
      cameraAfter: after.camera,
      moved: JSON.stringify(before.camera) !== JSON.stringify(after.camera),
      water: after.water,
    }
    report.samples.push(sample)
    check(
      `${scene}/${weather}/${input}: camera responds and reflection stays healthy`,
      sample.moved &&
        after.water.reflectionAvailable &&
        after.water.reflectionFailures === 0 &&
        !after.error,
    )
    if (scene === 'coast')
      check(
        'coast camera stays above its local sea plane',
        after.camera.planeClearance >= 11.9,
      )
    const pixels = after.buffer.match(/\d+/g).map(Number)
    check(
      `${scene}/${weather}/${input}: pixel and interaction budgets`,
      pixels[0] * pixels[1] <= 1920 * 1080 + 100 &&
        sample.p95 <= 25 &&
        sample.over50 === 0,
    )
    console.log(
      JSON.stringify({
        scene,
        weather,
        input,
        p95: sample.p95,
        max: sample.max,
        moved: sample.moved,
      }),
    )
  }
  for (const scene of ['mountain', 'coast'])
    for (const weather of ['day', 'sunset']) await measure(scene, weather)
  await page.setViewportSize({ width: 3840, height: 2160 })
  await measure('coast', 'day')
  await page.setViewportSize({ width: 600, height: 900 })
  await measure('coast', 'day', 'touch')
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.evaluate(() => window.__landscapeShowcase.setView('hero'))
  const beforeRoam = await state()
  await page.evaluate(() => window.__landscapeShowcase.setRoaming(true))
  await page.waitForTimeout(900)
  check(
    'cinematic drift moves the camera',
    (await state()).roaming &&
      JSON.stringify((await state()).camera) !==
        JSON.stringify(beforeRoam.camera),
  )
  await page.locator('canvas').first().dispatchEvent('pointerdown')
  check('manual input cancels drift', !(await state()).roaming)
  check(
    'coast loads an actual urban set and detailed near-shore mask',
    (await state()).modelCount === 56 &&
      (await state()).treeCount >= 60 &&
      (await state()).water.shorelineTexelSize < 5,
  )
  report.officeResources = [...officeRequests].sort()
  check(
    '52 office instances reuse twelve local GLB resources',
    officeRequests.size === 12,
  )
  await page.evaluate(() =>
    window.__landscapeShowcase.setOptions({ waveStrength: 1.17 }),
  )
  const reloadStarted = Date.now()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await ready()
  report.coastReadyMs = Date.now() - reloadStarted
  report.coastStartup = await page.evaluate(() => {
    const capture = window.__showcaseStartup
    capture.active = false
    const frames = [...capture.frames].sort((a, b) => a - b)
    return {
      frameCount: frames.length,
      p95: frames[Math.floor(frames.length * 0.95)],
      max: Math.max(...frames),
      over50: frames.filter((v) => v > 50).length,
    }
  })
  check(
    'complete scene link restores the water options',
    (await state()).options.waveStrength === 1.17,
  )
  if (process.env.SHOWCASE_SCREENSHOTS === '1') {
    await page.waitForTimeout(6000)
    await page.screenshot({ path: path.join(output, 'coast.png') })
    await page.evaluate(() => window.__landscapeShowcase.setScene('mountain'))
    await ready()
    await page.evaluate(() => window.__landscapeShowcase.setWeather('day'))
    await ready()
    await page.waitForTimeout(18000)
    await page.screenshot({ path: path.join(output, 'mountain.png') })
  }
  await page.evaluate(() =>
    Promise.all([
      window.__landscapeShowcase.setScene('mountain'),
      window.__landscapeShowcase.setScene('coast'),
    ]),
  )
  await ready()
  check(
    'rapid scene switching keeps the last scene',
    (await state()).scene === 'coast',
  )
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  check(
    'leaving the page destroys the Viewer and diagnostics',
    (await page.locator('.cesium-widget canvas').count()) === 0 &&
      (await page.evaluate(() => typeof window.__landscapeShowcase)) ===
        'undefined',
  )

  await page.evaluate(async (base) => {
    const { SceneCapture } = await import(
      new URL('src/water/capture.ts', base).href
    )
    const original = SceneCapture.prototype.render
    const probe = (window.__showcaseNative = {
      capture: null,
      selectionStable: true,
      lastReflectGlobe: false,
      forceNoTerrain: false,
    })
    SceneCapture.prototype.render = function (
      width,
      height,
      reflectGlobe,
      ...rest
    ) {
      const tiles = this.scene.globe?._surface?._tilesToRender?.slice()
      const result = original.call(
        this,
        width,
        height,
        probe.forceNoTerrain ? false : reflectGlobe,
        ...rest,
      )
      if (this.uniform === 'reflexTexture') {
        probe.capture = this
        probe.lastReflectGlobe = reflectGlobe
        const after = this.scene.globe?._surface?._tilesToRender
        if (tiles && after)
          probe.selectionStable &&=
            tiles.length === after.length &&
            tiles.every((tile, index) => tile === after[index])
      }
      return result
    }
    const { createLandscapeShowcase } = await import(
      new URL('src/views/landscape-showcase/runtime.ts', base).href
    )
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;inset:0;z-index:999'
    document.body.append(host)
    probe.host = host
    probe.demo = createLandscapeShowcase(host, () => {})
    await probe.demo.loadScene('mountain')
  }, base)
  await page.waitForFunction(
    () =>
      window.__showcaseNative.capture &&
      window.__showcaseNative.demo.getState().water?.reflectionAvailable,
    null,
    { timeout: 90000 },
  )
  await page.waitForTimeout(14000)
  await page.evaluate(() =>
    window.__showcaseNative.demo.setOptions({ quality: 'low' }),
  )
  await page.waitForTimeout(400)
  check(
    'mountain quality changes retain terrain reflection',
    await page.evaluate(() => window.__showcaseNative.lastReflectGlobe),
  )
  await page.evaluate(() =>
    window.__showcaseNative.demo.setOptions({
      quality: 'balanced',
      waveStrength: 0,
    }),
  )
  await page.waitForTimeout(500)
  const terrain = await page.evaluate(() => {
    const p = window.__showcaseNative,
      c = p.capture
    p.terrainPixels = c.scene.context.readPixels({
      framebuffer: c.framebuffer,
      width: c.width,
      height: c.height,
    })
    p.forceNoTerrain = true
    return { width: c.width, height: c.height }
  })
  await page.waitForTimeout(400)
  const difference = await page.evaluate(() => {
    const p = window.__showcaseNative,
      c = p.capture,
      pixels = c.scene.context.readPixels({
        framebuffer: c.framebuffer,
        width: c.width,
        height: c.height,
      })
    let sum = 0
    for (let i = 0; i < pixels.length; i++)
      if (i % 4 !== 3) sum += Math.abs(pixels[i] - p.terrainPixels[i])
    return sum / (pixels.length * 0.75)
  })
  report.terrainContribution = difference
  report.reflectionSize = terrain
  check(
    'actual terrain contributes to the reflection framebuffer',
    difference > 1,
  )
  check(
    'auxiliary reflection preserves the main selected terrain tiles',
    await page.evaluate(() => window.__showcaseNative.selectionStable),
  )
  await page.evaluate(() => {
    const p = window.__showcaseNative
    p.demo.dispose()
    p.host.remove()
  })
  check('no browser or WebGL errors', report.errors.length === 0)
  report.passed = true
  console.log(
    JSON.stringify({
      passed: true,
      checks: report.checks.length,
      samples: report.samples.length,
      terrainContribution: difference,
    }),
  )
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
