import { createFloodSimulation } from '../core/simulation'
import type { FloodFrame, FloodGrid } from '../core/dataset'

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
  const simulation = createFloodSimulation({
    grid,
    sourceCells,
    roughness: 0.035,
    inflow: { discharge, until },
    outlet: 'north',
  })
  function seek(time: number): FloodFrame {
    if (!Number.isFinite(time) || time < 0 || time > 180)
      throw new RangeError('实验时间必须在 0–180 秒内')
    if (time < simulation.time - 1e-9) simulation.reset()
    return time > simulation.time + 1e-9
      ? simulation.advance(time - simulation.time)
      : simulation.snapshot()
  }
  return { grid, simulation, seek }
}
