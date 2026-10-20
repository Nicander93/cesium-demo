import { describe, expect, it } from 'vitest'
import {
  createDischargeExperiment,
  createTerrainDischargeExperiment,
} from '../discharge'
describe('discharge / propagation / recession acceptance case', () => {
  it('propagates downstream, cuts off exactly, drains and conserves volume', () => {
    const experiment = createDischargeExperiment()
    const front = (depth: number[]) =>
      depth.reduce(
        (row, h, i) => (h >= 0.02 ? Math.max(row, Math.floor(i / 24)) : row),
        -1,
      )
    expect(front(experiment.seek(0).depth)).toBe(-1)
    const early = experiment.seek(10)
    const supplied = experiment.seek(35),
      peak = experiment.simulation.balance
    expect(front(early.depth)).toBeGreaterThan(2)
    expect(front(supplied.depth)).toBeGreaterThan(front(early.depth))
    expect(peak.injectedVolume).toBeCloseTo(12 * 35, 8)
    const receding = experiment.seek(60),
      middle = experiment.simulation.balance
    expect(front(receding.depth)).toBe(47)
    expect(middle.storedVolume).toBeLessThan(peak.storedVolume)
    const final = experiment.seek(180),
      balance = experiment.simulation.balance
    expect(balance.injectedVolume).toBeCloseTo(420, 8)
    expect(balance.storedVolume).toBeLessThan(20)
    expect(balance.dischargedVolume).toBeGreaterThan(400)
    expect(Math.abs(balance.balanceError)).toBeLessThan(1e-8)
    expect(final.depth.filter((h) => h >= 0.02).length).toBeLessThan(
      supplied.depth.filter((h) => h >= 0.02).length,
    )
    const replay = experiment.seek(10)
    expect(replay.depth).toEqual(early.depth)
    expect(() => experiment.seek(-1)).toThrow()
    expect(() => experiment.seek(181)).toThrow()
  })
})

describe('hypothetical release on supplied terrain', () => {
  it('chooses lower north/south outlet and valid source cells without changing the DEM', () => {
    for (const direction of [1, -1]) {
      const grid = {
        columns: 8,
        rows: 16,
        cellSize: 4,
        origin: [7.91, 46.57, 0] as [number, number, number],
        elevation: Array.from(
          { length: 128 },
          (_, i) =>
            10 -
            direction * Math.floor(i / 8) * 0.1 +
            ((i % 8) - 3.5) ** 2 * 0.2,
        ),
      }
      const original = structuredClone(grid),
        run = createTerrainDischargeExperiment(grid, 2, 5)
      expect(run.outlet).toBe(direction === 1 ? 'north' : 'south')
      expect(run.sourceCells.length).toBe(4)
      const row = direction === 1 ? 2 : 13
      expect(run.sourceCells.every((i) => Math.floor(i / 8) === row)).toBe(true)
      const result = run.seek(20)
      expect(result.depth.some((h) => h > 0)).toBe(true)
      expect(run.simulation.balance.injectedVolume).toBeCloseTo(10)
      expect(Math.abs(run.simulation.balance.balanceError)).toBeLessThan(1e-8)
      expect(grid).toEqual(original)
    }
  })
})
