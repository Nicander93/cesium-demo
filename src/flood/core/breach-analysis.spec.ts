import { describe, expect, it } from 'vitest'
import { analyzeFloodDataset, analyzeInundation, createCrossValleyWall, createDataset, createFloodSimulation, parseFloodDataset, sampleDamBreach, type FloodGrid } from './index'

function flat(columns = 4, rows = 4): FloodGrid {
  return { columns, rows, cellSize: 2, origin: [119, 33, 0], elevation: new Array<number>(columns * rows).fill(0) }
}

describe('connected static inundation', () => {
  it('excludes an isolated low basin until the intervening ridge is submerged', () => {
    const grid = flat(4, 3)
    for (let y = 0; y < 3; y++) grid.elevation[y * 4 + 2] = 10
    const connected = analyzeInundation(grid, { waterLevel: 5, seedCells: [0] })
    expect(connected.area).toBe(24)
    expect(connected.volume).toBe(120)
    expect(connected.depth[3]).toBe(0)
    expect(analyzeInundation(grid, { waterLevel: 5 }).area).toBe(36)
    expect(analyzeInundation(grid, { waterLevel: 11, seedCells: [0] }).area).toBe(48)
  })

  it('blocks equal-crest water, passes overtopping and respects a developed breach', () => {
    const grid = flat(4, 4)
    const barriers = createCrossValleyWall(grid, 2, 2)
    expect(analyzeInundation(grid, { waterLevel: 2, seedCells: [0], barriers }).area).toBe(32)
    expect(analyzeInundation(grid, { waterLevel: 2.01, seedCells: [0], barriers }).area).toBe(64)
    const state = sampleDamBreach({ row: 2, center: 4, finalWidth: 2, finalBottomElevation: 0, startTime: 5, formationTime: 10 }, 15)
    expect(analyzeInundation(grid, { waterLevel: 1, seedCells: [0], barriers, damBreach: state }).area).toBe(64)
  })

  it('honours east walls, NoData and four-neighbour connectivity', () => {
    const grid = flat(2, 2)
    const barriers = createCrossValleyWall(grid, 0, 1)
    barriers.east[1] = 3
    barriers.east[4] = 3
    expect(analyzeInundation(grid, { waterLevel: 2, seedCells: [0], barriers }).area).toBe(8)
    grid.active = [true, false, false, true]
    expect(analyzeInundation(grid, { waterLevel: 2, seedCells: [0] }).wet).toEqual([true, false, false, false])
    expect(analyzeInundation(grid, { waterLevel: 2, seedCells: [1] }).area).toBe(0)
  })

  it('rejects malformed inputs and reports no water for a dry seed', () => {
    expect(() => analyzeInundation(flat(), { waterLevel: NaN })).toThrow()
    expect(() => analyzeInundation(flat(), { waterLevel: 1, seedCells: [] })).toThrow()
    expect(() => analyzeInundation(flat(), { waterLevel: 1, seedCells: [-1] })).toThrow()
    expect(() => analyzeInundation(flat(), { waterLevel: 1, damBreach: { row: 2, progress: 1, width: 2, left: 3, right: 5, finalBottomElevation: 0 } })).toThrow()
    expect(analyzeInundation(flat(), { waterLevel: 0, seedCells: [0] }).volume).toBe(0)
  })
})

describe('time-series flood analysis', () => {
  const grid = flat(2, 2)
  grid.active = [true, true, false, true]
  const data = createDataset(grid, [
    { time: 10, depth: [0, 2, 0, 0] }, { time: 20, depth: [2, 0, 0, 0] },
    { time: 30, depth: [0, 2, 0, 0.5] }, { time: 40, depth: [2, 0, 0, 0.5] },
  ])

  it('interpolates arrivals and accumulates multiple wet intervals within the observation window', () => {
    const result = analyzeFloodDataset(data, { depthThreshold: 1 })
    expect(result.arrivalTime).toEqual([15, 10, null, null])
    expect(result.inundationDuration).toEqual([15, 15, null, null])
    expect(result.maximumDepth).toEqual([2, 2, null, null])
    expect(result.maximumDepthTime).toEqual([20, 10, null, null])
    expect(result.inundatedArea).toBe(8)
    expect(result.peakSampledArea).toBe(4)
    expect(result.fromTime).toBe(10)
    expect(result.toTime).toBe(40)
    expect(JSON.parse(JSON.stringify(result)).arrivalTime[2]).toBeNull()
  })

  it('retains zero-duration threshold touches and distinguishes them from never-wet cells', () => {
    const result = analyzeFloodDataset(data, { depthThreshold: 2 })
    expect(result.arrivalTime[0]).toBe(20)
    expect(result.inundationDuration[0]).toBe(0)
    expect(result.inundationDuration[3]).toBeNull()
    expect(() => analyzeFloodDataset(data, { depthThreshold: 0 })).toThrow()
    expect(() => analyzeFloodDataset(data, { depthThreshold: Infinity })).toThrow()
  })

  it('supports a single static observation without inventing an event duration', () => {
    const result = analyzeFloodDataset(createDataset(flat(2, 2), [{ time: 120, depth: [2, 0, 0, 0] }]))
    expect(result.arrivalTime[0]).toBe(120)
    expect(result.inundationDuration[0]).toBe(0)
  })
})

describe('reservoir and progressive dam breach', () => {
  function scenario() {
    const grid = flat(8, 10)
    const barriers = createCrossValleyWall(grid, 4, 4)
    const initialDepth = grid.elevation.map((_, i) => i < 32 ? 2 : 0)
    const damBreach = { row: 4, center: 8, finalWidth: 4, finalBottomElevation: 0, startTime: 5, formationTime: 10 }
    return { grid, barriers, initialDepth, damBreach }
  }

  it('retains the initial reservoir before failure, then sends water through the growing opening without creating water', () => {
    const options = scenario()
    const simulation = createFloodSimulation(options)
    const initial = simulation.snapshot()
    simulation.advance(5)
    expect(simulation.snapshot().depth.slice(32).every(h => h === 0)).toBe(true)
    expect(simulation.balance.initialVolume).toBe(256)
    expect(simulation.breachState?.progress).toBeCloseTo(0, 12)
    simulation.advance(30)
    expect(simulation.snapshot().depth.slice(32).some(h => h > 0.02)).toBe(true)
    expect(simulation.breachState?.width).toBe(4)
    expect(simulation.balance.injectedVolume).toBe(0)
    expect(Math.abs(simulation.balance.balanceError)).toBeLessThan(1e-7)
    simulation.advance(400)
    expect(simulation.balance.dischargedVolume).toBeGreaterThan(0)
    expect(Math.abs(simulation.balance.balanceError)).toBeLessThan(1e-7)
    const result = parseFloodDataset(simulation.toDataset([initial, simulation.snapshot()]))
    expect(result.structures?.damBreach).toEqual(options.damBreach)
    simulation.reset()
    expect(simulation.snapshot().depth).toEqual(initial.depth)
    expect(simulation.balance.dischargedVolume).toBe(0)
  })

  it('owns the supplied initial water and breach schedule', () => {
    const options = scenario()
    const simulation = createFloodSimulation(options)
    options.initialDepth.fill(0)
    options.damBreach.startTime = 5000
    expect(simulation.balance.initialVolume).toBe(256)
    simulation.advance(20)
    expect(simulation.breachState?.progress).toBe(1)
  })

  it('validates reservoirs and breach metadata, while accepting legacy results without structures', () => {
    const options = scenario()
    expect(() => createFloodSimulation({ ...options, initialDepth: [-1] })).toThrow()
    expect(() => createFloodSimulation({ ...options, damBreach: { ...options.damBreach, formationTime: 0 } })).toThrow()
    expect(() => createFloodSimulation({ ...options, damBreach: { ...options.damBreach, center: 100 } })).toThrow()
    const data = createDataset(options.grid, [{ time: 0, depth: options.initialDepth }])
    expect(parseFloodDataset(data).structures).toBeUndefined()
    expect(() => parseFloodDataset({ ...data, structures: { barriers: options.barriers, damBreach: { ...options.damBreach, finalWidth: -1 } } })).toThrow()
  })
})
