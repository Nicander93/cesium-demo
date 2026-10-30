import * as Cesium from 'cesium'
import { buildVegetationGlb, trianglesPerPlant } from './instancing'
import { prepareVegetationAssets } from './asset-loader'
import { FIELD_HALF_SIZE, MAX_PLANTS, TILE_SIZE, PlantingStore, groundHeight, tileKey, type Plant, type PlantingOptions, type Rectangle } from './planting'
import { createPlantingTerrain, DEFAULT_TERRAIN, type TerrainOptions, type TerrainStatus } from './terrain'
import { resolveVegetationShadowMode, type VegetationShadowMode } from './shadow-mode'
import { SPECIES_IDS, isSpecies, type Species } from './species'
import { createFoliageLighting } from './foliage-lighting'
export type { VegetationShadowMode } from './shadow-mode'

export type PlantingMode = 'navigate' | 'single' | 'brush' | 'erase' | 'area'
export interface VegetationSettings extends PlantingOptions {
  speciesPool: Species[]
  foliageLighting: boolean
  mode: PlantingMode
  radius: number
  density: number
  seed: number
  lod: boolean
  shadows: boolean
  maxSlope: number
}
export interface VegetationStatus {
  count: number
  batches: number
  loadedInstances: number
  pending: number
  triangles: number
  fps: number
  frameP95: number
  canUndo: boolean
  canRedo: boolean
  busy: boolean
  error: string
  ready: boolean
  heightPending: number
  terrain: TerrainStatus
}
export interface VegetationDiagnostics {
  rebuilds: number
  staleBuilds: number
  lastBuildMs: number
  maxBuildMs: number
  surfaceCorrections: number
  lastCorrectionMeters: number
  alignmentPending: number
  terrainTilesLoaded: boolean
  terrain: TerrainStatus
}
interface Tile {
  plants: Map<number, Plant>
  version: number
  detail: 'near' | 'far'
  model: Cesium.Model | undefined
  pendingModel: Cesium.Model | undefined
  loading: boolean
  loadedCount: number
  triangles: number
}

/** One host owns editing, chunk replacement, camera controls and Cesium resources. */
export function createVegetationLab(container: HTMLElement, report: (status: VegetationStatus) => void, terrainOptions: TerrainOptions = DEFAULT_TERRAIN) {
  const viewer = new Cesium.Viewer(container, {
    baseLayer: false, baseLayerPicker: false, geocoder: false, animation: false,
    timeline: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false,
    fullscreenButton: false, infoBox: false, selectionIndicator: false, skyBox: false,
    skyAtmosphere: false, shouldAnimate: false,
  })
  const scene = viewer.scene
  const realTerrain = terrainOptions.kind === 'terrain'
  scene.globe.show = realTerrain
  scene.fog.enabled = false
  if (scene.sun) scene.sun.show = false
  if (scene.moon) scene.moon.show = false
  scene.backgroundColor = Cesium.Color.fromCssColorString('#d7e4e8')
  viewer.camera.frustum.near = 0.2
  const terrain = createPlantingTerrain(viewer, terrainOptions)
  const { frame, inverse, world } = terrain
  const surfaceHeight = (x: number, y: number) => terrain.heightAt(x, y) ?? 0
  const lightDirection = Cesium.Matrix4.multiplyByPointAsVector(frame, new Cesium.Cartesian3(-0.4, 0.3, -0.8), new Cesium.Cartesian3())
  scene.light = new Cesium.DirectionalLight({ direction: Cesium.Cartesian3.normalize(lightDirection, lightDirection), intensity: 2.0 })
  const models = scene.primitives.add(new Cesium.PrimitiveCollection())
  const settings: VegetationSettings = { mode: 'brush', species: 'pine', speciesPool: [...SPECIES_IDS], foliageLighting: true, spacing: realTerrain ? 5 : 2.4, scaleMin: 0.8, scaleMax: 1.25, radius: 16, density: 5, seed: 42, lod: true, shadows: false, maxSlope: 40 }
  const foliageShader = createFoliageLighting()
  let shadowMode: VegetationShadowMode = 'disabled'
  viewer.shadows = false
  const tiles = new Map<string, Tile>()
  const dirty = new Set<string>()
  const objectUrls = new Set<string>()
  // Render-only roots follow the current terrain mesh. Plant.z remains the
  // most-detailed source elevation used for undo, import and export.
  const renderedHeights = new Map<number, number>()
  let disposed = false, busy = false, error = '', raf = 0, inFlight = 0, initialized = false
  let rebuilds = 0, staleBuilds = 0, lastBuildMs = 0, maxBuildMs = 0
  const heightQueue = new Map<number, Plant>()
  const refinedHeights = new WeakSet<Plant>()
  let heightInFlight = 0, lastEdit = 0
  let needsRootAlignment = true, cameraQuietAt = performance.now(), lastRootAlignment = 0
  let alignmentQueue: Plant[] | undefined, alignmentIndex = 0
  let surfaceCorrections = 0, lastCorrectionMeters = 0
  let ambientCoefficients: Cesium.Cartesian3[] | undefined
  let studioCoefficients: Cesium.Cartesian3[] | undefined
  let outdoorCoefficients: Cesium.Cartesian3[] | undefined
  let ambientProfile: 'studio' | 'outdoor' = 'outdoor'
  let ambientIntensity = 1
  async function prepareLighting(): Promise<void> {
    const response = await fetch(import.meta.env.BASE_URL + 'model-rendering/studio-sh.json')
    if (!response.ok) throw new Error('植被环境光资源加载失败')
    const values: unknown = await response.json()
    if (!Array.isArray(values) || values.length !== 9 || !values.every(value => Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number' && Number.isFinite(n)))) throw new Error('植被环境光系数无效')
    studioCoefficients = values.map(value => Cesium.Cartesian3.fromArray(value))
    // A studio's strongly directional SH has very dim directions for foliage.
    // Broad outdoor skylight keeps an ambient floor while retaining direction.
    outdoorCoefficients = studioCoefficients.map((value, index) => new Cesium.Cartesian3(
      value.x * 0.2 + (index === 0 ? 0.9 : 0),
      value.y * 0.2 + (index === 0 ? 0.95 : 0),
      value.z * 0.2 + (index === 0 ? 1.0 : 0),
    ))
    setAmbientProfile(ambientProfile)
  }
  function setAmbientProfile(profile: 'studio' | 'outdoor'): void {
    ambientProfile = profile
    const selected = profile === 'studio' ? studioCoefficients : outdoorCoefficients
    if (!selected) return
    // Cesium's model uniform map retains the array used when its shader is built.
    // Preserve that array and its elements when changing the diagnostic profile.
    if (!ambientCoefficients) ambientCoefficients = selected.map(value => Cesium.Cartesian3.clone(value))
    else selected.forEach((value, index) => Cesium.Cartesian3.clone(value, ambientCoefficients![index]))
    if (ambientCoefficients) for (const tile of tiles.values()) for (const model of [tile.model, tile.pendingModel]) {
      if (model) model.imageBasedLighting.sphericalHarmonicCoefficients = ambientCoefficients
    }
    scene.requestRender()
  }
  let dragging = false, start: { x: number; y: number } | undefined, lastStamp: { x: number; y: number } | undefined
  let lastLod = 0, lastReport = 0, lastFrame = performance.now()
  const renderedTerrainQuietTimeout = 1500
  const frameTimes: number[] = []
  const store = new PlantingStore(changed => {
    lastEdit = performance.now()
    needsRootAlignment = true
    alignmentQueue = undefined; alignmentIndex = 0
    for (const plant of changed) {
      renderedHeights.delete(plant.id)
      const key = tileKey(plant.x, plant.y)
      const tile = getTile(key)
      tile.plants.delete(plant.id)
      tile.version++
      dirty.add(key)
      const current = store.get(plant.id)
      if (current) {
        const currentKey = tileKey(current.x, current.y)
        const currentTile = getTile(currentKey)
        currentTile.plants.set(current.id, current)
        if (currentKey !== key) currentTile.version++
        dirty.add(currentKey)
        if (realTerrain && !refinedHeights.has(current)) { heightQueue.set(current.id, current); lastEdit = performance.now() }
      } else heightQueue.delete(plant.id)
    }
  }, terrain.storeSurface)
  const removeCameraChanged = viewer.camera.changed.addEventListener(() => {
    cameraQuietAt = performance.now()
    needsRootAlignment = true
    alignmentQueue = undefined; alignmentIndex = 0
  })
  const removeTerrainProgress = scene.globe.tileLoadProgressEvent.addEventListener((pending: number) => {
    if (pending === 0) {
      cameraQuietAt = performance.now()
      needsRootAlignment = true
      alignmentQueue = undefined; alignmentIndex = 0
    }
  })
  async function refineHeights(): Promise<void> {
    const plants = [...heightQueue.values()].slice(0, 512)
    for (const plant of plants) heightQueue.delete(plant.id)
    heightInFlight = plants.length
    try {
      const heights = await terrain.sample(plants)
      if (disposed) return
      for (const plant of plants) refinedHeights.add(plant)
      store.updateHeights(plants.map((plant, index) => ({ plant, height: heights[index]! })))
    } catch (failure) { if (!disposed) error = `树根高程精校失败：${String(failure)}` }
    finally { heightInFlight = 0 }
  }
  function getTile(key: string): Tile {
    let tile = tiles.get(key)
    if (!tile) {
      tile = { plants: new Map(), version: 0, detail: 'far', model: undefined, pendingModel: undefined, loading: false, loadedCount: 0, triangles: 0 }
      tiles.set(key, tile)
    }
    return tile
  }
  function cameraLocal(): Cesium.Cartesian3 {
    return Cesium.Matrix4.multiplyByPoint(inverse, viewer.camera.positionWC, new Cesium.Cartesian3())
  }
  function tileCenter(key: string): [number, number] {
    const [x = 0, y = 0] = key.split(',').map(Number)
    return [(x + 0.5) * TILE_SIZE, (y + 0.5) * TILE_SIZE]
  }
  function updateLod(): void {
    const camera = cameraLocal()
    for (const [key, tile] of tiles) {
      if (!tile.plants.size) continue
      const [x, y] = tileCenter(key)
      const distance = Math.hypot(camera.x - x, camera.y - y, camera.z - surfaceHeight(x, y))
      const detail = !settings.lod || distance < (tile.detail === 'near' ? 220 : 180) ? 'near' : 'far'
      if (detail !== tile.detail) { tile.detail = detail; tile.version++; dirty.add(key) }
    }
  }
  async function rebuild(key: string, tile: Tile): Promise<void> {
    dirty.delete(key)
    if (!tile.plants.size) {
      if (tile.model) models.remove(tile.model)
      tile.model = undefined; tile.loadedCount = 0; tile.triangles = 0
      return
    }
    tile.loading = true; inFlight++
    const version = tile.version
    const plants = [...tile.plants.values()]
    const [x, y] = tileCenter(key)
    const detail = tile.detail
    let url = ''
    let pending: Cesium.Model | undefined
    let settled = false
    const buildStarted = performance.now()
    let removeReady: (() => void) | undefined, removeError: (() => void) | undefined
    function finish(failure?: unknown): void {
      if (settled) return
      settled = true
      lastBuildMs = performance.now() - buildStarted
      maxBuildMs = Math.max(maxBuildMs, lastBuildMs)
      removeReady?.(); removeError?.()
      URL.revokeObjectURL(url)
      objectUrls.delete(url)
      if (disposed) return
      tile.loading = false; tile.pendingModel = undefined; inFlight--
      if (failure || tile.version !== version) {
        if (!failure && tile.version !== version) staleBuilds++
        if (pending) models.remove(pending)
        if (failure) error = `植被分块加载失败：${String(failure)}`
        else dirty.add(key)
        return
      }
      if (tile.model) models.remove(tile.model)
      tile.model = pending
      rebuilds++
      tile.loadedCount = plants.length
      tile.triangles = plants.reduce((total, plant) => total + trianglesPerPlant(plant.species, detail), 0)
    }
    try {
      const bytes = buildVegetationGlb(plants, x, y, detail, renderedHeights)
      const blob = new Blob([new Uint8Array(bytes)], { type: 'model/gltf-binary' })
      url = URL.createObjectURL(blob)
      objectUrls.add(url)
      pending = await Cesium.Model.fromGltfAsync({ url, modelMatrix: Cesium.Matrix4.multiplyByTranslation(frame, new Cesium.Cartesian3(x, y, 0), new Cesium.Matrix4()), upAxis: Cesium.Axis.Y, forwardAxis: Cesium.Axis.X, customShader: foliageShader, incrementallyLoadTextures: false, shadows: resolveVegetationShadowMode(shadowMode), allowPicking: false })
      if (disposed) { pending.destroy(); URL.revokeObjectURL(url); objectUrls.delete(url); return }
      // Reuse the model/city lab's IBL so leaf backs and bark retain ambient light in shadow.
      if (ambientCoefficients) pending.imageBasedLighting.sphericalHarmonicCoefficients = ambientCoefficients
      pending.imageBasedLighting.specularEnvironmentMaps = import.meta.env.BASE_URL + 'model-rendering/studio-specular.ktx2'
      pending.imageBasedLighting.imageBasedLightingFactor = new Cesium.Cartesian2(0.8 * ambientIntensity, 0.45 * ambientIntensity)
      models.add(pending); tile.pendingModel = pending
      removeError = pending.errorEvent.addEventListener((failure: unknown) => finish(failure))
      if (pending.ready) finish()
      else removeReady = pending.readyEvent.addEventListener(() => finish())
    } catch (failure) { finish(failure) }
  }
  function getState(): VegetationStatus {
    const samples = [...frameTimes].sort((a, b) => a - b)
    const total = samples.reduce((sum, value) => sum + value, 0)
    const all = [...tiles.values()]
    return {
      count: store.size, batches: all.filter(tile => tile.model).length,
      loadedInstances: all.reduce((sum, tile) => sum + tile.loadedCount, 0), pending: dirty.size + inFlight,
      triangles: all.reduce((sum, tile) => sum + tile.triangles, 0), fps: total ? Math.round(samples.length * 1000 / total) : 0,
      frameP95: samples[Math.floor(samples.length * 0.95)] ?? 0,
      canUndo: store.canUndo, canRedo: store.canRedo, busy, error,
      ready: initialized, heightPending: heightQueue.size + heightInFlight, terrain: terrain.getState(),
    }
  }
  const removePostRender = scene.postRender.addEventListener(() => {
    const now = performance.now()
    frameTimes.push(now - lastFrame); lastFrame = now
    if (frameTimes.length > 180) frameTimes.shift()
  })
  const removeRenderError = scene.renderError.addEventListener((_scene: Cesium.Scene, failure: unknown) => { error = String(failure) })
  function pump(now: number): void {
    if (disposed) return
    if (initialized && now - lastLod > 500) { updateLod(); lastLod = now }
    if (initialized && realTerrain && !busy && !dragging && !heightInFlight && heightQueue.size && now - lastEdit > 150) void refineHeights()
    if (initialized && realTerrain && scene.globe.tilesLoaded && (needsRootAlignment || alignmentQueue) && !busy && !dragging && !heightInFlight && now - cameraQuietAt > 650 && now - lastEdit > 350 && (alignmentQueue || now - lastRootAlignment > 500)) {
      lastRootAlignment = now
      if (!alignmentQueue) { alignmentQueue = store.values(); alignmentIndex = 0; needsRootAlignment = false }
      const batch = alignmentQueue.slice(alignmentIndex, alignmentIndex + 1000)
      alignmentIndex += batch.length
      const updates = terrain.alignRootsToRenderedSurface(batch, plant => renderedHeights.get(plant.id) ?? plant.z)
      if (updates.length) {
        surfaceCorrections += updates.length
        lastCorrectionMeters = Math.max(...updates.map(update => Math.abs(update.delta)))
        const touchedTiles = new Set<string>()
        for (const update of updates) {
          renderedHeights.set(update.plant.id, update.height)
          refinedHeights.add(update.plant)
          touchedTiles.add(tileKey(update.plant.x, update.plant.y))
        }
        for (const key of touchedTiles) {
          const tile = getTile(key)
          tile.version++
          dirty.add(key)
        }
        lastEdit = now
      }
      if (alignmentIndex >= alignmentQueue.length) { alignmentQueue = undefined; alignmentIndex = 0 }
    }
    let started = 0
    for (const key of dirty) {
      if (!initialized || inFlight >= 4 || started >= 2) break
      // Defer chunk serialization/upload while edits are arriving; a stroke/fill should
      // produce one final GLB per touched tile instead of several obsolete uploads.
      // Prefer a stable selected terrain mesh for final roots, but do not strand new
      // vegetation if an imagery/terrain request never drains. Existing tile models
      // stay visible until the replacement finishes loading.
      const waitingForRenderedTerrain = realTerrain && needsRootAlignment && !alignmentQueue && !scene.globe.tilesLoaded && now - cameraQuietAt < renderedTerrainQuietTimeout
      if (busy || dragging || heightInFlight || heightQueue.size || alignmentQueue || waitingForRenderedTerrain || now - lastEdit < 220 || now - cameraQuietAt < 220) break
      const tile = tiles.get(key)
      if (tile && !tile.loading) { void rebuild(key, tile); started++ }
    }
    if (now - lastReport > 250) { report(getState()); lastReport = now }
    raf = requestAnimationFrame(pump)
  }
  function overview(): void {
    viewer.camera.lookAt(world(0, 0, surfaceHeight(0, 0) + 10), new Cesium.HeadingPitchRange(0.25, -0.65, realTerrain ? 680 : 570))
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
  }
  function closeView(): void {
    viewer.camera.lookAt(world(0, 0, surfaceHeight(0, 0) + 10), new Cesium.HeadingPitchRange(0.3, -0.28, 100))
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
  }
  if (!realTerrain) createGround()
  const cursor = viewer.entities.add({ polyline: { positions: [], width: 2, material: Cesium.Color.fromCssColorString('#d4ff9c'), clampToGround: realTerrain } })
  function createGround(): void {
    const positions: number[] = [], normals: number[] = [], indices: number[] = []
    const divisions = 60, side = divisions + 1
    for (let row = 0; row <= divisions; row++) for (let col = 0; col <= divisions; col++) {
      const x = -FIELD_HALF_SIZE + col * FIELD_HALF_SIZE * 2 / divisions
      const y = -FIELD_HALF_SIZE + row * FIELD_HALF_SIZE * 2 / divisions
      const p = world(x, y)
      positions.push(p.x, p.y, p.z)
      const dx = (groundHeight(x + 0.1, y) - groundHeight(x - 0.1, y)) / 0.2
      const dy = (groundHeight(x, y + 0.1) - groundHeight(x, y - 0.1)) / 0.2
      const n = Cesium.Matrix4.multiplyByPointAsVector(frame, new Cesium.Cartesian3(-dx, -dy, 1), new Cesium.Cartesian3())
      Cesium.Cartesian3.normalize(n, n); normals.push(n.x, n.y, n.z)
      if (row < divisions && col < divisions) { const i = row * side + col; indices.push(i, i + 1, i + side, i + 1, i + side + 1, i + side) }
    }
    const attributes = new Cesium.GeometryAttributes()
    Object.assign(attributes, {
      position: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: new Float64Array(positions) }),
      normal: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: new Float32Array(normals) }),
    })
    scene.primitives.add(new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({ geometry: new Cesium.Geometry({ attributes, indices: new Uint16Array(indices), primitiveType: Cesium.PrimitiveType.TRIANGLES, boundingSphere: Cesium.BoundingSphere.fromVertices(positions) }), attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString('#8a9b62')) } }),
      appearance: new Cesium.PerInstanceColorAppearance({ translucent: false, closed: false }), asynchronous: false, shadows: Cesium.ShadowMode.RECEIVE_ONLY,
    }))
  }
  function pick(event: PointerEvent): { x: number; y: number } | undefined {
    const rect = scene.canvas.getBoundingClientRect()
    const ray = viewer.camera.getPickRay(new Cesium.Cartesian2(event.clientX - rect.left, event.clientY - rect.top))
    if (!ray) return
    if (realTerrain) return terrain.pick(ray)
    const o = Cesium.Matrix4.multiplyByPoint(inverse, ray.origin, new Cesium.Cartesian3())
    const d = Cesium.Matrix4.multiplyByPointAsVector(inverse, ray.direction, new Cesium.Cartesian3())
    if (d.z > -0.03) return
    let t = (groundHeight(0, 0) - o.z) / d.z
    for (let i = 0; i < 10; i++) {
      const x = o.x + d.x * t, y = o.y + d.y * t
      const dx = 2.4 / 65 * Math.cos(x / 65) * Math.cos(y / 75)
      const dy = -2.4 / 75 * Math.sin(x / 65) * Math.sin(y / 75)
      t -= (o.z + d.z * t - groundHeight(x, y)) / (d.z - dx * d.x - dy * d.y)
    }
    const x = o.x + d.x * t, y = o.y + d.y * t
    if (t < 0 || !Number.isFinite(x) || Math.abs(x) > FIELD_HALF_SIZE || Math.abs(y) > FIELD_HALF_SIZE) return
    return { x, y }
  }
  function showCursor(point?: { x: number; y: number }): void {
    cursor.show = Boolean(point) && settings.mode !== 'navigate'
    if (!point || !cursor.polyline) return
    let points: { x: number; y: number }[]
    if (start && settings.mode === 'area' && dragging) points = [start, { x: point.x, y: start.y }, point, { x: start.x, y: point.y }, start]
    else points = Array.from({ length: 65 }, (_, i) => ({ x: point.x + Math.cos(i * Math.PI / 32) * (settings.mode === 'single' ? 1.5 : settings.radius), y: point.y + Math.sin(i * Math.PI / 32) * (settings.mode === 'single' ? 1.5 : settings.radius) }))
    cursor.polyline.positions = new Cesium.ConstantProperty(points.map(p => world(p.x, p.y, surfaceHeight(p.x, p.y) + 0.12)))
  }
  function stamp(point: { x: number; y: number }): void {
    if (settings.mode === 'erase') store.erase(point.x, point.y, settings.radius)
    else if (settings.mode === 'single') store.add(point.x, point.y, settings)
    else if (settings.mode === 'brush') {
      const radius = settings.radius
      store.scatter({ minX: point.x - radius, minY: point.y - radius, maxX: point.x + radius, maxY: point.y + radius }, Math.max(1, Math.round(Math.PI * radius * radius * settings.density / 100)), settings, { ...point, radius })
    }
    lastStamp = point
  }
  function pointerDown(event: PointerEvent): void {
    if (event.button !== 0 || settings.mode === 'navigate' || busy || !initialized) return
    const point = pick(event)
    if (!point) return
    event.preventDefault(); dragging = true; start = point; lastStamp = undefined
    store.begin()
    if (settings.mode !== 'area') stamp(point)
    showCursor(point)
  }
  function pointerMove(event: PointerEvent): void {
    const point = pick(event)
    showCursor(point)
    if (!dragging || !point || settings.mode === 'area' || settings.mode === 'single') return
    if (!lastStamp) { stamp(point); return }
    const distance = Math.hypot(point.x - lastStamp.x, point.y - lastStamp.y)
    const step = Math.max(1, settings.radius * 0.4)
    // Interpolate long pointer jumps so the brush leaves a continuous stroke.
    const count = Math.floor(distance / step)
    const previous = lastStamp
    for (let i = 1; i <= Math.min(count, 100); i++) stamp({ x: previous.x + (point.x - previous.x) * i / count, y: previous.y + (point.y - previous.y) * i / count })
  }
  function pointerUp(event?: PointerEvent): void {
    if (!dragging) return
    const point = event ? pick(event) : undefined
    if (settings.mode === 'area' && start && point) {
      const bounds = { minX: Math.min(start.x, point.x), minY: Math.min(start.y, point.y), maxX: Math.max(start.x, point.x), maxY: Math.max(start.y, point.y) }
      void fillArea(Math.round((bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY) * settings.density / 100), bounds)
    } else store.end()
    dragging = false; start = undefined; lastStamp = undefined
  }
  function cancelStroke(): void { if (dragging) store.end(); dragging = false; start = undefined; lastStamp = undefined }
  function setSettings(patch: Partial<VegetationSettings>): void {
    cancelStroke()
    const previousSpecies = settings.species
    Object.assign(settings, patch)
    if (!isSpecies(settings.species)) settings.species = previousSpecies
    if (patch.speciesPool !== undefined) {
      const selection = Array.isArray(patch.speciesPool) ? patch.speciesPool.filter(isSpecies) : []
      settings.speciesPool = SPECIES_IDS.filter(id => selection.includes(id))
    } else if (patch.species !== undefined) settings.speciesPool = [settings.species]
    settings.species = settings.speciesPool[0] ?? settings.species
    foliageShader.setUniform('u_foliageStrength', settings.foliageLighting ? 1 : 0)
    settings.radius = Math.max(2, Math.min(40, settings.radius))
    settings.density = Math.max(1, Math.min(30, settings.density))
    settings.spacing = Math.max(0.5, Math.min(10, settings.spacing))
    settings.scaleMin = Math.max(0.25, Math.min(3, settings.scaleMin))
    settings.scaleMax = Math.max(settings.scaleMin, Math.min(3, settings.scaleMax))
    settings.maxSlope = Math.max(0, Math.min(90, settings.maxSlope))
    const controller = scene.screenSpaceCameraController
    controller.enableRotate = settings.mode === 'navigate'; controller.enableTilt = settings.mode === 'navigate'; controller.enableLook = false
    if (patch.seed !== undefined) store.setSeed(settings.seed)
    if (patch.lod !== undefined) updateLod()
    if (patch.shadows !== undefined) {
      setShadowMode(settings.shadows ? 'cast-only' : 'disabled')
    }
    scene.requestRender()
  }
  function setShadowMode(mode: VegetationShadowMode): void {
    shadowMode = mode
    viewer.shadows = mode !== 'disabled'
    const cesiumMode = resolveVegetationShadowMode(mode)
    for (const tile of tiles.values()) for (const model of [tile.model, tile.pendingModel]) if (model) model.shadows = cesiumMode
    scene.requestRender()
  }
  async function fillArea(count: number, bounds: Rectangle = { minX: -210, minY: -210, maxX: 210, maxY: 210 }): Promise<number> {
    if (busy || disposed || !initialized || !settings.speciesPool.length) return 0
    const options = { ...settings, speciesPool: [...settings.speciesPool] }
    busy = true; error = ''; store.begin()
    let added = 0
    const requested = Math.max(0, Math.min(MAX_PLANTS - store.size, Math.floor(count)))
    try {
      for (let attempted = 0; attempted < requested && !disposed; attempted += 250) {
        added += store.scatter(bounds, Math.min(250, requested - attempted), options)
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      }
    } finally { store.end(); busy = false }
    return added
  }
  scene.canvas.addEventListener('pointerdown', pointerDown)
  scene.canvas.addEventListener('pointermove', pointerMove)
  window.addEventListener('pointerup', pointerUp)
  window.addEventListener('pointercancel', cancelStroke)
  window.addEventListener('blur', cancelStroke)
  document.addEventListener('visibilitychange', cancelStroke)
  const resize = new ResizeObserver(() => viewer.resize())
  resize.observe(container)
  overview(); setSettings({}); raf = requestAnimationFrame(pump)
  const ready = Promise.all([terrain.ready, prepareLighting(), prepareVegetationAssets(new URL(import.meta.env.BASE_URL + 'vegetation-lab/', location.origin).href)]).then(() => {
    if (disposed) return
    initialized = true
    const boundary: Cesium.Cartesian3[] = []
    for (const [startX, startY, endX, endY] of [[-240, -240, 240, -240], [240, -240, 240, 240], [240, 240, -240, 240], [-240, 240, -240, -240]]) {
      for (let step = 0; step <= 32; step++) { const x = startX! + (endX! - startX!) * step / 32, y = startY! + (endY! - startY!) * step / 32; boundary.push(world(x, y, surfaceHeight(x, y) + 0.15)) }
    }
    viewer.entities.add({ polyline: { positions: boundary, width: 2, material: Cesium.Color.WHITE.withAlpha(0.65), clampToGround: realTerrain } })
    overview(); report(getState())
  }).catch(failure => { if (!disposed) { error = String(failure); report(getState()) }; throw failure })
  const api = {
    ready, getState, setSettings, overview, closeView, fill: fillArea,
    getSettings: () => ({ ...settings, speciesPool: [...settings.speciesPool] }),
    setAmbientProfile,
    setAmbientIntensity(value: number) {
      if (!Number.isFinite(value)) return
      ambientIntensity = Math.max(0, Math.min(2, value))
      for (const tile of tiles.values()) for (const model of [tile.model, tile.pendingModel]) {
        if (model) model.imageBasedLighting.imageBasedLightingFactor = new Cesium.Cartesian2(0.8 * ambientIntensity, 0.45 * ambientIntensity)
      }
    },
    setLightIntensity(value: number) {
      if (Number.isFinite(value) && scene.light instanceof Cesium.DirectionalLight) scene.light.intensity = Math.max(0, Math.min(4, value))
    },
    getPlants: (limit = 64) => store.values().slice(0, Math.min(1000, limit)).map(plant => {
      const renderHeight = renderedHeights.get(plant.id) ?? plant.z
      const source = Cesium.Cartographic.fromCartesian(world(plant.x, plant.y, plant.z))
      const rendered = Cesium.Cartographic.fromCartesian(world(plant.x, plant.y, renderHeight))
      return { ...plant, renderHeight, renderedHeight: rendered.height, longitude: Cesium.Math.toDegrees(rendered.longitude), latitude: Cesium.Math.toDegrees(rendered.latitude), height: source.height }
    }),
    checkGrounding: (limit = 64) => terrain.checkGrounding(store.values().slice(0, Math.min(1000, limit)), true, plant => renderedHeights.get(plant.id) ?? plant.z),
    getDiagnostics: (): VegetationDiagnostics => ({ rebuilds, staleBuilds, lastBuildMs, maxBuildMs, surfaceCorrections, lastCorrectionMeters, alignmentPending: alignmentQueue ? Math.max(0, alignmentQueue.length - alignmentIndex) : needsRootAlignment ? store.size : 0, terrainTilesLoaded: !realTerrain || scene.globe.tilesLoaded, terrain: terrain.getState() }),
    setShadowMode,
    reproject() { if (initialized && !busy) { error = ''; for (const plant of store.values()) { refinedHeights.delete(plant); heightQueue.set(plant.id, plant) } } },
    undo() { if (!busy) { cancelStroke(); store.undo() } },
    redo() { if (!busy) { cancelStroke(); store.redo() } },
    clear() { if (!busy) { cancelStroke(); store.clear(); error = '' } },
    add(x: number, y: number) { if (!busy && initialized) return store.add(x, y, settings) },
    erase(x: number, y: number, radius: number) { if (!busy) return store.erase(x, y, radius) },
    exportJson: () => store.exportJson(),
    importJson(json: string) { if (!busy) { cancelStroke(); store.importJson(json) } },
    destroy() {
      if (disposed) return
      disposed = true; cancelAnimationFrame(raf); resize.disconnect(); cancelStroke(); terrain.destroy(); heightQueue.clear()
      alignmentQueue = undefined; alignmentIndex = 0; renderedHeights.clear()
      removePostRender(); removeRenderError()
      removeCameraChanged(); removeTerrainProgress()
      scene.canvas.removeEventListener('pointerdown', pointerDown); scene.canvas.removeEventListener('pointermove', pointerMove)
      window.removeEventListener('pointerup', pointerUp); window.removeEventListener('blur', cancelStroke)
      window.removeEventListener('pointercancel', cancelStroke); document.removeEventListener('visibilitychange', cancelStroke)
      for (const url of objectUrls) URL.revokeObjectURL(url)
      objectUrls.clear()
      if (import.meta.env.DEV) delete (window as unknown as { __vegetationLab?: unknown }).__vegetationLab
      viewer.destroy()
      foliageShader.destroy()
    },
  }
  if (import.meta.env.DEV) (window as unknown as { __vegetationLab: typeof api }).__vegetationLab = api
  return api
}
export type VegetationLab = ReturnType<typeof createVegetationLab>


