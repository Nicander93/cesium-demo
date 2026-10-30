import * as Cesium from 'cesium'
import { FIELD_HALF_SIZE, groundHeight, type Plant, type PlantingSurface } from './planting'
import { sampleHeightGrid, sampleSlopeGrid, type HeightGrid } from './height-grid'

export const SWISS_TERRAIN_URL = 'https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1/'
export const SWISS_IMAGERY_URL = 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg'
export interface TerrainOptions {
  kind: 'terrain' | 'synthetic'
  longitude: number
  latitude: number
  terrainUrl: string
  imageryUrl: string
}
export const DEFAULT_TERRAIN: TerrainOptions = {
  kind: 'terrain', longitude: 8.034, latitude: 46.638,
  terrainUrl: SWISS_TERRAIN_URL, imageryUrl: SWISS_IMAGERY_URL,
}
export interface TerrainStatus {
  kind: 'terrain' | 'synthetic'
  label: string
  ready: boolean
  stage: string
  error: string
  imagery: string
  sampleCount: number
  minHeight: number
  maxHeight: number
  centerHeight: number
  longitude: number
  latitude: number
  terrainUrl: string
}

function timeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds) })]).finally(() => clearTimeout(timer))
}

/** Terrain has its own lifecycle. Sampling and cursor picking never read tree-canopy depth. */
export function createPlantingTerrain(viewer: Cesium.Viewer, options: TerrainOptions) {
  const real = options.kind === 'terrain'
  const longitude = real ? options.longitude : 119.0317, latitude = real ? options.latitude : 33.5921
  const frame = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(longitude, latitude, real ? 1500 : 30))
  const inverse = Cesium.Matrix4.inverseTransformation(frame, new Cesium.Matrix4())
  const state: TerrainStatus = {
    kind: options.kind, label: real ? (options.terrainUrl === SWISS_TERRAIN_URL ? 'swisstopo 实测地形 · SWISSIMAGE' : '自定义真实地形') : '合成地面性能基准', ready: !real,
    stage: real ? '连接真实地形服务' : '合成地面就绪', error: '', imagery: real ? '等待影像瓦片' : '未启用',
    sampleCount: 0, minHeight: 0, maxHeight: 0, centerHeight: real ? 0 : 30, longitude, latitude, terrainUrl: real ? options.terrainUrl : '',
  }
  let disposed = false, grid: HeightGrid | undefined, provider: Cesium.CesiumTerrainProvider | undefined
  const cleanups: (() => void)[] = []
  const local = (point: Cesium.Cartesian3) => Cesium.Matrix4.multiplyByPoint(inverse, point, new Cesium.Cartesian3())
  const heightAt = (x: number, y: number) => real ? (grid ? sampleHeightGrid(grid, x, y) : undefined) : groundHeight(x, y)
  const world = (x: number, y: number, z = heightAt(x, y) ?? 0) => Cesium.Matrix4.multiplyByPoint(frame, new Cesium.Cartesian3(x, y, z), new Cesium.Cartesian3())
  const down = Cesium.Matrix4.multiplyByPointAsVector(frame, new Cesium.Cartesian3(0, 0, -1), new Cesium.Cartesian3())
  Cesium.Cartesian3.normalize(down, down)
  function renderedMeshHeight(x: number, y: number, rootHeight: number): number | undefined {
    // Globe.pick visits the terrain tiles selected for this frame. Globe.getHeight
    // can instead read a deeper cached tile that is not currently rendered.
    const hit = viewer.scene.globe.pick(new Cesium.Ray(world(x, y, rootHeight + 10000), down), viewer.scene)
    return hit ? local(hit).z : undefined
  }
  const storeSurface: PlantingSurface = {
    id: real ? `terrain-enu-v1:${longitude},${latitude}:${options.terrainUrl}` : 'synthetic-enu-v1',
    heightAt,
    slopeAt: (x, y) => real && grid ? sampleSlopeGrid(grid, x, y) : 0,
    maxHeightError: real ? 30 : 0.01,
    reference: { longitude, latitude, height: real ? 1500 : 30, terrainUrl: real ? options.terrainUrl : '' },
  }
  async function sample(points: readonly { x: number; y: number }[]): Promise<number[]> {
    if (!real) return points.map(point => groundHeight(point.x, point.y))
    if (!provider || disposed) throw new Error('真实地形尚未就绪')
    const cartographics = points.map(point => Cesium.Cartographic.fromCartesian(world(point.x, point.y, 0)))
    const result = await timeout(Cesium.sampleTerrainMostDetailed(provider, cartographics), 60000, '地形高程采样超时，请重试或检查地形服务')
    if (disposed) throw new Error('地形已释放')
    return result.map(point => {
      if (!Number.isFinite(point.height)) throw new Error('地形服务未提供该位置的有效高程')
      return local(Cesium.Cartesian3.fromRadians(point.longitude, point.latitude, point.height)).z
    })
  }
  const ready = (async () => {
    if (!real) return
    try {
      provider = await timeout(Cesium.CesiumTerrainProvider.fromUrl(options.terrainUrl, { requestVertexNormals: true, credit: '© swisstopo' }), 45000, '真实地形服务连接超时')
      if (disposed) return
      viewer.terrainProvider = provider
      viewer.scene.globe.show = true
      viewer.scene.globe.depthTestAgainstTerrain = true
      viewer.scene.globe.maximumScreenSpaceError = 0.7
      viewer.scene.globe.enableLighting = true
      viewer.scene.globe.shadows = Cesium.ShadowMode.RECEIVE_ONLY
      viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#7e8665')
      if (options.imageryUrl) {
        const imagery = new Cesium.UrlTemplateImageryProvider({
          url: options.imageryUrl, maximumLevel: 19,
          ...(options.imageryUrl === SWISS_IMAGERY_URL ? { minimumLevel: 5, rectangle: Cesium.Rectangle.fromDegrees(5.9, 45.8, 10.6, 47.9), credit: '© swisstopo SWISSIMAGE' } : {}),
        })
        cleanups.push(imagery.errorEvent.addEventListener(() => { if (!disposed) state.imagery = '部分影像瓦片失败，地形仍可种植' }))
        viewer.imageryLayers.addImageryProvider(imagery)
        state.imagery = '影像已接入，正在按视角加载'
      } else state.imagery = '使用地形底色'
      state.stage = '采样种植区域高程'
      const center = await timeout(Cesium.sampleTerrainMostDetailed(provider, [Cesium.Cartographic.fromDegrees(longitude, latitude)]), 60000, '中心点高程采样超时')
      if (disposed) return
      const height = center[0]?.height
      if (height === undefined || !Number.isFinite(height)) throw new Error('此地形服务不覆盖指定坐标')
      state.centerHeight = height
      if (storeSurface.reference) storeSurface.reference.height = height
      Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(longitude, latitude, height), Cesium.Ellipsoid.WGS84, frame)
      Cesium.Matrix4.inverseTransformation(frame, inverse)
      const divisions = 64, points: { x: number; y: number }[] = []
      for (let row = 0; row <= divisions; row++) for (let col = 0; col <= divisions; col++) points.push({ x: -FIELD_HALF_SIZE + col * FIELD_HALF_SIZE * 2 / divisions, y: -FIELD_HALF_SIZE + row * FIELD_HALF_SIZE * 2 / divisions })
      const heights = await sample(points)
      if (disposed) return
      grid = { halfSize: FIELD_HALF_SIZE, divisions, heights: new Float64Array(heights) }
      state.sampleCount = heights.length
      state.minHeight = Math.min(...heights) + height; state.maxHeight = Math.max(...heights) + height
      state.ready = true; state.stage = '真实地形可种植'
    } catch (error) {
      if (!disposed) { state.error = String(error); state.stage = '地形加载失败' }
      throw error
    }
  })()
  return {
    frame, inverse, ready, storeSurface, world, local, heightAt, sample,
    alignRootsToRenderedSurface(plants: readonly Plant[], currentHeight: (plant: Plant) => number = plant => plant.z) {
      if (!real || !state.ready) return [] as { plant: Plant; height: number; delta: number }[]
      const updates: { plant: Plant; height: number; delta: number }[] = []
      for (const plant of plants) {
        const rootHeight = currentHeight(plant)
        const window = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, world(plant.x, plant.y, rootHeight + 0.2))
        if (!window || window.x < 0 || window.y < 0 || window.x > viewer.scene.canvas.clientWidth || window.y > viewer.scene.canvas.clientHeight) continue
        const height = renderedMeshHeight(plant.x, plant.y, rootHeight)
        if (!Number.isFinite(height)) continue
        const delta = height! - rootHeight
        if (Math.abs(delta) >= 0.05) updates.push({ plant, height: height!, delta })
      }
      return updates
    },
    getState: (): TerrainStatus => ({ ...state }),
    pick(ray: Cesium.Ray): { x: number; y: number } | undefined {
      if (!state.ready || !real) return
      const point = viewer.scene.globe.pick(ray, viewer.scene)
      if (!point) return
      const hit = local(point)
      if (Math.abs(hit.x) > FIELD_HALF_SIZE || Math.abs(hit.y) > FIELD_HALF_SIZE) return
      return { x: hit.x, y: hit.y }
    },
    checkGrounding(plants: readonly Plant[], visibleOnly = true, currentHeight: (plant: Plant) => number = plant => plant.z) {
      if (!real) return { count: plants.length, visible: plants.length, checked: plants.length, missing: 0, hidden: 0, occluded: 0, maxGap: 0, meanGap: 0, maxError: 0, gaps: plants.map(plant => ({ id: plant.id, x: plant.x, y: plant.y, rootHeight: plant.z, meshHeight: plant.z, screenOffset: 0, gap: 0 })) }
      const gaps: { id: number; x: number; y: number; rootHeight: number; meshHeight: number; screenOffset: number; gap: number }[] = []
      let missing = 0
      let hidden = 0
      let occluded = 0
      let visible = 0
      for (const plant of plants) {
        const renderedHeight = currentHeight(plant)
        const rootWindow = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, world(plant.x, plant.y, renderedHeight + 0.2))
        if (!rootWindow || rootWindow.x < 0 || rootWindow.y < 0 || rootWindow.x > viewer.scene.canvas.clientWidth || rootWindow.y > viewer.scene.canvas.clientHeight) {
          hidden++
          if (visibleOnly) continue
        } else visible++
        // Use the terrain mesh selected for this frame, not a cached deeper LOD.
        const meshHeight = renderedMeshHeight(plant.x, plant.y, renderedHeight)
        if (!Number.isFinite(meshHeight)) { missing++; continue }
        const screenGround = rootWindow ? viewer.scene.globe.pick(viewer.camera.getPickRay(rootWindow)!, viewer.scene) : undefined
        const groundLocal = screenGround ? local(screenGround) : undefined
        const screenOffset = groundLocal ? Math.hypot(groundLocal.x - plant.x, groundLocal.y - plant.y) : Infinity
        if (visibleOnly && screenOffset > 2) { occluded++; continue }
        const gap = renderedHeight - meshHeight!
        gaps.push({ id: plant.id, x: plant.x, y: plant.y, rootHeight: renderedHeight, meshHeight: meshHeight!, screenOffset, gap })
      }
      const absolute = gaps.map(item => Math.abs(item.gap))
      return {
        count: plants.length, visible, checked: gaps.length, missing, hidden, occluded,
        maxGap: Math.max(0, ...absolute), maxError: Math.max(0, ...absolute), meanGap: absolute.length ? absolute.reduce((sum, gap) => sum + gap, 0) / absolute.length : 0,
        gaps,
      }
    },
    destroy() { disposed = true; cleanups.forEach(remove => remove()) },
  }
}
