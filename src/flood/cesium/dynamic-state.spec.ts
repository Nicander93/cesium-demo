import { describe, expect, it } from 'vitest'
import type { FloodFrame, FloodGrid } from '../core/dataset'
import {
  createDynamicTopology,
  DynamicFloodState,
  validateRenderFrame,
} from './dynamic-state'
import { createFloodSurfaceState } from './surface-state'
function grid(): FloodGrid {
  return {
    columns: 3,
    rows: 3,
    cellSize: 2,
    origin: [119, 33, 100],
    elevation: [2, 2, 2, 2, 0, 2, 2, 2, 2],
  }
}
describe('persistent GPU flood state', () => {
  it('keeps winding, shares wet decisions across a triangle and omits inactive holes', () => {
    const domain = grid(),
      topology = createDynamicTopology(domain)
    expect(topology.length / 12).toBe(8)
    for (let k = 0; k < topology.length; k += 12) {
      const [a, b, c] = Array.from(topology.slice(k + 1, k + 4))
      expect(Array.from(topology.slice(k, k + 12))).toEqual([
        a,
        a,
        b,
        c,
        b,
        a,
        b,
        c,
        c,
        a,
        b,
        c,
      ])
      const x = (i: number) => i % domain.columns,
        y = (i: number) => Math.floor(i / domain.columns)
      expect(
        (x(b) - x(a)) * (y(c) - y(a)) - (y(b) - y(a)) * (x(c) - x(a)),
      ).toBeGreaterThan(0)
    }
    domain.active = Array(9).fill(true)
    domain.active[4] = false
    const holes = createDynamicTopology(domain)
    expect(holes.length / 12).toBe(2)
    expect(Array.from(holes)).not.toContain(4)
  })
  it('matches the CPU signed shoreline and owns persistent buffers without changing hydraulic input', () => {
    const domain = grid(),
      state = new DynamicFloodState(domain)
    const frame: FloodFrame = {
      time: 4,
      depth: [0, 0, 0, 0, 1, 0, 0, 0, 0],
      velocityEast: Array(9).fill(2),
      velocityNorth: Array(9).fill(-1),
    }
    const original = structuredClone(frame),
      surface = state.surface,
      foam = state.foam
    state.update(frame, Array(9).fill(0.2), Array(9).fill(0.1))
    const visual = createFloodSurfaceState(domain, frame)
    for (let i = 0; i < 9; i++) {
      expect(Array.from(surface.slice(i * 4, i * 4 + 4))).toEqual([
        Math.fround(visual.heights[i]),
        Math.fround(visual.depths[i]),
        2,
        -1,
      ])
    }
    expect(surface[1]).toBe(-1)
    expect(frame).toEqual(original)
    frame.depth[4] = 0.3
    expect(surface[17]).toBe(1)
    state.update(
      { time: 5, depth: Array(9).fill(0) },
      Array(9).fill(0),
      Array(9).fill(0),
    )
    expect(state.surface).toBe(surface)
    expect(state.foam).toBe(foam)
    expect(surface.filter((_, i) => i % 4 !== 0).every((v) => v === 0)).toBe(
      true,
    )
    expect(foam.every((v) => v === 0)).toBe(true)
  })
  it('keeps the CPU wet threshold even when Float32 rounds a dry depth up to 0.02', () => {
    const state = new DynamicFloodState(grid()),
      depth = Array(9).fill(0.02 - 1e-10)
    depth[4] = 0.02
    state.update({ time: 1, depth }, Array(9).fill(0), Array(9).fill(0))
    expect(state.surface[1]).toBe(Math.fround(0.02))
    expect(Array.from(state.foam.filter((_, i) => i % 4 === 2))).toEqual([
      0, 0, 0, 0, 1, 0, 0, 0, 0,
    ])
  })
  it('rejects malformed frames atomically, including one velocity component and inactive water', () => {
    const domain = grid(),
      state = new DynamicFloodState(domain),
      zero = Array(9).fill(0)
    state.update({ time: 1, depth: zero }, zero, zero)
    const before = state.surface.slice()
    for (const frame of [
      { time: NaN, depth: zero },
      { time: 2, depth: [1] },
      { time: 2, depth: zero, velocityEast: zero },
      { time: 2, depth: Array(9).fill(-1) },
      { time: 2, depth: Array(9).fill(1e39) },
    ]) {
      expect(() => state.update(frame, zero, zero)).toThrow()
      expect(state.surface).toEqual(before)
      expect(state.time).toBe(1)
    }
    domain.active = Array(9).fill(true)
    domain.active[4] = false
    expect(() =>
      validateRenderFrame(domain, { time: 2, depth: Array(9).fill(1) }),
    ).toThrow()
    expect(() =>
      state.update({ time: 2, depth: zero }, [NaN, ...zero.slice(1)], zero),
    ).toThrow()
    expect(state.surface).toEqual(before)
  })
})
