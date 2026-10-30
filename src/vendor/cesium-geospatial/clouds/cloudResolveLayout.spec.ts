import { describe, expect, it } from 'vitest'
import { Cartesian2 } from 'cesium'
import { buildCloudResolveLayout } from './cloudResolveLayout'
import { computeTemporalJitter } from './temporalMath'

describe('intermediate cloud reconstruction', () => {
  it.each([[1600, 900], [1601, 901], [7, 5]])('keeps each traced sample on its observed resolve pixel at %ix%i', (width, height) => {
    const layout = buildCloudResolveLayout(width, height, 4, 2)
    const traceWidth = Math.ceil(width / 4)
    const traceHeight = Math.ceil(height / 4)
    const samples = new Set<string>()
    for (let frame = 0; frame < 4; frame++) {
      const jitter = computeTemporalJitter(frame, traceWidth, traceHeight, new Cartesian2(), layout.upscaleDivisor)
      const x = (0.5 / traceWidth + jitter.x) * layout.width - 0.5
      const y = (0.5 / traceHeight + jitter.y) * layout.height - 0.5
      expect(x).toBeCloseTo(Math.round(x), 10)
      expect(y).toBeCloseTo(Math.round(y), 10)
      samples.add(Math.round(x) + ',' + Math.round(y))
    }
    expect(samples.size).toBe(4)
    expect(layout.width * layout.height).toBe(traceWidth * traceHeight * 4)
  })

  it('preserves the full output for existing consumers and non-quarter traces', () => {
    expect(buildCloudResolveLayout(1601, 901, 4)).toEqual({ width: 1601, height: 901, upscaleDivisor: 4 })
    expect(buildCloudResolveLayout(1601, 901, 2, 2)).toEqual({ width: 1601, height: 901, upscaleDivisor: 2 })
  })
})
