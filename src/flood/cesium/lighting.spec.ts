import { describe, expect, it } from 'vitest'
import { resolveFloodLighting } from './lighting'
describe('flood lighting options', () => {
  it('preserves raw settings and defaults to the existing material', () => {
    const initial = resolveFloodLighting({})
    expect(initial.model).toBe('legacy')
    const next = resolveFloodLighting(
      { model: 'microfacet', specularIntensity: 0, roughness: 0.7 },
      initial,
    )
    expect(next).toMatchObject({
      model: 'microfacet',
      specularIntensity: 0,
      roughness: 0.7,
      skyEnvironment: true,
      environmentIntensity: 1,
    })
    expect(initial.roughness).toBe(0.32)
  })
  it('rejects unsupported models, malformed switches and non-finite or out-of-range energy inputs', () => {
    for (const value of [
      { model: 'unknown' },
      { skyEnvironment: 1 },
      { roughness: -0.1 },
      { roughness: NaN },
      { specularIntensity: Infinity },
      { environmentIntensity: -1 },
    ])
      expect(() => resolveFloodLighting(value as never)).toThrow()
  })
})
