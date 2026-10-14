import type { FloodFrame, FloodGrid } from '../core/dataset'

export type FlowFixtureId = 'slow' | 'rapid' | 'bend' | 'obstacle'
interface FixtureFrame extends FloodFrame { velocityEast: number[]; velocityNorth: number[] }
export interface FlowFixture { id: FlowFixtureId; name: string; description: string; grid: FloodGrid; frame: FixtureFrame }
export const flowFixtureIds: FlowFixtureId[] = ['slow', 'rapid', 'bend', 'obstacle']

/** Analytic, synthetic fields for renderer comparisons; no hydraulic solver or real GIS data. */
export function createFlowFixture(id: FlowFixtureId): FlowFixture {
  if (!flowFixtureIds.includes(id)) throw new Error('Unknown flow fixture')
  const columns = 40, rows = 64, cellSize = 2
  const grid: FloodGrid = { columns, rows, cellSize, origin: [119, 33, 100], elevation: [] }
  const frame: FixtureFrame = { time: 0, depth: [], velocityEast: [], velocityNorth: [] }
  const names = { slow: '缓流', rapid: '急流浅滩', bend: '河湾', obstacle: '障碍物邻域' }
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const px = (x + 0.5) * cellSize, py = (y + 0.5) * cellSize
    const center = id === 'bend' ? 40 + 12 * Math.sin(py / 24) : 40
    const distance = Math.abs(px - center)
    const bed = distance > 18 ? 3 + (distance - 18) * 0.1 : 0.35 * Math.pow(distance / 18, 4)
    const obstacle = id === 'obstacle' && Math.hypot(px - 40, py - 64) < 7
    const elevation = obstacle ? 4 : bed
    const depth = Math.max(0, (id === 'rapid' ? 0.7 : 2) - elevation)
    const profile = Math.max(0, 1 - Math.pow(distance / 19, 4))
    let east = 0, north = (id === 'slow' ? 0.45 : id === 'rapid' ? 3.8 : 1.5) * profile
    if (id === 'bend') {
      const tangent = 0.5 * Math.cos(py / 24)
      east = north * tangent / Math.hypot(tangent, 1)
      north /= Math.hypot(tangent, 1)
    }
    if (id === 'obstacle' && !obstacle) {
      const dx = px - 40, dy = py - 64, r2 = Math.max(49, dx * dx + dy * dy)
      east = -north * 98 * dx * dy / (r2 * r2)
      north *= 1 + 49 * (dx * dx - dy * dy) / (r2 * r2)
    }
    grid.elevation.push(elevation)
    frame.depth.push(depth)
    frame.velocityEast.push(depth > 0 ? east : 0)
    frame.velocityNorth.push(depth > 0 ? north : 0)
  }
  return { id, name: names[id], grid, frame,
    description: id === 'obstacle' ? '给定合成绕流场；并未求解障碍物绕流。' : '给定合成水深和速度；用于渲染验收，不代表真实河道。' }
}

export function createFixtureFrame(fixture: FlowFixture, time: number, withVelocity = true): FloodFrame {
  if (!Number.isFinite(time) || time < 0) throw new Error('Frame time must be finite and nonnegative')
  return { time, depth: fixture.frame.depth,
    ...(withVelocity ? { velocityEast: fixture.frame.velocityEast, velocityNorth: fixture.frame.velocityNorth } : {}) }
}
