import { describe, expect, it } from 'vitest'
import { createFloodSurfaceState } from '../surface-state'
const grid = {
  columns: 3,
  rows: 2,
  cellSize: 1,
  origin: [0, 0, 0] as [number, number, number],
  elevation: [0, 0, 3, 0, 0, 3],
}
const frame = { time: 0, depth: [2, 2, 0, 2, 2, 0] }
describe('visual shoreline interpolation', () => {
  it('keeps the water stage flat and clips a dry raised bank using signed depth', () => {
    const before = JSON.stringify({ grid, frame }),
      state = createFloodSurfaceState(grid, frame)
    expect(state.heights[2]).toBeCloseTo(2.035)
    expect(state.depths[2]).toBe(-1)
    expect(state.depths[1]).toBe(2)
    expect(JSON.stringify({ grid, frame })).toBe(before)
  })
  it('preserves the barrier path and keeps wholly dry domains dry', () => {
    expect(createFloodSurfaceState(grid, frame, false).heights[2]).toBeCloseTo(
      3.035,
    )
    expect(
      createFloodSurfaceState(grid, {
        time: 0,
        depth: new Array(6).fill(0),
      }).depths.every((h) => h === 0),
    ).toBe(true)
  })
})
