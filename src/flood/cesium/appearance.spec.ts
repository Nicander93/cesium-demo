import { describe, expect, it } from 'vitest'
import { getFloodAppearancePreset, resolveFloodAppearance } from './appearance'

describe('flood appearance contract', () => {
  it('returns independent presets and preserves unspecified raw values on patches', () => {
    const first = getFloodAppearancePreset('muddy')
    const copy = getFloodAppearancePreset('muddy')
    first.shallowColor = '#ffffff'
    expect(copy.shallowColor).toBe('#a18758')
    const next = resolveFloodAppearance(
      { opacity: 0, waveStrength: 0, flowStrength: 0 },
      copy,
    )
    expect(next.deepColor).toBe(copy.deepColor)
    expect(next.colorDepth).toBe(copy.colorDepth)
    expect(next.opacity).toBe(0)
    expect(copy.opacity).toBe(1)
  })
  it('rejects malformed patches atomically rather than mutating current appearance', () => {
    const current = getFloodAppearancePreset('muddy')
    const before = { ...current }
    for (const value of [
      { shallowColor: '#abc' },
      { deepColor: 'red' },
      { foamColor: '#zzzzzz' },
      { colorDepth: 0 },
      { colorDepth: Infinity },
      { opacity: NaN },
      { opacity: 1.01 },
      { opacity: -1 },
      { waveStrength: -0.01 },
      { flowStrength: 3.01 },
      { waveStrength: undefined },
    ]) {
      expect(() => resolveFloodAppearance(value as never, current)).toThrow()
      expect(current).toEqual(before)
    }
    expect(() => getFloodAppearancePreset('unknown' as never)).toThrow()
  })
})
