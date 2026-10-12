import type { FloodGrid } from './dataset'

// Crest elevations use the same local ENU vertical reference as the grid.
// null means an ordinary open face, rather than a zero-height wall.
export interface FloodBarriers {
  east: (number | null)[]
  north: (number | null)[]
}

export type FloodOutlet = 'north' | 'south'

export function createCrossValleyWall(grid: FloodGrid, height: number, row = Math.floor(grid.rows * 0.45)): FloodBarriers {
  if (!Number.isFinite(height) || height < 0 || !Number.isInteger(row) || row < 1 || row >= grid.rows) throw new Error('挡墙高度或位置无效')
  const east = new Array<number | null>((grid.columns + 1) * grid.rows).fill(null)
  const north = new Array<number | null>(grid.columns * (grid.rows + 1)).fill(null)
  for (let x = 0; x < grid.columns; x++) {
    const i = row * grid.columns + x
    north[i] = Math.max(grid.elevation[i - grid.columns], grid.elevation[i]) + height
  }
  return { east, north }
}

// Ideal broad-crested weir per unit width, in m²/s. C = sqrt(g)*(2/3)^1.5.
// The tailwater reduction is a simple visual approximation, not a calibrated
// submerged-weir rating. No flow at equal stages, and either direction works.
export function overflowFlux(stageA: number, stageB: number, crest: number): number {
  const upstream = Math.max(stageA, stageB) - crest
  if (upstream <= 0 || stageA === stageB) return 0
  const downstream = Math.max(0, Math.min(stageA, stageB) - crest)
  const reduction = Math.sqrt(Math.max(0, 1 - downstream / upstream))
  return Math.sign(stageA - stageB) * Math.sqrt(9.81) * (2 / 3) ** 1.5 * upstream ** 1.5 * reduction
}

export function upstreamSourceCells(grid: FloodGrid, outlet: FloodOutlet = 'north'): number[] {
  const row = outlet === 'north' ? Math.min(3, grid.rows - 1) : Math.max(0, grid.rows - 4)
  let lowest = 0
  for (let x = 1; x < grid.columns; x++) {
    if (grid.elevation[row * grid.columns + x] < grid.elevation[row * grid.columns + lowest]) lowest = x
  }
  return [-2, -1, 0, 1].map(offset => lowest + offset)
    .filter(x => x >= 0 && x < grid.columns).map(x => row * grid.columns + x)
}
