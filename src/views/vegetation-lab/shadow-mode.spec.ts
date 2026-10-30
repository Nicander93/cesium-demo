import * as Cesium from 'cesium'
import { describe, expect, it } from 'vitest'
import { resolveVegetationShadowMode } from './shadow-mode'

describe('vegetation shadow modes', () => {
  it('keeps self-shadow receiving out of the tree-only ground-shadow mode', () => {
    const mode = resolveVegetationShadowMode('cast-only')
    expect(mode).toBe(Cesium.ShadowMode.CAST_ONLY)
  })

  it('keeps disabled as a no-caster, no-receiver mode', () => {
    const mode = resolveVegetationShadowMode('disabled')
    expect(mode).toBe(Cesium.ShadowMode.DISABLED)
  })

  it('retains the explicit diagnostic mode that enables both shadow paths', () => {
    const mode = resolveVegetationShadowMode('enabled')
    expect(mode).toBe(Cesium.ShadowMode.ENABLED)
  })
})
