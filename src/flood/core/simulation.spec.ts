import { describe, expect, it } from 'vitest'
import { createFloodSimulation, createCrossValleyWall, parseFloodDataset, interpolateFrame, type FloodGrid } from './index'

function layout(): FloodGrid {
  return { columns: 4, rows: 8, cellSize: 2, origin: [119, 33, 0], elevation: new Array<number>(32).fill(0) }
}

describe('public headless flood API', () => {
  it('updates inflow, conserves water, resets time and exports replayable results', () => {
    const simulation = createFloodSimulation({ grid: layout(), sourceCells: [5], inflow: { discharge: 2, until: 10 } })
    const frames = [simulation.snapshot(), simulation.advance(20)]
    expect(simulation.time).toBeCloseTo(20)
    expect(simulation.balance.injectedVolume).toBeCloseTo(20)
    expect(Math.abs(simulation.balance.balanceError)).toBeLessThan(1e-8)
    const result = parseFloodDataset(simulation.toDataset(frames, 'API example'))
    expect(result.name).toBe('API example')
    expect(interpolateFrame(result.frames, 10).time).toBe(10)
    const volume = simulation.balance.injectedVolume
    simulation.setInflow({ discharge: 0 })
    simulation.advance(5)
    expect(simulation.balance.injectedVolume).toBe(volume)
    simulation.reset()
    expect(simulation.time).toBe(0)
    expect(simulation.balance.storedVolume).toBe(0)
  })

  it('owns input domain, wall and source arrays, isolating caller mutations', () => {
    const grid = layout()
    const barriers = createCrossValleyWall(grid, 1, 4)
    const sourceCells = [5]
    const simulation = createFloodSimulation({ grid, barriers, sourceCells, inflow: { discharge: 0.2 } })
    grid.elevation.fill(1000)
    grid.origin[2] = 1000
    barriers.north.fill(null)
    sourceCells[0] = 30
    simulation.advance(100)
    expect(simulation.snapshot().depth.slice(16).every(h => h === 0)).toBe(true)
    expect(simulation.toDataset([simulation.snapshot()]).grid.origin[2]).toBe(0)
    expect(Math.abs(simulation.balance.balanceError)).toBeLessThan(1e-7)
  })

  it('rejects invalid inflow, roughness and duplicate source cells', () => {
    expect(() => createCrossValleyWall(layout(), 1, 2.5)).toThrow()
    expect(() => createFloodSimulation({ grid: layout(), roughness: -1 })).toThrow()
    expect(() => createFloodSimulation({ grid: layout(), sourceCells: [5, 5] })).toThrow()
    const simulation = createFloodSimulation({ grid: layout() })
    expect(() => simulation.setInflow({ discharge: NaN })).toThrow()
    expect(() => simulation.setInflow({ discharge: 1, until: -1 })).toThrow()
  })
})
