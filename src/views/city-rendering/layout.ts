export interface Point {
  x: number
  y: number
}
export interface VehiclePose extends Point {
  heading: number
}
export interface Building extends Point {
  name: string
  scale: number
  heading: number
}

export const river = { halfWidth: 48, halfLength: 320, height: 1 }
export const roads = { coast: 72, outer: 282, north: 220, south: -220 }
function roundedRectangle(
  left: number,
  right: number,
  bottom: number,
  top: number,
): Point[] {
  const radius = 12
  const centers = [
    [right - radius, bottom + radius],
    [right - radius, top - radius],
    [left + radius, top - radius],
    [left + radius, bottom + radius],
  ]
  return centers.flatMap((center, corner) =>
    Array.from({ length: 9 }, (_, step) => {
      const angle =
        -Math.PI / 2 + (corner * Math.PI) / 2 + ((step / 8) * Math.PI) / 2
      return {
        x: center[0]! + Math.cos(angle) * radius,
        y: center[1]! + Math.sin(angle) * radius,
      }
    }),
  )
}
export const trafficRoutes: Point[][] = [
  roundedRectangle(-72, 72, -220, 220),
  roundedRectangle(-282, -72, -220, 220),
  roundedRectangle(72, 282, -220, 220),
]

export function routeLength(route: readonly Point[]): number {
  if (route.length < 2)
    throw new Error('A traffic route needs at least two points')
  return route.reduce((length, point, index) => {
    const next = route[(index + 1) % route.length]!
    return length + Math.hypot(next.x - point.x, next.y - point.y)
  }, 0)
}

/** Closed loops use distance, so speed is independent of segment length and frame rate. */
export function vehiclePose(
  route: readonly Point[],
  distance: number,
  laneOffset = 4,
): VehiclePose {
  const total = routeLength(route)
  if (!Number.isFinite(distance) || total <= 0)
    throw new Error('Invalid route distance')
  let remaining = ((distance % total) + total) % total
  for (let index = 0; index < route.length; index++) {
    const a = route[index]!,
      b = route[(index + 1) % route.length]!
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (!length) continue
    if (remaining < length || index === route.length - 1) {
      const dx = (b.x - a.x) / length,
        dy = (b.y - a.y) / length
      return {
        x: a.x + dx * remaining + dy * laneOffset,
        y: a.y + dy * remaining - dx * laneOffset,
        heading: Math.atan2(dy, dx) + Math.PI / 2,
      }
    }
    remaining -= length
  }
  throw new Error('Invalid route geometry')
}

export function cityBuildings(): Building[] {
  const result: Building[] = []
  for (const side of [-1, 1]) {
    for (let row = 0; row < 4; row++)
      for (let column = 0; column < 3; column++) {
        const index = result.length
        const tower = column === 0 && (row === 1 || row === 2)
        result.push({
          x: side * [123, 194, 251][column]!,
          y: [-165, -55, 55, 165][row]!,
          name: tower
            ? `building-skyscraper-${'abcde'[index % 5]}`
            : `building-${'abcdefghijklmn'[index % 14]}`,
          scale: tower ? 31 + (index % 4) * 5 : 20 + (index % 3) * 3,
          heading: side === 1 ? Math.PI / 2 : -Math.PI / 2,
        })
      }
  }
  return result
}
