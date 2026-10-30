import { describe, expect, it } from 'vitest'
import { srgbToLinearColor } from './gltf-color'

describe('GLB authored palette', () => {
  it('converts known sRGB values while preserving alpha', () => {
    const linear = srgbToLinearColor([0.5, 0.04045, 1, 0.35])
    expect(linear[0]).toBeCloseTo(0.21404114, 7)
    expect(linear[1]).toBeCloseTo(0.003130805, 8)
    expect(linear[2]).toBe(1)
    expect(linear[3]).toBe(0.35)
    expect(srgbToLinearColor([0, 0, 0, 1])).toEqual([0, 0, 0, 1])
  })
})
