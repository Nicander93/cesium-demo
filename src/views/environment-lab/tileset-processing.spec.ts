import { describe, expect, it } from 'vitest'
import { limitTilesetProcessing } from './tileset-processing'

interface FakeTile {
  id: string
  _contentState: number
  steps: number
  destroyed: boolean
  isDestroyed(): boolean
}

interface FakeTileset {
  _processingQueue: FakeTile[]
  isDestroyed(): boolean
  prePassesUpdate(): void
  processingOrder: string[]
  queuedDuringNextPass?: FakeTile
  throwBeforeProcessing: boolean
}

function createTile(id: string): FakeTile {
  return {
    id,
    _contentState: 2,
    steps: 0,
    destroyed: false,
    isDestroyed() {
      return this.destroyed
    },
  }
}

function createTileset(tiles: FakeTile[]): FakeTileset {
  const tileset: FakeTileset = {
    _processingQueue: [...tiles],
    processingOrder: [],
    throwBeforeProcessing: false,
    isDestroyed: () => false,
    prePassesUpdate() {
      if (this.throwBeforeProcessing) throw new Error('processing failed')
      const queue = this._processingQueue
      for (let index = 0; index < queue.length; ) {
        const tile = queue[index]
        if (tile.isDestroyed() || tile._contentState !== 2) {
          queue.splice(index, 1)
          continue
        }
        this.processingOrder.push(tile.id)
        tile.steps++
        if (tile.steps >= 2) tile._contentState = 3
        index++
      }
      if (this.queuedDuringNextPass) {
        queue.push(this.queuedDuringNextPass)
        this.queuedDuringNextPass = undefined
      }
    },
  }
  return tileset
}

describe('tileset processing frame limit', () => {
  it('rotates pending tasks and eventually processes every tile', () => {
    const tiles = [createTile('a'), createTile('b'), createTile('c')]
    const tileset = createTileset(tiles)
    const release = limitTilesetProcessing(tileset as never, 1)

    for (let frame = 0; frame < 7; frame++) tileset.prePassesUpdate()

    expect(tileset.processingOrder).toEqual(['a', 'b', 'c', 'a', 'b', 'c'])
    expect(tiles.map((tile) => tile.steps)).toEqual([2, 2, 2])
    expect(tileset._processingQueue).toHaveLength(0)
    release()
  })

  it('preserves tasks enqueued while the selected task is processing', () => {
    const tiles = [createTile('a'), createTile('b')]
    const tileset = createTileset(tiles)
    const newTile = createTile('c')
    tileset.queuedDuringNextPass = newTile
    const release = limitTilesetProcessing(tileset as never, 1)

    tileset.prePassesUpdate()

    expect(tileset._processingQueue.map((tile) => tile.id)).toEqual([
      'b',
      'a',
      'c',
    ])
    for (let frame = 0; frame < 5; frame++) tileset.prePassesUpdate()
    expect(tileset.processingOrder).toContain('c')
    expect(newTile.steps).toBe(2)
    release()
  })

  it('preserves the queue after an exception and restores the original method', () => {
    const tileset = createTileset([createTile('a'), createTile('b')])
    const original = tileset.prePassesUpdate
    const release = limitTilesetProcessing(tileset as never, 1)
    tileset.throwBeforeProcessing = true

    expect(() => tileset.prePassesUpdate()).toThrow('processing failed')
    expect(tileset._processingQueue.map((tile) => tile.id)).toEqual(['b', 'a'])

    release()
    expect(tileset.prePassesUpdate).toBe(original)
    tileset.throwBeforeProcessing = false
    tileset.prePassesUpdate()
    expect(tileset.processingOrder).toContain('a')
    expect(tileset.processingOrder).toContain('b')
  })
})
