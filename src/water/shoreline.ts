import * as Cesium from 'cesium'

type Point = readonly [number, number]
export const shorelineRange = 64

/** Signed distance to the supplied real boundary; clipping edges are never added. */
export function buildShorelineDistanceField(
  ring: readonly Point[],
  bounds: readonly [number, number, number, number],
  resolution = 1024,
  range = shorelineRange,
) {
  if (
    ring.length < 3 ||
    ring.length > 20000 ||
    ring.some((p) => !p.every(Number.isFinite))
  )
    throw new RangeError('Invalid shoreline ring')
  const area = ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length]
    return sum + p[0] * q[1] - q[0] * p[1]
  }, 0)
  if (Math.abs(area) < 1e-6)
    throw new RangeError('Shoreline must enclose a nonzero area')
  const [left, bottom, right, top] = bounds
  if (
    !bounds.every(Number.isFinite) ||
    right <= left ||
    top <= bottom ||
    !Number.isInteger(resolution) ||
    resolution < 2 ||
    resolution > 2048 ||
    !Number.isFinite(range) ||
    range <= 0
  )
    throw new RangeError('Invalid shoreline grid')
  const scale = resolution / Math.max(right - left, top - bottom)
  const width = Math.max(2, Math.ceil((right - left) * scale)),
    height = Math.max(2, Math.ceil((top - bottom) * scale))
  const dx = (right - left) / width,
    dy = (top - bottom) / height
  const distances = new Float64Array(width * height).fill(range * range)
  // Only visit the expanded bounding box of each segment. Remote shoreline segments
  // still participate in the inside test, but do not require a full-grid distance scan.
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length],
      vx = b[0] - a[0],
      vy = b[1] - a[1],
      length2 = vx * vx + vy * vy
    if (!length2) continue
    const x0 = Math.max(
        0,
        Math.floor((Math.min(a[0], b[0]) - range - left) / dx),
      ),
      x1 = Math.min(
        width - 1,
        Math.ceil((Math.max(a[0], b[0]) + range - left) / dx),
      )
    const y0 = Math.max(
        0,
        Math.floor((Math.min(a[1], b[1]) - range - bottom) / dy),
      ),
      y1 = Math.min(
        height - 1,
        Math.ceil((Math.max(a[1], b[1]) + range - bottom) / dy),
      )
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const px = left + (x + 0.5) * dx - a[0],
          py = bottom + (y + 0.5) * dy - a[1]
        const t = Math.max(0, Math.min(1, (px * vx + py * vy) / length2))
        const squared = (px - t * vx) ** 2 + (py - t * vy) ** 2,
          index = y * width + x
        if (squared < distances[index]) distances[index] = squared
      }
  }
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const py = bottom + (y + 0.5) * dy,
      intersections: number[] = []
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i],
        b = ring[(i + 1) % ring.length]
      if (a[1] > py !== b[1] > py)
        intersections.push(a[0] + ((py - a[1]) * (b[0] - a[0])) / (b[1] - a[1]))
    }
    intersections.sort((a, b) => a - b)
    let crossing = 0
    for (let x = 0; x < width; x++) {
      const px = left + (x + 0.5) * dx
      while (crossing < intersections.length && intersections[crossing] <= px)
        crossing++
      const signed =
        Math.sqrt(distances[y * width + x]) * (crossing % 2 ? 1 : -1)
      const code = Math.round(((signed / range) * 0.5 + 0.5) * 65535),
        index = (y * width + x) * 4
      pixels[index] = code >> 8
      pixels[index + 1] = code & 255
      pixels[index + 3] = 255
    }
  }
  return { pixels, width, height, bounds, range, texelSize: Math.max(dx, dy) }
}

/** Static, host-supplied mapped shoreline in the same local ENU frame as WaterSurface. */
export function createShorelineMask(
  boundary: readonly Cesium.Cartographic[],
  positions: readonly Cesium.Cartographic[],
  origin: Cesium.Cartesian3,
  height: number,
) {
  if (
    boundary.some(
      (p) =>
        !Number.isFinite(p.longitude) ||
        !Number.isFinite(p.latitude) ||
        Math.abs(p.longitude) > Math.PI ||
        Math.abs(p.latitude) > Math.PI / 2,
    )
  )
    throw new RangeError('Invalid shoreline coordinates')
  const inverse = Cesium.Matrix4.inverse(
    Cesium.Transforms.eastNorthUpToFixedFrame(origin),
    new Cesium.Matrix4(),
  )
  const project = (p: Cesium.Cartographic): Point => {
    const local = Cesium.Matrix4.multiplyByPoint(
      inverse,
      Cesium.Cartesian3.fromRadians(p.longitude, p.latitude, height),
      new Cesium.Cartesian3(),
    )
    return [local.x, local.y]
  }
  const polygon = positions.map(project),
    padding = shorelineRange
  const bounds: [number, number, number, number] = [
    Math.min(...polygon.map((p) => p[0])) - padding,
    Math.min(...polygon.map((p) => p[1])) - padding,
    Math.max(...polygon.map((p) => p[0])) + padding,
    Math.max(...polygon.map((p) => p[1])) + padding,
  ]
  const field = buildShorelineDistanceField(boundary.map(project), bounds)
  const canvas = document.createElement('canvas')
  canvas.width = field.width
  canvas.height = field.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Shoreline mask requires a 2D canvas')
  context.putImageData(
    new ImageData(field.pixels, field.width, field.height),
    0,
    0,
  )
  return {
    canvas,
    width: field.width,
    height: field.height,
    texelSize: field.texelSize,
    bounds: new Cesium.Cartesian4(
      bounds[0],
      bounds[1],
      bounds[2] - bounds[0],
      bounds[3] - bounds[1],
    ),
  }
}
