import { describe, expect, it } from 'vitest'
import type { FloodGrid, FloodFrame } from '../../core/dataset'
import { computeFloodLocalFoamSources, FloodFoam, resolveFloodVisualOptions } from '../foam'

const grid: FloodGrid = { columns: 7, rows: 7, cellSize: 1, origin: [0, 0, 0], elevation: new Array(49).fill(0) }
function frame(time = 0): FloodFrame {
  return { time, depth: new Array(49).fill(2), velocityEast: new Array(49).fill(0), velocityNorth: new Array(49).fill(4) }
}
describe('local foam experiment', () => {
  it('does not aerate uniform supercritical flow merely because it is fast', () => {
    expect(computeFloodLocalFoamSources(grid, frame()).every(v => v === 0)).toBe(true)
  })
  it('localizes a shear source and preserves supplied depth and velocity', () => {
    const input = frame()
    input.velocityNorth = input.depth.map((_, i) => i % 7 < 3 ? 1 : 4)
    const original = JSON.stringify(input)
    const source = computeFloodLocalFoamSources(grid, input)
    expect(source[3 * 7 + 2]).toBeGreaterThan(0)
    expect(source[3 * 7 + 3]).toBeGreaterThan(0)
    expect(source[3 * 7 + 5]).toBe(0)
    expect(source.every(v => v >= 0 && v <= 0.42)).toBe(true)
    expect(JSON.stringify(input)).toBe(original)
  })
  it('generates at a downward stage gradient only when velocity points downstream', () => {
    const input = frame()
    input.depth = input.depth.map((_, i) => 5 - Math.floor(i / 7) * 0.5)
    expect(computeFloodLocalFoamSources(grid, input)[24]).toBeGreaterThan(0)
    input.velocityNorth = new Array(49).fill(-4)
    expect(computeFloodLocalFoamSources(grid, input)[24]).toBe(0)
  })
  it('does not invent a zero-velocity wall around a dry cell or missing velocities', () => {
    const input = frame()
    input.depth[24] = 0
    const source = computeFloodLocalFoamSources(grid, input)
    expect(source.every(v => v === 0)).toBe(true)
    expect(computeFloodLocalFoamSources(grid, { time: 0, depth: input.depth }).every(v => v === 0)).toBe(true)
  })
  it('transports and decays local coverage using the existing bounded tracer', () => {
    const foam = new FloodFoam(grid)
    foam.update(frame(0), 18, undefined, 'flow')
    foam.coverage[24] = 1
    foam.update(frame(0.05), 18, undefined, 'flow')
    expect(foam.coverage[31]).toBeGreaterThan(0)
    expect(foam.coverage[17]).toBe(0)
    expect(foam.coverage.reduce((a, b) => a + b, 0)).toBeCloseTo(Math.exp(-0.05 / 18), 5)
  })
  it('preserves opt-in behavior and validates independent particle controls', () => {
    expect(resolveFloodVisualOptions({}).surfaceStyle).toBe('baseline')
    expect(resolveFloodVisualOptions({ particles: false, surfaceStyle: 'flow' }).particles).toBe(false)
    expect(() => resolveFloodVisualOptions({ surfaceStyle: 'unknown' as 'flow' })).toThrow()
  })
})
