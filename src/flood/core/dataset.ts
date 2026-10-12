import type { FloodBarriers } from './hydraulics'
import { validateDamBreach, type DamBreachOptions } from './breach'

export interface FloodGrid {
  columns: number
  rows: number
  cellSize: number
  origin: [number, number, number]
  elevation: number[]
  active?: boolean[]
}

export interface FloodFrame {
  time: number
  depth: number[]
  velocityEast?: number[]
  velocityNorth?: number[]
}

export interface FloodDataset {
  format: 'cesium-flood-grid'
  version: 1
  name: string
  coordinates: 'local-enu'
  verticalDatum: 'WGS84-ellipsoid'
  units: { length: 'm'; time: 's'; velocity: 'm/s' }
  grid: FloodGrid
  frames: FloodFrame[]
  structures?: { barriers: FloodBarriers; damBreach?: DamBreachOptions }
}

// Limits bound JSON memory and synchronous validation work in the browser.
const maxCells = 20000
const maxSamples = 2000000

export function parseFloodDataset(input: unknown): FloodDataset {
  function object(value: unknown, name: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} 必须是对象`)
    return value as Record<string, unknown>
  }
  function finite(value: unknown, name: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} 必须是有限数值`)
    return value
  }
  function numbers(value: unknown, length: number, name: string, nonnegative = false): number[] {
    if (!Array.isArray(value) || value.length !== length) throw new Error(`${name} 需要 ${length} 个数值`)
    return value.map((item, i) => {
      const n = finite(item, `${name}[${i}]`)
      if (nonnegative && n < 0) throw new Error(`${name} 不能包含负数`)
      return n
    })
  }
  const data = object(input, '数据')
  if (data.format !== 'cesium-flood-grid' || data.version !== 1) throw new Error('仅支持 cesium-flood-grid v1')
  if (data.coordinates !== 'local-enu' || data.verticalDatum !== 'WGS84-ellipsoid') {
    throw new Error('请先转换为局部 ENU 坐标及 WGS84 椭球高；不要直接混用正高或投影坐标')
  }
  const units = object(data.units, 'units')
  if (units.length !== 'm' || units.time !== 's' || units.velocity !== 'm/s') throw new Error('单位必须为 m、s、m/s')
  const sourceGrid = object(data.grid, 'grid')
  const columns = finite(sourceGrid.columns, 'columns')
  const rows = finite(sourceGrid.rows, 'rows')
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 2 || rows < 2 || columns * rows > maxCells) {
    throw new Error(`网格必须至少 2 × 2，最多 ${maxCells} 个单元`)
  }
  const cellSize = finite(sourceGrid.cellSize, 'cellSize')
  if (cellSize <= 0) throw new Error('cellSize 必须大于 0')
  const origin = numbers(sourceGrid.origin, 3, 'origin') as [number, number, number]
  if (Math.abs(origin[0]) > 180 || Math.abs(origin[1]) > 90) throw new Error('origin 经纬度超出范围')
  if (Math.max(columns, rows) * cellSize > 20000) throw new Error('v1 局部网格最长边不超过 20 km')
  const count = columns * rows
  const grid: FloodGrid = { columns, rows, cellSize, origin, elevation: numbers(sourceGrid.elevation, count, 'elevation') }
  if (sourceGrid.active !== undefined) {
    if (!Array.isArray(sourceGrid.active) || sourceGrid.active.length !== count || !sourceGrid.active.every(item => typeof item === 'boolean')) throw new Error('active 必须为与网格同长的布尔数组')
    grid.active = sourceGrid.active
  }
  if (!Array.isArray(data.frames) || data.frames.length === 0 || data.frames.length * count > maxSamples) {
    throw new Error(`frames 不能为空，最多 ${maxSamples} 个时间-单元样本`)
  }
  let previousTime = -Infinity
  const frames = data.frames.map((item, index): FloodFrame => {
    const f = object(item, `frames[${index}]`)
    const time = finite(f.time, 'time')
    if (time < 0 || time <= previousTime) throw new Error('时间必须非负且严格递增')
    previousTime = time
    const frame: FloodFrame = { time, depth: numbers(f.depth, count, 'depth', true) }
    if (grid.active?.some((active, i) => !active && frame.depth[i] !== 0)) throw new Error('无效单元的水深必须为 0')
    if ((f.velocityEast === undefined) !== (f.velocityNorth === undefined)) throw new Error('流速分量必须同时提供或同时省略')
    if (f.velocityEast !== undefined) {
      frame.velocityEast = numbers(f.velocityEast, count, 'velocityEast')
      frame.velocityNorth = numbers(f.velocityNorth, count, 'velocityNorth')
    }
    return frame
  })
  if (frames.some(f => !!f.velocityEast !== !!frames[0].velocityEast)) throw new Error('所有帧的流速字段必须保持一致')
  let structures: FloodDataset['structures']
  if (data.structures !== undefined) {
    const source = object(data.structures, 'structures')
    const inputBarriers = object(source.barriers, 'barriers')
    function crests(value: unknown, length: number): (number | null)[] {
      if (!Array.isArray(value) || value.length !== length) throw new Error('挡墙数组长度无效')
      return value.map(v => v === null ? null : finite(v, 'crest'))
    }
    structures = { barriers: { east: crests(inputBarriers.east, (columns + 1) * rows), north: crests(inputBarriers.north, columns * (rows + 1)) } }
    if (source.damBreach !== undefined) {
      const breach = object(source.damBreach, 'damBreach')
      const options: DamBreachOptions = { row: finite(breach.row, 'row'), center: finite(breach.center, 'center'), finalWidth: finite(breach.finalWidth, 'finalWidth'),
        finalBottomElevation: finite(breach.finalBottomElevation, 'finalBottomElevation'), startTime: finite(breach.startTime, 'startTime'), formationTime: finite(breach.formationTime, 'formationTime') }
      validateDamBreach(grid, structures.barriers, options)
      structures.damBreach = options
    }
  }
  return { format: 'cesium-flood-grid', version: 1, name: typeof data.name === 'string' ? data.name.slice(0, 100) : '外部推演', coordinates: 'local-enu', verticalDatum: 'WGS84-ellipsoid', units: { length: 'm', time: 's', velocity: 'm/s' }, grid, frames, ...(structures ? { structures } : {}) }
}

export function createDataset(grid: FloodGrid, frames: FloodFrame[], name = '小山谷泄洪'): FloodDataset {
  return { format: 'cesium-flood-grid', version: 1, name, coordinates: 'local-enu', verticalDatum: 'WGS84-ellipsoid', units: { length: 'm', time: 's', velocity: 'm/s' }, grid, frames }
}

export function interpolateFrame(frames: FloodFrame[], time: number): FloodFrame {
  if (time <= frames[0].time) return frames[0]
  const last = frames[frames.length - 1]
  if (time >= last.time) return last
  let left = 0
  let right = frames.length - 1
  while (right - left > 1) {
    const middle = (left + right) >> 1
    if (frames[middle].time <= time) left = middle
    else right = middle
  }
  const a = frames[left]
  const b = frames[right]
  const t = (time - a.time) / (b.time - a.time)
  const mix = (x: number[], y: number[]) => x.map((v, i) => v + (y[i] - v) * t)
  const frame: FloodFrame = { time, depth: mix(a.depth, b.depth) }
  if (a.velocityEast && a.velocityNorth && b.velocityEast && b.velocityNorth) {
    frame.velocityEast = mix(a.velocityEast, b.velocityEast)
    frame.velocityNorth = mix(a.velocityNorth, b.velocityNorth)
  }
  return frame
}

export function createValleyGrid(): FloodGrid {
  const columns = 48
  const rows = 88
  const cellSize = 12
  const elevation = Array.from({ length: columns * rows }, (_, i) => {
    const east = (i % columns + 0.5) * cellSize
    const north = (Math.floor(i / columns) + 0.5) * cellSize
    const center = columns * cellSize / 2 + 48 * Math.sin(north / 190)
    const bank = Math.max(0, Math.abs(east - center) - 28)
    const basin = 3 * Math.exp(-(((east - center - 50) / 60) ** 2) - ((north - 710) / 110) ** 2)
    return 30 - 0.018 * north + 0.003 * bank ** 2 - basin
  })
  return { columns, rows, cellSize, origin: [119, 33, 0], elevation }
}
