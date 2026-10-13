import * as THREE from 'three'
import * as Cesium from 'cesium'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createThreeWater } from './three-water'
import {
  cityBuildings,
  river,
  routeLength,
  trafficRoutes,
  vehiclePose,
} from './layout'
import { createWaveNormalUrl } from './waves'

export interface ThreeCityOptions {
  hour: number
  exposure: number
  sunlight: number
  shadows: boolean
  selfShadows: boolean
  traffic: boolean
  reflections: boolean
  waveSpeed: number
}
export const threeCityDefaults: ThreeCityOptions = {
  hour: 14,
  exposure: 1,
  sunlight: 1.8,
  shadows: true,
  selfShadows: true,
  traffic: true,
  reflections: true,
  waveSpeed: 1,
}
interface Vehicle {
  object: THREE.Object3D
  route: number
  distance: number
  reverse: boolean
  wheels: { node: THREE.Object3D; rotation: number }[]
  rotation: number
}
interface Progress {
  loaded: number
  total: number
  fps: number
  error: string
}

/** Same GLBs, ENU layout, studio HDR and solar clock as the Cesium city. */
export function createThreeCity(
  container: HTMLElement,
  report: (value: Progress) => void,
) {
  let destroyed = false
  let cleanupDone = false
  let options = { ...threeCityDefaults }
  const progress: Progress = { loaded: 0, total: 65, fps: 0, error: '' }
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#a9c5d6')
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  container.append(renderer.domElement)
  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 16000)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = 8
  controls.maxDistance = 8000
  controls.maxPolarAngle = Math.PI * 0.495
  const light = new THREE.DirectionalLight(0xffffff, 1.8)
  light.castShadow = true
  light.shadow.mapSize.set(4096, 4096)
  light.shadow.camera.left = light.shadow.camera.bottom = -450
  light.shadow.camera.right = light.shadow.camera.top = 450
  light.shadow.camera.near = 1
  light.shadow.camera.far = 2500
  light.shadow.normalBias = 0.06
  light.shadow.bias = -0.00002
  scene.add(light, light.target)
  const vehicles: Vehicle[] = []
  const modelMeshes: THREE.Mesh[] = []
  const roots: THREE.Object3D[] = []
  const loader = new GLTFLoader()
  const base = `${import.meta.env.BASE_URL}city-rendering/`
  const pmrem = new THREE.PMREMGenerator(renderer)
  let environment: THREE.WebGLRenderTarget | undefined
  let normals: THREE.Texture | undefined
  let water: ReturnType<typeof createThreeWater> | undefined
  const plainWater = new THREE.Mesh(
    new THREE.PlaneGeometry(river.halfWidth * 2, river.halfLength * 2),
    new THREE.MeshStandardMaterial({
      color: '#246875',
      roughness: 0.22,
      metalness: 0.05,
    }),
  )
  plainWater.rotation.x = -Math.PI / 2
  plainWater.position.y = river.height
  scene.add(plainWater)

  function notify(): void {
    if (!destroyed) report({ ...progress })
  }
  function addModel(object: THREE.Object3D, ground: boolean): void {
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      child.castShadow = !ground || /^(Tree|Bridge|Quay)/.test(child.name)
      child.receiveShadow = ground || options.selfShadows
      if (!ground) modelMeshes.push(child)
    })
    roots.push(object)
    if (!destroyed) {
      scene.add(object)
      progress.loaded++
      notify()
    }
  }
  function positionVehicle(vehicle: Vehicle): void {
    const pose = vehiclePose(
      trafficRoutes[vehicle.route]!,
      vehicle.distance,
      vehicle.reverse ? -4 : 4,
    )
    vehicle.object.position.set(pose.x, 2.3, -pose.y)
    vehicle.object.rotation.y = pose.heading + (vehicle.reverse ? Math.PI : 0)
  }
  function apply(next: ThreeCityOptions): void {
    if (destroyed) return
    options = { ...next }
    renderer.toneMappingExposure = options.exposure
    renderer.shadowMap.enabled = options.shadows
    light.castShadow = options.shadows
    light.intensity = options.sunlight
    const date = Cesium.JulianDate.fromDate(
      new Date(Date.UTC(2026, 5, 21, 0, Math.round((options.hour - 8) * 60))),
    )
    const inertial =
      Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(
        date,
      )
    const fixed = Cesium.Matrix3.multiplyByVector(
      Cesium.Transforms.computeTemeToPseudoFixedMatrix(date),
      inertial,
      new Cesium.Cartesian3(),
    )
    const frame = Cesium.Transforms.eastNorthUpToFixedFrame(
      Cesium.Cartesian3.fromDegrees(119.0317, 33.5921),
    )
    const local = Cesium.Matrix4.multiplyByPointAsVector(
      Cesium.Matrix4.inverseTransformation(frame, new Cesium.Matrix4()),
      fixed,
      new Cesium.Cartesian3(),
    )
    const direction = new THREE.Vector3(local.x, local.z, -local.y).normalize()
    light.position.copy(direction).multiplyScalar(1000)
    water?.material.uniforms.sunDirection.value.copy(direction)
    for (const mesh of modelMeshes) mesh.receiveShadow = options.selfShadows
    if (water) water.surface.visible = options.reflections
    plainWater.visible = !water || !options.reflections
  }
  function resetView(view: 'overview' | 'river' | 'street' = 'overview'): void {
    const eye =
      view === 'street'
        ? [87, 15, 285]
        : view === 'river'
          ? [5, 30, 400]
          : [430, 240, 660]
    const target =
      view === 'street'
        ? [125, 40, 50]
        : view === 'river'
          ? [0, 90, -70]
          : [0, 130, 0]
    camera.position.set(eye[0]!, eye[1]!, eye[2]!)
    controls.target.set(target[0]!, target[1]!, target[2]!)
    controls.update()
  }
  function resize(): void {
    const width = Math.max(container.clientWidth, 1),
      height = Math.max(container.clientHeight, 1)
    renderer.setSize(width, height)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(container)
  resize()
  resetView()
  apply(options)
  const loading = Promise.allSettled([
    (async () => {
      const hdr = await new HDRLoader().loadAsync(
        `${import.meta.env.BASE_URL}model-rendering/studio.hdr`,
      )
      if (destroyed) {
        hdr.dispose()
        return
      }
      environment = pmrem.fromEquirectangular(hdr)
      hdr.dispose()
      scene.environment = environment.texture
      scene.environmentIntensity = 0.8
    })(),
    (async () => {
      normals = await new THREE.TextureLoader().loadAsync(createWaveNormalUrl())
      if (destroyed) return
      normals.wrapS = normals.wrapT = THREE.RepeatWrapping
      water = createThreeWater(
        river.halfWidth * 2,
        river.halfLength * 2,
        normals,
      )
      water.surface.position.y = river.height
      scene.add(water.surface)
      apply(options)
    })(),
    (async () => {
      addModel(
        (await loader.loadAsync(`${base}riverside-ground.glb`)).scene,
        true,
      )
    })(),
    ...cityBuildings().map(async (building) => {
      const object = (
        await loader.loadAsync(`${base}kenney/city/${building.name}.glb`)
      ).scene
      object.position.set(building.x, 2.2, -building.y)
      object.rotation.y = building.heading
      object.scale.setScalar(building.scale)
      addModel(object, false)
    }),
    (async () => {
      const names = ['sedan', 'taxi', 'suv', 'sedan-sports', 'van', 'delivery']
      const templates = await Promise.all(
        names.map(async (name) => {
          const object = (
            await loader.loadAsync(`${base}kenney/cars/${name}.glb`)
          ).scene
          roots.push(object)
          return object
        }),
      )
      for (let index = 0; index < 40; index++) {
        const object = templates[index % names.length]!.clone(true)
        object.scale.setScalar(2.7)
        const route = index < 16 ? 0 : index < 28 ? 1 : 2
        const vehicle: Vehicle = {
          object,
          route,
          distance:
            (index * routeLength(trafficRoutes[route]!)) /
            (route === 0 ? 16 : 12),
          reverse: index % 2 === 1,
          wheels: [],
          rotation: 0,
        }
        for (const name of [
          'wheel-front-left',
          'wheel-front-right',
          'wheel-back-left',
          'wheel-back-right',
        ]) {
          const node = object.getObjectByName(name)
          if (node) vehicle.wheels.push({ node, rotation: node.rotation.x })
        }
        object.visible = index < 28
        positionVehicle(vehicle)
        vehicles.push(vehicle)
        addModel(object, false)
      }
    })(),
  ]).then((results) => {
    const errors = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    if (errors.length) {
      progress.error = errors.map((result) => String(result.reason)).join('; ')
      notify()
    }
    if (destroyed) cleanup()
  })
  let last = performance.now(),
    start = last,
    frames = 0
  renderer.setAnimationLoop(() => {
    if (destroyed) return
    const now = performance.now(),
      dt = Math.min((now - last) / 1000, 0.1)
    last = now
    frames++
    controls.update()
    if (options.traffic)
      for (const vehicle of vehicles) {
        vehicle.distance += dt * 9 * (vehicle.reverse ? -1 : 1)
        positionVehicle(vehicle)
        vehicle.rotation += ((dt * 9) / 0.8) * (vehicle.reverse ? 1 : -1)
        for (const wheel of vehicle.wheels)
          wheel.node.rotation.x = wheel.rotation + vehicle.rotation
      }
    if (water) water.material.uniforms.time.value += dt * options.waveSpeed
    renderer.render(scene, camera)
    if (now - start > 1200) {
      progress.fps = Math.round((frames * 1000) / (now - start))
      frames = 0
      start = now
      notify()
    }
  })
  function cleanup(): void {
    if (cleanupDone) return
    cleanupDone = true
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>(),
      textures = new Set<THREE.Texture>()
    for (const root of [scene, ...roots])
      root.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return
        geometries.add(child.geometry)
        for (const material of Array.isArray(child.material)
          ? child.material
          : [child.material]) {
          materials.add(material)
          for (const value of Object.values(material))
            if (value instanceof THREE.Texture) textures.add(value)
        }
      })
    geometries.forEach((value) => value.dispose())
    materials.forEach((value) => value.dispose())
    textures.forEach((value) => value.dispose())
    normals?.dispose()
    environment?.dispose()
    pmrem.dispose()
    water?.surface.dispose()
    light.shadow.map?.dispose()
    renderer.dispose()
  }
  function dispose(): void {
    if (destroyed) return
    destroyed = true
    renderer.setAnimationLoop(null)
    controls.dispose()
    observer.disconnect()
    renderer.domElement.remove()
    // loading owns final cleanup, including assets arriving after navigation.
    void loading.then(cleanup)
  }
  return { apply, resetView, dispose }
}
