import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
const {chromium}=process.env.PLAYWRIGHT_MODULE_PATH?await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href):await import('playwright')
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH,args:['--enable-webgl','--ignore-gpu-blocklist']})
try{
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[],checks=[]
 page.on('pageerror',e=>errors.push(String(e)))
 page.on('console',m=>{if(m.type()==='error'&&/cleanup failed|shader|framebuffer|rendering has stopped|DeveloperError/i.test(m.text()))errors.push(m.text())})
 await page.route('**/cdnjs.cloudflare.com/**',r=>r.fulfill({contentType:'text/css',body:''}))
 await page.addInitScript(()=>{window.__warmWorkers={active:0,terminated:0};const Native=Worker;window.Worker=class extends Native{constructor(url,options){super(url,options);this.warm=String(url).includes('shader-prewarm.worker');if(this.warm)window.__warmWorkers.active++}terminate(){if(this.warm){window.__warmWorkers.active--;window.__warmWorkers.terminated++;this.warm=false}return super.terminate()}}})
 const base=process.env.ATMOSPHERE_BASE_URL??'http://127.0.0.1:5197/cesium-demo/'
 const ready=async provider=>{await page.waitForFunction(p=>{const s=window.__atmosphereLab?.getState();return s?.diagnostic.status==='failed'||s?.state.provider===p&&s.diagnostic.status==='ready'&&s.postProcess.ready},provider,{timeout:60000});const s=await page.evaluate(()=>window.__atmosphereLab.getState());assert.equal(s.diagnostic.status,'ready',JSON.stringify(s.errors));return s}
 await page.goto(base+'cloud-atmosphere-lab?provider=community&quality=balanced&cloudPresentation=full',{waitUntil:'domcontentloaded'})
 await page.waitForFunction(()=>window.__warmWorkers.active>0)
 await page.evaluate(()=>window.__atmosphereLab.setProvider('basic'))
 const basic=await ready('basic');await page.waitForFunction(()=>window.__warmWorkers.active===0)
 assert.equal(basic.scene.fogRendered,true);checks.push({name:'Cancelling startup releases the worker and restores the basic scene',passed:true})
 await page.evaluate(()=>{const api=window.__atmosphereLab;api.setOptions({quality:'reference',cloudForm:'layered',cloudSampling:'legacy'});api.setView('inside');api.setProvider('community')})
 await ready('community');await page.waitForFunction(()=>window.__warmWorkers.active===0)
 checks.push({name:'Layered and legacy-sampling comparison still compiles and renders',passed:true})
 await page.evaluate(()=>window.__atmosphereLab.setProvider('basic'));const restored=await ready('basic')
 assert.equal(restored.postProcess.count,basic.postProcess.count)
 await page.evaluate(()=>{const api=window.__atmosphereLab;api.setOptions({cloudForm:'cumulus',cloudSampling:'filtered',quality:'balanced'});api.setProvider('community')})
 await page.waitForFunction(()=>window.__warmWorkers.active>0)
 await page.evaluate(path=>{history.pushState({},'',path);dispatchEvent(new PopStateEvent('popstate'))},new URL(base).pathname)
 await page.waitForFunction(()=>window.__atmosphereLab===undefined&&window.__warmWorkers.active===0)
 await page.waitForTimeout(250);assert.deepEqual(errors,[])
 checks.push({name:'Component unmount cancels preparation before destroying Context',passed:true})
 const report={passed:true,checks,workers:await page.evaluate(()=>window.__warmWorkers),errors};await fs.writeFile('test-results/cloud-startup-20261026/lifecycle.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}finally{await browser.close()}
