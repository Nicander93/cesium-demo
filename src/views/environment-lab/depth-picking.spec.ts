import { describe, expect, it } from 'vitest'
import { acquireDepthPicking } from './depth-picking'

function createScene(initial: boolean) {
  let value = initial
  let destroyed = false
  const writes: boolean[] = []
  const scene = {
    get useDepthPicking() {
      return value
    },
    set useDepthPicking(next: boolean) {
      value = next
      writes.push(next)
    },
    isDestroyed: () => destroyed,
  }
  return {
    scene,
    writes,
    destroy() {
      destroyed = true
    },
  }
}

describe('depth-picking leases', () => {
  it('restores the initial value only after every concurrent lease releases', () => {
    const test = createScene(false)
    const releaseFirst = acquireDepthPicking(test.scene)
    const releaseSecond = acquireDepthPicking(test.scene)

    expect(test.scene.useDepthPicking).toBe(true)
    releaseSecond()
    expect(test.scene.useDepthPicking).toBe(true)
    releaseFirst()
    expect(test.scene.useDepthPicking).toBe(false)
    expect(test.writes).toEqual([true, false])
  })

  it('restores a scene whose initial depth-picking value was true', () => {
    const test = createScene(true)
    const release = acquireDepthPicking(test.scene)

    release()

    expect(test.scene.useDepthPicking).toBe(true)
    expect(test.writes).toEqual([true, true])
  })

  it('ignores repeated releases and does not write to a destroyed scene', () => {
    const test = createScene(false)
    const release = acquireDepthPicking(test.scene)

    test.destroy()
    release()
    release()

    expect(test.scene.useDepthPicking).toBe(true)
    expect(test.writes).toEqual([true])
  })
})
