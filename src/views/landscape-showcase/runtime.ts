import * as Cesium from 'cesium'
import { createEnvironment, presetEnvironmentOptions } from '../../environment'
import { WaterSurface, createWaterPreset } from '../../water'
import { createCoastScene, type CoastScene } from './coast'
import { createMountainScene } from './mountain'
import {
  defaultShowcaseOptions,
  normalizeShowcaseOptions,
  type ShowcaseOptions,
  type ShowcaseScene,
  type ShowcaseView,
  type ShowcaseWeather,
} from './settings'

export interface ShowcaseStatus {
  scene: ShowcaseScene
  loading: boolean
  refining: boolean
  stage: string
  error: string
  warning: string
  options: ShowcaseOptions
  view: ShowcaseView
  roaming: boolean
  fps: number
  p95: number
  buffer: string
  modelCount: number
  treeCount: number
  waterHeight: number | null
  water: ReturnType<WaterSurface['getDiagnostics']> | null
  environment: ReturnType<ReturnType<typeof createEnvironment>['getState']>
  camera: {
    longitude: number
    latitude: number
    height: number
    heading: number
    pitch: number
    planeClearance: number | null
  }
}

/** The showcase owns its Viewer and scene content; water and environment remain reusable modules. */
export function createLandscapeShowcase(
  container: HTMLElement,
  report: (state: ShowcaseStatus) => void,
) {
  const viewer = new Cesium.Viewer(container, {
    baseLayer: false,
    baseLayerPicker: false,
    geocoder: false,
    animation: false,
    timeline: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    skyBox: false,
    skyAtmosphere: false,
    shadows: true,
    shouldAnimate: false,
    contextOptions: { webgl: { alpha: false } },
  })
  const scene = viewer.scene
  scene.globe.show = false
  scene.globe.maximumScreenSpaceError = 3
  scene.globe.loadingDescendantLimit = 4
  scene.globe.preloadSiblings = false
  scene.globe.undergroundColor = Cesium.Color.clone(Cesium.Color.TRANSPARENT)
  scene.useDepthPicking = false
  scene.postProcessStages.fxaa.enabled = true
  scene.shadowMap.size = 2048
  scene.shadowMap.softShadows = true
  scene.shadowMap.maximumDistance = 1400
  scene.shadowMap.darkness = 0.3
  scene.screenSpaceCameraController.minimumZoomDistance = 8
  scene.screenSpaceCameraController.maximumZoomDistance = 18000
  viewer.useBrowserRecommendedResolution = true
  // Keep the host's existing Cesium 1.132 resource-creation budget bounded during loading.
  const scheduler = (
    scene as unknown as {
      _jobScheduler: { _totalBudget: number; _budgets: { _total: number }[] }
    }
  )._jobScheduler
  scheduler._totalBudget = 4
  scheduler._budgets.forEach((budget, index) => {
    budget._total = [1, 1, 2][index]!
  })
  const serverLimits = Cesium.RequestScheduler.requestsByServer
  const limits = ['3d.geo.admin.ch:443', 'wmts.geo.admin.ch:443']
  const previousLimits = limits.map((key) => serverLimits[key])
  limits.forEach((key) => {
    serverLimits[key] = 4
  })
  const environment = createEnvironment(viewer, {
    anchor: Cesium.Cartesian3.fromDegrees(7.353, 45.978, 1975),
    assetBaseUrl: import.meta.env.BASE_URL + 'environment-lab/',
  })
  let kind: ShowcaseScene = 'mountain'
  let options = defaultShowcaseOptions(kind)
  let view: ShowcaseView = 'hero'
  let loading = false,
    stage = '',
    error = '',
    warning = '',
    destroyed = false,
    sequence = 0,
    lookSequence = 0
  let water: WaterSurface | undefined
  let contents: CoastScene | undefined
  let coastPlane: Cesium.Plane | undefined
  let collection = new Cesium.PrimitiveCollection()
  scene.primitives.add(collection)
  const frames: number[] = []
  let previousFrame = performance.now(),
    lastReport = 0
  let roaming = false,
    roamStart = 0
  let roamPose:
    | {
        position: Cesium.Cartesian3
        target: Cesium.Cartesian3
        right: Cesium.Cartesian3
        up: Cesium.Cartesian3
      }
    | undefined
  const clockStart = performance.now()

  function getState(): ShowcaseStatus {
    const sorted = [...frames].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0
    const camera = viewer.camera.positionCartographic
    return {
      scene: kind,
      loading,
      refining: kind === 'mountain' && !scene.globe.tilesLoaded,
      stage,
      error,
      warning,
      options: { ...options },
      view,
      roaming,
      fps: median ? Math.round(1000 / median) : 0,
      p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      buffer: scene.drawingBufferWidth + ' × ' + scene.drawingBufferHeight,
      modelCount: contents?.modelCount ?? 0,
      treeCount: contents?.treeCount ?? 0,
      waterHeight: contents?.waterHeight ?? null,
      water: water?.getDiagnostics() ?? null,
      environment: environment.getState(),
      camera: {
        longitude: camera.longitude,
        latitude: camera.latitude,
        height: camera.height,
        heading: viewer.camera.heading,
        pitch: viewer.camera.pitch,
        planeClearance: coastPlane
          ? Cesium.Plane.getPointDistance(coastPlane, viewer.camera.positionWC)
          : null,
      },
    }
  }
  function notify(): void {
    if (!destroyed) report(getState())
  }
  function updateResolution(): void {
    viewer.resolutionScale = Math.min(
      1,
      Math.sqrt(
        (1920 * 1080) /
          Math.max(1, container.clientWidth * container.clientHeight),
      ),
    )
    viewer.resize()
    scene.requestRender()
  }
  const resize = new ResizeObserver(updateResolution)
  resize.observe(container)
  updateResolution()
  const removeError = scene.renderError.addEventListener((_scene, reason) => {
    error = String(reason)
    notify()
  })
  const unsubscribe = environment.subscribe(() => notify())

  function applyLook(): void {
    const preset = presetEnvironmentOptions(options.weather)
    const sunset = options.weather === 'sunset'
    const next = {
      ...preset,
      exposure: options.exposure,
      tonemapper: 'neutral' as const,
      modelLighting:
        kind === 'coast' ? ('studio' as const) : ('weather' as const),
      diffuseIntensity: kind === 'coast' ? 0.55 : 0.8,
      specularIntensity: kind === 'coast' ? 0.65 : 0.8,
      fog: kind === 'mountain' ? 0.075 : 0.1,
      skyIntensity: 1,
      sunAuto: false,
      sunHeading: kind === 'mountain' ? 245 : sunset ? 255 : 115,
      sunElevation: sunset ? 10 : 43,
      sunIntensity: sunset ? 2 : kind === 'mountain' ? 2.4 : 1.8,
      shadows: kind === 'coast' && !sunset,
    }
    if (JSON.stringify(environment.getState().options) !== JSON.stringify(next))
      environment.setOptions(next)
    if (kind === 'mountain') {
      // Aerial imagery already contains terrain shading; grade it without lighting it twice.
      scene.globe.enableLighting = false
      for (let index = 0; index < viewer.imageryLayers.length; index++) {
        const layer = viewer.imageryLayers.get(index)
        layer.brightness = sunset ? 0.7 : 1.05
        layer.saturation = sunset ? 0.78 : 0.92
        layer.contrast = 1.04
      }
    }
    scene.backgroundColor = Cesium.Color.fromCssColorString(
      sunset ? '#a4a5b1' : '#a8c7dc',
    )
  }
  function applyWater(): void {
    if (!water) return
    water.setOptions({
      waveStrength: options.waveStrength,
      waveLength: options.waveLength,
      roughness: options.roughness,
      waterColor: Cesium.Color.fromCssColorString(options.waterColor),
      reflection: options.reflection,
      reflectGlobe: kind === 'mountain',
      reflectionStrength: options.reflectionStrength,
      foam: options.foam,
      foamWidth: options.foamWidth,
      shoreFadeDistance: kind === 'mountain' ? 2 : 3,
      quality: options.quality,
      reflectionResolutionScale: options.quality === 'low' ? 0.4 : 0.65,
      reflectionMaxSize: options.quality === 'low' ? 640 : 1024,
      reflectionMaxFps: 15,
    })
  }
  function setOptions(patch: Partial<ShowcaseOptions>): void {
    const changedWeather =
      patch.weather !== undefined && patch.weather !== options.weather
    options = normalizeShowcaseOptions(kind, { ...options, ...patch })
    if (changedWeather) void setWeather(options.weather)
    else applyLook()
    applyWater()
    notify()
  }
  async function setWeather(weather: ShowcaseWeather): Promise<void> {
    const token = ++lookSequence
    options.weather = weather
    await environment.setPreset(weather)
    if (destroyed || token !== lookSequence) return
    applyLook()
    notify()
  }
  function setRoaming(active: boolean): void {
    roaming = Boolean(active && contents && !loading)
    if (roaming) {
      const camera = viewer.camera
      roamStart = performance.now()
      roamPose = {
        position: Cesium.Cartesian3.clone(camera.positionWC),
        target: Cesium.Cartesian3.add(
          camera.positionWC,
          Cesium.Cartesian3.multiplyByScalar(
            camera.directionWC,
            1700,
            new Cesium.Cartesian3(),
          ),
          new Cesium.Cartesian3(),
        ),
        right: Cesium.Cartesian3.clone(camera.rightWC),
        up: Cesium.Cartesian3.clone(camera.upWC),
      }
    }
    notify()
  }
  function setView(next: ShowcaseView): void {
    view = next
    setRoaming(false)
    contents?.focus(next)
    notify()
  }
  const stopRoaming = () => {
    if (roaming) setRoaming(false)
  }
  viewer.canvas.addEventListener('pointerdown', stopRoaming, { passive: true })
  viewer.canvas.addEventListener('wheel', stopRoaming, { passive: true })

  // The coast is a local horizontal set, so ellipsoid-only navigation can pass beneath its sea.
  const removeClearance = scene.preRender.addEventListener(() => {
    if (!coastPlane) return
    const distance = Cesium.Plane.getPointDistance(
      coastPlane,
      viewer.camera.positionWC,
    )
    if (distance >= 12) return
    const destination = Cesium.Cartesian3.add(
      viewer.camera.positionWC,
      Cesium.Cartesian3.multiplyByScalar(
        coastPlane.normal,
        12 - distance,
        new Cesium.Cartesian3(),
      ),
      new Cesium.Cartesian3(),
    )
    viewer.camera.setView({
      destination,
      orientation: {
        direction: Cesium.Cartesian3.clone(viewer.camera.directionWC),
        up: Cesium.Cartesian3.clone(viewer.camera.upWC),
      },
    })
  })
  const removeTick = scene.postRender.addEventListener(() => {
    const now = performance.now(),
      delta = now - previousFrame
    previousFrame = now
    if (delta > 0 && delta < 1000) {
      frames.push(delta)
      if (frames.length > 180) frames.shift()
    }
    contents?.update((now - clockStart) / 1000)
    if (roaming && roamPose) {
      const t = (now - roamStart) / 1000
      const position = Cesium.Cartesian3.add(
        roamPose.position,
        Cesium.Cartesian3.multiplyByScalar(
          roamPose.right,
          Math.sin(t * 0.12) * (kind === 'mountain' ? 22 : 50),
          new Cesium.Cartesian3(),
        ),
        new Cesium.Cartesian3(),
      )
      Cesium.Cartesian3.add(
        position,
        Cesium.Cartesian3.multiplyByScalar(
          roamPose.up,
          (1 - Math.cos(t * 0.1)) * 5,
          new Cesium.Cartesian3(),
        ),
        position,
      )
      const direction = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.subtract(
          roamPose.target,
          position,
          new Cesium.Cartesian3(),
        ),
        new Cesium.Cartesian3(),
      )
      const right = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.cross(
          direction,
          roamPose.up,
          new Cesium.Cartesian3(),
        ),
        new Cesium.Cartesian3(),
      )
      const up = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.cross(right, direction, new Cesium.Cartesian3()),
        new Cesium.Cartesian3(),
      )
      viewer.camera.setView({
        destination: position,
        orientation: { direction, up },
      })
    }
    if (now - lastReport > 350) {
      lastReport = now
      notify()
    }
  })
  async function loadScene(
    next: ShowcaseScene,
    initial?: ShowcaseOptions,
  ): Promise<void> {
    if (destroyed) return
    const token = ++sequence
    lookSequence++
    setRoaming(false)
    water?.destroy()
    water = undefined
    coastPlane = undefined
    contents?.dispose()
    contents = undefined
    scene.primitives.remove(collection)
    collection = new Cesium.PrimitiveCollection()
    scene.primitives.add(collection)
    viewer.imageryLayers.removeAll(true)
    viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider()
    scene.globe.cartographicLimitRectangle = Cesium.Rectangle.clone(
      Cesium.Rectangle.MAX_VALUE,
    )
    scene.globe.show = next === 'mountain'
    kind = next
    options = normalizeShowcaseOptions(
      next,
      initial ?? defaultShowcaseOptions(next),
    )
    error = ''
    warning = ''
    loading = true
    stage = '准备场景'
    frames.length = 0
    const cancelled = () => destroyed || token !== sequence
    if (next === 'mountain')
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(7.353, 45.987, 2120),
        orientation: { heading: Math.PI, pitch: -0.1, roll: 0 },
      })
    else
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(119.033, 33.585, 240),
        orientation: { heading: 0, pitch: -0.2, roll: 0 },
      })
    const look = setWeather(options.weather)
    applyLook()
    notify()
    try {
      const loaded = await (next === 'mountain'
        ? createMountainScene({
            viewer,
            environment,
            isCancelled: cancelled,
            onProgress: (message) => {
              if (!cancelled()) {
                stage = message
                notify()
              }
            },
          })
        : createCoastScene({
            viewer,
            environment,
            collection,
            isCancelled: cancelled,
            onProgress: (count, total) => {
              if (!cancelled()) {
                stage = '载入海岸城市 ' + count + ' / ' + total
                notify()
              }
            },
          }))
      if (cancelled()) {
        loaded.dispose()
        return
      }
      contents = loaded
      if (next === 'coast') {
        const at = Cesium.Cartographic.fromCartesian(loaded.anchor)
        const point = Cesium.Cartesian3.fromRadians(
          at.longitude,
          at.latitude,
          loaded.waterHeight,
        )
        coastPlane = Cesium.Plane.fromPointNormal(
          point,
          Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(
            point,
            new Cesium.Cartesian3(),
          ),
        )
      }
      environment.setAnchor(loaded.anchor)
      applyLook()
      water = new WaterSurface({
        scene,
        positions: loaded.waterPositions,
        shoreline: loaded.shoreline,
        shorelineExtent: loaded.shorelineExtent,
        height: loaded.waterHeight,
        planeOrigin:
          next === 'coast'
            ? Cesium.Cartographic.fromCartesian(loaded.anchor)
            : undefined,
        ...createWaterPreset('calm-lake'),
        lightingModel: 'microfacet',
        skyEnvironment: false,
        underwaterOptics: false,
        edgeFadeWidth: 0,
        shoreFadeDistance: 2,
        foam: true,
        foamWidth: options.foamWidth,
        foamIntensity: 0.65,
        foamSpeed: 0.45,
        waveSpread: 50,
        waveIrregularity: 0.45,
        detailStrength: 0.5,
        waterAlpha: 1,
        quality: options.quality,
        reflectGlobe: next === 'mountain',
        reflectionMaxSize: 1024,
        reflectionMaxFps: 15,
        normalMapUrl:
          import.meta.env.BASE_URL + 'cesium/Assets/Textures/waterNormals.jpg',
        environmentColor: Cesium.Color.fromCssColorString('#8bb5d3'),
        onError: (reason) => {
          if (!cancelled()) {
            warning = '倒影暂不可用：' + String(reason)
            notify()
          }
        },
      })
      applyWater()
      loaded.focus(view)
      await Promise.all([look, water.ready])
      if (cancelled()) return
      applyLook()
      loading = false
      stage = '场景就绪'
      notify()
    } catch (reason) {
      if (!cancelled()) {
        loading = false
        error = String(reason)
        stage = '场景未能就绪'
        notify()
      }
    }
  }
  return {
    viewer,
    environment,
    getState,
    loadScene,
    setOptions,
    setWeather,
    setView,
    setRoaming,
    dispose(): void {
      if (destroyed) return
      destroyed = true
      sequence++
      lookSequence++
      resize.disconnect()
      removeError()
      removeTick()
      removeClearance()
      unsubscribe()
      viewer.canvas.removeEventListener('pointerdown', stopRoaming)
      viewer.canvas.removeEventListener('wheel', stopRoaming)
      water?.destroy()
      contents?.dispose()
      environment.destroy()
      limits.forEach((key, index) => {
        if (serverLimits[key] === 4) {
          const previous = previousLimits[index]
          if (previous === undefined) delete serverLimits[key]
          else serverLimits[key] = previous
        }
      })
      viewer.destroy()
    },
  }
}
export type LandscapeShowcase = ReturnType<typeof createLandscapeShowcase>
