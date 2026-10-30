import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const { chromium } = process.env.PLAYWRIGHT_MODULE_PATH
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href)
  : await import('playwright')
const output = path.resolve(process.env.ATMOSPHERE_OUTPUT ?? 'test-results/atmosphere')
const base = process.env.ATMOSPHERE_BASE_URL ?? 'http://127.0.0.1:5174/cesium-demo/'
const phase = process.env.ATMOSPHERE_PHASE ?? 'effects'
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({headless:true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}),
  args:['--enable-webgl','--ignore-gpu-blocklist']})
const context = await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,
  ...(['continuous','cloud-dynamic'].includes(phase)?{recordVideo:{dir:path.join(output,'video'),size:{width:1440,height:900}}}:{})})
const page = await context.newPage()
if(phase==='cloud-dynamic')await page.addInitScript(()=>{
  window.__cloudLayerWrites=0
  const proto=WebGL2RenderingContext.prototype
  const attach=proto.framebufferTextureLayer
  proto.framebufferTextureLayer=function(...args){window.__cloudLayerWrites++;return attach.apply(this,args)}
})
if(phase==='cloud-quality')await page.addInitScript(()=>{
  const names=new WeakMap()
  const proto=WebGL2RenderingContext.prototype
  const getLocation=proto.getUniformLocation
  const setFloat=proto.uniform1f
  window.__cloudUniformProbe={}
  proto.getUniformLocation=function(program,name){
    const location=getLocation.call(this,program,name)
    if(location&&['u_sampleFootprintScale','u_maxOpticalDepthPerStep','u_cumulusDensity','coverage','groundAmbientAlbedo'].includes(name))names.set(location,name)
    return location
  }
  proto.uniform1f=function(location,value){
    const name=names.get(location)
    if(name)window.__cloudUniformProbe[name]=value
    return setFloat.call(this,location,value)
  }
})
const errors=[], assetErrors=[], checks=[], captures=[]
page.on('pageerror', e=>errors.push(String(e.stack??e).slice(0,4000)))
page.on('console', m=>{
  if(m.type()!=='error')return
  if(/cleanup failed|already been added|destroyed/i.test(m.text())){errors.push(m.text().slice(0,4000));return}
  if(/shader|link log|rendering has stopped|RuntimeError|DeveloperError|framebuffer|WebGL.*error/i.test(m.text())) errors.push(m.text().slice(0,4000))
  else assetErrors.push(m.text().slice(0,300))
})
const state=()=>page.evaluate(()=>window.__atmosphereLab.getState())
const call=(method,value)=>page.evaluate(([method,value])=>window.__atmosphereLab[method](value),[method,value])
async function frames(count=12){
  await page.evaluate(count=>new Promise(resolve=>{let i=0;function frame(){if(++i>=count)resolve();else requestAnimationFrame(frame)}requestAnimationFrame(frame)}),count)
}
async function ready(provider){
  await page.waitForFunction(provider=>{
    const s=window.__atmosphereLab?.getState()
    return s?.diagnostic.status==='failed'||(s?.state.provider===provider&&s?.diagnostic.status==='ready'&&s?.postProcess.ready)
  },provider,{timeout:45000})
  const s=await state()
  assert.equal(s.diagnostic.status,'ready',JSON.stringify(s.errors))
  assert.equal(s.scene.activeProvider,provider)
  assert.equal(errors.length,0,errors.join('\n').slice(0,3000))
  return s
}
async function open(provider,quality='reference',communityStep,view='ground',shapeMipmaps=false,detailScale=1,cloudDebug,shapeScale=1){
  if(provider==='community'&&quality==='reference'&&!cloudDebug&&['step','mipmap','detail','shape'].includes(phase))cloudDebug='raw'
  const stepQuery=communityStep===undefined?'':'&communityStep='+communityStep
  const mipQuery=shapeMipmaps?'&shapeMipmaps=1':''
  const detailQuery=detailScale===1?'':'&detailScale='+detailScale
  const debugQuery=cloudDebug?'&cloudDebug='+cloudDebug:''
  const shapeQuery=shapeScale===1?'':'&shapeScale='+shapeScale
  await page.goto(base+'cloud-atmosphere-lab?provider='+provider+'&quality='+quality+'&view='+view+stepQuery+mipQuery+detailQuery+debugQuery+shapeQuery,{waitUntil:'domcontentloaded'})
  return ready(provider)
}
async function waitTiles(){
  await page.waitForFunction(()=>{
    const scene=window.__atmosphereLab?.getState().scene
    return scene?.tilesLoaded===true&&scene.tileLoadQueueLength===0
  },null,{timeout:90000})
  await frames(60)
  await page.waitForTimeout(1000)
}
async function capture(name){
  await frames()
  const s=await state()
  await page.screenshot({path:path.join(output,name+'.png')})
  captures.push({name,...s})
  return s
}
let gpu, failure
try{
  await open('basic')
  gpu=await page.evaluate(()=>{
    const gl=document.querySelector('.cesium-widget canvas').getContext('webgl2')
    const ext=gl.getExtension('WEBGL_debug_renderer_info')
    return {version:gl.getParameter(gl.VERSION),renderer:gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL??gl.RENDERER)}
  })
  if(phase==='cloud-dynamic'){
    for(const quality of ['reference','balanced']){
      const query=new URLSearchParams({provider:'community',quality,view:'ground',weather:'sunny',cloudPresentation:'full',cloudDebug:'fullTemporal'})
      await page.goto(base+'cloud-atmosphere-lab?'+query,{waitUntil:'domcontentloaded'})
      await ready('community')
      await waitTiles()
      const before=await state()
      for(const [name,height,pitch] of [['ground',150,0],['cloudscape',4500,-0.22],['high',37600,-Math.PI/2]]){
        if(name!=='ground')await call('setCameraPose',{height,pitch})
        await frames(50)
        await page.mouse.move(620,320)
        await page.mouse.down()
        for(let segment=1;segment<=8;segment++){
          const t=segment<=4?segment/4:(8-segment)/4
          await page.mouse.move(620+170*t,320+30*t,{steps:20})
          await page.screenshot({path:path.join(output,'held-drag-'+quality+'-'+name+'-'+segment+'.png')})
        }
        await page.mouse.up()
        await frames(40)
        for(let sample=0;sample<6;sample++){
          await frames(2)
          await capture('dynamic-'+quality+'-'+name+'-'+sample)
        }
        const after=await state()
        assert.equal(after.diagnostic.rebuildCount,before.diagnostic.rebuildCount,'Dragging rebuilt cloud resources')
        assert.equal(after.diagnostic.activeEffect.cloudVisibility,1,'Dynamic acceptance hid the high-altitude field')
        assert.equal(after.diagnostic.activeEffect.staticSampleCount,-1,'Dynamic acceptance used a frozen preview')
        assert.equal(after.diagnostic.status,'ready')
        checks.push({check:quality+' '+name+' full-field drag keeps live temporal rendering and resource identity',passed:true})
      }
      await call('setView','cloudscape')
      await call('setOptions',{animated:true})
      await ready('community')
      await frames(30)
      const shadowWritesBefore=await page.evaluate(()=>window.__cloudLayerWrites)
      await frames(120)
      const shadowWritesAfter=await page.evaluate(()=>window.__cloudLayerWrites)
      assert(shadowWritesAfter>shadowWritesBefore,'Animated weather left cached cloud shadow layers stale')
      for(let sample=0;sample<6;sample++){
        await frames(2)
        const wind=await capture('wind-'+quality+'-'+sample)
        assert.equal(wind.diagnostic.activeEffect.staticSampleCount,-1)
        assert.equal(wind.diagnostic.activeEffect.cloudVisibility,1)
      }
      checks.push({check:quality+' animated cloudscape refreshes shadow layers and stays ready with full cloud field',passed:true,shadowLayerWrites:shadowWritesAfter-shadowWritesBefore})
    }
  }else if(phase==='cloud-perf'){
    for(const sampling of ['legacy','filtered'])for(const quality of ['reference','balanced'])for(const view of ['ground','inside','above']){
      const query=new URLSearchParams({provider:'community',quality,view,weather:'sunny',coverage:'0.42',cloudPresentation:'full',...Object.fromEntries(new URLSearchParams(process.env.ATMOSPHERE_CLOUD_QUERY??'')),cloudSampling:sampling,cloudLighting:'diffuse',cloudDebug:'fullTemporal'})
      if(process.env.ATMOSPHERE_CASE&&!`${sampling}-${quality}-${view}`.includes(process.env.ATMOSPHERE_CASE))continue
      await page.goto(base+'cloud-atmosphere-lab?'+query,{waitUntil:'domcontentloaded'})
      await ready('community')
      if(view==='above')await call('setCameraPose',{height:37600,pitch:-Math.PI/2})
      await frames(60)
      const durations=await page.evaluate(()=>new Promise(resolve=>{
        const samples=[];let previous=performance.now()
        function frame(now){samples.push(now-previous);previous=now;if(samples.length===90)resolve(samples);else requestAnimationFrame(frame)}requestAnimationFrame(frame)
      }))
      const sorted=durations.slice(1).sort((a,b)=>a-b)
      checks.push({check:sampling+' '+quality+' '+view+' live full-cloud frame timing',passed:true,frameMs:{median:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],max:sorted.at(-1)}})
      await capture('perf-'+sampling+'-'+quality+'-'+view)
    }
  }else if(phase==='cloud-noise'){
    for(const sampling of ['legacy','filtered']){
      for(const height of [10000,37600]){
        const query=new URLSearchParams({provider:'community',quality:'reference',view:'above',weather:'sunny',coverage:'0.42',cloudPresentation:'full',...Object.fromEntries(new URLSearchParams(process.env.ATMOSPHERE_CLOUD_QUERY??'')),cloudSampling:sampling,cloudDebug:'alphaTemporal'})
        await page.goto(base+'cloud-atmosphere-lab?'+query,{waitUntil:'domcontentloaded'})
        await ready('community')
        await call('setCameraPose',{height,pitch:-Math.PI/2})
        await frames(100)
        for(let sample=0;sample<16;sample++){
          await frames(2)
          await page.screenshot({path:path.join(output,'noise-'+sampling+'-'+height+'-'+sample+'.png')})
        }
        const s=await state()
        assert.equal(s.diagnostic.activeEffect.cloudVisibility,1)
        assert.equal(s.diagnostic.activeEffect.staticSampleCount,-1,'Noise test incorrectly used the held static preview')
        checks.push({check:sampling+' '+height+'m live temporal opacity sequence',passed:true})
      }
    }
  }else if(phase==='atmosphere'){
    const cases=[['ground','sunny',0],['ground','sunset',0],['ground','overcast',0],['above','sunny',0],['orbit','sunny',0],['orbit','sunset',0],['ground','sunny',0.42],['ground','sunset',0.55],['inside','sunny',0.42],['inside','sunset',0.55],['inside','overcast',0.68],['above','sunny',0.42],['orbit','sunny',0.42]]
    for(const [view,weather,coverage] of cases){
      const name='atmosphere-'+view+'-'+weather+(coverage===0?'-clear':'-clouds')
      if(process.env.ATMOSPHERE_CASE&&!name.includes(process.env.ATMOSPHERE_CASE))continue
      const query=new URLSearchParams({provider:'community',quality:'reference',view,weather,coverage:String(coverage),base:'1800',thickness:'1200',exposure:'1.00'})
      await page.goto(base+'cloud-atmosphere-lab?'+query,{waitUntil:'domcontentloaded'})
      await ready('community')
      await waitTiles()
      await frames(160)
      const current=await capture(name)
      assert.equal(current.state.exposure,1)
      assert.equal(current.state.coverage,coverage)
      assert.equal(current.scene.globeAtmosphere,false,'Built-in ground atmosphere is still rendered')
      assert.equal(current.scene.fogRendered,false,'Built-in fog is still rendered')
      if(view==='ground'&&weather==='sunny'&&coverage===0){
        for(const mode of [8,9,10,14]){
          await call('setAtmosphereDebug',mode)
          await capture(name+'-probe-'+mode)
        }
        await call('setAtmosphereDebug',0)
      }
      checks.push({check:name+' GPU ready',passed:true,scene:current.scene})
    }
    await call('setProvider','basic')
    const restored=await ready('basic')
    assert.equal(restored.scene.globeAtmosphere,true)
    assert.equal(restored.scene.fogRendered,true)
    checks.push({check:'Leaving LUT atmosphere restores Cesium ground atmosphere and fog rendering',passed:true})
  }else if(phase==='cloud-quality'){
    const cases=[['ground','sunny',150,null],['above','sunny',3600,-0.12],['above','sunny',4500,-0.22],['above','sunny',10000,-Math.PI/2],['above','sunny',37600,-Math.PI/2],['ground','overcast',150,null],['inside','sunset',2400,null]]
    for(const [view,weather,height,pitch] of cases){
      const query=new URLSearchParams({provider:'community',quality:'reference',view,weather,coverage:weather==='overcast'?'0.68':'0.42',cloudPresentation:'full',...Object.fromEntries(new URLSearchParams(process.env.ATMOSPHERE_CLOUD_QUERY??''))})
      const name='quality-'+view+'-'+weather+'-'+height
      if(process.env.ATMOSPHERE_CASE&&!name.includes(process.env.ATMOSPHERE_CASE))continue
      await page.goto(base+'cloud-atmosphere-lab?'+query,{waitUntil:'domcontentloaded'})
      await ready('community')
      if(pitch!==null)await call('setCameraPose',{height,pitch})
      await waitTiles()
      await frames(150)
      const settled=await capture(name)
      const uniforms=await page.evaluate(()=>window.__cloudUniformProbe)
      if(settled.state.cloudSampling==='filtered')assert.equal(uniforms.u_sampleFootprintScale,1,'Filtered sampling uniform did not reach the GPU')
      assert(Math.abs(uniforms.coverage-settled.state.coverage)<1e-6,'Coverage did not reach the GPU')
      if(settled.state.cloudForm==='cumulus')assert.equal(uniforms.u_cumulusDensity,1,'Cumulus density model was not active')
      if(settled.state.cloudSampling==='filtered')assert.equal(uniforms.u_maxOpticalDepthPerStep,0.5,'Optical refinement was not active')
      checks.push({check:name+' GPU sampling configuration',passed:true,uniforms})
      assert.equal(settled.diagnostic.activeEffect.cloudVisibility,1,'Quality comparison must show the complete cloud field')
      assert.equal(settled.diagnostic.status,'ready')
      checks.push({check:name+' full-cloud comparison captured',passed:true})
    }
  }else if(phase==='presentation'){
    for(const quality of ['reference','balanced']){
      await open('community',quality)
      await frames(140)
      const initial=await state()
      for(const height of [4000,6000,8000,10000,12000,37600,150]){
        await call('setCameraHeight',height)
        await frames(12)
        const s=await capture('presentation-'+quality+'-'+height)
        const active=s.diagnostic.activeEffect
        const t=Math.max(0,Math.min(1,(height-4000)/6000))
        const expected=1-t*t*(3-2*t)
        assert(Math.abs(s.camera.height-height)<0.01,'Camera height was not reproduced')
        assert(Math.abs(active.cloudVisibility-expected)<0.00001,'Incorrect continuous fade at '+height)
        assert.equal(active.cloudRenderingActive,height<10000,'Hidden cloud computation was not paused')
        assert.equal(s.diagnostic.rebuildCount,initial.diagnostic.rebuildCount,'Height changes rebuilt cloud resources')
        assert.equal(s.scene.primitiveCount,initial.scene.primitiveCount,'Height changes leaked or recreated primitives')
        assert.equal(s.postProcess.count,initial.postProcess.count,'Height changes changed the stage chain')
        assert.equal(s.diagnostic.status,'ready')
        assert.equal(s.errors.length,0)
        if(height===150){
          assert(active.staticSampleCount<128,'Descent reused the held cloud history')
          await frames(140)
          if(quality==='reference')assert.equal((await state()).diagnostic.activeEffect.staticSampleCount,128)
        }
        checks.push({check:quality+' height '+height+'m preserves resources and applies continuous presentation',passed:true,visibility:active.cloudVisibility,renderingActive:active.cloudRenderingActive})
      }
      for(const view of ['above','orbit','inside','ground']){
        await call('setView',view)
        await frames(20)
        const s=await state()
        assert.equal(s.diagnostic.rebuildCount,initial.diagnostic.rebuildCount,'View buttons rebuilt cloud resources')
        assert.equal(s.diagnostic.status,'ready')
        assert.equal(s.errors.length,0)
      }
      checks.push({check:quality+' view buttons retain one cloud pipeline across altitude changes',passed:true})
      const trace=await page.evaluate(()=>new Promise(resolve=>{
        const samples=[]
        function frame(){
          const index=samples.length
          const t=index<60?index/59:(119-index)/59
          window.__atmosphereLab.setCameraHeight(150+15850*t)
          requestAnimationFrame(()=>{
            const s=window.__atmosphereLab.getState()
            samples.push({status:s.diagnostic.status,ready:s.postProcess.ready,
              rebuildCount:s.diagnostic.rebuildCount,errors:s.errors,
              visibility:s.diagnostic.activeEffect.cloudVisibility,
              active:s.diagnostic.activeEffect.cloudRenderingActive})
            if(samples.length===120)resolve(samples)
            else frame()
          })
        }
        frame()
      }))
      assert(trace.every(s=>s.status==='ready'&&s.ready&&!s.errors.length&&s.rebuildCount===initial.diagnostic.rebuildCount),'Continuous ascent/descent interrupted the pipeline')
      assert(trace.some(s=>!s.active)&&trace.at(-1).active,'Continuous flight did not pause and resume clouds')
      assert(trace.every((s,i)=>i===0||Math.abs(s.visibility-trace[i-1].visibility)<0.07),'Presentation jumped between adjacent height samples')
      await fs.writeFile(path.join(output,'presentation-'+quality+'-trace.json'),JSON.stringify(trace,null,2))
      checks.push({check:quality+' 120-frame ascent/descent stays ready with a continuous fade and no rebuild',passed:true})
    }
    await call('setOptions',{cloudPresentation:'full'})
    await page.waitForFunction(()=>window.__atmosphereLab.getState().state.cloudPresentation==='full'&&window.__atmosphereLab.getState().diagnostic.status==='ready')
    // Wait for the debounced parameter update, then test the opt-out at the reported height.
    await frames(50)
    await ready('community')
    await call('setCameraHeight',37600)
    await frames(20)
    const full=await capture('presentation-full-diagnostic-37600')
    assert.equal(full.diagnostic.activeEffect.cloudVisibility,1)
    assert.equal(full.diagnostic.activeEffect.cloudRenderingActive,true)
    checks.push({check:'Full-cloud diagnostic bypasses the product height fade',passed:true})
    await page.goto(base+'cloud-atmosphere-lab?provider=community&quality=balanced&view=orbit',{waitUntil:'domcontentloaded'})
    await ready('community')
    assert.equal((await state()).diagnostic.activeEffect.cloudRenderingActive,false,'Initial orbital mount did not pause')
    await call('setView','ground')
    await frames(30)
    const descended=await capture('presentation-initial-orbit-return-ground')
    assert.equal(descended.diagnostic.activeEffect.cloudVisibility,1)
    assert.equal(descended.diagnostic.activeEffect.cloudRenderingActive,true)
    assert.equal(descended.diagnostic.rebuildCount,1)
    checks.push({check:'Initially hidden pipeline resumes at ground level without rebuilding',passed:true})
  }else if(phase==='lighting'){
    for(const debug of ['alpha',null]){
      for(const weather of ['sunny','sunset']){
        const query=new URLSearchParams({provider:'community',quality:'reference',view:'ground',weather,coverage:'0.42',base:'1800',thickness:'1200',exposure:'1.00'})
        if(debug)query.set('cloudDebug',debug)
        await page.goto(base+'cloud-atmosphere-lab?'+query,{waitUntil:'domcontentloaded'})
        await ready('community')
        await waitTiles()
        await frames(160)
        await capture('lighting-'+weather+'-'+(debug??'color'))
      }
    }
    const alphaImages=await Promise.all(['sunny','sunset'].map(weather=>fs.readFile(path.join(output,'lighting-'+weather+'-alpha.png')).then(bytes=>bytes.toString('base64'))))
    const comparison=await page.evaluate(async images=>{
      const pixels=await Promise.all(images.map(async encoded=>{
        const image=new Image();image.src='data:image/png;base64,'+encoded;await image.decode()
        const canvas=new OffscreenCanvas(image.width,image.height)
        const context=canvas.getContext('2d');context.drawImage(image,0,0)
        return context.getImageData(210,110,990,690).data
      }))
      let sum=0,changed=0,count=0
      for(let i=0;i<pixels[0].length;i++){if(i%4===3)continue;const delta=Math.abs(pixels[0][i]-pixels[1][i]);sum+=delta;changed+=delta>1?1:0;count++}
      return {meanAbsoluteChange:sum/count,changedChannelRatio:changed/count}
    },alphaImages)
    assert(comparison.meanAbsoluteChange<0.01&&comparison.changedChannelRatio<0.001,'Lighting changed the frozen cloud density: '+JSON.stringify(comparison))
    checks.push({check:'Changing only solar time preserves the frozen cloud opacity field',passed:true,...comparison})
  }else if(phase==='effects'){
    for(const [provider,quality] of [['basic','reference'],['current','reference'],['community','reference'],['community','balanced']]){
      await open(provider,quality)
      await page.waitForTimeout(1500)
      const s=await capture(provider+'-'+quality)
      assert(Math.abs(s.camera.height-150)<2,'Ground camera reset to a global view')
      assert(s.canvas.clientWidth>=1435,'Viewport is obscured by a permanent sidebar')
      assert.equal(s.scene.cloudVisible,provider!=='basic')
      if(provider==='community'){
        assert.equal(s.diagnostic.width,Math.ceil(s.canvas.bufferWidth/(quality==='balanced'?2:1)))
        assert.equal(s.diagnostic.temporalResolve,true)
      }
      checks.push({check:provider+'/'+quality+' GPU ready at ground level',passed:true})
    }
  }else if(phase==='step'){
    const percentile=samples=>{const sorted=[...samples].sort((a,b)=>a-b);return {median:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],max:Math.max(...sorted)}}
    for(const communityStep of [250,150,100]){
      await open('community','reference',communityStep,'ground')
      await waitTiles()
      await capture('community-ground-step-'+communityStep)
      const groundFrames=await page.evaluate(()=>new Promise(resolve=>{
        const samples=[];let previous=performance.now()
        function sample(now){samples.push(now-previous);previous=now;if(samples.length>=120)resolve(samples);else requestAnimationFrame(sample)}
        requestAnimationFrame(sample)
      }))
      checks.push({check:'Community step cap '+communityStep+'m ground render ready',passed:true,frameMs:{ground:percentile(groundFrames)}})
    }
    for(const communityStep of [250,150,100]){
      await open('community','reference',communityStep,'inside')
      await waitTiles()
      await capture('community-inside-step-'+communityStep)
      const insideFrames=await page.evaluate(()=>new Promise(resolve=>{
        const samples=[];let previous=performance.now()
        function sample(now){samples.push(now-previous);previous=now;if(samples.length>=120)resolve(samples);else requestAnimationFrame(sample)}
        requestAnimationFrame(sample)
      }))
      checks.push({check:'Community step cap '+communityStep+'m ground and inside render ready',passed:true,
        frameMs:{inside:percentile(insideFrames)}})
    }
  }else if(phase==='mipmap'){
    const percentile=samples=>{const sorted=[...samples].sort((a,b)=>a-b);return {median:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],max:Math.max(...sorted)}}
    for(const view of ['ground','inside']){
      for(const shapeMipmaps of [false,true]){
        await open('community','reference',250,view,shapeMipmaps)
        await waitTiles()
        const name='community-'+view+'-mipmaps-'+(shapeMipmaps?'on':'off')
        await capture(name)
        const samples=await page.evaluate(()=>new Promise(resolve=>{
          const values=[];let previous=performance.now()
          function sample(now){values.push(now-previous);previous=now;if(values.length>=120)resolve(values);else requestAnimationFrame(sample)}
          requestAnimationFrame(sample)
        }))
        checks.push({check:name+' GPU ready',passed:true,frameMs:percentile(samples)})
      }
    }
  }else if(phase==='detail'){
    const percentile=samples=>{const sorted=[...samples].sort((a,b)=>a-b);return {median:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],max:Math.max(...sorted)}}
    for(const view of ['ground','inside']){
      for(const detailScale of [1,0.4,0]){
        await open('community','reference',250,view,false,detailScale)
        await waitTiles()
        const name='community-'+view+'-detail-'+detailScale
        await capture(name)
        const samples=await page.evaluate(()=>new Promise(resolve=>{
          const values=[];let previous=performance.now()
          function sample(now){values.push(now-previous);previous=now;if(values.length>=120)resolve(values);else requestAnimationFrame(sample)}
          requestAnimationFrame(sample)
        }))
        checks.push({check:name+' GPU ready',passed:true,frameMs:percentile(samples)})
      }
    }
  }else if(phase==='quality'){
    const percentile=samples=>{const sorted=[...samples].sort((a,b)=>a-b);return {median:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],max:Math.max(...sorted)}}
    for(const view of ['ground','inside']){
      for(const quality of ['reference','balanced']){
        await open('community',quality,250,view)
        await waitTiles()
        const name='community-'+view+'-'+quality
        await capture(name)
        const samples=await page.evaluate(()=>new Promise(resolve=>{
          const values=[];let previous=performance.now()
          function sample(now){values.push(now-previous);previous=now;if(values.length>=120)resolve(values);else requestAnimationFrame(sample)}
          requestAnimationFrame(sample)
        }))
        checks.push({check:name+' temporal quality GPU ready',passed:true,frameMs:percentile(samples)})
      }
    }
  }else if(phase==='debug'){
    for(const view of ['ground','inside']){
      for(const cloudDebug of ['weather','sampleCount','march','marchA']){
        await open('community','reference',250,view,false,1,cloudDebug)
        await waitTiles()
        const name='community-'+view+'-debug-'+cloudDebug
        await capture(name)
        checks.push({check:name+' debug shader GPU ready',passed:true})
      }
    }
  }else if(phase==='shape'){
    const percentile=samples=>{const sorted=[...samples].sort((a,b)=>a-b);return {median:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],max:Math.max(...sorted)}}
    for(const view of ['ground','inside']){
      for(const shapeScale of [1,0.5,0]){
        await open('community','reference',250,view,false,1,undefined,shapeScale)
        await waitTiles()
        const name='community-'+view+'-shape-'+shapeScale
        await capture(name)
        const samples=await page.evaluate(()=>new Promise(resolve=>{
          const values=[];let previous=performance.now()
          function sample(now){values.push(now-previous);previous=now;if(values.length>=120)resolve(values);else requestAnimationFrame(sample)}
          requestAnimationFrame(sample)
        }))
        checks.push({check:name+' GPU ready',passed:true,frameMs:percentile(samples)})
      }
    }
  }else if(phase==='static'){
    for(const [view,weather] of [['ground','sunny'],['inside','sunny'],['above','sunny'],['ground','sunset'],['inside','sunset'],['ground','overcast']]){
      const query=new URLSearchParams({provider:'community',quality:'reference',view,weather,coverage:weather==='sunny'?'0.42':weather==='sunset'?'0.55':'0.68',base:'1800',thickness:'1200',exposure:'1.00'})
      await page.goto(base+'cloud-atmosphere-lab?'+query,{waitUntil:'domcontentloaded'})
      await ready('community')
      await waitTiles()
      await frames(160)
      const name='community-'+view+'-'+weather
      const frozen=await capture(name+'-static')
      assert.equal(frozen.diagnostic.staticSampleCount,128,'Fixed preview did not accumulate')
      assert.equal(frozen.diagnostic.temporalResolve,true)
      assert.equal(frozen.diagnostic.width,1440)
      await frames(60)
      const retained=await capture(name+'-static-plus60')
      assert.equal(retained.diagnostic.staticSampleCount,128,'Converged fixed preview was reset without camera motion')
      if(view==='inside'&&weather==='sunny'){
        await page.mouse.move(650,320)
        await page.mouse.down()
        for(let i=1;i<=5;i++){
          await page.mouse.move(650+i*18,320+i*3,{steps:4})
          const moved=await capture(name+'-drag-'+i)
          assert(moved.diagnostic.staticSampleCount<32,'Moving camera reused a converged static history')
        }
        await page.mouse.up()
        await page.waitForFunction(()=>window.__atmosphereLab.getState().diagnostic.staticSampleCount===128,null,{timeout:20000})
        await capture(name+'-settled')
        checks.push({check:'Camera drag resets static accumulation and release converges again',passed:true})
      }
      checks.push({check:name+' default full-resolution accumulation ready',passed:true})
    }
    await page.goto(base+'cloud-atmosphere-lab?provider=community&quality=reference&view=ground&animated=1',{waitUntil:'domcontentloaded'})
    await ready('community')
    await frames(60)
    const animated=await capture('community-animated-no-static-history')
    assert.equal(animated.diagnostic.staticSampleCount,-1,'Animated weather entered fixed-scene accumulation')
    checks.push({check:'Animated weather stays on normal reprojection',passed:true})
    const before=await state()
    await page.setViewportSize({width:1200,height:760})
    await page.waitForFunction(n=>(window.__atmosphereLab.getState().diagnostic.rebuildCount??0)>n,before.diagnostic.rebuildCount)
    const resized=await ready('community')
    assert.equal(resized.diagnostic.width,1200)
    assert.equal(resized.diagnostic.height,760)
    await capture('community-full-resolution-resized')
    checks.push({check:'Resize rebuilds full-resolution accumulation targets',passed:true})
  }else if(phase==='temporalFull'){
    for(const [view,weather] of [['ground','sunny'],['inside','sunny'],['inside','sunset']]){
      for(const quality of ['reference','fullTemporal','balanced']){
        const query=new URLSearchParams({provider:'community',quality:quality==='fullTemporal'?'reference':quality,view,weather,coverage:weather==='sunny'?'0.42':'0.55',base:'1800',thickness:'1200',exposure:'1.00'})
        if(quality==='reference')query.set('cloudDebug','raw')
        await page.goto(base+'cloud-atmosphere-lab?'+query,{waitUntil:'domcontentloaded'})
        await ready('community')
        await waitTiles()
        await frames(180)
        const name='community-'+view+'-'+weather+'-'+quality
        const current=await capture(name+'-180f')
        assert.equal(current.diagnostic.temporalResolve,quality!=='reference')
        assert.equal(current.diagnostic.width,quality==='balanced'?720:1440)
        await frames(60)
        await capture(name+'-240f')
        checks.push({check:name+' GPU ready at 180/240 frames',passed:true})
      }
    }
  }else if(phase==='jitter'){
    for(const [view,weather] of [['ground','sunny'],['inside','sunny'],['inside','sunset']]){
      for(const cloudDebug of [null,'fixedViewJitter','fixedLightJitter','fixedJitter']){
        const query=new URLSearchParams({provider:'community',quality:'reference',view,weather,coverage:weather==='sunny'?'0.42':'0.55',base:'1800',thickness:'1200',exposure:'1.00'})
        query.set('cloudDebug',cloudDebug??'raw')
        await page.goto(base+'cloud-atmosphere-lab?'+query,{waitUntil:'domcontentloaded'})
        await ready('community')
        await waitTiles()
        const name='community-'+view+'-'+weather+'-'+(cloudDebug??'random')
        await capture(name)
        checks.push({check:name+' GPU ready',passed:true})
      }
    }
  }else if(phase==='optical'){
    const percentile=samples=>{const sorted=[...samples].sort((a,b)=>a-b);return {median:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],max:Math.max(...sorted)}}
    for(const view of ['ground','inside','above']){
      for(const weather of ['sunny','sunset']){
        for(const opticalStep of [false,true]){
          const query=new URLSearchParams({provider:'community',quality:'reference',view,weather,coverage:weather==='sunny'?'0.42':'0.55',base:'1800',thickness:'1200',exposure:'1.00'})
          query.set('cloudDebug',opticalStep?'opticalStep':'raw')
          await page.goto(base+'cloud-atmosphere-lab?'+query,{waitUntil:'domcontentloaded'})
          await ready('community')
          await waitTiles()
          const name='community-'+view+'-'+weather+'-optical-'+(opticalStep?'on':'off')
          const current=await capture(name)
          assert.equal(current.state.communityShapeScale,1,'Cloud shape must remain unchanged')
          assert.equal(current.state.animated,false,'Weather animation must be frozen')
          const samples=await page.evaluate(()=>new Promise(resolve=>{
            const values=[];let previous=performance.now()
            function sample(now){values.push(now-previous);previous=now;if(values.length>=90)resolve(values);else requestAnimationFrame(sample)}
            requestAnimationFrame(sample)
          }))
          checks.push({check:name+' GPU ready',passed:true,frameMs:percentile(samples)})
        }
      }
    }
  }else if(phase==='views'){
    for(const provider of ['basic','community']){
      await open(provider,'balanced')
      for(const view of ['ground','inside','above','orbit']){
        const before=await state()
        await call('setView',view)
        await ready(provider)
        if(provider === 'community') await frames(60)
        const s=await capture(provider+'-'+view)
        assert.equal(s.diagnostic.rebuildCount,before.diagnostic.rebuildCount,'Camera preset rebuilt resources')
        const expected=view==='ground'?150:view==='inside'?2400:view==='above'?5120:18000000
        assert(Math.abs(s.camera.height-expected)<3,view+' has wrong camera height: '+s.camera.height)
        checks.push({check:provider+'/'+view+' actual camera and GPU ready',passed:true,height:s.camera.height})
      }
    }
  }else if(phase==='motion'){
    await open('community','balanced')
    await frames(30)
    const initial=await state()
    await page.mouse.move(650,320)
    await page.mouse.down()
    for(let i=1;i<=8;i++){
      await page.mouse.move(650+i*14,320+i*3,{steps:2})
      await capture('drag-'+i)
    }
    await page.mouse.up()
    const dragged=await state()
    assert(Math.hypot(dragged.camera.direction.x-initial.camera.direction.x,dragged.camera.direction.y-initial.camera.direction.y,dragged.camera.direction.z-initial.camera.direction.z)>.0001,'Drag did not move camera')
    for(const provider of ['current','community','basic','community','current','community']){
      const before=await state()
      await call('setProvider',provider)
      const s=await ready(provider)
      assert(Math.hypot(s.camera.position.x-before.camera.position.x,s.camera.position.y-before.camera.position.y,s.camera.position.z-before.camera.position.z)<1,'Provider switch reset manually dragged camera')
      assert.equal(s.postProcess.count,provider==='basic'?0:provider==='current'?4:3)
    }
    checks.push({check:'8 drag samples and six provider switches retain camera and stage counts',passed:true})
    const before=await state()
    await page.setViewportSize({width:1200,height:760})
    await page.waitForFunction(n=>(window.__atmosphereLab.getState().diagnostic.rebuildCount??0)>n,before.diagnostic.rebuildCount)
    const resized=await ready('community')
    assert.equal(resized.canvas.bufferWidth,1200)
    assert.equal(resized.diagnostic.width,600)
    assert.equal(resized.diagnostic.height,380)
    await capture('resized')
    checks.push({check:'Resize rebuilds actual half-resolution GPU targets',passed:true})
    await page.goto(base,{waitUntil:'domcontentloaded'})
    await page.waitForTimeout(500)
    await open('community','balanced')
    await capture('remount')
    checks.push({check:'Route unmount/remount renders again without duplicate stages',passed:true})
  }else if(phase==='local'){
    await open('local','reference')
    let stageCount
    for(const view of ['ground','inside','above','orbit']){
      await call('setView',view)
      await ready('local')
      await frames(20)
      const s=await capture('local-'+view)
      const expected=view==='ground'?150:view==='inside'?2400:view==='above'?5000:18000000
      assert(Math.abs(s.camera.height-expected)<3,'Local '+view+' has wrong camera height: '+s.camera.height)
      assert.equal(s.diagnostic.temporalResolve,false,'Local deterministic reference unexpectedly uses TAA')
      assert.equal(s.diagnostic.width,s.canvas.bufferWidth,'Local reference is not full resolution')
      stageCount??=s.postProcess.count
      assert.equal(s.postProcess.count,stageCount)
      assert.equal(new Set(s.postProcess.stages.map(stage=>stage.name)).size,stageCount)
      assert.deepEqual(s.errors,[])
      checks.push({check:'Local '+view+' renders same anchored volume without TAA',passed:true,height:s.camera.height})
    }
    await call('setView','ground')
    await ready('local')
    const initial=await state()
    await page.mouse.move(650,320)
    await page.mouse.down()
    await page.mouse.move(750,340,{steps:70})
    await page.mouse.up()
    const dragged=await state()
    assert(Math.hypot(dragged.camera.direction.x-initial.camera.direction.x,dragged.camera.direction.y-initial.camera.direction.y,dragged.camera.direction.z-initial.camera.direction.z)>.0001,'Local drag did not move camera')
    await capture('local-after-drag')
    for(const provider of ['basic','local','current','local','community','local']){
      const before=await state()
      await call('setProvider',provider)
      const s=await ready(provider)
      assert(Math.hypot(s.camera.position.x-before.camera.position.x,s.camera.position.y-before.camera.position.y,s.camera.position.z-before.camera.position.z)<1,'Local provider switch reset camera')
      if(provider==='local')assert.equal(s.postProcess.count,stageCount,'Local provider leaked stages')
      if(provider==='basic')assert.equal(s.postProcess.count,0)
    }
    await call('setWeather','sunset')
    await frames(20)
    await ready('local')
    await capture('local-sunset')
    checks.push({check:'Local drag, sunset update and six provider switches retain camera and clean stages',passed:true})
  }else if(phase==='rebuild'){
    await open('community','balanced')
    for(const weather of ['sunset','overcast','sunny']){
      const previous=await state()
      await call('setWeather',weather)
      await page.waitForFunction(n=>(window.__atmosphereLab.getState().diagnostic.rebuildCount??0)>n,previous.diagnostic.rebuildCount,{timeout:45000})
      await ready('community')
      await frames(12)
      const s=await state()
      assert.equal(s.state.weather,weather)
      assert.equal(s.postProcess.count,3,'Weather rebuild leaked or removed a stage')
      assert.deepEqual(s.errors,[])
      checks.push({check:'Community '+weather+' weather rebuild releases previous MRT textures and overlay',passed:true})
    }
    await capture('after-weather-rebuilds')
  }else if(phase==='continuous'){
    const provider=process.env.ATMOSPHERE_MOTION_PROVIDER??'community'
    assert(['community','current','local'].includes(provider),'Continuous provider must have clouds')
    await open(provider,'balanced')
    await frames(90)
    await capture('continuous-before')
    const initial=await state()
    const samplesPromise=page.evaluate(()=>new Promise(resolve=>{
      const samples=[]
      let previous=performance.now()
      function sample(now){
        const s=window.__atmosphereLab.getState()
        samples.push({elapsed:now-previous,status:s.diagnostic.status,
          rebuildCount:s.diagnostic.rebuildCount,stageReady:s.postProcess.ready,
          errors:s.errors,camera:s.camera})
        previous=now
        if(samples.length>=240)resolve(samples)
        else requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    }))
    await page.mouse.move(650,320)
    await page.mouse.down()
    await page.mouse.move(790,350,{steps:100})
    await page.mouse.move(620,300,{steps:100})
    await page.mouse.up()
    const samples=await samplesPromise
    assert(samples.every(s=>s.status==='ready'&&s.stageReady&&!s.errors.length),'Rendering became unready while dragging')
    assert(samples.every(s=>s.rebuildCount===initial.diagnostic.rebuildCount),'Dragging rebuilt the cloud pipeline')
    assert(samples.some(s=>Math.hypot(s.camera.direction.x-initial.camera.direction.x,s.camera.direction.y-initial.camera.direction.y,s.camera.direction.z-initial.camera.direction.z)>.0001),'Continuous trace did not include camera movement')
    const durations=samples.slice(1).map(s=>s.elapsed).sort((a,b)=>a-b)
    await fs.writeFile(path.join(output,'continuous-trace.json'),JSON.stringify(samples,null,2))
    await capture('continuous-after')
    checks.push({check:'240 consecutive frame samples retain ready stages and pipeline identity during drag',passed:true,
      frameMs:{median:durations[Math.floor(durations.length*.5)],p95:durations[Math.floor(durations.length*.95)],max:durations.at(-1)}})
  }else throw new Error('Unknown phase '+phase)
  assert.equal(errors.length,0,errors.join('\n').slice(0,3000))
}catch(error){failure=String(error.stack??error);try{await page.screenshot({path:path.join(output,phase+'-failure.png')})}catch{}}
finally{
  const report={phase,passed:!failure,gpu,checks,captures,errors,assetErrors,failure}
  await fs.writeFile(path.join(output,phase+'-report.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify({phase,passed:report.passed,gpu,checks,errors:errors.map(e=>e.slice(0,500)),failure},null,2))
  const video=page.video()
  await context.close()
  if(video)await video.saveAs(path.join(output,'continuous-drag.webm'))
  await browser.close()
}
if(failure)process.exitCode=1

