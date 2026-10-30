import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDebouncedSizeWatcher } from './resize-watcher'

afterEach(() => vi.useRealTimers())

describe('drawing buffer resize watcher', () => {
  it('debounces size changes, emits only actual dimensions, and cancels pending work on dispose', () => {
    vi.useFakeTimers()
    let size = { width: 800, height: 600 }
    const onChange = vi.fn()
    const watcher = createDebouncedSizeWatcher(() => size, onChange, 180)

    watcher.schedule()
    size = { width: 1024, height: 768 }
    watcher.schedule()
    size = { width: 1280, height: 720 }
    vi.advanceTimersByTime(179)
    expect(onChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith({ width: 1280, height: 720 }, { width: 800, height: 600 })

    watcher.schedule()
    vi.advanceTimersByTime(180)
    expect(onChange).toHaveBeenCalledOnce()

    watcher.schedule()
    size = { width: 1600, height: 900 }
    watcher.dispose()
    vi.advanceTimersByTime(180)
    expect(onChange).toHaveBeenCalledOnce()
  })
})
