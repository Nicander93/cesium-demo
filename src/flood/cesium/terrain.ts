import * as Cesium from 'cesium'
import type { FloodGrid } from '../core/dataset'

export interface TerrainSamplingOptions {
  level?: number
  signal?: AbortSignal
  onProgress?: (completed: number, total: number) => void
}

// Freeze TerrainProvider samples before simulation: camera LOD never changes
// the hydraulic ground. 3D Tiles are intentionally a separate obstacle input.
export async function sampleTerrainGrid(provider: Cesium.TerrainProvider, layout: FloodGrid, options: TerrainSamplingOptions = {}): Promise<FloodGrid> {
  if (!Number.isInteger(layout.columns) || !Number.isInteger(layout.rows) || layout.columns < 2 || layout.rows < 2 || layout.columns * layout.rows > 20000 || !Number.isFinite(layout.cellSize) || layout.cellSize <= 0 || layout.origin.some(v => !Number.isFinite(v))) throw new Error('计算网格尺寸或原点无效')
  if (!provider.availability && options.level === undefined) throw new Error('此地形未提供可用层级信息，请指定采样层级')
  if (options.level !== undefined && (!Number.isInteger(options.level) || options.level < 0 || options.level > 24)) throw new Error('采样层级应为 0–24 的整数')
  const matrix = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(...layout.origin))
  const inverse = Cesium.Matrix4.inverseTransformation(matrix, new Cesium.Matrix4())
  const total = layout.columns * layout.rows
  const elevation: number[] = []
  const checkCancelled = () => { if (options.signal?.aborted) throw new DOMException('地形采样已取消', 'AbortError') }
  for (let start = 0; start < total; start += 256) {
    checkCancelled()
    const positions: Cesium.Cartographic[] = []
    for (let i = start; i < Math.min(total, start + 256); i++) {
      const local = new Cesium.Cartesian3((i % layout.columns + 0.5) * layout.cellSize, (Math.floor(i / layout.columns) + 0.5) * layout.cellSize, 0)
      positions.push(Cesium.Cartographic.fromCartesian(Cesium.Matrix4.multiplyByPoint(matrix, local, new Cesium.Cartesian3())))
    }
    const sampled = options.level === undefined
      ? await Cesium.sampleTerrainMostDetailed(provider, positions)
      : await Cesium.sampleTerrain(provider, options.level, positions)
    checkCancelled()
    for (const point of sampled) {
      if (!Number.isFinite(point.height)) throw new Error('地形包含缺失高程；不能用零高程代替，请检查覆盖范围或采样层级')
      const world = Cesium.Cartesian3.fromRadians(point.longitude, point.latitude, point.height)
      elevation.push(Cesium.Matrix4.multiplyByPoint(inverse, world, new Cesium.Cartesian3()).z)
    }
    options.onProgress?.(elevation.length, total)
  }
  return { columns: layout.columns, rows: layout.rows, cellSize: layout.cellSize, origin: [...layout.origin], elevation }
}
