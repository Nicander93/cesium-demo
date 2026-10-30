import { describe, expect, it } from 'vitest'
import { sampleHeightGrid, sampleSlopeGrid, type HeightGrid } from './height-grid'

const grid: HeightGrid = { halfSize: 10, divisions: 2, heights: new Float64Array([-5, 0, 5, -5, 0, 5, -5, 0, 5]) }
describe('terrain height preview', () => {
  it('interpolates a slope and handles all field boundaries', () => {
    expect(sampleHeightGrid(grid, 3, -4)).toBeCloseTo(1.5)
    expect(sampleHeightGrid(grid, 10, 10)).toBe(5)
    expect(sampleHeightGrid(grid, -10, -10)).toBe(-5)
    expect(sampleSlopeGrid(grid, 0, 0)).toBeCloseTo(Math.atan(0.5) * 180 / Math.PI)
    expect(sampleSlopeGrid(grid, 10, 10)).toBeCloseTo(Math.atan(0.5) * 180 / Math.PI)
  })
  it('rejects missing data and locations outside the sampled area', () => {
    expect(sampleHeightGrid(grid, 10.01, 0)).toBeUndefined()
    expect(sampleHeightGrid(grid, NaN, 0)).toBeUndefined()
    expect(sampleHeightGrid({ ...grid, heights: new Float64Array(9).fill(NaN) }, 0, 0)).toBeUndefined()
  })
})
