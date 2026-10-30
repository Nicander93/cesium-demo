import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prewarmShaders } from './shader-prewarm'

class TestWorker {
  static instances: TestWorker[] = []
  onmessage?: (event: MessageEvent) => void
  onerror?: () => void
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() { TestWorker.instances.push(this) }
}

beforeEach(() => {
  vi.useFakeTimers()
  TestWorker.instances = []
  vi.stubGlobal('Worker', TestWorker)
  vi.stubGlobal('OffscreenCanvas', class {})
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('optional GPU startup warmup', () => {
  it('falls back without creating a worker when unavailable', async () => {
    vi.stubGlobal('OffscreenCanvas', undefined)
    expect(await prewarmShaders([], new AbortController().signal)).toMatchObject({ status: 'unavailable' })
    expect(TestWorker.instances).toHaveLength(0)
  })
  it('releases its worker and timeout after a successful warmup', async () => {
    const controller = new AbortController(), pending = prewarmShaders([], controller.signal)
    const worker = TestWorker.instances[0]!
    worker.onmessage?.({ data: { status: 'ready', durationMs: 1 } } as MessageEvent)
    expect(await pending).toMatchObject({ status: 'ready' })
    controller.abort()
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cancels an obsolete provider before disposing its Viewer', async () => {
    const controller = new AbortController(), pending = prewarmShaders([], controller.signal)
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort(); await rejection
    expect(TestWorker.instances[0]!.terminate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('does not start work for an already cancelled request', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(prewarmShaders([], controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(TestWorker.instances).toHaveLength(0)
  })
  it('bounds optional preparation time and resumes the normal renderer', async () => {
    const pending = prewarmShaders([], new AbortController().signal)
    await vi.advanceTimersByTimeAsync(1500)
    expect(await pending).toMatchObject({ status: 'timeout' })
    expect(TestWorker.instances[0]!.terminate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cleans up failed workers without failing cloud rendering', async () => {
    const pending = prewarmShaders([], new AbortController().signal)
    TestWorker.instances[0]!.onerror?.()
    expect(await pending).toMatchObject({ status: 'failed' })
    expect(TestWorker.instances[0]!.terminate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('releases the worker if startup data cannot be posted', async () => {
    vi.stubGlobal('Worker', class extends TestWorker {
      constructor() { super(); this.postMessage.mockImplementation(() => { throw new Error('post failed') }) }
    })
    expect(await prewarmShaders([], new AbortController().signal)).toMatchObject({ status: 'failed' })
    expect(TestWorker.instances[0]!.terminate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
