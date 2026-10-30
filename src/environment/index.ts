import * as Cesium from 'cesium'
import weatherShader from './weather.frag?raw'
import { PanoramaSky } from './sky'
import {
  environmentFrames,
  normalizeEnvironmentOptions,
  presetEnvironmentOptions,
  type EnvironmentAsset,
  type EnvironmentOptions,
  type EnvironmentPreset,
} from './presets'
export { environmentPresets, presetEnvironmentOptions } from './presets'
export type { EnvironmentOptions, EnvironmentPreset } from './presets'

// referenceMatrix exists in the pinned Cesium 1.132 runtime but is absent from its declarations.
type EnvironmentModel = Cesium.Model & { referenceMatrix?: Cesium.Matrix4 }
type RestorableIbl = {
  sphericalHarmonicCoefficients: Cesium.Cartesian3[] | undefined
  specularEnvironmentMaps: string | undefined
}

export interface EnvironmentState {
  preset: EnvironmentPreset
  pending: EnvironmentPreset | null
  ready: boolean
  error: string
  options: EnvironmentOptions
  attachedModels: number
}

/** Reusable local environment; the host retains Viewer, camera, models and simulation ownership. */
export function createEnvironment(
  viewer: Cesium.Viewer,
  config: { anchor: Cesium.Cartesian3; assetBaseUrl: string },
) {
  const scene = viewer.scene
  const assetBase = config.assetBaseUrl.replace(/\/$/, '') + '/'
  let anchor = Cesium.Cartesian3.clone(config.anchor)
  let preset: EnvironmentPreset = 'day'
  let options: EnvironmentOptions = presetEnvironmentOptions('day')
  let pending: EnvironmentPreset | null = null
  let asset: EnvironmentAsset | undefined
  let studio:
    | Pick<EnvironmentAsset, 'specular' | 'sphericalHarmonics'>
    | undefined
  let error = ''
  let destroyed = false
  let generation = 0
  const abort = new AbortController()
  const images = new Map<string, Promise<HTMLImageElement>>()
  const listeners = new Set<(state: EnvironmentState) => void>()
  const original = {
    sky: scene.skyBox,
    atmosphere: scene.skyAtmosphere?.show,
    light: scene.light,
    hdr: scene.highDynamicRange,
    fog: scene.fog.enabled,
    fogDensity: scene.fog.density,
    fogRenderable: scene.fog.renderable,
    fogMinimumBrightness: scene.fog.minimumBrightness,
    groundAtmosphere: scene.globe.showGroundAtmosphere,
    lighting: scene.globe.enableLighting,
    exposure: scene.postProcessStages.exposure,
    shadows: viewer.shadows,
    tonemapper: scene.postProcessStages.tonemapper,
  }
  const models = new Map<
    EnvironmentModel,
    {
      reference: Cesium.Matrix4 | undefined
      sh: Cesium.Cartesian3[] | undefined
      specular: string | undefined
      factor: Cesium.Cartesian2
      dynamic: boolean
    }
  >()
  const sky = new PanoramaSky(() => options.skyIntensity)
  const light = new Cesium.DirectionalLight({
    direction: new Cesium.Cartesian3(0, 0, -1),
  })
  const start = performance.now()
  let frames = environmentFrames(anchor, options.skyRotation)
  const weather = new Cesium.PostProcessStage({
    name: 'reusable-environment-weather',
    fragmentShader: weatherShader,
    uniforms: {
      u_rain: () => options.rain,
      u_time: () => (performance.now() - start) / 1000,
      u_rainSpeed: () => options.rainSpeed,
      u_rainAngle: () => options.rainAngle,
      u_rainLength: () => options.rainLength,
    },
  })
  scene.postProcessStages.add(weather)
  scene.skyBox = sky as unknown as Cesium.SkyBox
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = false
  scene.globe.showGroundAtmosphere = false
  scene.globe.enableLighting = true
  scene.fog.enabled = false
  scene.highDynamicRange = scene.highDynamicRangeSupported
  scene.postProcessStages.tonemapper = Cesium.Tonemapper.ACES
  scene.light = light

  const manifest = fetch(assetBase + 'manifest.json', {
    signal: abort.signal,
  }).then(async (response) => {
    if (!response.ok) throw new Error('天空资源清单加载失败')
    const value = (await response.json()) as Record<
      EnvironmentPreset,
      EnvironmentAsset
    > & { studio?: Pick<EnvironmentAsset, 'specular' | 'sphericalHarmonics'> }
    for (const id of ['day', 'sunset', 'rain'] as const) {
      const entry = value[id]
      if (
        !entry?.panorama ||
        !entry.specular ||
        entry.sphericalHarmonics?.length !== 9 ||
        entry.sphericalHarmonics.some(
          (c) => c.length !== 3 || !c.every(Number.isFinite),
        ) ||
        entry.sunDirection?.length !== 3 ||
        !entry.sunDirection.every(Number.isFinite)
      )
        throw new Error('天空资源清单内容无效：' + id)
    }
    if (value.studio) {
      if (
        !value.studio.specular ||
        value.studio.sphericalHarmonics?.length !== 9 ||
        value.studio.sphericalHarmonics.some(
          (c) => c.length !== 3 || !c.every(Number.isFinite),
        )
      )
        throw new Error('城市模型补光资源清单无效')
      studio = value.studio
    }
    return value
  })
  // A consumer may attach models before the first preset is requested.
  manifest.catch(() => {})
  function getState(): EnvironmentState {
    return {
      preset,
      pending,
      ready: Boolean(asset),
      error,
      options: { ...options },
      attachedModels: models.size,
    }
  }
  function notify(): void {
    if (!destroyed) for (const listener of listeners) listener(getState())
  }

  function updateLighting(): void {
    frames = environmentFrames(anchor, options.skyRotation)
    Cesium.Matrix3.clone(frames.worldToEnvironment, sky.worldToEnvironment)
    light.color = Cesium.Color.fromCssColorString(options.sunColor)
    light.intensity = options.sunIntensity
    if (asset || !options.sunAuto) {
      const heading = Cesium.Math.toRadians(options.sunHeading)
      const elevation = Cesium.Math.toRadians(options.sunElevation)
      const localSun =
        options.sunAuto && asset
          ? Cesium.Cartesian3.fromArray(asset.sunDirection)
          : new Cesium.Cartesian3(
              Math.sin(heading) * Math.cos(elevation),
              Math.cos(heading) * Math.cos(elevation),
              Math.sin(elevation),
            )
      Cesium.Matrix4.multiplyByPointAsVector(
        options.sunAuto
          ? frames.frame
          : Cesium.Transforms.eastNorthUpToFixedFrame(anchor),
        localSun,
        light.direction,
      )
      Cesium.Cartesian3.normalize(light.direction, light.direction)
      Cesium.Cartesian3.negate(light.direction, light.direction)
    }
    // Native terrain/model fog survives Cesium's per-frustum depth clears.
    scene.fog.enabled = options.fog > 0
    scene.fog.renderable = true
    scene.fog.density =
      options.fog * Cesium.Math.lerp(0.0002, 0.0005, options.rain)
    scene.fog.minimumBrightness = options.fogBrightness
    scene.highDynamicRange = options.hdr
    scene.postProcessStages.tonemapper =
      options.tonemapper === 'neutral'
        ? Cesium.Tonemapper.PBR_NEUTRAL
        : options.tonemapper === 'reinhard'
          ? Cesium.Tonemapper.REINHARD
          : Cesium.Tonemapper.ACES
    scene.postProcessStages.exposure = options.exposure
    viewer.shadows = options.shadows
    weather.enabled = options.rain > 0
    const useStudio = options.modelLighting === 'studio' && Boolean(studio)
    const illumination = useStudio ? studio : asset
    for (const [model, before] of models) {
      if (model.isDestroyed()) {
        models.delete(model)
        continue
      }
      // The city reference uses the model frame for its studio assets; outdoor HDRI uses shared ENU.
      model.referenceMatrix = useStudio ? before.reference : frames.frame
      if (illumination) {
        model.imageBasedLighting.sphericalHarmonicCoefficients =
          illumination.sphericalHarmonics.map(
            (c) => new Cesium.Cartesian3(c[0], c[1], c[2]),
          )
        model.imageBasedLighting.specularEnvironmentMaps =
          assetBase + illumination.specular
        model.imageBasedLighting.imageBasedLightingFactor =
          new Cesium.Cartesian2(
            options.diffuseIntensity,
            options.specularIntensity,
          )
        model.environmentMapManager.enabled = false
      }
    }
    scene.requestRender()
  }

  async function setPreset(id: EnvironmentPreset): Promise<boolean> {
    if (destroyed) return false
    const current = ++generation
    pending = id
    error = ''
    notify()
    try {
      const next = (await manifest)[id]
      let loaded = images.get(next.panorama)
      if (!loaded) {
        loaded = new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image()
          image.onload = () => resolve(image)
          image.onerror = () => reject(new Error('天空全景加载失败：' + id))
          image.src = assetBase + next.panorama
        })
        images.set(next.panorama, loaded)
        loaded.catch(() => images.delete(next.panorama))
      }
      const image = await loaded
      if (destroyed || current !== generation) return false
      asset = next
      preset = id
      pending = null
      options = presetEnvironmentOptions(id)
      sky.setImage(image)
      updateLighting()
      notify()
      return true
    } catch (reason) {
      if (!destroyed && current === generation) {
        pending = null
        error = String(reason)
        notify()
      }
      return false
    }
  }

  function detachModel(model: EnvironmentModel): void {
    const before = models.get(model)
    if (!before) return
    models.delete(model)
    if (!model.isDestroyed()) {
      model.referenceMatrix = before.reference
      ;(
        model.imageBasedLighting as unknown as RestorableIbl
      ).sphericalHarmonicCoefficients = before.sh
      ;(
        model.imageBasedLighting as unknown as RestorableIbl
      ).specularEnvironmentMaps = before.specular
      model.imageBasedLighting.imageBasedLightingFactor = before.factor
      model.environmentMapManager.enabled = before.dynamic
    }
  }

  return {
    setPreset,
    getState,
    setOptions(patch: Partial<EnvironmentOptions>): void {
      if (!destroyed) {
        options = normalizeEnvironmentOptions({ ...options, ...patch })
        updateLighting()
        notify()
      }
    },
    getAnchor(): Cesium.Cartesian3 {
      return Cesium.Cartesian3.clone(anchor)
    },
    setAnchor(next: Cesium.Cartesian3): void {
      if (!destroyed) {
        anchor = Cesium.Cartesian3.clone(next)
        updateLighting()
        notify()
      }
    },
    getLighting() {
      return {
        panoramaUrl: asset ? assetBase + asset.panorama : '',
        worldToEnvironment: frames.worldToEnvironment,
        rain: options.rain,
        highDynamicRange: scene.highDynamicRange,
        skyIntensity: options.skyIntensity,
      }
    },
    attachModel(model: EnvironmentModel): () => void {
      if (destroyed || model.isDestroyed() || models.has(model)) return () => {}
      models.set(model, {
        reference: model.referenceMatrix,
        sh: model.imageBasedLighting.sphericalHarmonicCoefficients,
        specular: model.imageBasedLighting.specularEnvironmentMaps,
        factor: Cesium.Cartesian2.clone(
          model.imageBasedLighting.imageBasedLightingFactor,
        ),
        dynamic: model.environmentMapManager.enabled,
      })
      updateLighting()
      notify()
      return () => detachModel(model)
    },
    subscribe(listener: (state: EnvironmentState) => void): () => void {
      listeners.add(listener)
      listener(getState())
      return () => listeners.delete(listener)
    },
    destroy(): void {
      if (destroyed) return
      destroyed = true
      generation++
      abort.abort()
      listeners.clear()
      images.clear()
      for (const model of [...models.keys()]) detachModel(model)
      if (!scene.isDestroyed()) {
        scene.postProcessStages.remove(weather)
        if (scene.skyBox === (sky as unknown as Cesium.SkyBox))
          scene.skyBox = original.sky
        if (scene.skyAtmosphere && original.atmosphere !== undefined)
          scene.skyAtmosphere.show = original.atmosphere
        scene.light = original.light
        scene.highDynamicRange = original.hdr
        scene.fog.enabled = original.fog
        scene.fog.density = original.fogDensity
        scene.fog.renderable = original.fogRenderable
        scene.fog.minimumBrightness = original.fogMinimumBrightness
        scene.globe.showGroundAtmosphere = original.groundAtmosphere
        scene.globe.enableLighting = original.lighting
        scene.postProcessStages.exposure = original.exposure
        scene.postProcessStages.tonemapper = original.tonemapper
        viewer.shadows = original.shadows
      }
      sky.destroy()
    },
  }
}

export type EnvironmentController = ReturnType<typeof createEnvironment>
