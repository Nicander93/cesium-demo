import { createDataset, parseFloodDataset, type FloodDataset, type FloodGrid } from './dataset'
import type { FloodBarriers } from './hydraulics'
import { getBreachFace, validateDamBreachState, type DamBreachState } from './breach'

export interface InundationOptions {
  waterLevel: number
  /** Omit for all terrain below the level; provide seeds to require hydraulic connectivity. */
  seedCells?: readonly number[]
  barriers?: FloodBarriers
  damBreach?: DamBreachState
}

export interface InundationResult {
  format: 'cesium-inundation'
  version: 1
  waterLevel: number
  connected: boolean
  depth: number[]
  wet: boolean[]
  area: number
  volume: number
  maxDepth: number
  touchesBoundary: boolean
}

function validatedGrid(grid: FloodGrid): FloodGrid {
  const count = grid.columns * grid.rows
  if (!Number.isInteger(count) || count < 4 || count > 20000) throw new Error('分析网格大小无效')
  return parseFloodDataset(createDataset(grid, [{ time: 0, depth: new Array<number>(count).fill(0) }])).grid
}

// Static equal-stage inundation, with four-neighbour terrain / wall connectivity.
export function analyzeInundation(input: FloodGrid, options: InundationOptions): InundationResult {
  const grid = validatedGrid(input)
  const { columns, rows, cellSize, elevation, active } = grid
  const { waterLevel, seedCells, barriers } = options
  if (!Number.isFinite(waterLevel)) throw new Error('淹没水位必须是有限的 ENU 高程')
  if (barriers && (barriers.east.length !== (columns + 1) * rows || barriers.north.length !== columns * (rows + 1)
    || [...barriers.east, ...barriers.north].some(v => v !== null && !Number.isFinite(v)))) throw new Error('挡墙数组无效')
  if (options.damBreach) validateDamBreachState(grid, barriers, options.damBreach)
  const count = columns * rows
  const eligible = elevation.map((z, i) => active?.[i] !== false && z < waterLevel)
  const wet = new Array<boolean>(count).fill(false)
  if (seedCells) {
    if (!seedCells.length || seedCells.some(i => !Number.isInteger(i) || i < 0 || i >= count)) throw new Error('淹没水源单元无效')
    const queue = [...new Set(seedCells)].filter(i => eligible[i])
    for (const i of queue) wet[i] = true
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head]
      const x = i % columns
      const y = Math.floor(i / columns)
      function visit(next: number, crest: number | null | undefined): void {
        if (!eligible[next] || wet[next] || (crest != null && waterLevel <= crest)) return
        wet[next] = true
        queue.push(next)
      }
      if (x > 0) visit(i - 1, barriers?.east[y * (columns + 1) + x])
      if (x < columns - 1) visit(i + 1, barriers?.east[y * (columns + 1) + x + 1])
      function northCrest(row: number): number | null | undefined {
        const crest = barriers?.north[row * columns + x]
        if (!options.damBreach || !barriers || options.damBreach.row !== row) return crest
        const opening = getBreachFace(grid, barriers, options.damBreach, x)
        return opening.fraction > 0 ? opening.crest : crest
      }
      if (y > 0) visit(i - columns, northCrest(y))
      if (y < rows - 1) visit(i + columns, northCrest(y + 1))
    }
  } else for (let i = 0; i < count; i++) wet[i] = eligible[i]
  const depth = elevation.map((z, i) => wet[i] ? waterLevel - z : 0)
  const area = wet.filter(Boolean).length * cellSize ** 2
  const volume = depth.reduce((sum, h) => sum + h, 0) * cellSize ** 2
  const touchesBoundary = wet.some((v, i) => v && (i % columns === 0 || i % columns === columns - 1 || i < columns || i >= count - columns))
  return { format: 'cesium-inundation', version: 1, waterLevel, connected: seedCells !== undefined,
    depth, wet, area, volume, maxDepth: Math.max(...depth), touchesBoundary }
}

export interface FloodAnalysis {
  format: 'cesium-flood-analysis'
  version: 1
  depthThreshold: number
  fromTime: number
  toTime: number
  maximumDepth: (number | null)[]
  maximumDepthTime: (number | null)[]
  arrivalTime: (number | null)[]
  inundationDuration: (number | null)[]
  inundatedArea: number
  peakSampledArea: number
  maxDepth: number
  areaSeries: { time: number; area: number; volume: number }[]
}

export type FloodAnalysisMetric = 'maximumDepth' | 'arrivalTime' | 'inundationDuration'

// Results are restricted to the input observation window. Threshold crossings
// use piecewise-linear depth; dry / inactive cells remain null, not zero-time arrivals.
export function analyzeFloodDataset(input: FloodDataset, options: { depthThreshold?: number } = {}): FloodAnalysis {
  const dataset = parseFloodDataset(input)
  const threshold = options.depthThreshold ?? 0.02
  if (!Number.isFinite(threshold) || threshold <= 0) throw new Error('分析水深阈值必须大于 0')
  const { grid, frames } = dataset
  const count = grid.columns * grid.rows
  const maximumDepth = new Array<number | null>(count).fill(null)
  const maximumDepthTime = new Array<number | null>(count).fill(null)
  const arrivalTime = new Array<number | null>(count).fill(null)
  const inundationDuration = new Array<number | null>(count).fill(null)
  const areaSeries = frames.map(frame => ({ time: frame.time,
    area: frame.depth.filter((h, i) => grid.active?.[i] !== false && h >= threshold).length * grid.cellSize ** 2,
    volume: frame.depth.reduce((sum, h, i) => sum + (grid.active?.[i] !== false ? h : 0), 0) * grid.cellSize ** 2 }))
  let maxDepth = 0
  for (let i = 0; i < count; i++) {
    if (grid.active?.[i] === false) continue
    let peak = -1
    let peakTime = frames[0].time
    let arrival: number | null = null
    let duration = 0
    for (let f = 0; f < frames.length; f++) {
      const current = frames[f]
      const h = current.depth[i]
      if (h > peak) { peak = h; peakTime = current.time }
      if (arrival === null && h >= threshold) {
        const previous = frames[f - 1]
        arrival = previous && previous.depth[i] < threshold
          ? previous.time + (current.time - previous.time) * (threshold - previous.depth[i]) / (h - previous.depth[i])
          : current.time
      }
      if (f === 0) continue
      const previous = frames[f - 1]
      const before = previous.depth[i]
      const dt = current.time - previous.time
      if (before >= threshold && h >= threshold) duration += dt
      else if (before < threshold && h >= threshold) duration += dt * (h - threshold) / (h - before)
      else if (before >= threshold && h < threshold) duration += dt * (before - threshold) / (before - h)
    }
    maxDepth = Math.max(maxDepth, peak)
    if (peak >= threshold) { maximumDepth[i] = peak; maximumDepthTime[i] = peakTime; arrivalTime[i] = arrival; inundationDuration[i] = duration }
  }
  return { format: 'cesium-flood-analysis', version: 1, depthThreshold: threshold,
    fromTime: frames[0].time, toTime: frames[frames.length - 1].time,
    maximumDepth, maximumDepthTime, arrivalTime, inundationDuration,
    inundatedArea: maximumDepth.filter(v => v !== null).length * grid.cellSize ** 2,
    peakSampledArea: areaSeries.reduce((peak, v) => Math.max(peak, v.area), 0), maxDepth, areaSeries }
}
