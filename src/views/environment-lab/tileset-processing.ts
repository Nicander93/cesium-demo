import type { Cesium3DTileset } from 'cesium'

interface ProcessingTile {
  _contentState: unknown
  isDestroyed(): boolean
}

interface ProcessingTileset {
  _processingQueue: ProcessingTile[]
  prePassesUpdate: (this: ProcessingTileset, ...args: unknown[]) => void
  isDestroyed(): boolean
}

/** Limit Cesium 1.132's synchronous processing queue without replacing its tile logic. */
export function limitTilesetProcessing(
  tileset: Cesium3DTileset,
  maxTilesPerFrame = 1,
): () => void {
  const frameLimit = Number.isFinite(maxTilesPerFrame)
    ? Math.max(1, Math.floor(maxTilesPerFrame))
    : 1
  const target = tileset as unknown as ProcessingTileset
  const original = target.prePassesUpdate
  if (typeof original !== 'function')
    throw new Error('Cesium 1.132 tileset prePassesUpdate is unavailable')

  const limited: ProcessingTileset['prePassesUpdate'] = function (...args) {
    if (this.isDestroyed()) return
    const queue = this._processingQueue
    if (queue.length === 0) {
      original.apply(this, args)
      return
    }

    const selected = queue.splice(0, frameLimit)
    const deferred = queue.splice(0, queue.length)
    const selectedStates = selected.map((tile) => tile._contentState)
    const additions: ProcessingTile[] = []
    const originalPush = queue.push
    const pushDescriptor = Object.getOwnPropertyDescriptor(queue, 'push')
    originalPush.apply(queue, selected)
    Object.defineProperty(queue, 'push', {
      configurable: true,
      writable: true,
      value: (...tiles: ProcessingTile[]) => {
        additions.push(...tiles)
        return queue.length + additions.length
      },
    })
    try {
      original.apply(this, args)
    } finally {
      const current = this._processingQueue.splice(
        0,
        this._processingQueue.length,
      )
      if (pushDescriptor) Object.defineProperty(queue, 'push', pushDescriptor)
      else {
        const mutableQueue = queue as unknown as {
          push?: (...tiles: ProcessingTile[]) => number
        }
        delete mutableQueue.push
      }
      const selectedSet = new Set(selected)
      const merged = [...deferred]
      const mergedSet = new Set(deferred)
      for (let index = 0; index < selected.length; index++) {
        const tile = selected[index]
        if (
          !tile.isDestroyed() &&
          tile._contentState === selectedStates[index] &&
          !mergedSet.has(tile)
        ) {
          merged.push(tile)
          mergedSet.add(tile)
        }
      }
      for (const tile of current) {
        if (!selectedSet.has(tile) && !mergedSet.has(tile)) {
          merged.push(tile)
          mergedSet.add(tile)
        }
      }
      for (const tile of additions) {
        if (!selectedSet.has(tile) && !mergedSet.has(tile)) {
          merged.push(tile)
          mergedSet.add(tile)
        }
      }
      originalPush.apply(queue, merged)
    }
  }

  target.prePassesUpdate = limited
  let released = false
  return () => {
    if (released) return
    released = true
    if (!target.isDestroyed() && target.prePassesUpdate === limited)
      target.prePassesUpdate = original
  }
}
