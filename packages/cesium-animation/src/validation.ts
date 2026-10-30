import { Cartesian3, Color } from 'cesium'
import type { GeoPoint } from './types.js'

export function validateNumber(
  name: string,
  value: number,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`${name} must be finite and in [${min}, ${max}]`)
  }
  return value
}

export function validatePoint(point: GeoPoint): void {
  if (!point || typeof point !== 'object')
    throw new TypeError('A WGS84 GeoPoint is required')
  validateKeys(point, ['lon', 'lat', 'height'])
  validateNumber('lon', point.lon, -180, 180)
  validateNumber('lat', point.lat, -90, 90)
  if (point.height !== undefined && !Number.isFinite(point.height))
    throw new RangeError('height must be finite')
}

export function validatePositions(points: GeoPoint[]): Cartesian3[] {
  if (!Array.isArray(points) || points.length < 2)
    throw new RangeError('positions requires at least two points')
  const positions = points.map((point) => {
    validatePoint(point)
    return Cartesian3.fromDegrees(point.lon, point.lat, point.height ?? 0)
  })
  for (let i = 1; i < positions.length; i++) {
    if (Cartesian3.distance(positions[i - 1]!, positions[i]!) < 0.001) {
      throw new RangeError(
        'Consecutive path points must be at least 1 mm apart',
      )
    }
  }
  return positions
}

export function parseColor(value: string): Color {
  if (typeof value !== 'string')
    throw new TypeError('color must be a CSS color string')
  const color = Color.fromCssColorString(value)
  if (!color) throw new RangeError('color must be a valid CSS color')
  return color
}

export function validateKeys(patch: object, allowed: readonly string[]): void {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch))
    throw new TypeError('options must be an object')
  for (const key of Object.keys(patch)) {
    if (!allowed.includes(key))
      throw new Error(`Unsupported option or hot update: ${key}`)
  }
}
