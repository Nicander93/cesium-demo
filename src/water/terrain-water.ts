import * as Cesium from 'cesium'

export type WaterCoordinate = [number, number]
export type WaterBounds = [number, number, number, number]
export const brienzBounds: WaterBounds = [7.884, 46.688, 7.901, 46.701]

/** Clip a known geographic water boundary; this never infers a river from a DEM. */
export function clipWaterRing(
  ring: readonly WaterCoordinate[],
  bounds: WaterBounds,
): WaterCoordinate[] {
  const closed =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
  let result = closed ? ring.slice(0, -1) : [...ring]
  for (const [axis, value, greater] of [
    [0, bounds[0], true],
    [0, bounds[2], false],
    [1, bounds[1], true],
    [1, bounds[3], false],
  ] as const) {
    const input = result
    result = []
    if (!input.length) break
    const inside = (p: WaterCoordinate) =>
      greater ? p[axis] >= value : p[axis] <= value
    for (let i = 0; i < input.length; i++) {
      const a = input[i],
        b = input[(i + 1) % input.length],
        inA = inside(a),
        inB = inside(b)
      if (inA) result.push(a)
      if (inA !== inB) {
        const t = (value - a[axis]) / (b[axis] - a[axis])
        result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
      }
    }
  }
  return result
}

export function isInsideWater(
  point: WaterCoordinate,
  ring: readonly WaterCoordinate[],
): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j]
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside
  }
  return inside
}

export function parseBrienzWater(input: unknown): { ring: WaterCoordinate[]; shoreline: WaterCoordinate[] } {
  if (!input || typeof input !== 'object')
    throw new Error('水域数据不是 GeoJSON Feature')
  const geometry = (
    input as { geometry?: { type?: unknown; coordinates?: unknown } }
  ).geometry
  if (geometry?.type !== 'MultiPolygon' || !Array.isArray(geometry.coordinates))
    throw new Error('预设水域必须是 MultiPolygon')
  const polygon = geometry.coordinates[0]
  if (!Array.isArray(polygon) || !Array.isArray(polygon[0]))
    throw new Error('水域边界缺失')
  const ring: WaterCoordinate[] = polygon[0].map((p: unknown) => {
    if (
      !Array.isArray(p) ||
      p.length < 2 ||
      !Number.isFinite(p[0]) ||
      !Number.isFinite(p[1]) ||
      Math.abs(p[0]) > 180 ||
      Math.abs(p[1]) > 90
    )
      throw new Error('水域坐标不是 WGS84 经纬度')
    return [p[0], p[1]]
  })
  // This local crop avoids the source island. Reject if a hole reaches the crop rather than fill it.
  for (const hole of polygon.slice(1))
    if (Array.isArray(hole) && clipWaterRing(hole, brienzBounds).length >= 3)
      throw new Error('当前裁剪区域有水域孔洞，不能用无洞水面覆盖')
  const clipped = clipWaterRing(ring, brienzBounds)
  if (clipped.length < 3) throw new Error('水域不覆盖当前真实场景')
  return { ring: clipped, shoreline: ring }
}

export function parseBrienzBoundary(input: unknown): WaterCoordinate[] {
  return parseBrienzWater(input).ring
}

/** Sample the terrain service's mapped lake surface; no bathymetry or observed water level is implied. */
export async function sampleLakeDisplayHeight(
  provider: Cesium.TerrainProvider,
  ring: readonly WaterCoordinate[],
): Promise<{
  height: number
  minimum: number
  maximum: number
  count: number
}> {
  const points: Cesium.Cartographic[] = []
  for (let y = 1; y < 8; y++)
    for (let x = 1; x < 8; x++) {
      const point: WaterCoordinate = [
        brienzBounds[0] + ((brienzBounds[2] - brienzBounds[0]) * x) / 8,
        brienzBounds[1] + ((brienzBounds[3] - brienzBounds[1]) * y) / 8,
      ]
      if (isInsideWater(point, ring))
        points.push(Cesium.Cartographic.fromDegrees(...point))
    }
  if (points.length < 3) throw new Error('水域内缺少足够的地形湖面采样点')
  const sampled = await Cesium.sampleTerrain(provider, 14, points)
  const heights = sampled.map((p) => p.height).sort((a, b) => a - b)
  if (heights.some((h) => !Number.isFinite(h)))
    throw new Error('湖面 DEM 高程缺失，停止生成水面')
  const minimum = heights[0],
    maximum = heights[heights.length - 1]
  if (maximum - minimum > 3)
    throw new Error('DEM 湖面采样不近似平面，请显式提供可信水位后再生成水面')
  return { height: maximum + 0.25, minimum, maximum, count: heights.length }
}
