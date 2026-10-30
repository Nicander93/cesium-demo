import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href)
const label=process.argv[2]??'candidate',runs=Number(process.env.CLOUD_STARTUP_RUNS??1),results=[]
for(let run=0;run<runs;run++){
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH,args:['--enable-webgl','--ignore-gpu-blocklist']})
 let timer
 try{
  const page=await browser.newPage({viewport:{width:1920,height:1080},hasTouch:true}),errors=[]
  page.on('pageerror',error=>errors.push(String(error)))
  await page.route('**/cdnjs.cloudflare.com/**',route=>route.fulfill({contentType:'text/css',body:''}))
  await page.addInitScript(({disableWorker})=>{
   // Block only the optional warmup worker, preserving Cesium's existing
   // geometry workers and image decoding capabilities.
   if(disableWorker){const NativeWorker=Worker;window.Worker=class extends NativeWorker{constructor(url,options){if(String(url).includes('shader-prewarm.worker'))throw Error('Warmup worker unavailable');super(url,options)}}}
   window.__startup={intervals:[],input:[],tasks:[],gl:[],active:true,warmExpected:[],actualPrograms:[]};let last
   function hash(text){let value=2166136261;for(let i=0;i<text.length;i++)value=Math.imul(value^text.charCodeAt(i),16777619);return value>>>0}
   if(typeof Worker!=='undefined'){const post=Worker.prototype.postMessage;Worker.prototype.postMessage=function(data,...rest){if(Array.isArray(data)&&data[0]?.vertexSource)window.__startup.warmExpected=data.map(p=>({name:p.name,hash:hash(p.vertexSource+'\n'+p.fragmentSource)}));return post.call(this,data,...rest)}}
   function sample(now){if(!window.__startup.active)return;if(last!==undefined)window.__startup.intervals.push(now-last);last=now;requestAnimationFrame(sample)}requestAnimationFrame(sample)
   new PerformanceObserver(list=>{if(window.__startup.active)window.__startup.tasks.push(...list.getEntries().map(e=>({at:e.startTime,ms:e.duration})))}).observe({type:'longtask'})
   addEventListener('pointermove',event=>{const sent=event.timeStamp;requestAnimationFrame(()=>{if(window.__startup.active)window.__startup.input.push(performance.now()-sent)})},{passive:true})
   const proto=WebGL2RenderingContext.prototype
   const sources=new WeakMap(),attached=new WeakMap(),shaderSource=proto.shaderSource,attach=proto.attachShader
   proto.shaderSource=function(shader,source){sources.set(shader,source);return shaderSource.call(this,shader,source)}
   proto.attachShader=function(program,shader){const entries=attached.get(program)??[];entries.push(shader);attached.set(program,entries);return attach.call(this,program,shader)}
   for(const name of ['getProgramParameter','getShaderParameter','drawElements','drawArrays']){const original=proto[name];proto[name]=function(...args){const start=performance.now(),result=original.apply(this,args),ms=performance.now()-start;if(ms>8)window.__startup.gl.push({name,at:start,ms});if(name==='getProgramParameter'&&args[1]===this.LINK_STATUS&&result)window.__startup.actualPrograms.push(hash((attached.get(args[0])??[]).map(shader=>sources.get(shader)??'').join('\n')));return result}}
  },{disableWorker:process.env.CLOUD_STARTUP_NO_WORKER==='1'})
  const start=Date.now()
  await page.goto((process.env.ATMOSPHERE_BASE_URL??'http://127.0.0.1:5197/cesium-demo/')+'cloud-atmosphere-lab?provider=community&quality=balanced&cloudPresentation=full&view=ground',{waitUntil:'domcontentloaded'})
  const domMs=Date.now()-start,cdp=await page.context().newCDPSession(page);let n=0;const pending=[]
  timer=setInterval(()=>{pending.push(cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:500+(n++%10),y:500,timestamp:Date.now()/1000}).catch(()=>undefined))},100)
  await page.waitForFunction(()=>{const s=window.__atmosphereLab?.getState();return s?.diagnostic.status==='failed'||s?.diagnostic.status==='ready'&&s.postProcess.ready},null,{timeout:60000})
  const readyMs=Date.now()-start;clearInterval(timer)
  const data=await page.evaluate(()=>{window.__startup.active=false;return {probe:window.__startup,state:window.__atmosphereLab.getState()}})
  await Promise.all(pending)
  assert.equal(data.state.diagnostic.status,'ready',JSON.stringify(data.state.errors));assert.deepEqual(errors,[])
  const quantile=(values,q)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*q))]??0
  const missingPrograms=data.probe.warmExpected.filter(p=>!data.probe.actualPrograms.includes(p.hash)).map(p=>p.name)
  if(data.state.diagnostic.activeEffect?.shaderWarmup?.status==='ready'){assert.equal(data.probe.warmExpected.length,5);assert.deepEqual(missingPrograms,[],'Prewarmed source must match programs actually used by Cesium')}
  if(process.env.CLOUD_STARTUP_NO_WORKER==='1')assert.equal(data.state.diagnostic.activeEffect?.shaderWarmup?.status,'unavailable')
  if(process.env.CLOUD_STARTUP_MAX_MS)assert(readyMs<=Number(process.env.CLOUD_STARTUP_MAX_MS),'Startup exceeded its acceptance budget: '+readyMs)
  const result={run,readyMs,domMs,maxRafMs:Math.max(0,...data.probe.intervals),inputMaxMs:Math.max(0,...data.probe.input),inputP95Ms:quantile(data.probe.input,.95),inputSamples:data.probe.input.length,longTasks:data.probe.tasks,gl:data.probe.gl,missingPrograms,diagnostic:data.state.diagnostic.activeEffect,errors}
  results.push(result);console.log(JSON.stringify(result))
 }finally{clearInterval(timer);await browser.close()}
}
await fs.mkdir('test-results/cloud-startup-20261026',{recursive:true});await fs.writeFile('test-results/cloud-startup-20261026/'+label+'.json',JSON.stringify({label,results},null,2))
