import { Cartesian2, Matrix4 } from 'cesium'
import { describe, expect, it } from 'vitest'
import { bayerIndices, computeTemporalJitter, isTemporalCameraStable } from './temporalMath'

function snapshot() {
  const viewMatrix = Matrix4.clone(Matrix4.IDENTITY)
  viewMatrix[12] = 2_581_000
  return { viewMatrix, projectionMatrix: Matrix4.clone(Matrix4.IDENTITY) }
}

describe('Bayer sample correspondence', () => {
  it('samples the pixel selected by the resolve mask at every phase', () => {
    for (const divisor of [2, 4] as const) {
      const indices = divisor === 2 ? [0, 2, 3, 1] : bayerIndices
      const positions = new Set<string>()
      for (let frame = 0; frame < divisor * divisor; frame++) {
        const jitter = computeTemporalJitter(frame, 100, 80, new Cartesian2(), divisor)
        const x = Math.round((0.5 + jitter.x * 100) * divisor - 0.5)
        const y = Math.round((0.5 + jitter.y * 80) * divisor - 0.5)
        expect(indices[y * divisor + x]).toBe(frame)
        positions.add(x + ',' + y)
      }
      expect(positions.size).toBe(divisor * divisor)
    }
  })
})

describe('fixed-scene camera stability', () => {
  it('requires a previous camera before accumulating history', () => {
    const current = snapshot()
    expect(isTemporalCameraStable(undefined, current.viewMatrix, current.projectionMatrix)).toBe(false)
  })

  it('accepts ECEF matrix recomputation noise at a stationary camera', () => {
    const previous = snapshot()
    const current = snapshot()
    current.viewMatrix[12] += 5e-10
    current.viewMatrix[14] += 6e-10
    current.viewMatrix[1] += 5.6e-17
    expect(isTemporalCameraStable(previous, current.viewMatrix, current.projectionMatrix)).toBe(true)
  })

  it('resets on translation, rotation and a changed field of view', () => {
    const previous = snapshot()
    for (const [matrix, index, delta] of [['viewMatrix', 12, 0.01], ['viewMatrix', 1, 0.001], ['projectionMatrix', 0, 0.02]] as const) {
      const current = snapshot()
      current[matrix][index] += delta
      expect(isTemporalCameraStable(previous, current.viewMatrix, current.projectionMatrix)).toBe(false)
    }
  })
})
