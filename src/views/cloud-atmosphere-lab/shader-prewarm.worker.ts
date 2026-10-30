import type { ShaderWarmupReport, StartupShaderProgram } from './shader-prewarm'

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<StartupShaderProgram[]>) => void) | null
  postMessage(value: ShaderWarmupReport): void
}
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 8))
function required<T>(value: T | null): T { if (value === null) throw new Error('GPU allocation failed'); return value }

scope.onmessage = async ({ data: sources }) => {
  const started = performance.now()
  const gl = new OffscreenCanvas(1, 1).getContext('webgl2', { powerPreference: 'high-performance' })
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) {
    scope.postMessage({ status: 'unavailable', durationMs: performance.now() - started }); return
  }
  gl.getExtension('OES_texture_float_linear')
  const parallel = gl.getExtension('KHR_parallel_shader_compile')
  if (!parallel) { scope.postMessage({ status: 'unavailable', durationMs: performance.now() - started }); return }
  const programs: WebGLProgram[] = [], shaders: WebGLShader[] = [], textures: WebGLTexture[] = [], framebuffers: WebGLFramebuffer[] = []
  let vao: WebGLVertexArrayObject | null = null, buffer: WebGLBuffer | null = null, fence: WebGLSync | null = null
  try {
    for (const source of sources) {
      const program = required(gl.createProgram()); programs.push(program)
      for (const [type, text] of [[gl.VERTEX_SHADER, source.vertexSource], [gl.FRAGMENT_SHADER, source.fragmentSource]] as const) {
        const shader = required(gl.createShader(type)); shaders.push(shader)
        gl.shaderSource(shader, text); gl.compileShader(shader); gl.attachShader(program, shader)
      }
      for (const [name, location] of Object.entries(source.attributes)) gl.bindAttribLocation(program, location, name)
      gl.linkProgram(program)
    }
    gl.flush()
    while (programs.some(program => !gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR))) {
      if (gl.isContextLost()) throw new Error('Warmup context lost')
      await pause()
    }
    for (const program of programs) if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Shader link failed')

    // Warm the first driver submission too. This isolated context owns all GL
    // state and 1x1 dummy targets; no Viewer textures or scene state are touched.
    vao = required(gl.createVertexArray()); buffer = required(gl.createBuffer())
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,0,0,1,-1,1,0,-1,1,0,1,1,1,1,1]), gl.STATIC_DRAW)
    for (let i = 0; i < 2; i++) { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, 2, gl.FLOAT, false, 16, i * 8) }
    for (const [unit, target] of [[0, gl.TEXTURE_2D], [1, gl.TEXTURE_3D]] as const) {
      const texture = required(gl.createTexture()); textures.push(texture)
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(target, texture)
      gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      if (target === gl.TEXTURE_2D) gl.texImage2D(target, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
      else gl.texImage3D(target, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
    }
    for (let index = 0; index < programs.length; index++) {
      const program = programs[index]!, source = sources[index]!
      gl.useProgram(program)
      const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number
      for (let i = 0; i < count; i++) {
        const uniform = required(gl.getActiveUniform(program, i))
        if (uniform.type === gl.SAMPLER_2D || uniform.type === gl.SAMPLER_3D) {
          if (uniform.size !== 1) throw new Error('Unsupported sampler array')
          gl.uniform1i(gl.getUniformLocation(program, uniform.name), uniform.type === gl.SAMPLER_3D ? 1 : 0)
        }
      }
      const framebuffer = required(gl.createFramebuffer()); framebuffers.push(framebuffer)
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      const attachments: number[] = []
      for (let i = 0; i < source.colorAttachments; i++) {
        const texture = required(gl.createTexture()); textures.push(texture)
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        const format = source.pixelType === 'byte' ? gl.RGBA8 : source.pixelType === 'half' ? gl.RGBA16F : gl.RGBA32F
        const type = source.pixelType === 'byte' ? gl.UNSIGNED_BYTE : source.pixelType === 'half' ? gl.HALF_FLOAT : gl.FLOAT
        gl.texImage2D(gl.TEXTURE_2D, 0, format, 1, 1, 0, gl.RGBA, type, null)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, texture, 0)
        attachments.push(gl.COLOR_ATTACHMENT0 + i)
      }
      gl.drawBuffers(attachments)
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete warmup framebuffer')
    }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, textures[0]!)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, textures[1]!)
    gl.viewport(0, 0, 1, 1)
    // No synchronous GL queries between the first draw and the completion fence.
    for (let i = 0; i < programs.length; i++) {
      gl.useProgram(programs[i]!); gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[i]!); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    fence = required(gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)); gl.flush()
    let fenceStatus = gl.clientWaitSync(fence, 0, 0)
    while (fenceStatus === gl.TIMEOUT_EXPIRED) {
      if (gl.isContextLost()) throw new Error('Warmup context lost')
      await pause()
      fenceStatus = gl.clientWaitSync(fence, 0, 0)
    }
    if (fenceStatus === gl.WAIT_FAILED) throw new Error('Warmup fence failed')
    if (gl.getError() !== gl.NO_ERROR) throw new Error('Warmup GL error')
    scope.postMessage({ status: 'ready', durationMs: performance.now() - started })
  } catch (error) {
    scope.postMessage({ status: 'failed', durationMs: performance.now() - started, detail: String(error) })
  } finally {
    if (fence) gl.deleteSync(fence)
    if (buffer) gl.deleteBuffer(buffer)
    if (vao) gl.deleteVertexArray(vao)
    for (const value of framebuffers) gl.deleteFramebuffer(value)
    for (const value of textures) gl.deleteTexture(value)
    for (const value of programs) gl.deleteProgram(value)
    for (const value of shaders) gl.deleteShader(value)
  }
}
