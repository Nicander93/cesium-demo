import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const { chromium } = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href) : await import('playwright')
const label = process.argv[2] ?? 'candidate'
const output = path.resolve(process.env.CLOUD_PERF_OUTPUT ?? 'test-results/cloud-performance-20261025')
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  args: ['--enable-webgl', '--ignore-gpu-blocklist'] })
// RAF intervals include scheduling/render work; they are not isolated GPU timings.
const report = { measurement: 'requestAnimationFrame intervals', label, viewport: { width: 1920, height: 1080 }, passed: false, samples: [], errors: [], assets: [] }
const percentile = (values, p) => [...values].sort((a,b) => a-b)[Math.min(values.length-1,Math.floor(values.length*p))] ?? 0
try {
  const page = await browser.newPage({ viewport: report.viewport, hasTouch: true })
  page.on('pageerror', error => report.errors.push(String(error)))
  page.on('request', request => { if (/atmosphere\/.*\.(bin|png)/.test(request.url())) report.assets.push(request.url()) })
  await page.route('**/cdnjs.cloudflare.com/**', route => route.fulfill({ body: '', contentType: 'text/css' }))
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(2000)
    window.__cloudPerf = { enabled: false, intervals: [], input: [], longTasks: [] }
    let previous
    function sample(now) {
      const probe = window.__cloudPerf
      if (probe.enabled && previous !== undefined) probe.intervals.push(now-previous)
      previous = probe.enabled ? now : undefined
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
    new PerformanceObserver(list => {
      if (window.__cloudPerf.enabled) window.__cloudPerf.longTasks.push(...list.getEntries().map(entry => entry.duration))
    }).observe({type:'longtask', buffered:false})
    addEventListener('pointermove', () => {
      if (!window.__cloudPerf.enabled) return
      const received = performance.now()
      requestAnimationFrame(() => window.__cloudPerf.input.push(performance.now()-received))
    }, {passive:true})
  })
  const ready = async () => {
    await page.waitForFunction(() => {
      const state = window.__atmosphereLab?.getState()
      return state?.diagnostic.status === 'failed' || state?.diagnostic.status === 'ready' && state.postProcess.ready
    }, null, {timeout:60000})
    const state = await page.evaluate(() => window.__atmosphereLab.getState())
    assert.equal(state.diagnostic.status,'ready',JSON.stringify(state.errors))
    assert.deepEqual(state.errors,[])
    return state
  }
  const started = Date.now()
  await page.goto((process.env.ATMOSPHERE_BASE_URL ?? 'http://127.0.0.1:5174/cesium-demo/') + 'cloud-atmosphere-lab?provider=community&quality=balanced&view=ground&cloudPresentation=full', {waitUntil:'domcontentloaded'})
  report.domContentLoadedMs = Date.now()-started
  const first = await ready()
  report.stageReadyMs = Date.now()-started
  report.stageReadyAfterDomMs = report.stageReadyMs - report.domContentLoadedMs
  report.firstDiagnostic = first.diagnostic.activeEffect
  report.startup = await page.evaluate(() => ({
    moduleImports:performance.getEntriesByName('cloud-provider-module').map(entry=>entry.duration),
    latestResources:performance.getEntriesByType('resource').sort((a,b)=>b.responseEnd-a.responseEnd).slice(0,10).map(entry=>({name:new URL(entry.name).origin+new URL(entry.name).pathname,start:entry.startTime,end:entry.responseEnd,duration:entry.duration}))
  }))
  report.renderer = await page.evaluate(() => {
    const canvas=document.createElement('canvas'), gl=canvas.getContext('webgl2'), ext=gl.getExtension('WEBGL_debug_renderer_info')
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
  })
  const session = await page.context().newCDPSession(page)
  async function measure(view, interaction, steps = 36) {
    await page.evaluate(view => window.__atmosphereLab.setView(view),view)
    await ready()
    await page.waitForTimeout(350)
    const before = await page.evaluate(() => window.__atmosphereLab.getState())
    const centerX=page.viewportSize().width/2, centerY=page.viewportSize().height/2
    await page.evaluate(() => Object.assign(window.__cloudPerf,{enabled:true,intervals:[],input:[],longTasks:[]}))
    if (interaction==='idle') await page.waitForTimeout(1800)
    if (interaction==='mouse') {
      await page.mouse.move(centerX,centerY)
      await page.mouse.down()
      for(let index=0;index<steps;index++) { await page.mouse.move(centerX+Math.sin(index/8)*150,centerY+Math.cos(index/9)*45); await page.waitForTimeout(16) }
      await page.mouse.up()
    }
    if (interaction==='touch') {
      await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:centerX,y:centerY}]})
      for(let index=1;index<=steps;index++) {
        await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:centerX+Math.sin(index/8)*150,y:centerY+Math.cos(index/9)*45}]})
        await page.waitForTimeout(16)
      }
      await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
    }
    const probe=await page.evaluate(() => { window.__cloudPerf.enabled=false;return window.__cloudPerf })
    const after=await page.evaluate(() => window.__atmosphereLab.getState())
    const cameraMoved=JSON.stringify(before.camera.position)!==JSON.stringify(after.camera.position) || JSON.stringify(before.camera.direction)!==JSON.stringify(after.camera.direction)
    const record={view,interaction,quality:after.state.quality,weather:after.state.weather,frameCount:probe.intervals.length,frameMedianMs:percentile(probe.intervals,.5),frameP95Ms:percentile(probe.intervals,.95),frameMaxMs:Math.max(0,...probe.intervals),over50ms:probe.intervals.filter(value=>value>50).length,inputP95Ms:percentile(probe.input,.95),longTasks:probe.longTasks,cameraMoved,rebuildBefore:before.diagnostic.rebuildCount,rebuildAfter:after.diagnostic.rebuildCount,cloudVisible:after.scene.cloudVisible,canvas:after.canvas}
    report.samples.push(record)
    console.log(JSON.stringify(record))
    assert(record.frameCount>10,'Too few animation-frame samples')
    assert.equal(record.cloudVisible,true,'Full cloud presentation must remain active')
    if(interaction!=='idle')assert(cameraMoved,'Input must move the actual Cesium camera')
  }
  await measure('ground','idle')
  await measure('cloudscape','mouse')
  await measure('inside','touch')
  const initialAssets=report.assets.length
  const stateBefore=await page.evaluate(() => window.__atmosphereLab.getState())
  await page.evaluate(() => window.__atmosphereLab.setOptions({exposure:1.1,sunHour:15,cloudShadows:false}))
  await page.waitForTimeout(700)
  await ready()
  const stateAfter=await page.evaluate(() => window.__atmosphereLab.getState())
  report.liveUpdate={assetRequests:report.assets.length-initialAssets,rebuilds:(stateAfter.diagnostic.rebuildCount??0)-(stateBefore.diagnostic.rebuildCount??0)}
  if(label!=='baseline' && process.env.CLOUD_PERF_EXTENDED==='1'){
    await page.setViewportSize({width:3840,height:2160})
    await page.waitForFunction(()=>{const state=window.__atmosphereLab.getState();return state.canvas.clientWidth===3840&&state.canvas.bufferWidth*state.canvas.bufferHeight<=1600*900+4000&&state.diagnostic.status==='ready'},null,{timeout:45000})
    const resized=await ready()
    assert(resized.canvas.bufferWidth*resized.canvas.bufferHeight<=1600*900+4000,'High-resolution display exceeds the fixed scene pixel budget')
    await page.evaluate(()=>{window.__atmosphereLab.setOptions({quality:'reference',cloudShadows:true,animated:true})})
    await page.waitForFunction(()=>window.__atmosphereLab.getState().diagnostic.status==='ready' && window.__atmosphereLab.getState().diagnostic.activeEffect?.groundShadowEnabled===true)
    await ready()
    await measure('cloudscape','mouse',180)
    await page.evaluate(()=>window.__atmosphereLab.setWeather('overcast'))
    await page.waitForTimeout(250)
    await ready()
    await measure('inside','touch',180)
    report.finalDiagnostic=(await ready()).diagnostic.activeEffect
  }
  if(label!=='baseline'){

    assert.equal(report.liveUpdate.assetRequests,0,'Uniform edits must not reload weather/LUT assets')
    assert.equal(report.liveUpdate.rebuilds,0,'Uniform edits must not rebuild the pipeline')
    for(const sample of report.samples){assert(sample.frameMedianMs<=20,JSON.stringify(sample));assert(sample.frameP95Ms<=25,JSON.stringify(sample));assert.equal(sample.over50ms,0,JSON.stringify(sample))}
  }
  assert.deepEqual(report.errors,[])
  report.passed=true
} catch(error) { report.failure=String(error); throw error }
finally { await fs.writeFile(path.join(output,label+'.json'),JSON.stringify(report,null,2));await browser.close() }
