import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
const { unrollLoops } = await import('../src/vendor/cesium-geospatial/core/unrollLoops.ts')
const root = fileURLToPath(new URL('../src/vendor/cesium-geospatial/', import.meta.url))
let source = await fs.readFile(root + 'clouds/glsl/cloudsResolve.frag', 'utf8')
for (const [name, file] of [['core/turbo', 'core/glsl/turbo.glsl'], ['catmullRomSampling', 'clouds/glsl/catmullRomSampling.glsl'], ['varianceClipping', 'clouds/glsl/varianceClipping.glsl']]) {
  source = source.replace('#include "' + name + '"', await fs.readFile(root + file, 'utf8'))
}
source = unrollLoops(source)
const { chromium } = process.env.PLAYWRIGHT_MODULE_PATH ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href) : await import('playwright')
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH, args: ['--enable-webgl', '--ignore-gpu-blocklist'] })
try {
  const page = await browser.newPage()
  const results = await page.evaluate(source => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64
    const gl = canvas.getContext('webgl2')
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw new Error('Float WebGL2 required')
    function shader(type, text) {
      const shader = gl.createShader(type); gl.shaderSource(shader, text); gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader))
      return shader
    }
    const vertex = shader(gl.VERTEX_SHADER, `#version 300 es
      out vec2 vUv; void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vUv=p;gl_Position=vec4(p*2.0-1.0,0,1);}`)
    function texture(w, h, values) {
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, values ?? null)
      return tex
    }
    const fbo = gl.createFramebuffer(), results = []
    const table = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5]
    const truth = (x,y) => {
      const a = x < 32 ? 0.25 : 0.85
      return [a*(0.4+0.2*Math.sin(x*0.7)), a*(0.5+0.1*Math.cos(y*0.5)),a*0.3,a]
    }
    for (const divisor of [2,4]) {
      const low = 64/divisor
      const program = gl.createProgram(); gl.attachShader(program, vertex)
      gl.attachShader(program, shader(gl.FRAGMENT_SHADER, '#version 300 es\n#define TEMPORAL_UPSCALE\n#define UPSCALE_DIVISOR '+divisor+'\n'+source))
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program))
      gl.useProgram(program)
      const uniform = name => gl.getUniformLocation(program, name)
      gl.uniform1i(uniform('colorBuffer'), 0);gl.uniform1i(uniform('depthVelocityBuffer'), 1);gl.uniform1i(uniform('colorHistoryBuffer'), 2)
      gl.uniform2f(uniform('texelSize'),1/64,1/64);gl.uniform1f(uniform('temporalAlpha'),.1)
      gl.uniform1f(uniform('varianceGamma'),2);gl.uniform1f(uniform('temporalDisocclusion'),.5)
      gl.uniform1i(uniform('u_accumulateUpscaleHistory'),1)
      const values = new Float32Array(low*low*4), depths = new Float32Array(low*low*4)
      for(let i=0;i<low*low;i++)depths[i*4]=100
      const input=texture(low,low,values),depth=texture(low,low,depths)
      const history=[texture(64,64),texture(64,64)]
      const frames=divisor*divisor*96
      for(let frame=0;frame<frames;frame++){
        const phase=frame%(divisor*divisor)
        const pixel=divisor===2?[0,3,1,2][phase]:table.indexOf(phase)
        const px=pixel%divisor,py=Math.floor(pixel/divisor)
        for(let y=0;y<low;y++)for(let x=0;x<low;x++){
          const observed=truth(x*divisor+px,y*divisor+py)
          // Deterministic zero-mean noise independent of the spatial phase.
          const noise=((Math.floor(frame/(divisor*divisor))%2)*2-1)*.12
          values.set(observed.map(v=>v+noise),(y*low+x)*4)
        }
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,input)
        gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,low,low,gl.RGBA,gl.FLOAT,values)
        gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,depth)
        gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,history[frame%2])
        gl.bindFramebuffer(gl.FRAMEBUFFER,fbo)
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,history[1-frame%2],0)
        gl.uniform1i(uniform('frame'),frame);gl.uniform1i(uniform('u_staticSampleCount'),frame===0?0:-1)
        gl.uniform2f(uniform('jitterOffset'),((px+.5)/divisor-.5)/low,((py+.5)/divisor-.5)/low)
        gl.viewport(0,0,64,64);gl.drawArrays(gl.TRIANGLES,0,3)
      }
      const output=new Float32Array(64*64*4);gl.readPixels(0,0,64,64,gl.RGBA,gl.FLOAT,output)
      let error=0,alphaError=0
      for(let y=0;y<64;y++)for(let x=0;x<64;x++){
        const expected=truth(x,y)
        for(let c=0;c<4;c++)error+=(output[(y*64+x)*4+c]-expected[c])**2
        alphaError=Math.max(alphaError,Math.abs(output[(y*64+x)*4+3]-expected[3]))
      }
      results.push({divisor,rmse:Math.sqrt(error/output.length),alphaError,glError:gl.getError(),finite:output.every(Number.isFinite)})
      const whiteHistory = new Float32Array(64*64*4).fill(1)
      gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,history[0])
      gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,64,64,gl.RGBA,gl.FLOAT,whiteHistory)
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,input)
      gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,low,low,gl.RGBA,gl.FLOAT,new Float32Array(low*low*4))
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,history[1],0)
      gl.uniform1i(uniform('frame'),0);gl.uniform1i(uniform('u_staticSampleCount'),-1)
      gl.uniform1i(uniform('u_cameraMoving'),1)
      gl.drawArrays(gl.TRIANGLES,0,3)
      gl.readPixels(0,0,64,64,gl.RGBA,gl.FLOAT,output)
      const anchorAlpha=Math.max(...output.filter((v,i)=>i%4===3))
      if(anchorAlpha>1e-6)throw new Error('Stationary orbit anchor kept a white cloud history: '+anchorAlpha)
      results.at(-1).orbitAnchorAlpha=anchorAlpha
      for(const tex of [input,depth,...history])gl.deleteTexture(tex)
      gl.deleteProgram(program)
    }
    return results
  }, source)
  for(const result of results){assert.equal(result.glError,0);assert(result.finite);assert(result.rmse<.02,JSON.stringify(result));assert(result.alphaError<.02,JSON.stringify(result))}
  if (process.env.CLOUD_RECONSTRUCTION_REPORT) await fs.writeFile(process.env.CLOUD_RECONSTRUCTION_REPORT, JSON.stringify({passed:true,results},null,2))
  console.log(JSON.stringify({passed:true,results}))
}finally{await browser.close()}
