import { describe, expect, it } from 'vitest'
import { defaultLabState } from './url-state'
import { DEFAULT_CLOUD_LAYERS } from '../../vendor/cesium-geospatial/clouds/cloudLayersPacking'
import { applyCurrentPipelineSettings, buildCommunityCloudParameters, buildCommunityRenderSettings, buildCommunityPresentationSettings, buildCurrentAtmosphereSettings, buildCurrentPipelineSettings, communityCloudTopM } from './provider-settings'

describe('provider settings', () => {
  it('enables footprint filtering without replacing the weather or shape field', () => {
    const legacy = buildCommunityCloudParameters({ ...defaultLabState, cloudSampling: 'legacy' })
    const filtered = buildCommunityCloudParameters({ ...defaultLabState, cloudSampling: 'filtered' })
    expect(legacy.sampleFootprintScale).toBe(0)
    expect(filtered.sampleFootprintScale).toBe(1)
    expect(filtered.shapeAmounts).toEqual(legacy.shapeAmounts)
    expect(filtered.shapeDetailAmounts).toEqual(legacy.shapeDetailAmounts)
    expect(filtered.densityScales).toEqual(legacy.densityScales)
    expect(filtered.coverage).toBe(legacy.coverage)
  })

  it('keeps diffuse lighting calibration separate from density and exposure', () => {
    const state = { ...defaultLabState, cloudLighting: 'diffuse' as const }
    const params = buildCommunityCloudParameters(state)
    expect(params).toMatchObject({ groundAmbientAlbedo: 0.2, groundDiffuseTransport: 1, ambientMultipleScattering: 0.5, ambientSkySaturation: 0.5, skyLightScale: 0.45 })
    expect(params.densityScales).toEqual(buildCommunityCloudParameters(defaultLabState).densityScales)
    expect(state.exposure).toBe(defaultLabState.exposure)
  })

  it('runs live temporal diagnostics without the static 128-sample hold', () => {
    for (const communityDebug of ['fullTemporal', 'alphaTemporal'] as const) {
      expect(buildCommunityRenderSettings({ ...defaultLabState, communityDebug })).toMatchObject({ temporal: true, frameUnfreeze: true, staticAccumulation: false })
    }
  })
  it('fades above the main cloud layer without changing the underlying density or lighting', () => {
    expect(buildCommunityPresentationSettings(defaultLabState)).toEqual({
      heightFade: true, heightFadeStart: 4000, heightFadeEnd: 10000, pauseWhenHidden: true,
    })
    const full = { ...defaultLabState, cloudPresentation: 'full' as const }
    expect(buildCommunityPresentationSettings(full).heightFade).toBe(false)
    expect(buildCommunityCloudParameters(full)).toEqual(buildCommunityCloudParameters(defaultLabState))
    expect(buildCommunityPresentationSettings({ ...defaultLabState, communityDebug: 'alpha' }).heightFade).toBe(false)
  })

  it('keeps ground/inside cameras below the fade band even for custom tall cloud layers', () => {
    expect(buildCommunityPresentationSettings({ ...defaultLabState, cloudBaseM: 12000, cloudThicknessM: 8000 })).toMatchObject({
      heightFadeStart: 21000, heightFadeEnd: 27000,
    })
  })
  it('keeps rest and animated previews on the same bounded reconstruction path', () => {
    expect(buildCommunityRenderSettings(defaultLabState)).toMatchObject({
      quality: 'low', temporal: true, upscaleDivisor: 2, frameUnfreeze: true, staticAccumulation: false, boundedMarch: true,
    })
    expect(buildCommunityRenderSettings({ ...defaultLabState, animated: true })).toMatchObject({
      temporal: true, staticAccumulation: false,
    })
  })

  it('keeps moving quarter-resolution clouds on reprojection and raw diagnostics unaccumulated', () => {
    expect(buildCommunityRenderSettings({ ...defaultLabState, quality: 'balanced' })).toMatchObject({
      temporal: true, upscaleDivisor: 2, staticAccumulation: false,
    })
    for (const communityDebug of ['raw', 'fixedJitter', 'fixedLightJitter', 'fixedViewJitter', 'opticalStep'] as const) {
      expect(buildCommunityRenderSettings({ ...defaultLabState, communityDebug })).toMatchObject({
        temporal: false, frameUnfreeze: false, staticAccumulation: false, upscaleDivisor: 1,
      })
    }
  })

  it('keeps current TAA off, converts wind into UV units, and freezes shape evolution', () => {
    const frozen = buildCurrentPipelineSettings({ ...defaultLabState, animated: false })
    expect(frozen.windSpeed).toBe(0)
    expect(frozen.evolutionSpeed).toBe(0)
    expect(frozen.temporalEnabled).toBe(false)
    const animated = buildCurrentPipelineSettings({ ...defaultLabState, animated: true })
    expect(animated.windSpeed).toBeCloseTo(0.00012)
    expect(animated.evolutionSpeed).toBeGreaterThan(0)
    expect(animated.temporalEnabled).toBe(false)
  })

  it('maps the current adapter to the city cloud profile and keeps the three lab controls meaningful', () => {
    const params: Record<string, any> = { layers: [{}, {}, {}] }
    applyCurrentPipelineSettings(params, { ...defaultLabState, cloudBaseM: 2400, cloudThicknessM: 2000, coverage: 0.6, animated: false })
    expect(params.layers[0]).toMatchObject({ altitude: 2400, height: 2000, densityScale: 0.0028, coverage: 0.6 })
    expect(params.layers[1]).toMatchObject({ altitude: 4550, height: 1100, densityScale: 0.0012, coverage: 0.3 })
    expect(params.layers[2]).toMatchObject({ height: 0 })
    expect(params.shapeRepeat).toBe(6.5)
    expect(params.cloudExposure).toBe(1.85)
    expect(params.shadowFar).toBe(18000)
    expect(params.maxRayDistance).toBe(30000)
    expect(params.temporalEnabled).toBe(false)
    expect(params.evolutionSpeed).toBe(0)
  })

  it('uses quality only for march steps and sends final exposure to the city-style tone stage', () => {
    const reference = buildCurrentPipelineSettings({ ...defaultLabState, quality: 'reference', exposure: 0.7 })
    const balanced = buildCurrentPipelineSettings({ ...defaultLabState, quality: 'balanced', exposure: 2.4 })
    expect(reference.maxSteps).toBe(192)
    expect(balanced.maxSteps).toBe(128)
    expect(reference.cloudExposure).toBe(balanced.cloudExposure)
    expect(buildCurrentAtmosphereSettings({ ...defaultLabState, exposure: 0.7 }).finalExposure).toBe(0.7)
    expect(buildCurrentAtmosphereSettings(defaultLabState)).toMatchObject({ exposureFollowTimeline: false, atmosphereExposure: 1.5, aerialSurfaceShadowStrength: 0 })
  })

  it('uses the highest active packed layer, including the high cirrus layer, for the above-cloud view', () => {
    expect(communityCloudTopM({ ...defaultLabState, cloudForm: 'layered' })).toBe(8000)
    expect(communityCloudTopM(defaultLabState)).toBe(3120)
    expect(communityCloudTopM({ ...defaultLabState, cloudBaseM: 12000, cloudThicknessM: 8000 })).toBe(20800)
  })

  it('repacks every derived layer field when base or thickness changes', () => {
    const parameters = buildCommunityCloudParameters({ ...defaultLabState, cloudBaseM: 2600, cloudThicknessM: 2400 })
    expect(parameters.minLayerHeights.x).toBe(2600)
    expect(parameters.maxLayerHeights.x).toBe(5000)
    expect(parameters.minLayerHeights.y).toBe(3560)
    expect(parameters.maxLayerHeights.y).toBe(5240)
    expect(parameters.minHeight).toBe(2600)
    expect(parameters.maxHeight).toBe(parameters.maxLayerHeights.y)
    expect(parameters.minIntervalHeights.x).toBe(0)
    expect(parameters.coverage).toBe(defaultLabState.coverage)
    expect(parameters.groundAmbientAlbedo).toBe(0.2)
    expect(parameters.maxStepSize).toBe(600)
    expect(buildCommunityCloudParameters({ ...defaultLabState, communityMaxStepM: 150 }).maxStepSize).toBe(150)
    expect(parameters.shapeDetailAmounts.x).toBe(0.8)
    expect(parameters.shapeAmounts.x).toBe(1)
    expect(buildCommunityCloudParameters({ ...defaultLabState, communityShapeScale: 1 }).shapeAmounts.x).toBe(1)
    expect(buildCommunityCloudParameters({ ...defaultLabState, communityDetailScale: 0.4 }).shapeDetailAmounts.x).toBeCloseTo(0.32)
    expect(buildCommunityCloudParameters({ ...defaultLabState, communityShapeScale: 0 }).shapeAmounts.x).toBe(0)
  })

  it('preserves low-cloud height controls and keeps cirrus in the comparison profile', () => {
    const cumulus = buildCommunityCloudParameters(defaultLabState)
    const layered = buildCommunityCloudParameters({ ...defaultLabState, cloudForm: 'layered' })
    expect(cumulus.cumulusDensity).toBe(1)
    expect(layered.cumulusDensity).toBeUndefined()
    expect(cumulus.maxLayerHeights.x).toBe(layered.maxLayerHeights.x)
    expect(cumulus.maxLayerHeights.y).toBe(layered.maxLayerHeights.y)
    expect(cumulus.maxHeight).toBeLessThan(layered.maxHeight)
    expect(cumulus.shapeRepeat?.x).toBe(0.00005)
    expect(cumulus.densityScales.x).toBe(0.12)
    expect(layered.densityScales.x).toBe(0.2)
    expect(DEFAULT_CLOUD_LAYERS[0]!.densityScale).toBe(0.2)
  })
})

