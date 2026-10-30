import type { LabState } from './url-state'
import type { CloudsShaderConstants } from '../../vendor/cesium-geospatial/clouds/CloudsMaterial'
import { Cartesian2, Cartesian3, Cartesian4 } from 'cesium'
import { DEFAULT_CLOUD_LAYERS, packLayerUniforms } from '../../vendor/cesium-geospatial/clouds/cloudLayersPacking'

export function buildCurrentPipelineSettings(state: LabState) {
  const cloudBaseM = state.cloudBaseM
  const cloudThicknessM = state.cloudThicknessM
  return {
    cloudsVisible: true,
    windSpeed: state.animated ? 6 * 0.00002 : 0,
    evolutionSpeed: state.animated ? 0.003 + 6 * 0.0003 : 0,
    temporalEnabled: false,
    maxSteps: state.quality === 'reference' ? 192 : 128,
    cloudExposure: 1.85,
    minStepSize: 25,
    maxStepSize: 250,
    perspectiveStepScale: 1.002,
    minSecondaryStepSize: 40,
    secondaryStepScale: 1.8,
    powderScale: 0.35,
    shapeRepeat: 6.5,
    maxStepsToSun: 10,
    multiScatteringOctaves: 4,
    maxShadowLengthIterationCount: 80,
    shadowFar: 18000,
    maxRayDistance: 30000,
    skyLightScale: 1,
    skyToSunRatio: 1,
    groundBounceScale: 1,
    jitterStrength: 0,
    temporalAlpha: 0.18,
    useShadowBuffer: true,
    shadowLengthEnabled: true,
    layers: [
      { altitude: cloudBaseM, height: cloudThicknessM, densityScale: 0.0028, coverage: state.coverage },
      { altitude: cloudBaseM + cloudThicknessM + 150, height: cloudThicknessM * 0.55, densityScale: 0.0012, coverage: state.coverage * 0.5 },
      { height: 0 },
    ],
  }
}

export function applyCurrentPipelineSettings(params: Record<string, any>, state: LabState): void {
  const { layers, ...scalars } = buildCurrentPipelineSettings(state)
  Object.assign(params, scalars)
  layers.forEach((layer, index) => Object.assign(params.layers[index], layer))
}

export function buildCurrentAtmosphereSettings(state: LabState) {
  return {
    exposureFollowTimeline: false,
    atmosphereExposure: 1.5,
    aerialSurfaceShadowStrength: 0,
    finalExposure: state.exposure,
  }
}

/** Preserve existing opaque lighting while integrating the cloud shadow field. */
export function buildCommunityAtmosphereSettings(state: LabState) {
  return { groundLighting: 0, groundShadowOnly: true, groundShadowStrength: state.cloudShadows ? 0.7 : 0 }
}

/** Fixed budgets apply during interaction and while stationary. */
export function buildCommunityPerformanceBudget(state: LabState) {
  const detailed = state.quality === 'reference'
  return { maxIterationCount: detailed ? 128 : 96, maxIterationCountToSun: detailed ? 3 : 2,
    minStepSize: 20, maxStepSize: detailed ? 400 : 600 }
}

/** Uniform-only edits retain shaders, targets and prepared textures. */
export function needsCommunityRebuild(previous: LabState, next: LabState): boolean {
  const live = new Set<keyof LabState>(['exposure', 'sunHour', 'cloudShadows', 'animated', 'view'])
  return (Object.keys(next) as (keyof LabState)[]).some(key => !live.has(key) && previous[key] !== next[key])
}

export function buildCommunityCloudParameters(state: LabState) {
  const layers = DEFAULT_CLOUD_LAYERS.map((layer) => ({ ...layer }))
  const cumulus = state.cloudForm === 'cumulus'
  if (cumulus) {
    // Broad bodies and smaller edge erosion are separate spatial scales. Avoid
    // stacking two equally opaque sheets into a continuous ceiling.
    for (const layer of layers.slice(0, 2)) {
      Object.assign(layer, { densityScale: 0.12, shapeAmount: 1, shapeDetailAmount: 0.8, shapeAlteringBias: 0.65, coverageFilterWidth: 0.35, weatherExponent: 1.15 })
    }
    layers[1]!.densityScale = 0.006
    // The cumulus reference has no upper cirrus veil. Even a low cirrus
    // extinction becomes opaque along a long grazing path and hides the tops.
    layers[2]!.height = 0
  }
  for (const layer of layers) layer.shapeAmount *= state.communityShapeScale
  for (const layer of layers) layer.shapeDetailAmount *= state.communityDetailScale
  layers[0] = { ...layers[0]!, altitude: state.cloudBaseM, height: state.cloudThicknessM }
  layers[1] = { ...layers[1]!, altitude: state.cloudBaseM + state.cloudThicknessM * 0.4, height: state.cloudThicknessM * 0.7 }
  return {
    ...packLayerUniforms(layers),
    ...(cumulus ? {
      localWeatherRepeat: new Cartesian2(200, 100),
      shapeRepeat: new Cartesian3(0.00005, 0.00005, 0.00005),
      shapeDetailRepeat: new Cartesian3(0.001, 0.001, 0.001),
      cumulusDensity: 1,
      minSecondaryStepSize: 80,
      powderScale: 0.35,
      // The new indirect-light model does not need the legacy fog whitening,
      // emissive floor or artificial 20% alpha softening.
      inLayerFog: 0,
      turbulenceDisplacement: 100,
      topPuffWeights: new Cartesian4(0, 0, 0, 0),
    } : {}),
    coverage: state.coverage,
    // Restore a bounded, neutral indirect contribution underneath the clouds.
    // The pinned full ground-bounce ray march is not enabled in this adapter.
    groundAmbientAlbedo: 0.2,
    groundDiffuseTransport: state.cloudLighting === 'diffuse' ? 1 : 0,
    skyLightScale: state.cloudLighting === 'diffuse' ? 0.45 : 1,
    ambientMultipleScattering: state.cloudLighting === 'diffuse' ? 0.5 : 0,
    ambientSkySaturation: state.cloudLighting === 'diffuse' ? 0.5 : 1,
    sampleFootprintScale: state.cloudSampling === 'filtered' ? 1 : 0,
    maxOpticalDepthPerStep: state.cloudSampling === 'filtered' ? 0.5 : 0,
    emptyStepScale: state.cloudSampling === 'filtered' ? 3 : 1,
    // Fine enough to cross a 1.2km cloud in multiple samples instead of binary STBN hits.
    ...buildCommunityPerformanceBudget(state),
    maxStepSize: Math.min(state.communityMaxStepM, buildCommunityPerformanceBudget(state).maxStepSize),
    perspectiveStepScale: 1.02,
    minDensity: 1e-4,
    minExtinction: 1e-4,
    unfreezeMipThreshold: -1,
  }
}

export function buildCommunityRenderSettings(state: LabState) {
  const temporalDiagnostic = state.communityDebug === 'fullTemporal' || state.communityDebug === 'alphaTemporal'
  const temporal = state.communityDebug === null || temporalDiagnostic
  const shaderConstants: CloudsShaderConstants = {
    cumulusDensity: state.cloudForm === 'cumulus' ? 1 : 0,
    sampleFootprintScale: state.cloudSampling === 'filtered' ? 1 : 0,
    ...(state.cloudForm === 'cumulus' ? { inLayerFog: 0 as const, topPuffs: false as const } : {}),
  }
  return {
    quality: state.quality === 'reference' ? 'medium' as const : 'low' as const,
    shapeDetail: true,
    temporal,
    upscaleDivisor: temporal ? 2 as const : 1 as const,
    temporalOutputDivisor: temporal ? 2 as const : 1 as const,
    frameUnfreeze: temporal,
    staticAccumulation: false,
    boundedMarch: true,
    shaderConstants,
    vertexIrradiance: true,
    lightingApproximation: state.communityDebug === null || temporalDiagnostic,
    // Trace one quarter of the scene pixels and resolve at scene resolution.
    // The fixed scene pixel cap keeps this same budget during camera motion.
    lightShafts: false,
    accurateSunSkyLight: false,
    turbulence: false,
  }
}

export function communityCloudTopM(state: LabState): number {
  return buildCommunityCloudParameters(state).maxHeight
}

/** Presentation policy for a city/map, separate from the physical density field. */
export function buildCommunityPresentationSettings(state: LabState) {
  const heightFadeStart = state.cloudBaseM + state.cloudThicknessM + 1000
  const heightFadeEnd = Math.max(communityCloudTopM(state) + 4000, heightFadeStart + 6000)
  return {
    heightFade: state.cloudPresentation === 'adaptive' && state.communityDebug === null,
    heightFadeStart,
    heightFadeEnd,
    pauseWhenHidden: true,
  }
}

