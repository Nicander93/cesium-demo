import { createFloodSimulation } from '../core/simulation'
import type { FloodFrame, FloodGrid } from '../core/dataset'
import type { FloodOutlet } from '../core/hydraulics'

/** Controlled synthetic channel; the solver remains independent of the rendering backend. */
export function createDischargeExperiment(discharge = 12, until = 35) {
  const columns = 24,
    rows = 48,
    cellSize = 2
  const elevation = Array.from({ length: columns * rows }, (_, i) => {
    const x = ((i % columns) + 0.5) * cellSize - (columns * cellSize) / 2
    const y = (Math.floor(i / columns) + 0.5) * cellSize
    return 4 - y * 0.03 + Math.max(0, Math.abs(x) - 5) ** 2 * 0.025
  })
  const grid: FloodGrid = {
    columns,
    rows,
    cellSize,
    origin: [119, 33, 100],
    elevation,
  }
  const sourceCells = [10, 11, 12, 13].map((x) => columns * 2 + x)
  return createExperiment(grid, sourceCells, discharge, until, 'north', 180)
}

function createExperiment(
  grid: FloodGrid,
  sourceCells: number[],
  discharge: number,
  until: number,
  outlet: FloodOutlet,
  maximumTime: number,
) {
  const simulation = createFloodSimulation({
    grid,
    sourceCells,
    roughness: 0.035,
    inflow: { discharge, until },
    outlet,
  })
  function seek(time: number): FloodFrame {
    if (!Number.isFinite(time) || time < 0 || time > maximumTime)
      throw new RangeError('实验时间必须在 0–' + maximumTime + ' 秒内')
    if (time < simulation.time - 1e-9) simulation.reset()
    return time > simulation.time + 1e-9
      ? simulation.advance(time - simulation.time)
      : simulation.snapshot()
  }
  return { grid, simulation, seek, maximumTime, sourceCells, outlet }
}

/** Hypothetical release on unmodified sampled terrain; source placement is not a surveyed river boundary. */
export function createTerrainDischargeExperiment(
  grid: FloodGrid,
  discharge = 80,
  until = 60,
) {
  if (
    !Number.isInteger(grid.columns) ||
    !Number.isInteger(grid.rows) ||
    grid.columns < 4 ||
    grid.rows < 5 ||
    grid.columns * grid.rows > 20000 ||
    grid.elevation.length !== grid.columns * grid.rows
  )
    throw new RangeError('真实工况网格至少为 4×5 且不超过 20000 个单元')
  const valid = (i: number) =>
    grid.active?.[i] !== false && Number.isFinite(grid.elevation[i])
  const floor = (row: number) =>
    Math.min(
      ...grid.elevation
        .slice(row * grid.columns, (row + 1) * grid.columns)
        .filter((_, x) => valid(row * grid.columns + x)),
    )
  const outlet: FloodOutlet =
    floor(1) < floor(grid.rows - 2) ? 'south' : 'north'
  const row = outlet === 'north' ? 2 : grid.rows - 3
  const sourceCells = Array.from(
    { length: grid.columns - 2 },
    (_, x) => row * grid.columns + x + 1,
  )
    .filter(valid)
    .sort((a, b) => grid.elevation[a] - grid.elevation[b])
    .slice(0, 4)
  if (!sourceCells.length) throw new Error('真实地形没有有效的入流单元')
  return createExperiment(grid, sourceCells, discharge, until, outlet, 600)
}
