import { describe, expect, it } from 'vitest'
import { buildCommunityAtmosphereSettings, buildCommunityCloudParameters, buildCommunityRenderSettings } from './provider-settings'
import { defaultLabState, readLabState, writeLabState } from './url-state'

describe('cloud and atmosphere transport', () => {
  it('adds cloud shadow without relighting Cesium opaque colors', () => {
    expect(buildCommunityAtmosphereSettings(defaultLabState)).toEqual({ groundLighting: 0, groundShadowOnly: true, groundShadowStrength: 0.7 })
    const off = { ...defaultLabState, cloudShadows: false }
    expect(buildCommunityAtmosphereSettings(off).groundShadowStrength).toBe(0)
    expect(buildCommunityCloudParameters(off)).toEqual(buildCommunityCloudParameters(defaultLabState))
    expect(buildCommunityRenderSettings(off)).toEqual(buildCommunityRenderSettings(defaultLabState))
  })
  it('persists the shadow comparison while retaining old URLs', () => {
    expect(readLabState('').cloudShadows).toBe(true)
    expect(readLabState('?cloudShadows=invalid').cloudShadows).toBe(true)
    const state = { ...defaultLabState, cloudShadows: false }
    expect(readLabState(writeLabState(state))).toEqual(state)
  })
})
