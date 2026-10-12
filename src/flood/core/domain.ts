import { createDataset, parseFloodDataset, type FloodGrid } from './dataset'
import type { FloodBarriers } from './hydraulics'

export type FloodPoint = readonly [number, number]

export type FloodObstacle =
  | { id: string; kind: 'solid'; footprint: readonly FloodPoint[]; topElevation: number }
  | { id: string; kind: 'wall'; path: readonly FloodPoint[]; crestElevation: number }

// Adapters for 3D Tiles, GeoJSON or manually drawn geometry output this contract.
// Solid objects are vertical columns; bridge decks must not be classified as solids.
export function composeFloodDomain(input: FloodGrid, obstacles: readonly FloodObstacle[], existing?: FloodBarriers): { grid: FloodGrid; barriers: FloodBarriers } {
  const count = input.columns * input.rows
  if (!Number.isInteger(count) || count < 4 || count > 20000) throw new Error('计算网格大小无效')
  const grid = parseFloodDataset(createDataset(input, [{ time: 0, depth: new Array<number>(count).fill(0) }])).grid
  grid.elevation = [...grid.elevation]
  const { columns, rows, cellSize } = grid
  const barriers: FloodBarriers = existing
    ? { east: [...existing.east], north: [...existing.north] }
    : { east: new Array<number | null>((columns + 1) * rows).fill(null), north: new Array<number | null>(columns * (rows + 1)).fill(null) }
  if (barriers.east.length !== (columns + 1) * rows || barriers.north.length !== columns * (rows + 1)
    || [...barriers.east, ...barriers.north].some(z => z !== null && !Number.isFinite(z))) throw new Error('挡墙数组无效')
  if (obstacles.length > 1000) throw new Error('一次最多合并 1000 个障碍，请预先分块')
  for (const obstacle of obstacles) {
    const points = obstacle.kind === 'solid' ? obstacle.footprint : obstacle.path
    const level = obstacle.kind === 'solid' ? obstacle.topElevation : obstacle.crestElevation
    if (!Number.isFinite(level) || points.length < (obstacle.kind === 'solid' ? 3 : 2) || points.length > 1000
      || points.some(p => p.length !== 2 || !p.every(Number.isFinite))) throw new Error(`障碍 ${obstacle.id} 的坐标或高程无效`)
    const xs = points.map(p => p[0])
    const ys = points.map(p => p[1])
    const minX = Math.max(0, Math.floor(Math.min(...xs) / cellSize) - 1)
    const maxX = Math.min(columns - 1, Math.ceil(Math.max(...xs) / cellSize) + 1)
    const minY = Math.max(0, Math.floor(Math.min(...ys) / cellSize) - 1)
    const maxY = Math.min(rows - 1, Math.ceil(Math.max(...ys) / cellSize) + 1)
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const i = y * columns + x
      if (obstacle.kind === 'solid') {
        if (grid.active?.[i] !== false && contains(points, [(x + .5) * cellSize, (y + .5) * cellSize])) grid.elevation[i] = Math.max(grid.elevation[i], level)
      } else {
        const point: FloodPoint = [(x + .5) * cellSize, (y + .5) * cellSize]
        if (x < columns - 1 && crossesPath(points, point, [point[0] + cellSize, point[1]])) {
          const face = y * (columns + 1) + x + 1
          barriers.east[face] = Math.max(barriers.east[face] ?? -Infinity, level)
        }
        if (y < rows - 1 && crossesPath(points, point, [point[0], point[1] + cellSize])) {
          const face = (y + 1) * columns + x
          barriers.north[face] = Math.max(barriers.north[face] ?? -Infinity, level)
        }
      }
    }
  }
  return { grid, barriers }
}

function contains(points: readonly FloodPoint[], point: FloodPoint): boolean {
  let inside = false
  for (let a = 0, b = points.length - 1; a < points.length; b = a++) {
    const p = points[a]
    const q = points[b]
    if ((p[1] > point[1]) !== (q[1] > point[1]) && point[0] < (q[0] - p[0]) * (point[1] - p[1]) / (q[1] - p[1]) + p[0]) inside = !inside
  }
  return inside
}

function cross(a: FloodPoint, b: FloodPoint, p: FloodPoint): number {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
}

function crossesPath(points: readonly FloodPoint[], a: FloodPoint, b: FloodPoint): boolean {
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1]
    const q = points[i]
    if (Math.max(a[0], b[0]) < Math.min(p[0], q[0]) || Math.min(a[0], b[0]) > Math.max(p[0], q[0])
      || Math.max(a[1], b[1]) < Math.min(p[1], q[1]) || Math.min(a[1], b[1]) > Math.max(p[1], q[1])) continue
    if (cross(a, b, p) * cross(a, b, q) <= 0 && cross(p, q, a) * cross(p, q, b) <= 0) return true
  }
  return false
}
