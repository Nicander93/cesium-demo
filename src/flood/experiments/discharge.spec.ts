import { describe, expect, it } from 'vitest'
import { createDischargeExperiment } from './discharge'
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
