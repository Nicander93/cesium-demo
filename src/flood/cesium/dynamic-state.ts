import type { FloodFrame, FloodGrid } from '../core/dataset'
import { createFloodSurfaceState } from './surface-state'

/** Validate before changing transport history or GPU staging buffers. */
export function validateRenderFrame(grid: FloodGrid, frame: FloodFrame): void {
  const count = grid.columns * grid.rows
  if (
    !Number.isFinite(frame.time) ||
    frame.time < 0 ||
    frame.depth.length !== count
  )
    throw new RangeError('洪水帧时间或水深长度无效')
  if (
    (frame.velocityEast === undefined) !==
    (frame.velocityNorth === undefined)
  )
    throw new RangeError('流速分量必须同时提供或同时省略')
  if (
    frame.velocityEast &&
    (frame.velocityEast.length !== count ||
      frame.velocityNorth?.length !== count)
  )
    throw new RangeError('流速数组与网格不一致')
  for (let i = 0; i < count; i++) {
    const h = frame.depth[i],
      e = frame.velocityEast?.[i] ?? 0,
      n = frame.velocityNorth?.[i] ?? 0
    if (
      !Number.isFinite(Math.fround(h)) ||
      h < 0 ||
      !Number.isFinite(Math.fround(grid.elevation[i] + h + 0.035)) ||
      !Number.isFinite(Math.fround(e)) ||
      !Number.isFinite(Math.fround(n))
    )
      throw new RangeError('洪水帧包含无效或超出 GPU 浮点范围的值')
    if (grid.active?.[i] === false && h !== 0)
      throw new RangeError('无效单元的水深必须为 0')
  }
}

/** Static triangle data duplicates vertices to carry a flat per-triangle wet mask. */
export function createDynamicTopology(grid: FloodGrid): Float32Array {
  const vertices: number[] = []
  const add = (a: number, b: number, c: number) => {
    if (grid.active && (!grid.active[a] || !grid.active[b] || !grid.active[c]))
      return
    for (const cell of [a, b, c]) vertices.push(cell, a, b, c)
  }
  for (let y = 0; y < grid.rows - 1; y++)
    for (let x = 0; x < grid.columns - 1; x++) {
      const a = y * grid.columns + x
      add(a, a + 1, a + grid.columns)
      add(a + 1, a + grid.columns + 1, a + grid.columns)
    }
  return new Float32Array(vertices)
}

export class DynamicFloodState {
  readonly surface: Float32Array
  readonly foam: Float32Array
  time = 0
  minimumHeight = 0
  maximumHeight = 0
  constructor(readonly grid: FloodGrid) {
    const count = grid.columns * grid.rows
    if (
      !Number.isInteger(grid.columns) ||
      !Number.isInteger(grid.rows) ||
      grid.columns < 2 ||
      grid.rows < 2 ||
      count > 20000 ||
      grid.elevation.length !== count ||
      !Number.isFinite(grid.cellSize) ||
      grid.cellSize <= 0
    )
      throw new RangeError('动态洪水网格无效')
    this.surface = new Float32Array(count * 4)
    this.foam = new Float32Array(count * 4)
  }
  update(
    frame: FloodFrame,
    coverage: ArrayLike<number>,
    sources: ArrayLike<number>,
  ): void {
    validateRenderFrame(this.grid, frame)
    const count = this.grid.columns * this.grid.rows
    if (coverage.length !== count || sources.length !== count)
      throw new RangeError('泡沫数组与网格不一致')
    for (let i = 0; i < count; i++)
      if (
        !Number.isFinite(Math.fround(coverage[i])) ||
        !Number.isFinite(Math.fround(sources[i]))
      )
        throw new RangeError('泡沫状态无效')
    const visual = createFloodSurfaceState(this.grid, frame, true)
    let low = Infinity,
      high = -Infinity
    for (let i = 0; i < count; i++) {
      const offset = i * 4
      this.surface[offset] = visual.heights[i]
      this.surface[offset + 1] = visual.depths[i]
      this.surface[offset + 2] = frame.velocityEast?.[i] ?? 0
      this.surface[offset + 3] = frame.velocityNorth?.[i] ?? 0
      this.foam[offset] = coverage[i]
      this.foam[offset + 1] = sources[i]
      // Classify in the input precision, just like CPU topology, before Float32 quantization.
      this.foam[offset + 2] = frame.depth[i] >= 0.02 ? 1 : 0
      low = Math.min(low, visual.heights[i])
      high = Math.max(high, visual.heights[i])
    }
    this.minimumHeight = low
    this.maximumHeight = high
    this.time = frame.time
  }
}
