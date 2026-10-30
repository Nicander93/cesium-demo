import { describe, expect, it } from 'vitest'
import { buildCloudsMainFragmentShader, buildCloudsMainVertexShader } from '../../vendor/cesium-geospatial/clouds/CloudsMaterial'
import { buildCommunityCloudParameters, buildCommunityRenderSettings } from './provider-settings'
import { defaultLabState } from './url-state'

describe('compiled cloud profile', () => {
  it('specializes only values that match the selected density and sampling model', () => {
    for (const cloudForm of ['cumulus', 'layered'] as const) for (const cloudSampling of ['filtered', 'legacy'] as const) {
      const state = { ...defaultLabState, cloudForm, cloudSampling }
      const constants = buildCommunityRenderSettings(state).shaderConstants
      const parameters = buildCommunityCloudParameters(state)
      expect(constants.cumulusDensity).toBe(parameters.cumulusDensity ?? 0)
      expect(constants.sampleFootprintScale).toBe(parameters.sampleFootprintScale)
      if (constants.inLayerFog === 0) expect(parameters.inLayerFog).toBe(0)
      if (constants.topPuffs === false) expect(Object.values(parameters.topPuffWeights!)).toEqual([0, 0, 0, 0])
    }
  })
  it('does not use uninitialized approximate irradiance with per-sample lighting', () => {
    const shader = buildCloudsMainFragmentShader({ lightingApproximation: true, accurateSunSkyLight: true })
    expect(shader).not.toContain('#define FAST_CLOUD_LIGHTING')
    expect(buildCloudsMainVertexShader({ vertexIrradiance: true, accurateSunSkyLight: true })).toBeUndefined()
  })
  it('retains a full-lighting diagnostic without changing density', () => {
    const normal = buildCommunityRenderSettings(defaultLabState)
    const raw = buildCommunityRenderSettings({ ...defaultLabState, communityDebug: 'raw' })
    expect(normal.lightingApproximation).toBe(true)
    expect(raw.lightingApproximation).toBe(false)
    expect(raw.shaderConstants).toEqual(normal.shaderConstants)
  })
})
