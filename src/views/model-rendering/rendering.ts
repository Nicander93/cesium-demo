import * as Cesium from 'cesium'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'

export interface RenderingOptions {
  enhanced: boolean
  environment: boolean
  shadows: boolean
  selfShadows: boolean
  ao: boolean
  exposure: number
  lightIntensity: number
  environmentIntensity: number
  tonemapper: 'neutral' | 'aces'
}

export const defaultOptions: RenderingOptions = {
  enhanced: true, environment: true, shadows: true, selfShadows: false, ao: false,
  exposure: 1, lightIntensity: 1, environmentIntensity: 1, tonemapper: 'neutral',
}

interface LoadedModels { cesium: Cesium.Model; three: THREE.Group }
interface RenderingSupport { version: string; hdr: boolean; ao: boolean; ibl: boolean }

/** A shared model, view and HDR source isolate lighting changes from material changes. */
export function createRenderingComparison(cesiumContainer: HTMLElement, threeContainer: HTMLElement, reportError: (message: string) => void) {
  let destroyed = false
  let generation = 0
  let loaded: LoadedModels | undefined
  let options = { ...defaultOptions }
  const assetBase = `${import.meta.env.BASE_URL}model-rendering/`
  const origin = Cesium.Cartesian3.fromDegrees(116.39, 39.9, 200)
  const frame = Cesium.Transforms.eastNorthUpToFixedFrame(origin)
  const viewer = new Cesium.Viewer(cesiumContainer, {
    baseLayer: false, globe: false, skyBox: false, skyAtmosphere: false,
    animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false,
    sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, infoBox: false,
    selectionIndicator: false, scene3DOnly: true, requestRenderMode: false, maximumRenderTimeChange: Infinity,
    msaaSamples: 4, contextOptions: { webgl: { alpha: false, antialias: true } },
  })
  const scene = viewer.scene
  scene.backgroundColor = Cesium.Color.fromCssColorString('#242832')
  scene.fog.enabled = false
  if (scene.sun) scene.sun.show = false
  if (scene.moon) scene.moon.show = false
  scene.screenSpaceCameraController.enableInputs = false
  viewer.resolutionScale = Math.min(devicePixelRatio, 1.5)
  viewer.useBrowserRecommendedResolution = false
  viewer.camera.lookAtTransform(frame)
  const cesiumFrustum = viewer.camera.frustum as Cesium.PerspectiveFrustum
  scene.shadowMap.size = 2048
  scene.shadowMap.softShadows = true
  scene.shadowMap.darkness = 0.25

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  threeContainer.append(renderer.domElement)
  const threeScene = new THREE.Scene()
  threeScene.background = new THREE.Color('#242832')
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000)
  camera.position.set(5, 3, 10)
  const controls = { target: new THREE.Vector3(), minDistance: 0.1, maxDistance: 1000, update: synchronizeCamera }
  const light = new THREE.DirectionalLight(0xffffff, 1)
  light.position.set(-3, 5, 4)
  light.shadow.mapSize.set(2048, 2048)
  light.shadow.normalBias = 0.02
  threeScene.add(light, light.target)
  const pmrem = new THREE.PMREMGenerator(renderer)
  let environmentTarget: THREE.WebGLRenderTarget | undefined
  let coefficients: Cesium.Cartesian3[] = []
  const environmentReady = Promise.all([
    new HDRLoader().loadAsync(`${assetBase}studio.hdr`),
    fetch(`${assetBase}studio-sh.json`).then(async response => {
      if (!response.ok) throw new Error('环境光资源加载失败')
      const values = await response.json() as number[][]
      return values.map(value => new Cesium.Cartesian3(value[0], value[1], value[2]))
    }),
  ]).then(([hdr, sh]) => {
    if (destroyed) { hdr.dispose(); return }
    environmentTarget = pmrem.fromEquirectangular(hdr)
    hdr.dispose()
    coefficients = sh
  })

  let radius = 5
  let center = new THREE.Vector3()
  let floor: Cesium.Primitive | undefined
  let threeFloor: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> | undefined
  function synchronizeCamera(): void {
    if (destroyed) return
    camera.lookAt(controls.target)
    camera.updateMatrixWorld()
    const position = camera.position
    const direction = new THREE.Vector3().subVectors(controls.target, position).normalize()
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
    Cesium.Cartesian3.clone(new Cesium.Cartesian3(position.x, -position.z, position.y), viewer.camera.position)
    Cesium.Cartesian3.clone(new Cesium.Cartesian3(direction.x, -direction.z, direction.y), viewer.camera.direction)
    Cesium.Cartesian3.clone(new Cesium.Cartesian3(up.x, -up.z, up.y), viewer.camera.up)
    Cesium.Cartesian3.cross(viewer.camera.direction, viewer.camera.up, viewer.camera.right)
    // Cesium's fov is horizontal in a wide viewport; Three's fov is always vertical.
    const aspect = cesiumContainer.clientWidth / Math.max(1, cesiumContainer.clientHeight)
    cesiumFrustum.fov = aspect > 1 ? 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect) : THREE.MathUtils.degToRad(camera.fov)
    cesiumFrustum.near = camera.near
    cesiumFrustum.far = camera.far
    scene.requestRender()
    renderer.render(threeScene, camera)
  }
  const inputCleanups: (() => void)[] = []
  for (const canvas of [scene.canvas, renderer.domElement]) {
    let gesture: { id: number; x: number; y: number; pan: boolean } | undefined
    const down = (event: PointerEvent) => {
      if (gesture || event.button > 2) return
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, pan: event.shiftKey || event.button !== 0 }
      canvas.setPointerCapture(event.pointerId)
      event.preventDefault()
    }
    const move = (event: PointerEvent) => {
      if (!gesture || gesture.id !== event.pointerId) return
      const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y
      gesture.x = event.clientX; gesture.y = event.clientY
      const offset = camera.position.clone().sub(controls.target)
      if (gesture.pan) {
        const scale = 2 * offset.length() * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(canvas.clientHeight, 1)
        const shift = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(-dx * scale)
          .add(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(dy * scale))
        camera.position.add(shift); controls.target.add(shift)
      } else {
        const spherical = new THREE.Spherical().setFromVector3(offset)
        spherical.theta -= dx * 0.008
        spherical.phi = THREE.MathUtils.clamp(spherical.phi - dy * 0.008, 0.05, Math.PI - 0.05)
        camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical))
      }
      synchronizeCamera()
    }
    const up = (event: PointerEvent) => {
      if (gesture?.id !== event.pointerId) return
      gesture = undefined
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    }
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const offset = camera.position.clone().sub(controls.target)
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1)
      const distance = THREE.MathUtils.clamp(offset.length() * Math.exp(delta * 0.001), controls.minDistance, controls.maxDistance)
      camera.position.copy(controls.target).add(offset.setLength(distance))
      synchronizeCamera()
    }
    const menu = (event: Event) => event.preventDefault()
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('wheel', wheel, { passive: false })
    canvas.addEventListener('contextmenu', menu)
    inputCleanups.push(() => {
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('contextmenu', menu)
    })
  }

  function resize(): void {
    if (destroyed) return
    const width = Math.max(1, threeContainer.clientWidth)
    const height = Math.max(1, threeContainer.clientHeight)
    renderer.setSize(width, height)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    viewer.resize()
    synchronizeCamera()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(cesiumContainer)
  observer.observe(threeContainer)

  function disposeThree(object: THREE.Object3D): void {
    const textures = new Set<THREE.Texture>()
    const materials = new Set<THREE.Material>()
    const geometries = new Set<THREE.BufferGeometry>()
    object.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return
      geometries.add(child.geometry)
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
        materials.add(material)
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value)
      }
    })
    geometries.forEach(value => value.dispose())
    materials.forEach(value => value.dispose())
    textures.forEach(value => value.dispose())
  }

  function applyOptions(next: RenderingOptions): void {
    options = { ...next }
    if (destroyed) return
    const enhanced = options.enhanced
    scene.highDynamicRange = enhanced && scene.highDynamicRangeSupported
    scene.postProcessStages.tonemapper = options.tonemapper === 'aces' ? Cesium.Tonemapper.ACES : Cesium.Tonemapper.PBR_NEUTRAL
    scene.postProcessStages.exposure = enhanced ? options.exposure : 1
    scene.postProcessStages.fxaa.enabled = enhanced
    scene.postProcessStages.bloom.enabled = false
    scene.postProcessStages.ambientOcclusion.enabled = enhanced && options.ao && Cesium.PostProcessStageLibrary.isAmbientOcclusionSupported(scene)
    viewer.shadows = enhanced && options.shadows
    const localDirection = new Cesium.Cartesian3(3, -4, -5)
    const worldDirection = Cesium.Matrix4.multiplyByPointAsVector(frame, localDirection, new Cesium.Cartesian3())
    scene.light = enhanced ? new Cesium.DirectionalLight({ direction: Cesium.Cartesian3.normalize(worldDirection, worldDirection), intensity: options.lightIntensity }) : new Cesium.SunLight()
    if (loaded) {
      // Cesium documents undefined as the reset value; its generated types omit it.
      const ibl = loaded.cesium.imageBasedLighting as Omit<Cesium.ImageBasedLighting, 'sphericalHarmonicCoefficients' | 'specularEnvironmentMaps'> & {
        sphericalHarmonicCoefficients: Cesium.Cartesian3[] | undefined
        specularEnvironmentMaps: string | undefined
      }
      ibl.sphericalHarmonicCoefficients = enhanced && options.environment ? coefficients : undefined
      ibl.specularEnvironmentMaps = enhanced && options.environment ? `${assetBase}studio-specular.ktx2` : undefined
      ibl.imageBasedLightingFactor = new Cesium.Cartesian2(enhanced ? (options.environment ? options.environmentIntensity : 0) : 1, enhanced ? (options.environment ? options.environmentIntensity : 0) : 1)
      loaded.cesium.environmentMapManager.enabled = !enhanced
      loaded.cesium.shadows = viewer.shadows ? (options.selfShadows ? Cesium.ShadowMode.ENABLED : Cesium.ShadowMode.CAST_ONLY) : Cesium.ShadowMode.DISABLED

    }
    // The reference always uses the shared studio; disabling Cesium enhancements does not change it.
    threeScene.environment = options.environment ? environmentTarget?.texture ?? null : null
    threeScene.environmentIntensity = options.environmentIntensity
    renderer.toneMapping = options.tonemapper === 'aces' ? THREE.ACESFilmicToneMapping : THREE.NeutralToneMapping
    renderer.toneMappingExposure = options.exposure
    renderer.shadowMap.enabled = options.shadows
    light.intensity = options.lightIntensity
    light.castShadow = options.shadows
    loaded?.three.traverse(child => { if (child instanceof THREE.Mesh) child.receiveShadow = options.selfShadows })
    synchronizeCamera()
  }

  function resetView(): void {
    controls.target.copy(center)
    const aspect = Math.min(cesiumContainer.clientWidth / Math.max(cesiumContainer.clientHeight, 1), threeContainer.clientWidth / Math.max(threeContainer.clientHeight, 1))
    const halfFov = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(1, aspect))
    const distance = radius / Math.sin(halfFov) * 1.1
    camera.position.copy(center).add(new THREE.Vector3(0.15, 0.28, 1).normalize().multiplyScalar(distance))
    camera.near = Math.max(radius / 1000, 0.001)
    camera.far = Math.max(radius * 100, 100)
    controls.minDistance = radius * 0.3
    controls.maxDistance = radius * 10
    controls.update()
    resize()
  }

  async function load(url: string): Promise<void> {
    const request = ++generation
    await environmentReady
    if (destroyed || request !== generation) return
    const results = await Promise.allSettled([
      Cesium.Model.fromGltfAsync({ url, modelMatrix: frame, upAxis: Cesium.Axis.Y, forwardAxis: Cesium.Axis.X, enableVerticalExaggeration: false }),
      new GLTFLoader().loadAsync(url),
    ])
    const cesiumResult = results[0]!
    const threeResult = results[1]!
    if (destroyed || request !== generation || cesiumResult.status === 'rejected' || threeResult.status === 'rejected') {
      if (cesiumResult.status === 'fulfilled' && !cesiumResult.value.isDestroyed()) cesiumResult.value.destroy()
      if (threeResult.status === 'fulfilled') disposeThree(threeResult.value.scene)
      if (destroyed || request !== generation) return
      throw new Error(results.filter(result => result.status === 'rejected').map(result => String(result.reason)).join('\n'))
    }
    const object = threeResult.value.scene
    const bounds = new THREE.Box3().setFromObject(object)
    const sphere = bounds.getBoundingSphere(new THREE.Sphere())
    if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) {
      cesiumResult.value.destroy(); disposeThree(object)
      throw new Error('模型没有可显示的几何范围')
    }
    if (loaded) { scene.primitives.remove(loaded.cesium); threeScene.remove(loaded.three); disposeThree(loaded.three) }
    radius = sphere.radius
    center = sphere.center
    object.traverse(child => { if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true } })
    threeScene.add(object)
    scene.primitives.add(cesiumResult.value)
    loaded = { cesium: cesiumResult.value, three: object }
    loaded.cesium.errorEvent.addEventListener(error => reportError(`Cesium 模型渲染失败：${String(error)}`))
    if (floor) scene.primitives.remove(floor)
    if (threeFloor) { threeScene.remove(threeFloor); disposeThree(threeFloor) }
    const floorY = bounds.min.y - radius * 0.005
    threeFloor = new THREE.Mesh(new THREE.PlaneGeometry(radius * 8, radius * 8), new THREE.MeshStandardMaterial({ color: '#656872', roughness: 1, metalness: 0 }))
    threeFloor.rotation.x = -Math.PI / 2
    threeFloor.position.set(center.x, floorY, center.z)
    threeFloor.receiveShadow = true
    threeScene.add(threeFloor)
    const floorTransform = Cesium.Matrix4.multiplyByTranslation(frame, new Cesium.Cartesian3(center.x, -center.z, floorY - radius * 0.001), new Cesium.Matrix4())
    floor = new Cesium.Primitive({ geometryInstances: new Cesium.GeometryInstance({ geometry: Cesium.BoxGeometry.fromDimensions({ dimensions: new Cesium.Cartesian3(radius * 8, radius * 8, radius * 0.002), vertexFormat: Cesium.MaterialAppearance.MaterialSupport.BASIC.vertexFormat }), modelMatrix: floorTransform }), appearance: new Cesium.MaterialAppearance({ material: Cesium.Material.fromType('Color', { color: Cesium.Color.fromCssColorString('#656872') }), materialSupport: Cesium.MaterialAppearance.MaterialSupport.BASIC, flat: false }), shadows: Cesium.ShadowMode.RECEIVE_ONLY, asynchronous: false })
    scene.primitives.add(floor)
    light.position.copy(center).add(new THREE.Vector3(-3, 5, 4).multiplyScalar(radius))
    light.target.position.copy(center)
    light.shadow.camera.left = light.shadow.camera.bottom = -radius * 3
    light.shadow.camera.right = light.shadow.camera.top = radius * 3
    light.shadow.camera.near = radius * 0.1
    light.shadow.camera.far = radius * 15
    light.shadow.camera.updateProjectionMatrix()
    scene.shadowMap.maximumDistance = radius * 20
    applyOptions(options)
    resetView()
  }

  function dispose(): void {
    destroyed = true
    generation++
    observer.disconnect()
    inputCleanups.forEach(cleanup => cleanup())
    pmrem.dispose()
    environmentTarget?.dispose()
    if (loaded) disposeThree(loaded.three)
    if (threeFloor) disposeThree(threeFloor)

    viewer.destroy()
    renderer.dispose()
    renderer.domElement.remove()
  }

  const support: RenderingSupport = { version: (Cesium as unknown as { VERSION: string }).VERSION, hdr: scene.highDynamicRangeSupported, ao: Cesium.PostProcessStageLibrary.isAmbientOcclusionSupported(scene), ibl: scene.specularEnvironmentMapsSupported }
  return { load, applyOptions, resetView, dispose, support }
}
