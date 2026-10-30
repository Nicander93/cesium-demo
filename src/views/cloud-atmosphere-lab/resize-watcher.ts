export interface DrawingBufferSize {
  width: number
  height: number
}

export interface DebouncedSizeWatcher {
  schedule(): void
  reset(size: DrawingBufferSize): void
  dispose(): void
}

export function sameDrawingBufferSize(a: DrawingBufferSize, b: DrawingBufferSize): boolean {
  return a.width === b.width && a.height === b.height
}

export function createDebouncedSizeWatcher(
  measure: () => DrawingBufferSize,
  onChange: (next: DrawingBufferSize, previous: DrawingBufferSize) => void,
  delayMs = 180,
): DebouncedSizeWatcher {
  let last = measure()
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  function clearTimer() {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
  }

  return {
    schedule() {
      if (disposed) return
      clearTimer()
      timer = setTimeout(() => {
        timer = undefined
        if (disposed) return
        const next = measure()
        if (sameDrawingBufferSize(last, next)) return
        const previous = last
        last = next
        onChange(next, previous)
      }, delayMs)
    },
    reset(size) {
      if (disposed) return
      clearTimer()
      last = { ...size }
    },
    dispose() {
      disposed = true
      clearTimer()
    },
  }
}
