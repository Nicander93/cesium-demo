import { describe, expect, it } from 'vitest'
import { FloodFoam, resolveFloodVisualOptions } from '../foam'
import type { FloodFrame, FloodGrid } from '../../core/dataset'

const grid: FloodGrid = { columns: 6, rows: 3, cellSize: 1, origin: [0, 0, 0], elevation: new Array(18).fill(0) }
function frame(time: number, east = 0, north = 0): FloodFrame {
  return { time, depth: new Array(18).fill(2), velocityEast: new Array(18).fill(east), velocityNorth: new Array(18).fill(north) }
}

describe('visual foam transport', () => {
  it('transports a patch east and decays without modifying hydraulic data', () => {
    const foam = new FloodFoam(grid)
    foam.update(frame(0, 1), 18)
    foam.coverage[7] = 1
    const next = frame(0.2, 1)
    const input = JSON.stringify(next)
    foam.update(next, 18)
    expect(foam.coverage[8]).toBeGreaterThan(0)
    expect(foam.coverage[6]).toBe(0)
    expect(foam.coverage.reduce((a, b) => a + b, 0)).toBeCloseTo(Math.exp(-0.2 / 18), 5)
    expect(JSON.stringify(next)).toBe(input)
  })

  it('supports negative north velocities without assuming downstream is north', () => {
    const foam = new FloodFoam(grid)
    foam.update(frame(0, 0, -1), 18)
    foam.coverage[8] = 1
    foam.update(frame(0.2, 0, -1), 18)
    expect(foam.coverage[2]).toBeGreaterThan(0)
    expect(foam.coverage[14]).toBe(0)
  })

  it('blocks transport across dry cells and walls until overtopped', () => {
    const barriers = { east: new Array(21).fill(null), north: new Array(24).fill(null) }
    barriers.east[9] = 3
    const foam = new FloodFoam(grid, barriers)
    foam.update(frame(0, 1), 18)
    foam.coverage[7] = 1
    foam.update(frame(0.2, 1), 18)
    expect(foam.coverage[8]).toBe(0)
    const wet = frame(0.4, 1)
    wet.depth.fill(4)
    foam.update(wet, 18)
    expect(foam.coverage[8]).toBeGreaterThan(0)
    const dry = frame(0.6, 1)
    dry.depth[8] = 0
    foam.update(dry, 18)
    expect(foam.coverage[8]).toBe(0)
  })

  it('generates in shallow moving water, but not in still deep water', () => {
    const foam = new FloodFoam(grid)
    foam.update(frame(0), 18)
    foam.update(frame(1), 18)
    expect(foam.coverage.every(x => x === 0)).toBe(true)
    const rapid = frame(2, 2)
    rapid.depth.fill(0.2)
    foam.update(rapid, 18)
    expect(foam.coverage.some(x => x > 0)).toBe(true)
    expect(foam.coverage.every(x => Number.isFinite(x) && x >= 0 && x <= 1)).toBe(true)
  })

  it('freezes at the same time and clears on seek, missing velocity and reset', () => {
    const foam = new FloodFoam(grid)
    foam.update(frame(10), 18)
    foam.coverage[7] = 0.5
    foam.update(frame(10), 18)
    expect(foam.coverage[7]).toBe(0.5)
    foam.update(frame(5), 18)
    expect(foam.coverage[7]).toBe(0)
    foam.coverage[7] = 0.5
    foam.update({ time: 6, depth: new Array(18).fill(2) }, 18)
    expect(foam.coverage[7]).toBe(0)
    foam.coverage[7] = 0.5
    foam.reset()
    expect(foam.coverage[7]).toBe(0)
  })

  it('rejects invalid API options before returning a changed configuration', () => {
    const current = resolveFloodVisualOptions({})
    expect(() => resolveFloodVisualOptions({ foam: false, foamLifetime: 0 }, current)).toThrow()
    expect(current.foam).toBe(true)
    expect(() => resolveFloodVisualOptions({ foamIntensity: Number.NaN })).toThrow()
  })

  it('clears discontinuous jumps and bounds fast divergent transport', () => {
    const foam = new FloodFoam(grid)
    foam.update(frame(0), 18)
    foam.coverage[7] = 1
    foam.update(frame(31), 18)
    expect(foam.coverage[7]).toBe(0)
    const fast = frame(32, 15, -12)
    foam.update(fast, 18)
    expect(foam.coverage.every(x => Number.isFinite(x) && x >= 0 && x <= 1)).toBe(true)
    const invalidCells = { ...grid, active: new Array(18).fill(true) }
    invalidCells.active[8] = false
    const isolated = new FloodFoam(invalidCells)
    isolated.update(frame(0, 1), 18)
    isolated.coverage[7] = 1
    isolated.update(frame(0.2, 1), 18)
    expect(isolated.coverage[8]).toBe(0)
  })
})
