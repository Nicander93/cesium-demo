import * as Cesium from 'cesium'
import {
  createEnvironment,
  type EnvironmentPreset,
  type EnvironmentState,
} from '../../environment'
import { createEnvironmentWater } from '../../environment/water'
import { cityBuildings } from '../city-rendering/layout'
import {
  createLandscape,
  createLandscapeBackdrop,
  landscapeHeight,
  sceneDefinitions,
  type DemoScene,
} from './landscape'
import { createRealScene, type RealSceneState } from './real-scenes'
import {
  createSceneConfiguration,
  normalizeSceneConfiguration,
  type SceneConfiguration,
} from './configuration'

export interface DemoStatus {
  scene: DemoScene
  loading: boolean
  loadedModels: number
  error: string
  fps: number
  frameP95: number
  buffer: string
  cameraHeight: number
  cameraPose: {
    longitude: number
    latitude: number
    height: number
    heading: number
    pitch: number
  }
  primitiveCount: number
  postProcessCount: number
  globeVisible: boolean
  imageryLayerCount: number
  depthPickingEnabled: boolean
  source: RealSceneState | null
  environment: EnvironmentState
  configuration: SceneConfiguration
}

/** Only this host owns scene content and the camera; the environment has no scene-specific dependencies. */
export function createEnvironmentDemo(
  container: HTMLElement,
  report: (status: DemoStatus) => void,
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
  // Cesium 1.132 defaults to 50 ms for texture/program/buffer creation per frame.
  // This host owns its Viewer; keep refinement jobs small while the camera remains responsive.
  const jobs = (
    scene as unknown as {
      _jobScheduler: { _totalBudget: number; _budgets: { _total: number }[] }
    }
  )._jobScheduler
  jobs._totalBudget = 4
  jobs._budgets.forEach((budget, index) => {
    budget._total = [1, 1, 2][index]!
  })
  const serverLimits = Cesium.RequestScheduler.requestsByServer
  const limits: [string, number][] = [
    ['data.mars3d.cn:443', 3],
    ['3d.geo.admin.ch:443', 4],
    ['wmts.geo.admin.ch:443', 4],
    ['services.arcgisonline.com:443', 4],
  ]
  const previousLimits = limits.map(([key]) => serverLimits[key])
  for (const [key, value] of limits) serverLimits[key] = value
  const restoreRequestLimits = () => {
    if (Cesium.RequestScheduler.requestsByServer !== serverLimits) return
    limits.forEach(([key, value], index) => {
      if (serverLimits[key] !== value) return
      if (previousLimits[index] === undefined) delete serverLimits[key]
      else serverLimits[key] = previousLimits[index]!
    })
  }
  // City starts with a prepared landscape; real-data scenes install their terrain and imagery.
  scene.globe.show = false
  // Camera navigation uses terrain/ellipsoid rays, avoiding synchronous GPU readback on middle drag.
  scene.useDepthPicking = false
  scene.globe.loadingDescendantLimit = 4
  scene.globe.preloadSiblings = false
  scene.globe.maximumScreenSpaceError = 3
  scene.postProcessStages.fxaa.enabled = true
  scene.shadowMap.size = 2048
  scene.shadowMap.softShadows = true
  scene.shadowMap.maximumDistance = 1800
  scene.shadowMap.darkness = 0.3
  // Cesium 1.132 receiver bias is private; keep this adapter local.
  const bias = (
    scene.shadowMap as unknown as {
      _primitiveBias: { normalOffsetScale: number; depthBias: number }
    }
  )._primitiveBias
  bias.normalOffsetScale = 0.5
  bias.depthBias = 0.00015
  scene.screenSpaceCameraController.minimumZoomDistance = 6
  scene.screenSpaceCameraController.maximumZoomDistance = 25000
  scene.screenSpaceCameraController.enableCollisionDetection = true
  viewer.useBrowserRecommendedResolution = true
  const base = import.meta.env.BASE_URL
  let kind: DemoScene = 'city'
  let configuration = createSceneConfiguration('city')
  let frame = Cesium.Transforms.eastNorthUpToFixedFrame(
    Cesium.Cartesian3.fromDegrees(...sceneDefinitions.city.origin),
  )
  const environment = createEnvironment(viewer, {
    anchor: Cesium.Cartesian3.fromDegrees(...sceneDefinitions.city.origin),
    assetBaseUrl: base + 'environment-lab/',
  })
  let collection = new Cesium.PrimitiveCollection()
  scene.primitives.add(collection)
  let detachModels: (() => void)[] = []
  let buildingModels: Cesium.Model[] = []
  let destroyed = false,
    sequence = 0,
    loading = false,
    loadedModels = 0,
    error = ''
  let water: ReturnType<typeof createEnvironmentWater> | undefined
  let waterPrimitive: Cesium.Primitive | undefined
  let terrain: Cesium.Primitive | undefined
  let backdrop: Cesium.Primitive | undefined
  let trees: Cesium.Primitive | undefined
  let realScene: ReturnType<typeof createRealScene> | undefined
  let waterLevel = 0
  let lastTime = performance.now(),
    lastReport = 0
  const intervals: number[] = []
  let currentEnvironment = environment.getState()
  function getState(): DemoStatus {
    const realState = realScene?.getState() ?? null
    const sorted = [...intervals].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0
    return {
      scene: kind,
      loading,
      loadedModels: realState?.loadedTiles ?? loadedModels,
      error,
      fps: median ? Math.round(1000 / median) : 0,
      frameP95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      buffer: `${scene.drawingBufferWidth} × ${scene.drawingBufferHeight}`,
      cameraHeight: Math.round(viewer.camera.positionCartographic.height),
      cameraPose: {
        longitude: viewer.camera.positionCartographic.longitude,
        latitude: viewer.camera.positionCartographic.latitude,
        height: viewer.camera.positionCartographic.height,
        heading: viewer.camera.heading,
        pitch: viewer.camera.pitch,
      },
      primitiveCount: scene.primitives.length,
      postProcessCount: scene.postProcessStages.length,
      globeVisible: scene.globe.show,
      imageryLayerCount: viewer.imageryLayers.length,
      depthPickingEnabled: scene.useDepthPicking,
      source: realState,
      environment: currentEnvironment,
      configuration: structuredClone(configuration),
    }
  }
  function notify(): void {
    if (!destroyed) report(getState())
  }
  const unsubscribe = environment.subscribe((state) => {
    currentEnvironment = state
    configuration = {
      ...configuration,
      weather: state.preset,
      environment: { ...state.options },
    }
    for (const land of [terrain, backdrop])
      if (land)
        (
          land.appearance as Cesium.MaterialAppearance
        ).material.uniforms.u_wetness = state.options.rain
    notify()
  })
  function updateResolution(): void {
    const pixels = Math.max(1, container.clientWidth * container.clientHeight)
    const budget = {
      '720': 1280 * 720,
      '1080': 1920 * 1080,
      '1440': 2560 * 1440,
    }[configuration.quality.pixelBudget]
    viewer.resolutionScale =
      Math.min(1, Math.sqrt(budget / pixels)) *
      configuration.quality.resolutionScale
    viewer.resize()
    scene.requestRender()
  }
  const resize = new ResizeObserver(updateResolution)
  resize.observe(container)
  const removeError = scene.renderError.addEventListener(
    (_scene: Cesium.Scene, reason: unknown) => {
      error = String(reason)
      notify()
    },
  )
  const localCamera = new Cesium.Cartesian3()
  const inverseCameraFrame = new Cesium.Matrix4()
  const removeClearance = scene.preUpdate.addEventListener(() => {
    if (kind !== 'city') return
    Cesium.Matrix4.inverseTransformation(frame, inverseCameraFrame)
    Cesium.Matrix4.multiplyByPoint(
      inverseCameraFrame,
      viewer.camera.positionWC,
      localCamera,
    )
    const minimum = landscapeHeight(kind, localCamera.x, localCamera.y) + 6
    if (localCamera.z < minimum) {
      localCamera.z = minimum
      const destination = Cesium.Matrix4.multiplyByPoint(
        frame,
        localCamera,
        new Cesium.Cartesian3(),
      )
      viewer.camera.setView({
        destination,
        orientation: {
          direction: Cesium.Cartesian3.clone(viewer.camera.directionWC),
          up: Cesium.Cartesian3.clone(viewer.camera.upWC),
        },
      })
    }
  })
  const removeTick = scene.preRender.addEventListener(() => {
    const now = performance.now()
    if (now - lastTime < 1000) {
      intervals.push(now - lastTime)
      if (intervals.length > 180) intervals.shift()
    }
    lastTime = now
    water?.update(now / 1000)
    realScene?.update(now / 1000)
    if (now - lastReport > 500) {
      lastReport = now
      notify()
    }
  })

  function localMatrix(
    x: number,
    y: number,
    z: number,
    heading = 0,
    scale = 1,
  ): Cesium.Matrix4 {
    const matrix = Cesium.Matrix4.fromRotationTranslation(
      Cesium.Matrix3.fromRotationZ(heading),
      new Cesium.Cartesian3(x, y, z),
    )
    Cesium.Matrix4.multiplyByUniformScale(matrix, scale, matrix)
    return Cesium.Matrix4.multiplyTransformation(frame, matrix, matrix)
  }
  function setView(view: 'overview' | 'near' | 'low' = 'overview'): void {
    configuration.view = view
    if (realScene) {
      realScene.focus(view)
      return
    }
    const definition = sceneDefinitions[kind]
    const target = Cesium.Matrix4.multiplyByPoint(
      frame,
      Cesium.Cartesian3.fromArray(definition.target),
      new Cesium.Cartesian3(),
    )
    const range =
      definition.range * (view === 'near' ? 0.5 : view === 'low' ? 0.65 : 1)
    let pitch =
      view === 'low' ? -0.1 : view === 'near' ? -0.2 : definition.pitch
    // Demo meshes are not a terrain provider, so keep the prepared camera above their height.
    const heading = Cesium.Math.toRadians(-55)
    const inverse = Cesium.Matrix4.inverseTransformation(
      frame,
      new Cesium.Matrix4(),
    )
    for (let i = 0; i < 4; i++) {
      viewer.camera.lookAt(
        target,
        new Cesium.HeadingPitchRange(heading, pitch, range),
      )
      const local = Cesium.Matrix4.multiplyByPoint(
        inverse,
        viewer.camera.positionWC,
        new Cesium.Cartesian3(),
      )
      const minimum = landscapeHeight(kind, local.x, local.y) + 90
      if (local.z >= minimum) break
      pitch = -Math.asin(
        Cesium.Math.clamp((minimum - definition.target[2]) / range, 0, 0.9),
      )
    }
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
    scene.requestRender()
  }
  function makeWater(): void {
    water = createEnvironmentWater(
      environment,
      Cesium.Color.fromCssColorString(configuration.water.color),
      configuration.water,
    )
    const width = kind === 'city' ? 96 : kind === 'reservoir' ? 1800 : 2600
    const length = kind === 'city' ? 640 : kind === 'reservoir' ? 2800 : 3800
    const geometry = new Cesium.PlaneGeometry({
      vertexFormat:
        Cesium.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat,
    })
    const transform = Cesium.Matrix4.multiplyByScale(
      localMatrix(0, 0, waterLevel),
      new Cesium.Cartesian3(width, length, 1),
      new Cesium.Matrix4(),
    )
    waterPrimitive = new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({ geometry }),
      modelMatrix: transform,
      appearance: new Cesium.MaterialAppearance({
        material: water.material,
        translucent: false,
        faceForward: true,
        closed: false,
      }),
      asynchronous: false,
      shadows: Cesium.ShadowMode.RECEIVE_ONLY,
    })
    collection.add(waterPrimitive)
    waterPrimitive.show = configuration.water.visible
    waterPrimitive.shadows = configuration.water.receiveShadows
      ? Cesium.ShadowMode.RECEIVE_ONLY
      : Cesium.ShadowMode.DISABLED
  }
  function setWaterLevel(value: number): void {
    configuration.water.level = Cesium.Math.clamp(
      Number.isFinite(value) ? value : 0,
      kind === 'city' ? -2 : 0,
      kind === 'city' ? 42 : 20,
    )
    if (realScene) {
      realScene.setWaterLevel(value)
      notify()
      return
    }
    waterLevel = configuration.water.level
    if (waterPrimitive) {
      const width = kind === 'city' ? 96 : kind === 'reservoir' ? 1800 : 2600
      const length = kind === 'city' ? 640 : kind === 'reservoir' ? 2800 : 3800
      waterPrimitive.modelMatrix = Cesium.Matrix4.multiplyByScale(
        localMatrix(0, 0, waterLevel),
        new Cesium.Cartesian3(width, length, 1),
        new Cesium.Matrix4(),
      )
      scene.requestRender()
    }
  }
  function buildingShadowMode(): Cesium.ShadowMode {
    return configuration.shadows.buildingShadows === 'both'
      ? Cesium.ShadowMode.ENABLED
      : Cesium.ShadowMode.CAST_ONLY
  }
  function treeShadowMode(): Cesium.ShadowMode {
    return configuration.shadows.treeShadows === 'both'
      ? Cesium.ShadowMode.ENABLED
      : configuration.shadows.treeShadows === 'cast'
        ? Cesium.ShadowMode.CAST_ONLY
        : Cesium.ShadowMode.DISABLED
  }
  function applyConfiguration(next: SceneConfiguration): void {
    configuration = normalizeSceneConfiguration(kind, next)
    const shadow = configuration.shadows
    if (
      JSON.stringify(currentEnvironment.options) !==
      JSON.stringify(configuration.environment)
    )
      environment.setOptions(configuration.environment)
    scene.shadowMap.size = shadow.size
    scene.shadowMap.softShadows = shadow.soft
    scene.shadowMap.maximumDistance = shadow.distance
    scene.shadowMap.darkness = shadow.darkness
    bias.normalOffsetScale = shadow.normalOffset
    bias.depthBias = shadow.depthBias
    scene.postProcessStages.fxaa.enabled = configuration.quality.fxaa
    scene.globe.maximumScreenSpaceError = configuration.quality.terrainError
    if (terrain)
      terrain.shadows = shadow.backgroundReceives
        ? Cesium.ShadowMode.RECEIVE_ONLY
        : Cesium.ShadowMode.DISABLED
    if (trees) trees.shadows = treeShadowMode()
    for (const model of buildingModels)
      if (!model.isDestroyed()) model.shadows = buildingShadowMode()
    water?.setOptions(configuration.water)
    if (waterPrimitive) {
      waterPrimitive.show = configuration.water.visible
      waterPrimitive.shadows = configuration.water.receiveShadows
        ? Cesium.ShadowMode.RECEIVE_ONLY
        : Cesium.ShadowMode.DISABLED
    }
    realScene?.setOptions({
      water: configuration.water,
      quality: configuration.quality,
      source: configuration.source,
    })
    setWaterLevel(configuration.water.level)
    updateResolution()
    notify()
  }
  function makeTrees(): void {
    const instances: Cesium.GeometryInstance[] = []
    const count = kind === 'city' ? 42 : 180
    for (let i = 0; i < count; i++) {
      const angle = i * 2.399963229728653
      const radial = Math.sqrt((i + 0.5) / count)
      let x = Math.cos(angle) * radial * (kind === 'city' ? 1000 : 2100),
        y = Math.sin(angle) * radial * (kind === 'city' ? 1000 : 2100)
      if (kind === 'city' && Math.abs(x) < 340 && Math.abs(y) < 330) continue
      const z = landscapeHeight(kind, x, y)
      if (kind !== 'city' && (z < 32 || z > 500)) continue
      const height = 13 + (i % 9) * 1.5
      instances.push(
        new Cesium.GeometryInstance({
          geometry: new Cesium.CylinderGeometry({
            length: height,
            topRadius: 1,
            bottomRadius: height * 0.28,
            slices: 7,
            vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
          }),
          modelMatrix: localMatrix(x, y, z + height / 2),
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(
              Cesium.Color.fromCssColorString(
                ['#314b2e', '#3b5134', '#4b5b38'][i % 3]!,
              ),
            ),
          },
        }),
      )
    }
    if (instances.length) {
      trees = new Cesium.Primitive({
        geometryInstances: instances,
        appearance: new Cesium.PerInstanceColorAppearance({
          translucent: false,
          closed: true,
        }),
        asynchronous: false,
        shadows: treeShadowMode(),
      })
      collection.add(trees)
    }
  }
  async function loadScene(
    next: DemoScene,
    tilesetUrl?: string,
    initialConfiguration?: SceneConfiguration,
  ): Promise<void> {
    if (destroyed) return
    const token = ++sequence
    realScene?.dispose()
    realScene = undefined
    loading = true
    kind = next
    configuration = normalizeSceneConfiguration(
      next,
      initialConfiguration ??
        createSceneConfiguration(next, currentEnvironment.preset),
    )
    if (tilesetUrl) configuration.source.modelUrl = tilesetUrl
    loadedModels = 0
    error = ''
    intervals.length = 0
    for (const detach of detachModels) detach()
    detachModels = []
    buildingModels = []
    scene.primitives.remove(collection)
    for (const land of [terrain, backdrop])
      if (land)
        (land.appearance as Cesium.MaterialAppearance).material.destroy()
    water?.material.destroy()
    water = undefined
    waterPrimitive = undefined
    terrain = undefined
    backdrop = undefined
    trees = undefined
    collection = new Cesium.PrimitiveCollection()
    scene.primitives.add(collection)
    applyConfiguration(configuration)
    if (next !== 'city') {
      realScene = createRealScene({
        viewer,
        environment,
        kind: next,
        collection,
        water: configuration.water,
        quality: configuration.quality,
        source: configuration.source,
        ...(tilesetUrl ? { tilesetUrl } : {}),
        onChange(state) {
          if (destroyed || token !== sequence) return
          const changed = loading !== state.loading || error !== state.error
          loading = state.loading
          error = state.error
          if (changed) notify()
        },
      })
      try {
        await realScene.ready
      } catch (reason) {
        if (!destroyed && token === sequence) error = String(reason)
      }
      if (!destroyed && token === sequence) {
        loading = false
        notify()
      }
      return
    }
    scene.globe.show = false
    const anchor = Cesium.Cartesian3.fromDegrees(
      ...sceneDefinitions[kind].origin,
    )
    frame = Cesium.Transforms.eastNorthUpToFixedFrame(anchor)
    environment.setAnchor(anchor)
    backdrop = createLandscapeBackdrop(frame, kind)
    collection.add(backdrop)
    terrain = createLandscape(frame, kind)
    // Only compact site geometry receives city shadows; background bounds waste cascade precision.
    if (kind === 'city')
      terrain.shadows = configuration.shadows.backgroundReceives
        ? Cesium.ShadowMode.RECEIVE_ONLY
        : Cesium.ShadowMode.DISABLED
    collection.add(terrain)
    for (const land of [terrain, backdrop])
      (
        land.appearance as Cesium.MaterialAppearance
      ).material.uniforms.u_wetness = currentEnvironment.options.rain
    waterLevel = configuration.water.level
    makeWater()
    makeTrees()
    setView()
    notify()
    const buildings =
      kind === 'city'
        ? cityBuildings()
        : cityBuildings()
            .slice(0, kind === 'reservoir' ? 6 : 12)
            .map((building, i) => ({
              ...building,
              x:
                (i % 2 === 0 ? -1 : 1) * (kind === 'reservoir' ? 820 : 360) +
                (i % 3) * 55,
              y: -500 + Math.floor(i / 2) * 180,
              scale: building.scale * 0.65,
            }))
    const tasks = [
      ...(kind === 'city'
        ? [
            {
              name: 'ground',
              url: base + 'city-rendering/riverside-site.glb',
              matrix: localMatrix(0, 0, 0),
            },
          ]
        : []),
      ...buildings.map((b) => ({
        name: b.name,
        url: base + `city-rendering/kenney/city/${b.name}.glb`,
        matrix: localMatrix(
          b.x,
          b.y,
          kind === 'city' ? 2.2 : landscapeHeight(kind, b.x, b.y),
          b.heading,
          b.scale,
        ),
      })),
    ]
    let index = 0
    const worker = async () => {
      while (index < tasks.length) {
        if (destroyed || token !== sequence) break
        const task = tasks[index++]!
        try {
          const model = await Cesium.Model.fromGltfAsync({
            url: task.url,
            modelMatrix: task.matrix,
            upAxis: Cesium.Axis.Y,
            forwardAxis: Cesium.Axis.X,
            enableVerticalExaggeration: false,
            shadows:
              task.name === 'ground'
                ? Cesium.ShadowMode.RECEIVE_ONLY
                : buildingShadowMode(),
          })
          if (destroyed || token !== sequence) {
            model.destroy()
            continue
          }
          collection.add(model)
          if (task.name !== 'ground') buildingModels.push(model)
          detachModels.push(environment.attachModel(model))
          loadedModels++
          notify()
        } catch (reason) {
          if (!destroyed && token === sequence) {
            error = `模型加载失败：${task.name} · ${String(reason)}`
            notify()
          }
        }
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker))
    if (!destroyed && token === sequence) {
      loading = false
      notify()
    }
  }
  return {
    viewer,
    environment,
    getState,
    loadScene,
    setView,
    setWaterLevel,
    applyConfiguration,
    async setWeather(preset: EnvironmentPreset) {
      return environment.setPreset(preset)
    },
    dispose(): void {
      if (destroyed) return
      destroyed = true
      sequence++
      resize.disconnect()
      unsubscribe()
      removeError()
      removeClearance()
      removeTick()
      realScene?.dispose()
      realScene = undefined
      for (const detach of detachModels) detach()
      environment.destroy()
      scene.primitives.remove(collection)
      for (const land of [terrain, backdrop])
        if (land)
          (land.appearance as Cesium.MaterialAppearance).material.destroy()
      water?.material.destroy()
      restoreRequestLimits()
      viewer.destroy()
    },
  }
}

export type EnvironmentDemo = ReturnType<typeof createEnvironmentDemo>
