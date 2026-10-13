import * as Cesium from 'cesium'
import { createWaveNormalUrl } from './waves'
import { applyRiverMaterial } from './river-material'
import { WaterSurface } from '../../water'
import {
  cityBuildings,
  trafficRoutes,
  routeLength,
  vehiclePose,
  river,
} from './layout'
import { createCityRain, type RainObstacle } from './rain'
import {
  createCityEnvironment,
  defaultOptions,
  type CityOptions,
} from './environment'

interface Vehicle {
  model: Cesium.Model
  route: number
  distance: number
  reverse: boolean
  wheelRotation: number
  wheels: { node: Cesium.ModelNode; matrix: Cesium.Matrix4 }[]
}
interface AssetBounds {
  min: number[]
  max: number[]
}
export interface CityStatus {
  phase: string
  loaded: number
  total: number
  sky: 'loading' | 'ready' | 'failed'
  warning: string
  fps: number
}

export interface CityPlacement {
  longitude: number
  latitude: number
  /** Prepared site elevation in meters above the WGS84 ellipsoid, not terrain clamping. */
  height: number
}
const base = `${import.meta.env.BASE_URL}city-rendering/`

export function createCityScene(
  container: HTMLElement,
  report: (status: CityStatus) => void,
  placement: CityPlacement = {
    longitude: 119.0317,
    latitude: 33.5921,
    height: 0,
  },
) {
  const origin = Cesium.Cartesian3.fromDegrees(
    placement.longitude,
    placement.latitude,
    placement.height,
  )
  const frame = Cesium.Transforms.eastNorthUpToFixedFrame(origin)
  let destroyed = false,
    cleanupDone = false
  let options = { ...defaultOptions }
  const status: CityStatus = {
    phase: '加载街区与车辆',
    loaded: 0,
    total: 65,
    sky: 'loading',
    warning: '',
    fps: 0,
  }
  function notify(): void {
    if (!destroyed) report({ ...status })
  }
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
    requestRenderMode: false,
    scene3DOnly: true,
    msaaSamples: 4,
    showRenderLoopErrors: false,
    contextOptions: { webgl: { alpha: false, antialias: true } },
  })
  const imageryUrl =
    import.meta.env.VITE_CITY_IMAGERY_URL ||
    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
  const imagery = Cesium.ImageryLayer.fromProviderAsync(
    Cesium.ArcGisMapServerImageryProvider.fromUrl(imageryUrl, {
      enablePickFeatures: false,
    }),
  )
  function imageryError(): void {
    if (destroyed) return
    status.warning = '影像加载失败，请检查网络或 VITE_CITY_IMAGERY_URL 配置'
    notify()
  }
  const removeImageryError = imagery.errorEvent.addEventListener(imageryError)
  let removeTileError: (() => void) | undefined
  const removeImageryReady = imagery.readyEvent.addEventListener((provider) => {
    if (!destroyed)
      removeTileError = provider.errorEvent.addEventListener(imageryError)
  })
  viewer.imageryLayers.add(imagery)
  const scene = viewer.scene
  scene.globe.baseColor = Cesium.Color.fromCssColorString('#60887e')
  // Imagery supplies geographic context; the prepared flat site has no DEM yet.
  scene.globe.show = true
  scene.globe.enableLighting = true
  scene.globe.showGroundAtmosphere = false
  scene.fog.enabled = false
  scene.backgroundColor = Cesium.Color.fromCssColorString('#a9c5d6')
  scene.skyAtmosphere = new Cesium.SkyAtmosphere()
  scene.skyAtmosphere.show = true
  scene.highDynamicRange = scene.highDynamicRangeSupported
  scene.postProcessStages.tonemapper = Cesium.Tonemapper.PBR_NEUTRAL
  scene.postProcessStages.fxaa.enabled = true
  scene.shadowMap.size = 2048
  scene.shadowMap.softShadows = true
  scene.shadowMap.darkness = 0.25
  scene.shadowMap.maximumDistance = 1500
  // Cesium 1.132 exposes no public receiver bias controls. Keep this adjustment
  // on the city's own shadow map; the default is too small for these flat walls.
  const receiverBias = (
    scene.shadowMap as unknown as {
      _primitiveBias: { normalOffsetScale: number; depthBias: number }
    }
  )._primitiveBias
  receiverBias.normalOffsetScale = 0.5
  receiverBias.depthBias = 0.00015
  scene.screenSpaceCameraController.minimumZoomDistance = 8
  scene.screenSpaceCameraController.maximumZoomDistance = 50000000
  viewer.useBrowserRecommendedResolution = false
  viewer.clock.shouldAnimate = true
  viewer.clock.multiplier = 1
  const models: Cesium.Model[] = []
  let environmentCoefficients: Cesium.Cartesian3[] | undefined
  const lightingReady = fetch(
    `${import.meta.env.BASE_URL}model-rendering/studio-sh.json`,
  ).then(async (response) => {
    if (!response.ok) throw new Error('模型环境光加载失败')
    const values = (await response.json()) as number[][]
    environmentCoefficients = values.map(
      (value) => new Cesium.Cartesian3(value[0]!, value[1]!, value[2]!),
    )
  })
  const vehicles: Vehicle[] = []
  const obstacles: RainObstacle[] = []
  let environment: Awaited<ReturnType<typeof createCityEnvironment>> | undefined
  const rain = createCityRain(scene, frame, obstacles)
  const wetShader = new Cesium.CustomShader({
    uniforms: { u_wetness: { type: Cesium.UniformType.FLOAT, value: 0 } },
    fragmentShaderText: `void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
      float road = 1.0 - step(0.10, max(max(material.diffuse.r, material.diffuse.g), material.diffuse.b));
      float wet = u_wetness * road;
      material.diffuse *= mix(1.0, 0.55, wet);
      material.roughness = mix(material.roughness, 0.16, wet);
      material.specular = mix(material.specular, vec3(0.065), wet);
    }`,
  })
  function geographic(x: number, y: number): Cesium.Cartographic {
    return Cesium.Cartographic.fromCartesian(
      Cesium.Matrix4.multiplyByPoint(
        frame,
        new Cesium.Cartesian3(x, y, 0),
        new Cesium.Cartesian3(),
      ),
    )
  }
  function waterBoundary(
    x: number,
    y: number,
    width: number,
    length: number,
    ellipse = false,
  ): Cesium.Cartographic[] {
    if (!ellipse)
      return [
        [x - width / 2, y - length / 2],
        [x + width / 2, y - length / 2],
        [x + width / 2, y + length / 2],
        [x - width / 2, y + length / 2],
      ].map((point) => geographic(point[0]!, point[1]!))
    return Array.from({ length: 24 }, (_, index) => {
      const angle = (index / 24) * Math.PI * 2
      return geographic(
        x + (Math.cos(angle) * width) / 2,
        y + (Math.sin(angle) * length) / 2,
      )
    })
  }
  function waterError(error: unknown): void {
    status.warning = `水面倒影退回基础材质：${String(error)}`
    notify()
  }
  const water = new WaterSurface({
    scene,
    positions: waterBoundary(0, 0, river.halfWidth * 2, river.halfLength * 2),
    height: placement.height + river.height,
    quality: 'balanced',
    normalMapUrl: createWaveNormalUrl(),
    foam: false,
    reflectionMaxFps: 30,
    waterColor: Cesium.Color.fromCssColorString('#123f43'),
    waterAlpha: 1,
    reflectivity: 0.04,
    rippleSize: 50,
    distortionScale: 2.2,
    sunShiny: 64,
    onError: waterError,
  })
  applyRiverMaterial(water.material, river.halfWidth, river.halfLength)
  let cameraMoving = false
  const removeMoveStart = viewer.camera.moveStart.addEventListener(() => {
    cameraMoving = true
    water.setOptions({ reflectionMaxFps: 60 })
  })
  const removeMoveEnd = viewer.camera.moveEnd.addEventListener(() => {
    cameraMoving = false
    water.setOptions({
      reflectionMaxFps:
        options.quality === 'high' ? 60 : options.quality === 'low' ? 15 : 30,
    })
  })
  const puddle = new WaterSurface({
    scene,
    positions: waterBoundary(77, -165, 5.5, 18, true),
    height: placement.height + 2.29,
    foam: false,
    quality: 'low',
    waterColor: Cesium.Color.fromCssColorString('#293746'),
    waterAlpha: 0.98,
    reflectivity: 0.7,
    rippleSize: 26,
    distortionScale: 0.15,
    onError: waterError,
  })
  puddle.show = false

  function modelMatrix(
    x: number,
    y: number,
    z: number,
    heading: number,
    scale: number,
    result = new Cesium.Matrix4(),
  ): Cesium.Matrix4 {
    const rotation = Cesium.Matrix3.fromRotationZ(heading)
    const local = Cesium.Matrix4.fromRotationTranslation(
      rotation,
      new Cesium.Cartesian3(x, y, z),
    )
    Cesium.Matrix4.multiplyByUniformScale(local, scale, local)
    return Cesium.Matrix4.multiplyTransformation(frame, local, result)
  }
  async function loadModel(
    url: string,
    matrix: Cesium.Matrix4,
    shader?: Cesium.CustomShader,
  ): Promise<Cesium.Model | undefined> {
    const model = await Cesium.Model.fromGltfAsync({
      url,
      modelMatrix: matrix,
      upAxis: Cesium.Axis.Y,
      forwardAxis: Cesium.Axis.X,
      enableVerticalExaggeration: false,
      shadows: shader
        ? Cesium.ShadowMode.ENABLED
        : options.selfShadows
          ? Cesium.ShadowMode.ENABLED
          : Cesium.ShadowMode.CAST_ONLY,
      ...(shader ? { customShader: shader } : {}),
    })
    if (destroyed) {
      model.destroy()
      return
    }
    models.push(model)
    scene.primitives.add(model)
    if (environmentCoefficients) {
      model.imageBasedLighting.sphericalHarmonicCoefficients =
        environmentCoefficients
      model.imageBasedLighting.specularEnvironmentMaps = `${import.meta.env.BASE_URL}model-rendering/studio-specular.ktx2`
      model.imageBasedLighting.imageBasedLightingFactor = new Cesium.Cartesian2(
        0.8,
        0.8,
      )
      model.environmentMapManager.enabled = false
    }
    model.environmentMapManager.maximumPositionEpsilon = 50
    model.errorEvent.addEventListener((error) => {
      status.warning = `模型资源或渲染失败：${String(error)}`
      notify()
    })
    status.loaded++
    notify()
    return model
  }
  async function loadBuildings(): Promise<void> {
    const response = await fetch(`${base}kenney/bounds.json`)
    if (!response.ok) throw new Error('建筑范围文件加载失败')
    const bounds = (await response.json()) as Record<string, AssetBounds>
    const buildings = cityBuildings()
    for (const building of buildings) {
      const dimensions = bounds[building.name]
      if (!dimensions) throw new Error(`缺少建筑范围：${building.name}`)
      const w = ((dimensions.max[0]! - dimensions.min[0]!) * building.scale) / 2
      const l = ((dimensions.max[2]! - dimensions.min[2]!) * building.scale) / 2
      const cosine = Math.abs(Math.cos(building.heading)),
        sine = Math.abs(Math.sin(building.heading))
      obstacles.push({
        x: building.x,
        y: building.y,
        halfWidth: w * cosine + l * sine,
        halfLength: w * sine + l * cosine,
        roof: 2.2 + dimensions.max[1]! * building.scale,
      })
    }
    await runQueue(buildings, async (building) => {
      await loadModel(
        `${base}kenney/city/${building.name}.glb`,
        modelMatrix(
          building.x,
          building.y,
          2.2,
          building.heading,
          building.scale,
        ),
      )
    })
  }
  async function runQueue<T>(
    items: T[],
    action: (item: T, index: number) => Promise<void>,
  ): Promise<void> {
    let index = 0
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        while (!destroyed && index < items.length) {
          const current = index++
          await action(items[current]!, current)
        }
      }),
    )
  }
  async function loadVehicles(): Promise<void> {
    const names = ['sedan', 'taxi', 'suv', 'sedan-sports', 'van', 'delivery']
    await runQueue(
      Array.from({ length: 40 }, (_, index) => index),
      async (index) => {
        const route = index < 16 ? 0 : index < 28 ? 1 : 2
        const distance =
          (index * routeLength(trafficRoutes[route]!)) / (route === 0 ? 16 : 12)
        const reverse = index % 2 === 1
        const pose = vehiclePose(
          trafficRoutes[route]!,
          distance,
          reverse ? -4 : 4,
        )
        const model = await loadModel(
          `${base}kenney/cars/${names[index % names.length]}.glb`,
          modelMatrix(
            pose.x,
            pose.y,
            2.3,
            pose.heading + (reverse ? Math.PI : 0),
            2.7,
          ),
        )
        if (!model) return
        const vehicle: Vehicle = {
          model,
          route,
          distance,
          reverse,
          wheelRotation: 0,
          wheels: [],
        }
        vehicles.push(vehicle)
        model.readyEvent.addEventListener(() => {
          for (const name of [
            'wheel-front-right',
            'wheel-front-left',
            'wheel-back-right',
            'wheel-back-left',
          ]) {
            const node = model.getNode(name)
            if (node)
              vehicle.wheels.push({
                node,
                matrix: Cesium.Matrix4.clone(node.matrix),
              })
          }
        })
      },
    )
  }
  const frustum = viewer.camera.frustum as Cesium.PerspectiveFrustum
  function updateFrustum(): void {
    const aspect =
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight)
    const vertical = Cesium.Math.toRadians(50)
    frustum.fov =
      aspect > 1 ? 2 * Math.atan(Math.tan(vertical / 2) * aspect) : vertical
    frustum.near = 0.5
  }
  const resizeObserver = new ResizeObserver(updateFrustum)
  resizeObserver.observe(container)
  updateFrustum()
  function resetView(
    view: 'overview' | 'river' | 'street' | 'clouds' | 'earth' = 'overview',
  ): void {
    if (view === 'earth') {
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(
          placement.longitude,
          placement.latitude,
          18000000,
        ),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      })
      return
    }
    const position =
      view === 'clouds'
        ? new Cesium.Cartesian3(
            0,
            -900,
            options.cloudAltitude + options.cloudThickness * 0.4,
          )
        : view === 'street'
          ? new Cesium.Cartesian3(87, -285, 15)
          : view === 'river'
            ? new Cesium.Cartesian3(5, -400, 30)
            : new Cesium.Cartesian3(430, -660, 240)
    const target =
      view === 'clouds'
        ? new Cesium.Cartesian3(
            0,
            1300,
            options.cloudAltitude + options.cloudThickness * 0.7,
          )
        : view === 'street'
          ? new Cesium.Cartesian3(125, -50, 40)
          : view === 'river'
            ? new Cesium.Cartesian3(0, 70, 90)
            : new Cesium.Cartesian3(0, 0, 130)
    const eye = Cesium.Matrix4.multiplyByPoint(
      frame,
      position,
      new Cesium.Cartesian3(),
    )
    const aim = Cesium.Matrix4.multiplyByPoint(
      frame,
      target,
      new Cesium.Cartesian3(),
    )
    const up = Cesium.Matrix4.multiplyByPointAsVector(
      frame,
      Cesium.Cartesian3.UNIT_Z,
      new Cesium.Cartesian3(),
    )
    viewer.camera.setView({
      destination: eye,
      orientation: {
        direction: Cesium.Cartesian3.normalize(
          Cesium.Cartesian3.subtract(aim, eye, aim),
          aim,
        ),
        up,
      },
    })
  }
  let appliedHour = NaN
  function apply(next: CityOptions): void {
    options = { ...next }
    if (destroyed) return
    const date = new Date(
      Date.UTC(2026, 5, 21, 0, Math.round((options.hour - 8) * 60)),
    )
    if (appliedHour !== options.hour) {
      viewer.clock.currentTime = Cesium.JulianDate.fromDate(date)
      appliedHour = options.hour
      rain.reset()
    }
    scene.light = new Cesium.SunLight({ intensity: options.sunlight })
    scene.postProcessStages.exposure = options.exposure
    viewer.shadows = options.shadows
    for (const model of models)
      model.shadows =
        model.customShader === wetShader
          ? Cesium.ShadowMode.ENABLED
          : options.selfShadows
            ? Cesium.ShadowMode.ENABLED
            : Cesium.ShadowMode.CAST_ONLY
    viewer.resolutionScale =
      options.quality === 'low'
        ? 1
        : Math.min(devicePixelRatio, options.quality === 'high' ? 1.25 : 1)
    scene.shadowMap.size =
      options.quality === 'high'
        ? 4096
        : options.quality === 'low'
          ? 1024
          : 2048
    water.setOptions({
      reflection: options.reflections,
      quality: options.quality,
      distortionScale: 2.2 + options.rain * 0.4,
      waveStrength:
        options.waveStrength * (0.65 + Math.min(options.wind, 20) * 0.06),
      waveSpeed: options.waveSpeed * (0.6 + Math.min(options.wind, 20) * 0.065),
      reflectionMaxFps:
        cameraMoving || options.quality === 'high'
          ? 60
          : options.quality === 'low'
            ? 15
            : 30,
      lightDirection: (() => {
        const sun = Cesium.Matrix4.multiplyByPointAsVector(
          Cesium.Matrix4.inverseTransformation(frame, new Cesium.Matrix4()),
          Cesium.Matrix3.multiplyByVector(
            Cesium.Transforms.computeTemeToPseudoFixedMatrix(
              Cesium.JulianDate.fromDate(date),
            ),
            Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
              Cesium.JulianDate.fromDate(date),
            ),
            new Cesium.Cartesian3(),
          ),
          new Cesium.Cartesian3(),
        )
        Cesium.Cartesian3.normalize(sun, sun)
        return new Cesium.Cartesian3(sun.x, sun.z, -sun.y)
      })(),
    })
    puddle.show = options.puddles
    puddle.setOptions({ reflection: options.reflections })
    wetShader.setUniform('u_wetness', options.wetness)
    rain.apply(options.rain, options.wind, options.quality)
    environment?.apply(options)
    if (scene.skyAtmosphere)
      scene.skyAtmosphere.show = !environment || !options.clouds
    vehicles.forEach((vehicle, index) => {
      vehicle.model.show = index < options.vehicles
    })
    scene.requestRender()
  }
  let last = performance.now(),
    fpsStart = last,
    fpsFrames = 0
  const removeFrame = scene.preRender.addEventListener(() => {
    const now = performance.now(),
      dt = Math.min((now - last) / 1000, 0.1)
    last = now
    fpsFrames++
    if (now - fpsStart > 1200) {
      status.fps = Math.round((fpsFrames * 1000) / (now - fpsStart))
      fpsFrames = 0
      fpsStart = now
      notify()
    }
    if (!options.traffic) return
    vehicles.forEach((vehicle, index) => {
      if (index >= options.vehicles) return
      vehicle.distance += dt * options.speed * (vehicle.reverse ? -1 : 1)
      const pose = vehiclePose(
        trafficRoutes[vehicle.route]!,
        vehicle.distance,
        vehicle.reverse ? -4 : 4,
      )
      vehicle.model.modelMatrix = modelMatrix(
        pose.x,
        pose.y,
        2.3,
        pose.heading + (vehicle.reverse ? Math.PI : 0),
        2.7,
      )
      vehicle.wheelRotation +=
        ((dt * options.speed) / 0.8) * (vehicle.reverse ? 1 : -1)
      for (const wheel of vehicle.wheels)
        wheel.node.matrix = Cesium.Matrix4.multiply(
          wheel.matrix,
          Cesium.Matrix4.fromRotationTranslation(
            Cesium.Matrix3.fromRotationX(vehicle.wheelRotation),
          ),
          new Cesium.Matrix4(),
        )
    })
  })
  let recovering = false
  const removeError = scene.renderError.addEventListener((_scene, error) => {
    status.warning = `渲染错误：${String(error).slice(0, 450)}`
    notify()
    if (!environment || recovering) return
    recovering = true
    requestAnimationFrame(() => {
      if (destroyed) return
      environment?.destroy()
      environment = undefined
      status.sky = 'failed'
      status.warning = `高级天空渲染失败，已退回基础光照：${String(error).slice(0, 200)}`
      if (scene.skyAtmosphere) scene.skyAtmosphere.show = true
      viewer.useDefaultRenderLoop = true
      scene.requestRender()
      notify()
    })
  })
  resetView()
  apply(options)
  notify()
  const loading = Promise.allSettled([
    (async () => {
      try {
        await lightingReady
        await loadModel(`${base}riverside-site.glb`, frame, wetShader)
        await Promise.all([loadBuildings(), loadVehicles()])
        if (!destroyed) {
          status.phase = '滨水街区就绪'
          apply(options)
          notify()
        }
      } catch (error) {
        status.phase = '部分模型加载失败'
        status.warning = String(error)
        notify()
      }
    })(),
    (async () => {
      try {
        environment = await createCityEnvironment(viewer)
        status.sky = 'ready'
        if (!destroyed) apply(options)
      } catch (error) {
        status.sky = 'failed'
        status.warning = `云与大气加载失败：${String(error)}`
      }
      notify()
    })(),
  ]).then(() => {
    if (destroyed) cleanup()
  })

  function cleanup(): void {
    if (cleanupDone) return
    cleanupDone = true
    environment?.destroy()
    rain.destroy()
    puddle.destroy()
    water.destroy()
    viewer.destroy()
    wetShader.destroy()
  }
  function dispose(): void {
    if (destroyed) return
    destroyed = true
    removeFrame()
    removeMoveStart()
    removeMoveEnd()
    removeError()
    removeImageryError()
    removeImageryReady()
    removeTileError?.()
    resizeObserver.disconnect()
    viewer.useDefaultRenderLoop = false
    void loading.then(cleanup)
  }
  return { apply, resetView, dispose }
}
