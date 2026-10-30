import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
const {chromium}=process.env.PLAYWRIGHT_MODULE_PATH?await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href):await import('playwright')
const source=await fs.readFile(new URL('../src/vendor/cesium-geospatial/clouds/glsl/fastLighting.glsl',import.meta.url),'utf8')
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH,args:['--enable-webgl','--ignore-gpu-blocklist']})
const fixtures=[
 {name:'zero distance is neutral',input:[0,0,0]},
 {name:'homogeneous sea-level air',input:[1000,0,0]},
 {name:'higher altitude has less attenuation',input:[1000,10000,10000]},
 {name:'endpoint heights commute',input:[12000,500,3000]},
 {name:'reversed endpoint heights commute',input:[12000,3000,500]},
 {name:'space-to-cloud column stays finite',input:[1600000,1600000,2000]},
 {name:'nearly equal heights stay continuous',input:[1000,0,.01]},
 {name:'negative distances remain neutral',input:[-100,0,0]},
 {name:'below-sea-level inputs are bounded',input:[1000,-200,-200]},
 {name:'very long paths remain finite',input:[1000000000,0,0]},
]
try{
 const page=await browser.newPage();await page.setContent('<canvas width="1" height="1"></canvas>')
 const results=await page.evaluate(({source,fixtures})=>{
  const gl=document.querySelector('canvas').getContext('webgl2');if(!gl.getExtension('EXT_color_buffer_float'))throw Error('Float target required')
  const p=gl.createProgram();for(const[t,s]of[[gl.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}'],[gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;uniform vec3 u_path;layout(location=0) out vec4 color;\n'+source+'\nvoid main(){color=vec4(cloudAerialTransmittance(u_path.x,u_path.y,u_path.z),1.);}']]){const sh=gl.createShader(t);gl.shaderSource(sh,s);gl.compileShader(sh);gl.attachShader(p,sh)}gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p)
  const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,1,1,0,gl.RGBA,gl.FLOAT,null);const target=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,target);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0)
  return fixtures.map(f=>{gl.uniform3fv(gl.getUniformLocation(p,'u_path'),f.input);gl.drawArrays(gl.TRIANGLES,0,3);const pixel=new Float32Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.FLOAT,pixel);return {...f,actual:[...pixel].slice(0,3),glError:gl.getError()}})
 },{source,fixtures})
 for(const result of results){assert.equal(result.glError,0,result.name);assert(result.actual.every(v=>Number.isFinite(v)&&v>=0&&v<=1),JSON.stringify(result))}
 const close=(a,b)=>a.every((v,i)=>Math.abs(v-b[i])<2e-5)
 assert(close(results[0].actual,[1,1,1]));assert(close(results[7].actual,[1,1,1]))
 assert(close(results[1].actual,[5.8e-6,13.5e-6,33.1e-6].map(c=>Math.exp(-(c+4.44e-6)*1000))))
 assert(results[2].actual.every((v,i)=>v>results[1].actual[i]))
 assert(close(results[3].actual,results[4].actual))
 assert(results[5].actual.every(v=>v>.5&&v<1))
 assert(close(results[6].actual,results[1].actual));assert(close(results[8].actual,results[1].actual))
 assert(results[1].actual[0]>results[1].actual[1]&&results[1].actual[1]>results[1].actual[2])
 await fs.mkdir('test-results/cloud-startup-20261026',{recursive:true});await fs.writeFile('test-results/cloud-startup-20261026/fast-lighting-gpu.json',JSON.stringify({passed:true,checks:results},null,2));console.log(JSON.stringify({passed:true,checks:results.length}))
}finally{await browser.close()}
