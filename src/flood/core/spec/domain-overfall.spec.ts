import { describe, expect, it } from 'vitest'
import { analyzeInundation, composeFloodDomain, createCrossValleyWall, createFloodSimulation, sampleDamBreach, sampleWallOverfalls, type FloodFrame, type FloodGrid } from '../index'

function flat(): FloodGrid {
  return { columns: 4, rows: 4, cellSize: 10, origin: [94.323, 29.686, 0], elevation: new Array<number>(16).fill(0) }
}

describe('shared terrain and model domain', () => {
  it('merges solid footprints as columns without changing the source terrain', () => {
    const ground = flat()
    const domain = composeFloodDomain(ground, [{ id: 'building', kind: 'solid', footprint: [[10, 10], [30, 10], [30, 30], [10, 30]], topElevation: 8 }])
    expect(ground.elevation.every(z => z === 0)).toBe(true)
    expect(domain.grid.elevation.filter(z => z === 8)).toHaveLength(4)
    expect(analyzeInundation(domain.grid, { waterLevel: 5 }).area).toBe(1200)
    expect(analyzeInundation(domain.grid, { waterLevel: 10 }).volume).toBe(12800)
  })

  it('rasterizes a wall line as internal face crests and preserves overtopping', () => {
    const domain = composeFloodDomain(flat(), [{ id: 'wall', kind: 'wall', path: [[0, 20], [40, 20]], crestElevation: 5 }])
    expect(analyzeInundation(domain.grid, { waterLevel: 5, seedCells: [0], barriers: domain.barriers }).area).toBe(800)
    expect(analyzeInundation(domain.grid, { waterLevel: 6, seedCells: [0], barriers: domain.barriers }).area).toBe(1600)
    const east = composeFloodDomain(flat(), [{ id: 'wall', kind: 'wall', path: [[20, 0], [20, 40]], crestElevation: 5 }])
    expect(analyzeInundation(east.grid, { waterLevel: 4, seedCells: [0], barriers: east.barriers }).area).toBe(800)
  })

  it('rejects invalid geometry and elevations', () => {
    expect(() => composeFloodDomain(flat(), [{ id: 'bad', kind: 'solid', footprint: [[0, 0]], topElevation: 8 }])).toThrow()
    expect(() => composeFloodDomain(flat(), [{ id: 'bad', kind: 'wall', path: [[0, 0], [40, 0]], crestElevation: NaN }])).toThrow()
  })
})

describe('directional open outlets', () => {
  it('mirrors north-flowing and south-flowing runs with the same conserved drainage', () => {
    const north = { ...flat(), rows: 16, elevation: Array.from({ length: 64 }, (_, i) => 16 - Math.floor(i / 4)) }
    const south = { ...north, elevation: Array.from({ length: 64 }, (_, i) => 1 + Math.floor(i / 4)) }
    const a = createFloodSimulation({ grid: north, inflow: { discharge: 30, until: 30 } })
    const b = createFloodSimulation({ grid: south, outlet: 'south', inflow: { discharge: 30, until: 30 } })
    a.advance(500)
    b.advance(500)
    expect(b.balance.dischargedVolume).toBeGreaterThan(0)
    expect(b.balance.dischargedVolume).toBeCloseTo(a.balance.dischargedVolume, 6)
    expect(Math.abs(b.balance.balanceError)).toBeLessThan(1e-6)
    b.reset()
    expect(b.balance.dischargedVolume).toBe(0)
  })
})

describe('overfall sheet controls', () => {
  function frame(reverse = false): FloodFrame {
    return { time: 60, depth: Array.from({ length: 16 }, (_, i) => (Math.floor(i / 4) < 2) !== reverse ? 8 : 0),
      velocityEast: new Array<number>(16).fill(0), velocityNorth: new Array<number>(16).fill(reverse ? -1 : 1) }
  }

  it('starts above the crest and falls to the downstream surface in either direction', () => {
    const grid = flat()
    const barriers = createCrossValleyWall(grid, 5, 2)
    for (const reverse of [false, true]) {
      const sheets = sampleWallOverfalls(grid, barriers, frame(reverse))
      expect(sheets).toHaveLength(4)
      expect(sheets.every(s => s.lipLevel > s.crest && s.lipLevel < s.upstreamLevel && s.downstreamLevel === 0)).toBe(true)
      expect(sheets.every(s => s.direction === (reverse ? -1 : 1))).toBe(true)
    }
    const east = composeFloodDomain(grid, [{ id: 'east wall', kind: 'wall', path: [[20, 0], [20, 40]], crestElevation: 5 }])
    const eastFrame = { time: 60, depth: Array.from({ length: 16 }, (_, i) => i % 4 < 2 ? 8 : 0), velocityEast: new Array<number>(16).fill(1), velocityNorth: new Array<number>(16).fill(0) }
    expect(sampleWallOverfalls(grid, east.barriers, eastFrame).every(s => s.axis === 'east' && s.direction === 1)).toBe(true)
    expect(sampleWallOverfalls(grid, east.barriers, eastFrame)).toHaveLength(4)
  })

  it('uses the lowered breach crest and suppresses unobserved depth-only motion', () => {
    const grid = flat()
    const barriers = createCrossValleyWall(grid, 10, 2)
    expect(sampleWallOverfalls(grid, barriers, frame())).toHaveLength(0)
    const breach = sampleDamBreach({ row: 2, center: 20, finalWidth: 20, finalBottomElevation: 0, startTime: 0, formationTime: 60 }, 30)
    expect(sampleWallOverfalls(grid, barriers, frame(), breach)).toHaveLength(2)
    expect(sampleWallOverfalls(grid, barriers, frame(), breach).every(s => s.crest === 5)).toBe(true)
    const still = frame()
    delete still.velocityNorth
    delete still.velocityEast
    expect(sampleWallOverfalls(grid, barriers, still, breach)).toHaveLength(0)
  })
})
