import * as Cesium from 'cesium'

export type ReservoirCoordinate = [number, number]

export interface ReservoirPolygon {
  hierarchy: Cesium.PolygonHierarchy
  rings: ReservoirCoordinate[][]
}

export interface ReservoirGeometry {
  polygons: ReservoirPolygon[]
  anchor: ReservoirCoordinate
}

export interface ReservoirHeightSample {
  height: number
  minimum: number
  maximum: number
  count: number
}

function parseRing(input: unknown): ReservoirCoordinate[] {
  if (!Array.isArray(input) || input.length < 4)
    throw new Error('水库边界环缺少有效坐标')
  const ring = input.map((value: unknown) => {
    if (
      !Array.isArray(value) ||
      value.length < 2 ||
      !Number.isFinite(value[0]) ||
      !Number.isFinite(value[1]) ||
      Math.abs(value[0]) > 180 ||
      Math.abs(value[1]) > 90
    )
      throw new Error('水库边界不是有效的 WGS84 经纬度')
    return [value[0], value[1]] as ReservoirCoordinate
  })
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first[0] === last[0] && first[1] === last[1]) ring.pop()
  if (ring.length < 3) throw new Error('水库边界环至少需要三个顶点')
  return ring
}

function ringCentroid(ring: readonly ReservoirCoordinate[]): {
  area: number
  longitude: number
  latitude: number
} {
  let twiceArea = 0
  let longitudeSum = 0
  let latitudeSum = 0
  for (let index = 0; index < ring.length; index++) {
    const a = ring[index]
    const b = ring[(index + 1) % ring.length]
    const cross = a[0] * b[1] - b[0] * a[1]
    twiceArea += cross
    longitudeSum += (a[0] + b[0]) * cross
    latitudeSum += (a[1] + b[1]) * cross
  }
  if (Math.abs(twiceArea) < 1e-12) throw new Error('水库边界环面积无效')
  return {
    area: Math.abs(twiceArea) * 0.5,
    longitude: longitudeSum / (3 * twiceArea),
    latitude: latitudeSum / (3 * twiceArea),
  }
}

/** Parse official GeoJSON while preserving every MultiPolygon part and inner ring. */
export function createReservoirHierarchies(
  geometry: ReservoirGeometry,
  height: number,
): Cesium.PolygonHierarchy[] {
  if (!Number.isFinite(height)) throw new Error('水库水面高程无效')
  const positions = (ring: readonly ReservoirCoordinate[]) =>
    ring.map(([longitude, latitude]) =>
      Cesium.Cartesian3.fromDegrees(longitude, latitude, height),
    )
  return geometry.polygons.map(
    (polygon) =>
      new Cesium.PolygonHierarchy(
        positions(polygon.rings[0]),
        polygon.rings
          .slice(1)
          .map((hole) => new Cesium.PolygonHierarchy(positions(hole))),
      ),
  )
}

export function parseReservoirGeometry(
  input: unknown,
  expectedName = 'Lac de la Gruyère',
): ReservoirGeometry {
  if (!input || typeof input !== 'object')
    throw new Error('水库边界不是 GeoJSON Feature')
  const root = input as {
    feature?: unknown
    type?: unknown
    properties?: { name?: unknown }
    geometry?: { type?: unknown; coordinates?: unknown }
  }
  const feature =
    root.feature && typeof root.feature === 'object'
      ? (root.feature as typeof root)
      : root
  if (feature.type !== 'Feature')
    throw new Error('水库边界不是 GeoJSON Feature')
  if (feature.properties?.name !== expectedName)
    throw new Error('GeoJSON 不是官方 ' + expectedName + ' 水域')
  const geometry = feature.geometry
  if (geometry?.type !== 'MultiPolygon' || !Array.isArray(geometry.coordinates))
    throw new Error('Gruyère 水域必须是 MultiPolygon')

  const polygons: ReservoirPolygon[] = []
  let weightedLongitude = 0
  let weightedLatitude = 0
  let totalArea = 0
  for (const coordinates of geometry.coordinates) {
    if (!Array.isArray(coordinates) || coordinates.length === 0)
      throw new Error('水库多边形缺少外环')
    const rings = coordinates.map(parseRing)
    const outer = ringCentroid(rings[0])
    let polygonArea = outer.area
    let longitudeMoment = outer.longitude * outer.area
    let latitudeMoment = outer.latitude * outer.area
    for (const hole of rings.slice(1)) {
      const centroid = ringCentroid(hole)
      polygonArea -= centroid.area
      longitudeMoment -= centroid.longitude * centroid.area
      latitudeMoment -= centroid.latitude * centroid.area
    }
    if (polygonArea <= 0) throw new Error('水库多边形孔洞面积异常')
    weightedLongitude += longitudeMoment
    weightedLatitude += latitudeMoment
    totalArea += polygonArea
    const positions = (ring: readonly ReservoirCoordinate[]) =>
      ring.map(([longitude, latitude]) =>
        Cesium.Cartesian3.fromDegrees(longitude, latitude),
      )
    polygons.push({
      rings,
      hierarchy: new Cesium.PolygonHierarchy(
        positions(rings[0]),
        rings
          .slice(1)
          .map((hole) => new Cesium.PolygonHierarchy(positions(hole))),
      ),
    })
  }
  if (!polygons.length || totalArea <= 0)
    throw new Error('水库没有可用的面几何')
  return {
    polygons,
    anchor: [weightedLongitude / totalArea, weightedLatitude / totalArea],
  }
}

function isInsideRing(
  point: ReservoirCoordinate,
  ring: readonly ReservoirCoordinate[],
): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside
  }
  return inside
}

function distanceToSegmentMeters(
  point: ReservoirCoordinate,
  start: ReservoirCoordinate,
  end: ReservoirCoordinate,
): number {
  const cosLatitude = Math.cos(Cesium.Math.toRadians(point[1]))
  const toLocal = ([longitude, latitude]: ReservoirCoordinate) => [
    Cesium.Math.toRadians(longitude - point[0]) *
      Cesium.Ellipsoid.WGS84.maximumRadius *
      cosLatitude,
    Cesium.Math.toRadians(latitude - point[1]) *
      Cesium.Ellipsoid.WGS84.maximumRadius,
  ]
  const a = toLocal(start)
  const b = toLocal(end)
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSquared = dx * dx + dy * dy
  const t =
    lengthSquared > 0
      ? Cesium.Math.clamp(-(a[0] * dx + a[1] * dy) / lengthSquared, 0, 1)
      : 0
  return Math.hypot(a[0] + dx * t, a[1] + dy * t)
}

function distanceToRingsMeters(
  point: ReservoirCoordinate,
  rings: readonly (readonly ReservoirCoordinate[])[],
): number {
  let minimum = Number.POSITIVE_INFINITY
  for (const ring of rings)
    for (let index = 0; index < ring.length; index++)
      minimum = Math.min(
        minimum,
        distanceToSegmentMeters(
          point,
          ring[index],
          ring[(index + 1) % ring.length],
        ),
      )
  return minimum
}

/** Select distributed interior points, excluding shorelines, islands, and holes. */
export function createReservoirSamplePoints(
  geometry: ReservoirGeometry,
): ReservoirCoordinate[] {
  const outerRings = geometry.polygons.map((polygon) => polygon.rings[0])
  const allRings = geometry.polygons.flatMap((polygon) => polygon.rings)
  const longitudes = outerRings.flatMap((ring) => ring.map((point) => point[0]))
  const latitudes = outerRings.flatMap((ring) => ring.map((point) => point[1]))
  const minLongitude = Math.min(...longitudes)
  const maxLongitude = Math.max(...longitudes)
  const minLatitude = Math.min(...latitudes)
  const maxLatitude = Math.max(...latitudes)
  const midLatitude = (minLatitude + maxLatitude) * 0.5
  const widthMeters =
    Cesium.Math.toRadians(maxLongitude - minLongitude) *
    Cesium.Ellipsoid.WGS84.maximumRadius *
    Math.cos(Cesium.Math.toRadians(midLatitude))
  const heightMeters =
    Cesium.Math.toRadians(maxLatitude - minLatitude) *
    Cesium.Ellipsoid.WGS84.maximumRadius
  const columns = Cesium.Math.clamp(Math.ceil(widthMeters / 420), 8, 28)
  const rows = Cesium.Math.clamp(Math.ceil(heightMeters / 420), 8, 72)
  const candidates: ReservoirCoordinate[] = []
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++) {
      const point: ReservoirCoordinate = [
        minLongitude +
          ((column + 0.5) / columns) * (maxLongitude - minLongitude),
        minLatitude + ((row + 0.5) / rows) * (maxLatitude - minLatitude),
      ]
      const withinWater = geometry.polygons.some(
        (polygon) =>
          isInsideRing(point, polygon.rings[0]) &&
          !polygon.rings.slice(1).some((hole) => isInsideRing(point, hole)),
      )
      if (withinWater && distanceToRingsMeters(point, allRings) >= 60)
        candidates.push(point)
    }
  if (candidates.length < 5)
    throw new Error('水域内部避岸采样点不足，未生成水面')
  const count = Math.min(48, candidates.length)
  return Array.from({ length: count }, (_, index) => {
    const candidateIndex = Math.min(
      candidates.length - 1,
      Math.floor(((index + 0.5) * candidates.length) / count),
    )
    return candidates[candidateIndex]
  })
}

/** Sample level-14 terrain only within the lake interior; the BFE metadata height is not used as water elevation. */
export async function sampleReservoirDisplayHeight(
  provider: Cesium.TerrainProvider,
  geometry: ReservoirGeometry,
): Promise<ReservoirHeightSample> {
  const points = createReservoirSamplePoints(geometry).map((point) =>
    Cesium.Cartographic.fromDegrees(...point),
  )
  const sampled = await Cesium.sampleTerrain(provider, 14, points)
  const heights = sampled
    .map((point) => point.height)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  if (heights.length < 5)
    throw new Error('水库 DEM 采样有效点少于 5 个，水面已停用')
  const minimum = heights[Math.floor((heights.length - 1) * 0.1)]
  const maximum = heights[Math.ceil((heights.length - 1) * 0.9)]
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum))
    throw new Error('水库 DEM 采样结果无效，水面已停用')
  if (maximum - minimum > 3)
    throw new Error('水域 DEM 采样高差超过 3 m，未确认可信湖面基准')
  return {
    height: maximum + 0.25,
    minimum,
    maximum,
    count: heights.length,
  }
}
