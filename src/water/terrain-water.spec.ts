import { describe, expect, it } from 'vitest'
import {
  clipWaterRing,
  isInsideWater,
  parseBrienzBoundary,
  brienzBounds,
} from './terrain-water'
import fs from 'node:fs'
describe('explicit geographic water boundary', () => {
  it('clips both closed and open rings without inferring water from terrain', () => {
    const open: [number, number][] = [
      [-1, -1],
      [2, -1],
      [2, 2],
      [-1, 2],
    ]
    const clipped = clipWaterRing(open, [0, 0, 1, 1])
    expect(clipped.length).toBe(4)
    expect(
      clipped.every((p) => p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1),
    ).toBe(true)
    expect(isInsideWater([0.5, 0.5], clipped)).toBe(true)
    expect(clipWaterRing([...open, open[0]], [0, 0, 1, 1])).toEqual(clipped)
  })
  it('uses the bundled official MultiPolygon and rejects missing water data', () => {
    const data = JSON.parse(
      fs.readFileSync('public/water/brienz-water.geojson', 'utf8'),
    )
    const ring = parseBrienzBoundary(data)
    expect(ring.length).toBeGreaterThan(3)
    expect(
      ring.every(
        (p) =>
          p[0] >= brienzBounds[0] &&
          p[0] <= brienzBounds[2] &&
          p[1] >= brienzBounds[1] &&
          p[1] <= brienzBounds[3],
      ),
    ).toBe(true)
    expect(() => parseBrienzBoundary({})).toThrow()
  })
})
