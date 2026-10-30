import { describe, expect, it } from 'vitest'
import { evaluateWaterOptics } from '../optics'

const coefficients = { absorption: [0.16, 0.06, 0.025] as const, scattering: [0.025, 0.015, 0.01] as const }
describe('underwater light transport', () => {
  it('returns unchanged light at zero depth', () => {
    const result = evaluateWaterOptics(0, 1, coefficients)
    expect(result.transmission).toEqual([1, 1, 1])
    expect(result.scatteringWeight).toEqual([0, 0, 0])
  })
  it('attenuates red more than blue and increases with depth', () => {
    const shallow = evaluateWaterOptics(2, 1, coefficients)
    const deep = evaluateWaterOptics(8, 1, coefficients)
    expect(shallow.transmission[0]).toBeLessThan(shallow.transmission[2])
    expect(deep.transmission[0]).toBeLessThan(shallow.transmission[0])
    expect(deep.transmission[2]).toBeLessThan(shallow.transmission[2])
    expect(deep.scatteringWeight[0]).toBeGreaterThan(shallow.scatteringWeight[0])
  })
  it('uses a longer optical path at oblique angles with a stable cosine floor', () => {
    const nadir = evaluateWaterOptics(3, 1, coefficients)
    const oblique = evaluateWaterOptics(3, 0.5, coefficients)
    const grazing = evaluateWaterOptics(3, 0, coefficients)
    expect(oblique.transmission[0]).toBeLessThan(nadir.transmission[0])
    expect(grazing.transmission[0]).toBeCloseTo(evaluateWaterOptics(3, 0.15, coefficients).transmission[0])
  })
  it('rejects invalid optical inputs', () => {
    expect(() => evaluateWaterOptics(-1, 1, coefficients)).toThrow()
    expect(() => evaluateWaterOptics(1, 1.1, coefficients)).toThrow()
    expect(() => evaluateWaterOptics(1, 1, coefficients, 5)).toThrow()
    expect(() => evaluateWaterOptics(1, 1, { absorption: [-1, 0, 0], scattering: [0, 0, 0] })).toThrow()
  })
})
