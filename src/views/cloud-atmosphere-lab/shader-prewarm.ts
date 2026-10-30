export interface StartupShaderProgram {
  name: string
  vertexSource: string
  fragmentSource: string
  attributes: Record<string, number>
  colorAttachments: number
  pixelType: 'byte' | 'half' | 'float'
}

export interface ShaderWarmupReport {
  status: 'ready' | 'unavailable' | 'failed' | 'timeout'
  durationMs: number
  detail?: string
}

/** A cache hint only: the normal Cesium path remains responsible for rendering. */
export function prewarmShaders(programs: StartupShaderProgram[], signal: AbortSignal): Promise<ShaderWarmupReport> {
  if (signal.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'))
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    return Promise.resolve({ status: 'unavailable', durationMs: 0 })
  }
  return new Promise((resolve, reject) => {
    const started = performance.now()
    let settled = false
    let worker: Worker
    try { worker = new Worker(new URL('./shader-prewarm.worker.ts', import.meta.url), { type: 'module' }) }
    catch { resolve({ status: 'unavailable', durationMs: performance.now() - started }); return }
    function cleanup() {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      worker.terminate()
    }
    function finish(result: ShaderWarmupReport) { if (settled) return; settled = true; cleanup(); resolve(result) }
    function abort() { if (settled) return; settled = true; cleanup(); reject(new DOMException('aborted', 'AbortError')) }
    const timeout = setTimeout(() => finish({ status: 'timeout', durationMs: performance.now() - started }), 1500)
    signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<ShaderWarmupReport>) => finish({ ...event.data, durationMs: performance.now() - started })
    worker.onerror = () => finish({ status: 'failed', durationMs: performance.now() - started, detail: 'Worker failed' })
    try { worker.postMessage(programs) }
    catch { finish({ status: 'failed', durationMs: performance.now() - started, detail: 'Worker message failed' }) }
  })
}
