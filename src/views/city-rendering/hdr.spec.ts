import { describe, expect, it, vi } from 'vitest'
import { moveToneMappingToEnd, type PostProcessExecution } from './hdr'

describe('linear HDR cloud integration', () => {
  it('bypasses the early tone pass only while clouds are active, preserving the receiver and return value', () => {
    let active = false
    const execute = vi.fn(function (this: PostProcessExecution) {
      return this._tonemapping.enabled
    })
    const collection = { _tonemapping: { enabled: true }, execute }
    const restore = moveToneMappingToEnd(collection, () => active)
    expect(collection.execute()).toBe(true)
    active = true
    expect(collection.execute()).toBe(false)
    expect(collection._tonemapping.enabled).toBe(true)
    restore()
    expect(collection.execute).toBe(execute)
  })
  it('restores Cesium state when a GPU execution throws', () => {
    const collection = {
      _tonemapping: { enabled: true },
      execute: () => {
        throw new Error('shader failed')
      },
    }
    const restore = moveToneMappingToEnd(collection, () => true)
    expect(() => collection.execute()).toThrow('shader failed')
    expect(collection._tonemapping.enabled).toBe(true)
    restore()
  })
})
