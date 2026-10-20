import { describe, it, expect } from 'vitest'
import { buildShorelineDistanceField } from '../shoreline'

function decode(
  field: ReturnType<typeof buildShorelineDistanceField>,
  x: number,
  y: number,
) {
  const i = (y * field.width + x) * 4
  return (
    (((field.pixels[i] * 256 + field.pixels[i + 1]) / 65535) * 2 - 1) *
    field.range
  )
}
describe('mapped shoreline distance', () => {
  it('matches analytic segment distances inside and outside, independently of winding', () => {
    const ring: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]
    for (const boundary of [ring, [...ring].reverse()]) {
      const field = buildShorelineDistanceField(
        boundary,
        [-2, -2, 12, 12],
        14,
        20,
      )
      for (let y = 0; y < 14; y++)
        for (let x = 0; x < 14; x++) {
          const px = x - 1.5,
            py = y - 1.5,
            inside = px > 0 && px < 10 && py > 0 && py < 10
          const expected = inside
            ? Math.min(px, py, 10 - px, 10 - py)
            : -Math.hypot(Math.max(0, -px, px - 10), Math.max(0, -py, py - 10))
          expect(decode(field, x, y)).toBeCloseTo(expected, 2)
        }
    }
  })
  it('does not turn a crop edge into a shoreline and preserves signed saturation', () => {
    const field = buildShorelineDistanceField(
      [
        [0, -100],
        [100, -100],
        [100, 100],
        [0, 100],
      ],
      [0, -10, 20, 10],
      20,
      8,
    )
    expect(decode(field, 0, 10)).toBeCloseTo(0.5, 2)
    expect(decode(field, 19, 10)).toBe(8)
    const exterior = buildShorelineDistanceField(
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      [-20, -20, -10, -10],
      10,
      8,
    )
    expect(decode(exterior, 0, 0)).toBe(-8)
  })
  it('retains concave water shapes and rejects malformed input', () => {
    const field = buildShorelineDistanceField(
      [
        [0, 0],
        [8, 0],
        [8, 3],
        [3, 3],
        [3, 8],
        [0, 8],
      ],
      [0, 0, 8, 8],
      8,
      10,
    )
    expect(decode(field, 1, 6)).toBeGreaterThan(0)
    expect(decode(field, 6, 6)).toBeLessThan(0)
    expect(() =>
      buildShorelineDistanceField(
        [
          [0, 0],
          [1, 0],
        ],
        [0, 0, 1, 1],
      ),
    ).toThrow()
    expect(() =>
      buildShorelineDistanceField(
        [
          [0, 0],
          [1, 0],
          [0, NaN],
        ],
        [0, 0, 1, 1],
      ),
    ).toThrow()
  })
})
