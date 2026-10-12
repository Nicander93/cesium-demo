import type { FloodFrame, FloodGrid } from './dataset'
import type { FloodBarriers } from './hydraulics'
import { getBreachFace, validateDamBreachState, type DamBreachState } from './breach'

export interface FloodOverfall {
  axis: 'north' | 'east'
  face: number
  left: number
  right: number
  direction: 1 | -1
  crest: number
  upstreamLevel: number
  lipLevel: number
  downstreamLevel: number
  speed: number
}

// Rendering diagnostics, not a second solver. Only animate flows whose direction
// is supported by the result velocities; depth-only external results stay still.
export function sampleWallOverfalls(grid: FloodGrid, barriers: FloodBarriers, frame: FloodFrame, breach?: DamBreachState): FloodOverfall[] {
  const sections: FloodOverfall[] = []
  const count = grid.columns * grid.rows
  if (frame.depth.length !== count || frame.depth.some(h => !Number.isFinite(h) || h < 0)
    || barriers.east.length !== (grid.columns + 1) * grid.rows || barriers.north.length !== grid.columns * (grid.rows + 1)) throw new Error('跌水输入与网格不一致')
  if (breach) validateDamBreachState(grid, barriers, breach)
  if (!frame.velocityEast || !frame.velocityNorth) return sections
  if (frame.velocityEast.length !== count || frame.velocityNorth.length !== count
    || frame.velocityEast.some(v => !Number.isFinite(v)) || frame.velocityNorth.some(v => !Number.isFinite(v))) throw new Error('跌水流速无效')
  const { columns, rows, cellSize, elevation } = grid
  function section(axis: 'north' | 'east', face: number, a: number, b: number, left: number, right: number, crest: number): void {
    if (right <= left || grid.active?.[a] === false || grid.active?.[b] === false) return
    const levelA = elevation[a] + frame.depth[a]
    const levelB = elevation[b] + frame.depth[b]
    const direction = levelA > levelB ? 1 : -1
    const upper = Math.max(levelA, levelB)
    const lower = Math.min(levelA, levelB)
    const effectiveCrest = Math.max(crest, elevation[a], elevation[b])
    const velocity = axis === 'north' ? frame.velocityNorth! : frame.velocityEast!
    const speed = Math.max(velocity[a] * direction, velocity[b] * direction)
    if (upper <= effectiveCrest + .02 || upper - lower < .02 || speed <= 1e-5) return
    const control = Math.max(effectiveCrest, lower)
    sections.push({ axis, face, left, right, direction, crest: effectiveCrest, upstreamLevel: upper,
      lipLevel: control + (upper - control) * 2 / 3, downstreamLevel: lower, speed })
  }
  for (let y = 1; y < rows; y++) for (let x = 0; x < columns; x++) {
    const b = y * columns + x
    const crest = barriers.north[b]
    if (crest == null) continue
    const left = x * cellSize
    const right = left + cellSize
    if (breach && y === breach.row) {
      const opening = getBreachFace(grid, barriers, breach, x)
      if (opening.fraction > 0) {
        section('north', y * cellSize, b - columns, b, left, opening.left, crest)
        section('north', y * cellSize, b - columns, b, opening.left, opening.right, opening.crest)
        section('north', y * cellSize, b - columns, b, opening.right, right, crest)
        continue
      }
    }
    section('north', y * cellSize, b - columns, b, left, right, crest)
  }
  for (let y = 0; y < rows; y++) for (let x = 1; x < columns; x++) {
    const crest = barriers.east[y * (columns + 1) + x]
    if (crest != null) section('east', x * cellSize, y * columns + x - 1, y * columns + x, y * cellSize, (y + 1) * cellSize, crest)
  }
  return sections
}
