import { describe, expect, it } from 'vitest'
import { coastShoreX } from './coast-layout'

describe('coastal presentation layout', () => {
  it('curves the shoreline across the north-south axis', () => {
    const samples = [-1200, -600, 0, 600, 1200].map(coastShoreX)
    expect(new Set(samples).size).toBe(samples.length)
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(100)
  })

  it('keeps the sampled shoreline continuous without sharp breaks', () => {
    const samples = Array.from({ length: 33 }, (_, index) =>
      coastShoreX(-1600 + index * 100),
    )
    const largestStep = Math.max(
      ...samples.slice(1).map((value, index) => Math.abs(value - samples[index]!)),
    )
    expect(largestStep).toBeLessThan(80)
  })
})
