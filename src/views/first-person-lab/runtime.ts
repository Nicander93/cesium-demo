import * as Cesium from 'cesium'
import { movePlayer, walkingVelocity, WALKING_WORLD, type PlayerState } from './walking'
import { loadInteriorSource, type InteriorSpawn } from './interior-source'
import { moveMeshPlayer, spawnMeshPlayer, type MeshPlayerState } from './mesh-walking'
import { advanceToTarget, findWalkTarget } from './navigation'
import type { Point2 } from './walking'

export type WalkMode = 'paused' | 'walking' | 'navigate' | 'inspect'
export type InteriorQuality = 'performance' | 'balanced' | 'high'
export interface FirstPersonLabOptions {
  manifestUrl?: string
  origin?: [number, number, number]
}

export interface WalkStatus {
  mode: WalkMode
  pointerLocked: boolean
  dragLook: boolean
  roofVisible: boolean
  player: PlayerState
  fps: number
  ready: boolean
  stage: string
  error: string
  fixture: boolean
  modelName: string
  collisionTriangles: number
  grounded: boolean
  exposure: number
  occlusion: boolean
  spawns: InteriorSpawn[]
  quality: InteriorQuality
  renderScale: number
  sliced: boolean
  sliceHeight: number
  navigationMessage: string
  author: string
  sourceUrl: string
  license: string
}

const anchor = Cesium.Cartesian3.fromDegrees(119.0317, 33.5921, 30)
const frame = Cesium.Transforms.eastNorthUpToFixedFrame(anchor)

function buildRoom(): Cesium.Primitive {
  const parts = [
    { x: 0, y: 0.5, z: -0.1, width: 20, depth: 19, height: 0.2, color: '#68746a' },
    ...WALKING_WORLD.walls.map(wall => ({
      x: (wall.minX + wall.maxX) / 2,
      y: (wall.minY + wall.maxY) / 2,
      z: wall.height / 2,
      width: wall.maxX - wall.minX,
      depth: wall.maxY - wall.minY,
      height: wall.height,
      color: '#dfd5c3',
    })),
    ...WALKING_WORLD.platforms.map(platform => ({
      x: (platform.minX + platform.maxX) / 2,
      y: (platform.minY + platform.maxY) / 2,
      z: platform.height / 2,
      width: platform.maxX - platform.minX,
      depth: platform.maxY - platform.minY,
      height: platform.height,
      color: '#a7835b',
    })),
    ...WALKING_WORLD.blockers.map(blocker => ({
      x: (blocker.minX + blocker.maxX) / 2,
      y: (blocker.minY + blocker.maxY) / 2,
      z: blocker.height / 2,
      width: blocker.maxX - blocker.minX,
      depth: blocker.maxY - blocker.minY,
      height: blocker.height,
      color: blocker.color,
    })),
    // Lintels are visual only; the doorway collider remains open below them.
    { x: 0, y: -5.1, z: 2.75, width: 2, depth: 0.2, height: 0.9, color: '#c7b79d' },
    { x: 0, y: 0.09, z: 2.5, width: 2.5, depth: 0.18, height: 0.6, color: '#c7b79d' },
  ]
  const instances = parts.map(part => {
    const dimensions = new Cesium.Cartesian3(part.width, part.depth, part.height)
    return new Cesium.GeometryInstance({
      geometry: Cesium.BoxGeometry.fromDimensions({
        vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
        dimensions,
      }),
      modelMatrix: Cesium.Matrix4.multiplyByTranslation(
        frame,
        new Cesium.Cartesian3(part.x, part.y, part.z),
        new Cesium.Matrix4(),
      ),
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString(part.color)!),
      },
    })
  })
  return new Cesium.Primitive({
    geometryInstances: instances,
    appearance: new Cesium.PerInstanceColorAppearance({ flat: true, closed: true }),
    releaseGeometryInstances: true,
  })
}

function buildRoof(): Cesium.Primitive {
  const dimensions = new Cesium.Cartesian3(12.6, 12.6, 0.22)
  return new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry: Cesium.BoxGeometry.fromDimensions({
        vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
        dimensions,
      }),
      modelMatrix: Cesium.Matrix4.multiplyByTranslation(
        frame,
        new Cesium.Cartesian3(0, 1, 3.31),
        new Cesium.Matrix4(),
      ),
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString('#647467')!),
      },
    }),
    appearance: new Cesium.PerInstanceColorAppearance({ flat: true, closed: true }),
    releaseGeometryInstances: true,
  })
}

export function createFirstPersonLab(container: HTMLElement, report: (status: WalkStatus) => void, options: FirstPersonLabOptions = {}) {
  const fixture = new URLSearchParams(location.search).get('fixture') === 'procedural'
  const sceneId = new URLSearchParams(location.search).get('scene') === 'living-room' ? 'interior' : 'modern-hall'
  const manifestUrl = options.manifestUrl ?? import.meta.env.BASE_URL + `first-person-lab/${sceneId}/manifest.json`
  const origin = options.origin ?? [119.0317, 33.5921, 30]
  const frame = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(...origin))
  const inverseFrame = Cesium.Matrix4.inverseTransformation(frame, new Cesium.Matrix4())
  function localPoint(x: number, y: number, z: number): Cesium.Cartesian3 {
    return Cesium.Matrix4.multiplyByPoint(frame, new Cesium.Cartesian3(x, y, z), new Cesium.Cartesian3())
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
    scene3DOnly: true,
    contextOptions: { webgl: { alpha: false, antialias: true } },
    // resolutionScale is the total CSS-pixel scale; avoid applying devicePixelRatio twice.
    useBrowserRecommendedResolution: true,
    msaaSamples: 4,
  })
  viewer.scene.globe.show = false
  // A walking camera can approach walls much closer than Cesium's default 1 m near plane.
  viewer.camera.frustum.near = 0.03
  viewer.camera.frustum.far = 300
  if (viewer.camera.frustum instanceof Cesium.PerspectiveFrustum) viewer.camera.frustum.fov = Cesium.Math.toRadians(72)
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#c8cbd0')!
  viewer.scene.screenSpaceCameraController.enableInputs = false
  if (fixture) viewer.scene.primitives.add(buildRoom())
  const roof: Cesium.Primitive | undefined = fixture ? viewer.scene.primitives.add(buildRoof()) : undefined
  if (!fixture) {
    viewer.shadows = true
    viewer.scene.highDynamicRange = viewer.scene.highDynamicRangeSupported
    viewer.scene.postProcessStages.tonemapper = Cesium.Tonemapper.PBR_NEUTRAL
    const light = Cesium.Matrix4.multiplyByPointAsVector(frame, new Cesium.Cartesian3(-0.4, 0.55, -1), new Cesium.Cartesian3())
    viewer.scene.light = new Cesium.DirectionalLight({ direction: Cesium.Cartesian3.normalize(light, light), intensity: 1.4 })
    viewer.scene.shadowMap.maximumDistance = 30
  }
  const canvas = viewer.canvas
  canvas.setAttribute('tabindex', '0')

  let player: PlayerState = { x: 0, y: -2.7, footHeight: 0, heading: 0, pitch: 0 }
  let mode: WalkMode = 'paused'
  let destroyed = false
  let dragLook = false
  let pointerLocked = false
  let previousPointer = { x: 0, y: 0 }
  let lastFrame = performance.now()
  let frameCount = 0
  let fpsStart = lastFrame
  let fps = 0
  let initialized = fixture, stage = fixture ? '调试房间就绪' : '加载真实室内模型', error = ''
  let interior: Awaited<ReturnType<typeof loadInteriorSource>>
  let meshPlayer: MeshPlayerState | undefined
  let model: Cesium.Model | undefined
  let finishPendingModel: (() => void) | undefined
  let exposure = 1.15, occlusion = !fixture
  let quality: InteriorQuality = 'high', sliced = false, sliceHeight = 2.5
  let navigationMessage = '点击地面前往，拖动转向'
  let target: Point2 | undefined
  let pointerStart: { x: number; y: number } | undefined
  let pointerMoved = false
  const keys = new Set<string>()
  const controller = viewer.scene.screenSpaceCameraController
  const resize = new ResizeObserver(() => viewer.resize())
  resize.observe(container)

  function getState(): WalkStatus {
    return {
      mode, pointerLocked, dragLook, roofVisible: roof?.show ?? true, player: { ...player }, fps,
      ready: initialized, stage, error, fixture, modelName: fixture ? '碰撞调试房间' : (interior?.manifest.name ?? 'Living Room'),
      collisionTriangles: interior?.world.triangleCount ?? 0, grounded: meshPlayer?.grounded ?? true,
      exposure, occlusion, spawns: interior?.manifest.spawns ?? [],
      quality, renderScale: viewer.resolutionScale, sliced, sliceHeight, navigationMessage,
      author: interior?.manifest.author ?? '', sourceUrl: interior?.manifest.sourceUrl ?? '', license: interior?.manifest.license ?? '',
    }
  }

  function publish(): void {
    if (!destroyed) report(getState())
  }

  function positionCamera(): void {
    const eye = localPoint(player.x, player.y, player.footHeight + (interior?.world.eyeHeight ?? WALKING_WORLD.eyeHeight))
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
    viewer.camera.setView({
      destination: eye,
      orientation: { heading: player.heading, pitch: player.pitch, roll: 0 },
    })
  }

  function startWalk(): void {
    if (!initialized || destroyed) return
    mode = 'walking'
    setSlice(false)
    if (roof) roof.show = true
    controller.enableInputs = false
    lastFrame = performance.now()
    canvas.focus()
    if ('requestPointerLock' in canvas) {
      try {
        void Promise.resolve(canvas.requestPointerLock()).then(() => {
          if (mode !== 'walking' && document.pointerLockElement === canvas) document.exitPointerLock()
        }, () => publish())
      } catch { publish() }
    }
    positionCamera()
    publish()
  }

  function pause(): void {
    mode = 'paused'
    clearKeys()
    dragLook = false
    if (roof) roof.show = true
    if (document.pointerLockElement === canvas) document.exitPointerLock()
    if (initialized && !destroyed) positionCamera()
    publish()
  }

  function spawn(x: number, y: number, heading = 0): void {
    clearKeys()
    if (mode === 'inspect') mode = 'paused'
    if (roof) roof.show = true
    player = { x, y, footHeight: 0, heading, pitch: 0 }
    positionCamera()
    publish()
  }

  function spawnAt(id: string): void {
    if (!initialized || !interior) return
    const point = interior.manifest.spawns.find(item => item.id === id) ?? interior.manifest.spawns[0]
    if (!point) return
    clearKeys()
    if (mode === 'inspect') mode = 'paused'
    controller.enableInputs = false
    setSlice(false)
    meshPlayer = spawnMeshPlayer(interior.world, point.position, point.heading, point.pitch)
    player = meshPlayer
    positionCamera(); publish()
  }

  function inspect(): void {
    if (!initialized) return
    pause()
    mode = 'inspect'
    if (roof) roof.show = false
    controller.enableInputs = !fixture
    const bounds = interior?.world.bounds
    const range = fixture ? 24 : Math.max(8, Math.hypot(bounds ? bounds.max.x - bounds.min.x : 10, bounds ? bounds.max.y - bounds.min.y : 10) * 1.05)
    viewer.camera.lookAt(localPoint(0, 0, fixture ? 0 : 1.0), new Cesium.HeadingPitchRange(-0.5, -0.9, range))
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
    publish()
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.code === 'Escape' && (mode === 'walking' || mode === 'navigate')) {
      pause()
      return
    }
    if (event.repeat || !['walking', 'navigate'].includes(mode) || !['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(event.code) || (event.target instanceof HTMLElement && /INPUT|SELECT|TEXTAREA/.test(event.target.tagName))) return
    event.preventDefault()
    keys.add(event.code)
  }

  function handleKeyUp(event: KeyboardEvent): void { keys.delete(event.code) }
  function clearKeys(): void { keys.clear(); dragLook = false; target = undefined; pointerStart = undefined }
  function handlePointerLockChange(): void {
    const wasLocked = pointerLocked
    pointerLocked = document.pointerLockElement === canvas
    if (wasLocked && !pointerLocked && mode === 'walking') {
      mode = 'paused'
      clearKeys()
      if (roof) roof.show = true
      positionCamera()
    }
    if (wasLocked !== pointerLocked) publish()
  }
  function applyLook(movementX: number, movementY: number): void {
    player.heading = (player.heading + movementX * 0.0025 + Math.PI * 2) % (Math.PI * 2)
    player.pitch = Math.max(-1.25, Math.min(1.25, player.pitch - movementY * 0.002))
    positionCamera()
  }
  function handlePointerMove(event: PointerEvent): void {
    if (mode === 'walking' && pointerLocked) applyLook(event.movementX, event.movementY)
  }
  function handlePointerDown(event: PointerEvent): void {
    if (!['walking', 'navigate'].includes(mode) || pointerLocked || event.button !== 0) return
    dragLook = true
    previousPointer = { x: event.clientX, y: event.clientY }
    pointerStart = { ...previousPointer }; pointerMoved = false
    canvas.setPointerCapture(event.pointerId)
    publish()
  }
  function handleDragMove(event: PointerEvent): void {
    if (!dragLook || pointerLocked) return
    if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) pointerMoved = true
    if (mode === 'navigate' && !pointerMoved) return
    const movementX = event.clientX - previousPointer.x
    const movementY = event.clientY - previousPointer.y
    previousPointer = { x: event.clientX, y: event.clientY }
    applyLook(movementX, movementY)
  }
  function stopDrag(event: PointerEvent): void {
    const clicked = dragLook && !pointerMoved && mode === 'navigate' && event.type === 'pointerup'
    dragLook = false; pointerStart = undefined
    if (clicked && viewer.scene.pickPositionSupported && interior) {
      const rect = canvas.getBoundingClientRect()
      const screen = new Cesium.Cartesian2(event.clientX - rect.left, event.clientY - rect.top)
      const hit = viewer.scene.pickPosition(screen)
      if (hit) {
        const point = Cesium.Matrix4.multiplyByPoint(inverseFrame, hit, new Cesium.Cartesian3())
        navigateTo([point.x, point.y, point.z])
      }
    }
    publish()
  }

  const removeTick = viewer.scene.preRender.addEventListener(() => {
    const now = performance.now()
    const deltaSeconds = Math.min(0.25, Math.max(0, (now - lastFrame) / 1000))
    lastFrame = now
    frameCount++
    if (now - fpsStart >= 500) {
      fps = Math.round(frameCount * 1000 / (now - fpsStart))
      fpsStart = now
      frameCount = 0
      publish()
    }
    if (mode !== 'walking' && mode !== 'navigate') return
    const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? 4.2 : 2.2
    const velocity = walkingVelocity(keys, speed)
    const sine = Math.sin(player.heading)
    const cosine = Math.cos(player.heading)
    const forward = velocity.y * deltaSeconds
    const side = velocity.x * deltaSeconds
    if (interior && meshPlayer) {
      meshPlayer.heading = player.heading; meshPlayer.pitch = player.pitch
      if (mode === 'navigate' && target && velocity.x === 0 && velocity.y === 0) {
        const step = advanceToTarget(meshPlayer, target, deltaSeconds, interior.world)
        meshPlayer = step.player
        if (step.stopped) { target = undefined; navigationMessage = step.stopped === 'arrived' ? '已到达 · 点击下一处地面' : '前方受阻 · 请分段点击绕行'; publish() }
      } else {
        if (velocity.x !== 0 || velocity.y !== 0) target = undefined
        meshPlayer = moveMeshPlayer(meshPlayer, {
          x: sine * velocity.y + cosine * velocity.x,
          y: cosine * velocity.y - sine * velocity.x,
        }, deltaSeconds, interior.world)
      }
      player = meshPlayer
      if (player.footHeight < interior.world.bounds.min.z - 3) spawnAt('entry')
    } else player = movePlayer(player, { x: sine * forward + cosine * side, y: cosine * forward - sine * side })
    positionCamera()
  })

  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)
  window.addEventListener('blur', clearKeys)
  document.addEventListener('visibilitychange', clearKeys)
  document.addEventListener('pointerlockchange', handlePointerLockChange)
  canvas.addEventListener('pointermove', handlePointerMove)
  canvas.addEventListener('pointerdown', handlePointerDown)
  canvas.addEventListener('pointermove', handleDragMove)
  canvas.addEventListener('pointerup', stopDrag)
  canvas.addEventListener('pointercancel', stopDrag)
  if (fixture) spawn(0, -8.1)
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)

  function setExposure(value: number): void {
    exposure = Math.max(0.5, Math.min(2.5, value))
    viewer.scene.postProcessStages.exposure = exposure
    publish()
  }
  function setQuality(value: InteriorQuality): void {
    quality = value
    const ratio = Math.max(1, window.devicePixelRatio || 1)
    viewer.resolutionScale = value === 'performance' ? 1 : value === 'balanced' ? Math.min(ratio, 1.5) : Math.max(1.5, Math.min(ratio, 2))
    viewer.scene.msaaSamples = value === 'performance' ? 1 : 4
    viewer.scene.postProcessStages.fxaa.enabled = true
    viewer.resize(); publish()
  }
  function setSlice(value: boolean): void {
    sliced = value && !fixture
    if (model?.clippingPlanes) model.clippingPlanes.enabled = sliced
    publish()
  }
  function setSliceHeight(value: number): void {
    sliceHeight = Math.max(0.5, Math.min(15, value))
    const plane = model?.clippingPlanes?.get(0)
    if (plane) plane.distance = sliceHeight
    publish()
  }
  function startNavigation(): void {
    if (!initialized || !interior) return
    pause(); setSlice(false); mode = 'navigate'; controller.enableInputs = false
    navigationMessage = '点击地面前往，拖动转向'; canvas.focus(); positionCamera(); publish()
  }
  function navigateTo(point: readonly number[]): boolean {
    if (!interior || mode !== 'navigate') return false
    target = findWalkTarget(interior.world, point)
    navigationMessage = target ? '前往目标 · 点击可更换目标' : '请点击有足够站立空间的地面'
    publish(); return !!target
  }
  function setOcclusion(value: boolean): void {
    const supported = Cesium.PostProcessStageLibrary.isAmbientOcclusionSupported(viewer.scene)
    occlusion = value && supported
    const ao = viewer.scene.postProcessStages.ambientOcclusion
    ao.enabled = occlusion
    ao.uniforms.intensity = 2.2; ao.uniforms.bias = 0.05; ao.uniforms.lengthCap = 0.35; ao.uniforms.stepSize = 0.7
    publish()
  }
  async function initialize(): Promise<void> {
    if (fixture) { publish(); return }
    try {
      const source = await loadInteriorSource(manifestUrl, message => { if (!destroyed) { stage = message; publish() } }, () => destroyed)
      if (!source || destroyed) return
      interior = source
      viewer.camera.frustum.far = Math.max(300, source.world.bounds.max.distanceTo(source.world.bounds.min) * 10)
      stage = '加载模型材质与光照'; publish()
      const response = await fetch(import.meta.env.BASE_URL + 'model-rendering/studio-sh.json')
      if (!response.ok) throw new Error('室内环境光加载失败')
      const coefficients: unknown = await response.json()
      if (!Array.isArray(coefficients) || coefficients.length !== 9 || !coefficients.every(value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite))) throw new Error('室内环境光数据无效')
      const loaded = await Cesium.Model.fromGltfAsync({
        url: source.modelUrl, modelMatrix: frame,
        // Match the collider's [x,-z,y] map; default Z-forward rotates the floor plan again.
        upAxis: Cesium.Axis.Y, forwardAxis: Cesium.Axis.X,
        shadows: Cesium.ShadowMode.ENABLED, backFaceCulling: false, allowPicking: true,
      })
      if (destroyed) { loaded.destroy(); return }
      model = loaded
      model.clippingPlanes = new Cesium.ClippingPlaneCollection({ planes: [new Cesium.ClippingPlane(new Cesium.Cartesian3(0, 0, -1), sliceHeight)], enabled: false, edgeWidth: 1, edgeColor: Cesium.Color.fromCssColorString('#b8c9ab')! })
      model.imageBasedLighting.sphericalHarmonicCoefficients = coefficients.map(value => Cesium.Cartesian3.fromArray(value))
      model.imageBasedLighting.specularEnvironmentMaps = import.meta.env.BASE_URL + 'model-rendering/studio-specular.ktx2'
      model.imageBasedLighting.imageBasedLightingFactor = new Cesium.Cartesian2(1, 0.7)
      viewer.scene.primitives.add(model)
      setExposure(exposure); setOcclusion(occlusion); setQuality(quality)
      await new Promise<void>((resolve, reject) => {
        let completed = false
        let removeReady = () => {}, removeError = () => {}
        const finish = (failure?: unknown) => {
          if (completed) return
          completed = true; removeReady(); removeError(); finishPendingModel = undefined
          if (failure) reject(failure); else resolve()
        }
        finishPendingModel = () => finish()
        removeError = loaded.errorEvent.addEventListener((failure: unknown) => finish(failure))
        if (loaded.ready) finish()
        else removeReady = loaded.readyEvent.addEventListener(() => finish())
      })
      if (destroyed) return
      initialized = true; stage = '真实模型与碰撞已就绪'
      spawnAt('entry'); inspect(); setSlice(true); publish()
    } catch (failure) { if (!destroyed) { initialized = false; error = String(failure); stage = '室内模型加载失败'; publish() } }
  }
  const ready = initialize()

  const api = {
    ready, getState,
    projectPoint(point: [number, number, number]) {
      const screen = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, localPoint(...point))
      return screen ? { x: screen.x, y: screen.y } : undefined
    },
    pickPoint(x: number, y: number) {
      const hit = viewer.scene.pickPosition(new Cesium.Cartesian2(x, y))
      if (!hit) return undefined
      const local = Cesium.Matrix4.multiplyByPoint(inverseFrame, hit, new Cesium.Cartesian3())
      return [local.x, local.y, local.z]
    },
    enter: startWalk,
    pause,
    spawnOutdoor: () => fixture ? spawn(0, -8.1) : spawnAt('entry'),
    spawnIndoor: () => fixture ? spawn(0, -2.7) : spawnAt('inside'),
    spawnAt, inspect, setExposure, setOcclusion, setQuality, setSlice, setSliceHeight,
    navigate: startNavigation, navigateTo,
    look(heading: number, pitch = 0) {
      if (!initialized || !Number.isFinite(heading) || !Number.isFinite(pitch)) return
      player.heading = (heading % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)
      player.pitch = Math.max(-1.25, Math.min(1.25, pitch))
      positionCamera(); publish()
    },
    inspectScene() {
      const inverse = Cesium.Matrix4.inverseTransformation(frame, new Cesium.Matrix4())
      const bounds = model?.ready ? model.boundingSphere : undefined
      const center = bounds ? Cesium.Matrix4.multiplyByPoint(inverse, bounds.center, new Cesium.Cartesian3()) : undefined
      return {
        modelReady: model?.ready ?? false, renderer: 'Cesium',
        cameraPosition: Cesium.Matrix4.multiplyByPoint(inverse, viewer.camera.positionWC, new Cesium.Cartesian3()),
        cameraDirection: Cesium.Matrix4.multiplyByPointAsVector(inverse, viewer.camera.directionWC, new Cesium.Cartesian3()),
        clipEnabled: model?.clippingPlanes?.enabled ?? false, far: viewer.camera.frustum.far,
        modelCenter: center ? [center.x, center.y, center.z] : null, modelRadius: bounds?.radius ?? 0,
        collisionBounds: interior ? { min: interior.world.bounds.min.toArray(), max: interior.world.bounds.max.toArray() } : null,
        ibl: model?.imageBasedLighting.sphericalHarmonicCoefficients?.length ?? 0,
        shadows: viewer.shadows, exposure, occlusion, quality, fxaa: viewer.scene.postProcessStages.fxaa.enabled,
        msaaSamples: viewer.scene.msaaSamples, msaaSupported: viewer.scene.msaaSupported,
        devicePixelRatio: window.devicePixelRatio, resolutionScale: viewer.resolutionScale,
        drawingBuffer: [viewer.scene.drawingBufferWidth, viewer.scene.drawingBufferHeight], cssSize: [canvas.clientWidth, canvas.clientHeight], sliced,
      }
    },
    pressKey: (code: string) => keys.add(code),
    releaseKey: (code: string) => keys.delete(code),
  }
  const debugWindow = window as Window & { __firstPersonLab?: typeof api }
  if (import.meta.env.DEV) debugWindow.__firstPersonLab = api

  return {
    ...api,
    destroy(): void {
      if (destroyed) return
      destroyed = true
      clearKeys(); finishPendingModel?.()
      if (document.pointerLockElement === canvas) document.exitPointerLock()
      resize.disconnect()
      removeTick()
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', clearKeys)
      document.removeEventListener('visibilitychange', clearKeys)
      document.removeEventListener('pointerlockchange', handlePointerLockChange)
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointermove', handleDragMove)
      canvas.removeEventListener('pointerup', stopDrag)
      canvas.removeEventListener('pointercancel', stopDrag)
      if (debugWindow.__firstPersonLab === api) delete debugWindow.__firstPersonLab
      viewer.destroy()
      interior?.world.octree.clear()
      interior = undefined; meshPlayer = undefined; model = undefined; initialized = false
    },
  }
}





