import { describe, expect, it } from 'vitest'
import { createDataset, createValleyGrid, interpolateFrame, parseFloodDataset } from '../dataset'
import { FloodSolver } from '../solver'
import { createCrossValleyWall, overflowFlux } from '../hydraulics'

describe('overtopping barriers', () => {
  it('blocks below and at crest, allows reverse flow, and balances equal stages', () => {
    expect(overflowFlux(2, 0, 3)).toBe(0)
    expect(overflowFlux(3, 0, 3)).toBe(0)
    expect(overflowFlux(4, 0, 3)).toBeGreaterThan(0)
    expect(overflowFlux(0, 4, 3)).toBe(-overflowFlux(4, 0, 3))
    expect(overflowFlux(4, 4, 3)).toBe(0)
    expect(overflowFlux(4, 3.8, 3)).toBeLessThan(overflowFlux(4, 0, 3))
  })

  it('stores water upstream until it overtops, conserving volume', () => {
    const grid = { columns: 4, rows: 8, cellSize: 2, origin: [119, 33, 0] as [number, number, number], elevation: new Array<number>(32).fill(0) }
    const wall = createCrossValleyWall(grid, 1, 4)
    const solver = new FloodSolver(grid, 0.035, wall, [5])
    solver.advance(100, 0.2)
    expect(Array.from(solver.depth).slice(16).every(h => h === 0)).toBe(true)
    expect(solver.wallDischarge).toBe(0)
    solver.advance(150, 1)
    expect(Array.from(solver.depth).slice(16).some(h => h > 0.02)).toBe(true)
    expect(solver.wallDischarge).toBeGreaterThan(0)
    expect(Math.abs(solver.balanceError)).toBeLessThan(1e-7)
    expect(Array.from(solver.depth).every(h => h >= 0 && Number.isFinite(h))).toBe(true)
  })

  it('rejects missing hydraulic ground instead of treating NoData as a wall', () => {
    const grid = createValleyGrid()
    grid.active = grid.elevation.map(() => true)
    grid.active[0] = false
    expect(() => new FloodSolver(grid)).toThrow('完整地形')
  })
})

describe('local-inertial valley simulation', () => {
  it('remains dry without an inflow', () => {
    const solver = new FloodSolver(createValleyGrid())
    solver.advance(60, 0)
    expect(solver.storedVolume).toBe(0)
    expect(solver.snapshot().depth.every(h => h === 0)).toBe(true)
  })

  it('conserves water through the wet/dry front and open downstream boundary', () => {
    const grid = createValleyGrid()
    const solver = new FloodSolver(grid)
    solver.advance(1800, 350, 240)
    const result = solver.snapshot()
    expect(solver.injectedVolume).toBeCloseTo(350 * 240, 4)
    expect(Math.abs(solver.balanceError)).toBeLessThan(0.001)
    expect(solver.dischargedVolume).toBeGreaterThan(1000)
    expect(result.depth.every(h => Number.isFinite(h) && h >= 0)).toBe(true)
    expect(result.velocityNorth?.every(Number.isFinite)).toBe(true)
    const lastWetRow = Math.max(...result.depth.map((h, i) => h > 0.02 ? Math.floor(i / grid.columns) : 0))
    expect(lastWetRow).toBeGreaterThan(60)
  }, 20000)

  it('cuts off inflow exactly when the prescribed release duration ends', () => {
    const solver = new FloodSolver(createValleyGrid())
    solver.advance(41, 600, 30)
    expect(solver.injectedVolume).toBeCloseTo(18000, 6)
    const volume = solver.injectedVolume
    solver.advance(20, 600, 30)
    expect(solver.injectedVolume).toBe(volume)
    expect(Math.abs(solver.balanceError)).toBeLessThan(1e-6)
  })

  it('does not move a still lake on uneven terrain', () => {
    const grid = createValleyGrid()
    grid.elevation = grid.elevation.map((_, i) => 10 + 0.1 * ((i % grid.columns - 24) ** 2 + (Math.floor(i / grid.columns) - 44) ** 2))
    const solver = new FloodSolver(grid)
    // A horizontal, enclosed lake in the lower side basin.
    for (let i = 0; i < solver.depth.length; i++) solver.depth[i] = Math.max(0, 10.8 - grid.elevation[i])
    const before = Array.from(solver.depth)
    expect(before.some(h => h > 0)).toBe(true)
    solver.advance(30, 0)
    expect(Math.max(...solver.depth.map((h, i) => Math.abs(h - before[i])))).toBeLessThan(1e-8)
  })
})

describe('flood result interchange', () => {
  const grid = createValleyGrid()
  const solver = new FloodSolver(grid)
  const start = solver.snapshot()
  solver.advance(20, 200, 20)
  const end = solver.snapshot()

  it('round-trips built-in output through the external result parser', () => {
    const original = createDataset(grid, [start, end])
    expect(parseFloodDataset(JSON.parse(JSON.stringify(original)))).toEqual(original)
  })

  it('supports depth-only models without manufacturing velocity data', () => {
    const frames = [start, end].map(({ time, depth }) => ({ time, depth }))
    const parsed = parseFloodDataset(createDataset(grid, frames))
    const midpoint = interpolateFrame(parsed.frames, 10)
    expect(midpoint.velocityEast).toBeUndefined()
    expect(midpoint.time).toBe(10)
    expect(midpoint.depth.reduce((sum, h) => sum + h, 0)).toBeCloseTo(end.depth.reduce((sum, h) => sum + h, 0) / 2, 6)
  })

  it.each([
    ['wrong units', (d: any) => { d.units.length = 'ft' }],
    ['mixed datum', (d: any) => { d.verticalDatum = 'EGM96' }],
    ['missing values', (d: any) => { d.frames[1].depth.pop() }],
    ['negative depth', (d: any) => { d.frames[1].depth[0] = -1 }],
    ['duplicate time', (d: any) => { d.frames[1].time = 0 }],
    ['one velocity component', (d: any) => { delete d.frames[1].velocityEast }],
    ['mixed velocity availability', (d: any) => { delete d.frames[1].velocityEast; delete d.frames[1].velocityNorth }],
    ['oversized grid', (d: any) => { d.grid.columns = 20001 }],
    ['invalid mask', (d: any) => { d.grid.active = [true] }],
    ['non-finite value', (d: any) => { d.frames[1].depth[0] = NaN }],
  ])('rejects %s', (_, change) => {
    const data = structuredClone(createDataset(grid, [start, end]))
    change(data)
    expect(() => parseFloodDataset(data)).toThrow()
  })
})
