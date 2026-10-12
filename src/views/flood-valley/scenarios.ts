import { analyzeInundation, type FloodGrid, type FloodBarriers, type DamBreachOptions } from '../../flood/core'

export function createDamBreachDemo(grid: FloodGrid, options: { startTime: number; formationTime: number; finalWidth: number; upstream?: 'north' | 'south'; reservoirDepth?: number }) {
  const upstream = options.upstream ?? 'south'
  const row = Math.floor(grid.rows * (upstream === 'south' ? 0.3 : 0.7))
  let column = 0
  const foundation = (x: number) => Math.max(grid.elevation[row * grid.columns + x], grid.elevation[(row - 1) * grid.columns + x])
  for (let x = 1; x < grid.columns; x++) if (foundation(x) < foundation(column)) column = x
  const floor = foundation(column)
  const reservoirDepth = options.reservoirDepth ?? 12
  if (!Number.isFinite(reservoirDepth) || reservoirDepth <= 0) throw new Error('初始蓄水深度必须大于零')
  const waterLevel = floor + reservoirDepth
  const barriers: FloodBarriers = {
    east: new Array<number | null>((grid.columns + 1) * grid.rows).fill(null),
    north: new Array<number | null>(grid.columns * (grid.rows + 1)).fill(null),
  }
  for (let x = 0; x < grid.columns; x++) {
    const i = row * grid.columns + x
    barriers.north[i] = Math.max(waterLevel + 3, grid.elevation[i], grid.elevation[i - grid.columns])
  }
  const damBreach: DamBreachOptions = { row, center: (column + 0.5) * grid.cellSize, finalBottomElevation: floor,
    startTime: options.startTime, formationTime: options.formationTime, finalWidth: options.finalWidth }
  const sourceCell = (upstream === 'south' ? row - 1 : row) * grid.columns + column
  const initialDepth = analyzeInundation(grid, { waterLevel, barriers, seedCells: [sourceCell] }).depth
  return { initialDepth, barriers, damBreach, waterLevel }
}

// Public geographic example; release and wall are hypothetical test conditions.
export const realValleyName = '瑞士劳特布龙嫩山谷'

export function createRealValleyLayout(): FloodGrid {
  return { columns: 64, rows: 96, cellSize: 12, origin: [7.903, 46.570, 0], elevation: new Array<number>(64 * 96).fill(0) }
}

export const tibetValleyName = '西藏林芝河谷'

export function createTibetValleyLayout(): FloodGrid {
  return { columns: 100, rows: 96, cellSize: 30, origin: [94.323, 29.686, 0], elevation: new Array<number>(100 * 96).fill(0) }
}
