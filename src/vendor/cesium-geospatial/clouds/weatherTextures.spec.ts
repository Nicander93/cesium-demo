import { describe, expect, it } from 'vitest'
import { buildR8VolumeMipLevels } from './weatherTextures'

describe('R8 volume mip levels', () => {
  it('box-filters each 2×2×2 block and returns a complete chain', () => {
    const levels = buildR8VolumeMipLevels(new Uint8Array(Array.from({ length: 4 ** 3 }, (_, index) => index)), 4)
    expect(levels.map((level) => level.length)).toEqual([8, 1])
    expect(levels[1]![0]).toBe(32)
  })

  it('rejects non-cubic or non-power-of-two inputs', () => {
    expect(() => buildR8VolumeMipLevels(new Uint8Array(8), 3)).toThrow('cubic power-of-two')
    expect(() => buildR8VolumeMipLevels(new Uint8Array(7), 2)).toThrow('cubic power-of-two')
  })
})
