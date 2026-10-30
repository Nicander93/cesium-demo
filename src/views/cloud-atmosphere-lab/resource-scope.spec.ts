import { describe, expect, it, vi } from 'vitest'
import { createWithResourceScope } from '../../vendor/cesium-geospatial/core/resourceScope'

function resource(destroy = vi.fn()) {
  return { destroy, isDestroyed: () => false }
}

describe('transactional GPU resource allocation', () => {
  it('destroys earlier allocations when a later constructor fails', async () => {
    const first = resource()
    const second = resource()
    const allocation = vi.fn()

    await expect(createWithResourceScope((own) => {
      allocation()
      own(first)
      allocation()
      own(second)
      allocation()
      throw new Error('third texture constructor failed')
    })).rejects.toThrow('third texture constructor failed')

    expect(allocation).toHaveBeenCalledTimes(3)
    expect(second.destroy).toHaveBeenCalledOnce()
    expect(first.destroy).toHaveBeenCalledOnce()
  })

  it('keeps resources alive when the allocation transaction succeeds', async () => {
    const texture = resource()
    await expect(createWithResourceScope((own) => own(texture))).resolves.toBe(texture)
    expect(texture.destroy).not.toHaveBeenCalled()
  })
})
