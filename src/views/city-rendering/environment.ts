import * as Cesium from 'cesium'
import { moveToneMappingToEnd, type PostProcessExecution } from './hdr'

export interface CityOptions {
  hour: number
  exposure: number
  sunlight: number
  clouds: boolean
  aerialPerspective: boolean
  groundCloudShadows: boolean
  coverage: number
  cloudBrightness: number
  waveStrength: number
  waveSpeed: number
  cloudAltitude: number
  cloudThickness: number
  wind: number
  volumeLight: number
  rain: number
  wetness: number
  puddles: boolean
  reflections: boolean
  shadows: boolean
  selfShadows: boolean
  traffic: boolean
  vehicles: number
  speed: number
  quality: 'low' | 'balanced' | 'high'
}

export const defaultOptions: CityOptions = {
  hour: 14,
  exposure: 1,
  sunlight: 1.8,
  clouds: true,
  aerialPerspective: true,
  groundCloudShadows: false,
  coverage: 0.25,
  cloudBrightness: 1.85,
  waveStrength: 1.2,
  waveSpeed: 1,
  wind: 6,
  cloudAltitude: 1000,
  cloudThickness: 900,
  volumeLight: 1,
  rain: 0,
  wetness: 0,
  puddles: false,
  reflections: true,
  shadows: true,
  selfShadows: false,
  traffic: true,
  vehicles: 28,
  speed: 9,
  quality: 'balanced',
}

export const presets: Record<'day' | 'sunset' | 'rain', CityOptions> = {
  day: { ...defaultOptions, hour: 14, coverage: 0.25, volumeLight: 0.8 },
  sunset: {
    ...defaultOptions,
    hour: 18.2,
    cloudThickness: 1100,
    cloudBrightness: 1.1,
    exposure: 1.15,
    sunlight: 1.6,
    coverage: 0.38,
    volumeLight: 2.5,
  },
  rain: {
    ...defaultOptions,
    hour: 15,
    cloudThickness: 1700,
    cloudBrightness: 0.95,
    sunlight: 0.8,
    exposure: 0.95,
    coverage: 0.83,
    wind: 12,
    rain: 0.65,
    wetness: 0.75,
    volumeLight: 0.25,
  },
}

interface CloudLayer {
  coverage?: number
  altitude?: number
  height?: number
  densityScale?: number
}
interface AtmospherePass {
  stage: Cesium.PostProcessStage | null
  _tyndallScale: number
  _bsmGroundOpticalDepthScale: number
  _exposureFollowTimeline?: boolean
  _atmosphereExposure?: number
  _surfaceShadowStrength?: number
}
interface CloudPipeline {
  params: {
    cloudsVisible: boolean
    layers: CloudLayer[]
    maxSteps: number
    maxStepsToSun: number
    maxShadowLengthIterationCount: number
    useShadowBuffer: boolean
    shadowLengthEnabled: boolean
    windSpeed: number
    evolutionSpeed: number
    sunIntensity: number
    cloudExposure: number
    groundBounceScale: number
    shadowFar: number
    maxRayDistance: number
    multiScatteringOctaves: number
    skyLightScale: number
    skyToSunRatio: number
    jitterStrength: number
    minStepSize: number
    maxStepSize: number
    perspectiveStepScale: number
    minSecondaryStepSize: number
    secondaryStepScale: number
    powderScale: number
    shapeRepeat: number
    temporalEnabled: boolean
    temporalAlpha: number
  }
  cloudStage: Cesium.PostProcessStage | null
  cloudComposite: Cesium.PostProcessStageComposite | null
  atmosphere: AtmospherePass | null
  aerial: AtmospherePass | null
  init: () => Promise<void>
  destroy: () => void
}

/** This adapter contains the vendored pipeline's parameter API and private pass controls. */
export async function createCityEnvironment(viewer: Cesium.Viewer) {
  // The vendored JS is inspected and pinned; its public entry has no TypeScript declarations.
  const module = await import(
    // @ts-expect-error The upstream module is JavaScript.
    '../../vendor/cesium-clouds-atmosphere/ThreeGeospatialPipeline.js'
  )
  const base = `${import.meta.env.BASE_URL}city-rendering/atmosphere/`
  const pipeline = new module.ThreeGeospatialPipeline(viewer, {
    cloudsAssetsBase: `${base}clouds-assets/`,
    atmosphereAssetsBase: `${base}lut/`,
    atmosphereShaderBase: `${base}shaders/`,
    brunetonShaderBase: `${base}shaders/bruneton/`,
    blueNoiseUrl: `${base}blue-noise.png`,
    cloudShadowSize: 512,
    separateCloudComposite: true,
  }) as CloudPipeline
  pipeline.params.maxSteps = 96
  pipeline.params.layers[0]!.altitude = 1000
  pipeline.params.layers[0]!.height = 950
  pipeline.params.layers[0]!.densityScale = 0.006
  pipeline.params.layers[1]!.altitude = 2100
  pipeline.params.layers[1]!.height = 1400
  pipeline.params.layers[1]!.densityScale = 0.003
  pipeline.params.minStepSize = 25
  pipeline.params.maxStepSize = 250
  pipeline.params.perspectiveStepScale = 1.002
  pipeline.params.minSecondaryStepSize = 40
  pipeline.params.secondaryStepScale = 1.8
  pipeline.params.powderScale = 0.35
  pipeline.params.shapeRepeat = 6.5
  pipeline.params.maxStepsToSun = 10
  pipeline.params.multiScatteringOctaves = 4
  pipeline.params.maxShadowLengthIterationCount = 80
  pipeline.params.shadowFar = 18000
  pipeline.params.maxRayDistance = 30000
  // No high cirrus layer in this local cumulus test; it unnecessarily widened
  // the ray interval while contributing almost no visible density.
  pipeline.params.layers[2]!.height = 0
  try {
    await pipeline.init()
  } catch (error) {
    pipeline.destroy()
    throw error
  }
  if (pipeline.atmosphere) {
    pipeline.atmosphere._exposureFollowTimeline = false
    pipeline.atmosphere._atmosphereExposure = 1.5
  }
  let active = true
  const restoreTone = moveToneMappingToEnd(
    viewer.scene.postProcessStages as unknown as PostProcessExecution,
    () => active,
  )
  const finalTone = new Cesium.PostProcessStage({
    name: 'CityFinalToneMapping',
    fragmentShader: `uniform sampler2D colorTexture;
      uniform float u_exposure;
      in vec2 v_textureCoordinates;
      void main() {
        vec4 sampleColor = texture(colorTexture, v_textureCoordinates);
        vec3 color = czm_pbrNeutralTonemapping(max(sampleColor.rgb, vec3(0.0)) * u_exposure);
        out_FragColor = vec4(czm_inverseGamma(color), sampleColor.a);
      }`,
    uniforms: { u_exposure: 1.0 },
  })
  viewer.scene.postProcessStages.add(finalTone)
  function apply(options: CityOptions): void {
    active = options.clouds
    finalTone.enabled = active
    finalTone.uniforms.u_exposure = options.exposure
    if (pipeline.atmosphere?.stage) pipeline.atmosphere.stage.enabled = active
    if (pipeline.aerial?.stage)
      pipeline.aerial.stage.enabled = active && options.aerialPerspective
    if (pipeline.aerial)
      // This post effect has no separate direct-light buffer: attenuating the
      // entire PBR result also darkens IBL and emissive light. Keep it opt-in.
      pipeline.aerial._surfaceShadowStrength = options.groundCloudShadows
        ? 0.25
        : 0
    const params = pipeline.params
    params.cloudsVisible = options.clouds
    if (pipeline.cloudStage) pipeline.cloudStage.enabled = options.clouds
    if (pipeline.cloudComposite)
      pipeline.cloudComposite.enabled = options.clouds
    params.layers.forEach((layer, index) => {
      if (index >= 3) return
      layer.coverage = options.clouds
        ? options.coverage * (index === 0 ? 1 : index === 1 ? 0.5 : 0.15)
        : 0
    })
    // Like the existing volume-rendering demo's box dimensions, these change
    // the sampled 3D volume itself. The second layer follows above the first.
    const storm = Cesium.Math.clamp(options.rain / 0.65, 0, 1)
    const lower = params.layers[0]
    const upper = params.layers[1]
    if (lower) {
      lower.altitude = options.cloudAltitude
      lower.height = options.cloudThickness
      // Rain presets use optically thicker clouds; coverage alone controls
      // how much sky is occupied and should not turn every fair cloud black.
      lower.densityScale = Cesium.Math.lerp(0.0028, 0.008, storm)
    }
    if (upper) {
      upper.altitude = options.cloudAltitude + options.cloudThickness + 150
      upper.height =
        options.cloudThickness * Cesium.Math.lerp(0.55, 1.15, storm)
      upper.densityScale = Cesium.Math.lerp(0.0012, 0.0035, storm)
    }
    params.windSpeed = options.wind * 0.00002
    params.evolutionSpeed = 0.003 + options.wind * 0.0003
    params.maxSteps =
      options.quality === 'low' ? 80 : options.quality === 'high' ? 192 : 128
    params.maxStepsToSun = options.quality === 'high' ? 10 : 6
    // Keep reprojection off until the history pass has been verified while moving.
    params.temporalEnabled = false
    params.jitterStrength = 0.0
    params.skyLightScale = 1.0
    params.skyToSunRatio = Cesium.Math.lerp(1, 0.75, storm)
    params.groundBounceScale = options.quality === 'low' ? 0 : 1
    params.powderScale = Cesium.Math.lerp(0.15, 0.35, storm)
    params.temporalAlpha = 0.18
    params.useShadowBuffer = options.clouds && options.volumeLight > 0
    params.shadowLengthEnabled = options.clouds && options.volumeLight > 0
    params.sunIntensity = (3.5 * options.sunlight) / 1.8
    params.cloudExposure = options.cloudBrightness
    for (const pass of [pipeline.atmosphere, pipeline.aerial])
      if (pass) {
        pass._tyndallScale = options.volumeLight
        pass._bsmGroundOpticalDepthScale = 0.3
      }
  }
  return {
    apply,
    destroy: () => {
      active = false
      restoreTone()
      viewer.scene.postProcessStages.remove(finalTone)
      pipeline.destroy()
    },
  }
}
