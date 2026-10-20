import { describe, expect, it } from 'vitest'
import { createWaveBands } from '../waves'

const options = {
  waveLength: 48,
  direction: 0.7,
  spread: 0.8,
  irregularity: 0.65,
}
describe('finite directional water waves', () => {
  it('builds a stable field whose directions stay within the requested spread', () => {
    const bands = createWaveBands(options)
    expect(createWaveBands(options)).toEqual(bands)
    const phases = new Set<number>()
    for (const values of Object.values(bands)) {
      expect(values).toHaveLength(16)
      for (let i = 0; i < 4; i++) {
        const [kx, ky, omega, phase] = values.slice(i * 4, i * 4 + 4)
        expect(
          Math.abs(Math.atan2(kx, ky) - options.direction),
        ).toBeLessThanOrEqual(options.spread)
        expect(omega ** 2).toBeCloseTo(9.81 * Math.hypot(kx, ky), 10)
        phases.add(phase)
      }
    }
    expect(phases.size).toBe(20)
  })
  it('changes metric wavelength without moving phases or silently changing direction', () => {
    const a = createWaveBands(options),
      b = createWaveBands({ ...options, waveLength: options.waveLength * 2 })
    for (const name of Object.keys(a))
      for (let i = 0; i < 4; i++) {
        expect(b[name][i * 4]).toBeCloseTo(a[name][i * 4] / 2, 12)
        expect(b[name][i * 4 + 1]).toBeCloseTo(a[name][i * 4 + 1] / 2, 12)
        expect(b[name][i * 4 + 2]).toBeCloseTo(
          a[name][i * 4 + 2] / Math.sqrt(2),
          12,
        )
        expect(b[name][i * 4 + 3]).toBe(a[name][i * 4 + 3])
      }
  })
  it('rotates the field with a compass bearing instead of camera orientation', () => {
    const a = createWaveBands(options),
      b = createWaveBands({
        ...options,
        direction: options.direction + Math.PI / 2,
      })
    for (const name of Object.keys(a))
      for (let i = 0; i < 4; i++) {
        expect(b[name][i * 4]).toBeCloseTo(a[name][i * 4 + 1], 12)
        expect(b[name][i * 4 + 1]).toBeCloseTo(-a[name][i * 4], 12)
        expect(b[name][i * 4 + 2]).toBe(a[name][i * 4 + 2])
        expect(b[name][i * 4 + 3]).toBe(a[name][i * 4 + 3])
      }
  })
  it('honors zero angular spread and still keeps distinct wavelengths', () => {
    const bands = createWaveBands({ ...options, spread: 0, irregularity: 0 })
    const wavelengths = new Set<number>()
    for (const values of Object.values(bands))
      for (let i = 0; i < 4; i++) {
        const kx = values[i * 4],
          ky = values[i * 4 + 1]
        expect(Math.atan2(kx, ky)).toBeCloseTo(options.direction, 12)
        wavelengths.add((2 * Math.PI) / Math.hypot(kx, ky))
      }
    expect(wavelengths.size).toBe(20)
  })
})
