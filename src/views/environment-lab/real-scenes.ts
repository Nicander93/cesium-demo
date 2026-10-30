import * as Cesium from 'cesium'
import {
  createSceneConfiguration,
  normalizeSceneConfiguration,
  type WaterSettings,
  type QualitySettings,
  type SourceSettings,
} from './configuration'
import { acquireDepthPicking } from './depth-picking'
import { limitTilesetProcessing } from './tileset-processing'
import {
  chooseModelGroundHeight,
  isTargetModelHit,
  boxDisplayBaseHeight,
} from './model-ground'
import { createEnvironmentWater } from '../../environment/water'
import type { EnvironmentController } from '../../environment'
import {
  createReservoirHierarchies,
  parseReservoirGeometry,
  sampleReservoirDisplayHeight,
} from './reservoir-data'

const SWISS_TERRAIN_URL = 'https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1/'
const SWISS_IMAGERY_URL =
  'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg'
const GRUYERE_WATER_URL =
  import.meta.env.BASE_URL + 'environment-lab/lac-de-la-gruyere.geojson'
const DEFAULT_TILESET_URL = 'https://data.mars3d.cn/3dtiles/qx-dyt/tileset.json'
// Calibrated only for this public example; this is a visual placement, not a datum conversion.
const DEFAULT_TILESET_PLACEMENT = { offset: -28, nativeGround: 421.1 }
const WORLD_TERRAIN_URL = 'https://data.mars3d.cn/terrain/'
const GRUYERE_ANCHOR: [number, number] = [7.098941, 46.665303]
const GRUYERE_METADATA_ELEVATION = 677

export type RealSceneKind = 'reservoir' | 'flood'
export type RealSceneView = 'overview' | 'near' | 'low'

export interface RealSceneState {
  kind: 'terrain' | 'tileset'
  label: string
  sourceUrl: string
  loading: boolean
  ready: boolean
  error: string
  loadedTiles: number
  refining: boolean
  warning: string
  waterBaseHeight: number | null
  waterOffset: number
  waterHeight: number | null
  waterStatus: string
}

interface RealSceneOptions {
  water?: WaterSettings
  quality?: QualitySettings
  source?: SourceSettings
}

export interface CreateRealSceneOptions extends RealSceneOptions {
  viewer: Cesium.Viewer
  environment: EnvironmentController
  kind: RealSceneKind
  collection: Cesium.PrimitiveCollection
  tilesetUrl?: string
  onChange: (state: RealSceneState) => void
}

export interface RealScene {
  ready: Promise<void>
  getState(): RealSceneState
  focus(view?: RealSceneView): void
  setWaterLevel(offset: number): void
  setOptions(options: RealSceneOptions): void
  update(time: number): void
  dispose(): void
}

function makeWaterPrimitive(
  environment: EnvironmentController,
  collection: Cesium.PrimitiveCollection,
  frame: Cesium.Matrix4,
  worldHierarchies: readonly Cesium.PolygonHierarchy[],
  offset: number,
  settings: WaterSettings,
): {
  primitive: Cesium.Primitive
  update(time: number): void
  setOffset(offset: number): void
  setOptions(settings: WaterSettings): void
  dispose(): void
} {
  const inverse = Cesium.Matrix4.inverse(frame, new Cesium.Matrix4())
  const instances = worldHierarchies.map((hierarchy) => {
    const worldGeometry = Cesium.PolygonGeometry.createGeometry(
      new Cesium.PolygonGeometry({
        polygonHierarchy: hierarchy,
        vertexFormat: Cesium.VertexFormat.POSITION_NORMAL_AND_ST,
        perPositionHeight: true,
        closeTop: true,
        closeBottom: false,
      }),
    )
    if (!worldGeometry) throw new Error('无法生成场景水面几何')
    const positionAttribute = worldGeometry.attributes.position
    const normalAttribute = worldGeometry.attributes.normal
    const stAttribute = worldGeometry.attributes.st
    if (!positionAttribute || !normalAttribute || !stAttribute)
      throw new Error('水面网格缺少材质顶点属性')
    const worldPositions = positionAttribute.values as Float64Array
    const localPositions = new Float64Array(worldPositions.length)
    const worldNormals = normalAttribute.values as Float32Array
    const localNormals = new Float32Array(worldNormals.length)
    for (let index = 0; index < worldPositions.length; index += 3) {
      const local = Cesium.Matrix4.multiplyByPoint(
        inverse,
        new Cesium.Cartesian3(
          worldPositions[index],
          worldPositions[index + 1],
          worldPositions[index + 2],
        ),
        new Cesium.Cartesian3(),
      )
      localPositions.set([local.x, local.y, local.z], index)
      const normal = Cesium.Matrix4.multiplyByPointAsVector(
        inverse,
        new Cesium.Cartesian3(
          worldNormals[index],
          worldNormals[index + 1],
          worldNormals[index + 2],
        ),
        new Cesium.Cartesian3(),
      )
      Cesium.Cartesian3.normalize(normal, normal)
      localNormals.set([normal.x, normal.y, normal.z], index)
    }
    const attributes = new Cesium.GeometryAttributes()
    Object.assign(attributes, {
      position: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.DOUBLE,
        componentsPerAttribute: 3,
        values: localPositions,
      }),
      normal: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 3,
        values: localNormals,
      }),
      st: stAttribute,
    })
    const rawIndices = worldGeometry.indices
    const indices = rawIndices
      ? new Uint32Array(rawIndices as ArrayLike<number>)
      : undefined
    const primitiveType = worldGeometry.primitiveType
    if (!primitiveType) throw new Error('水面网格缺少图元类型')
    const geometry = new Cesium.Geometry({
      attributes,
      ...(indices ? { indices } : {}),
      primitiveType,
      boundingSphere: Cesium.BoundingSphere.fromVertices(
        Array.from(localPositions),
      ),
    })
    return new Cesium.GeometryInstance({ geometry })
  })
  const material = createEnvironmentWater(
    environment,
    Cesium.Color.fromCssColorString(settings.color),
    settings,
  )
  const primitive = new Cesium.Primitive({
    geometryInstances: instances,
    appearance: new Cesium.MaterialAppearance({
      material: material.material,
      translucent: false,
      closed: false,
      faceForward: true,
    }),
    modelMatrix: Cesium.Matrix4.clone(frame),
    asynchronous: false,
    shadows: Cesium.ShadowMode.DISABLED,
  })
  collection.add(primitive)
  function setOffset(value: number): void {
    primitive.modelMatrix = Cesium.Matrix4.multiplyByTranslation(
      frame,
      new Cesium.Cartesian3(0, 0, value),
      new Cesium.Matrix4(),
    )
  }
  setOffset(offset)
  return {
    primitive,
    update: (time) => material.update(time),
    setOffset,
    setOptions: (next) => material.setOptions(next),
    dispose(): void {
      if (!material.material.isDestroyed()) material.material.destroy()
    },
  }
}

function waitForRender(viewer: Cesium.Viewer): Promise<void> {
  return new Promise((resolve) => {
    if (viewer.isDestroyed()) {
      resolve()
      return
    }
    let finished = false
    let remove = () => {}
    const finish = () => {
      if (finished) return
      finished = true
      remove()
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, 1000)
    remove = viewer.scene.postRender.addEventListener(finish)
    viewer.scene.requestRender()
  })
}

async function sampleTilesetGround(
  viewer: Cesium.Viewer,
  target: Cesium.Cesium3DTileset,
  isDisposed: () => boolean,
  sampleTiles: readonly Cesium.Cesium3DTile[],
): Promise<number> {
  const { center, radius } = target.boundingSphere
  const centerHeight = Cesium.Cartographic.fromCartesian(center).height
  const heights: number[] = []
  const releaseDepthPicking = acquireDepthPicking(viewer.scene)
  // Produce one depth-enabled frame before reading it; navigation normally keeps depth picking off.
  try {
    await waitForRender(viewer)
    if (isDisposed() || viewer.isDestroyed()) throw new Error('场景已销毁')
    for (const tile of sampleTiles.slice(0, 12)) {
      const screen = viewer.scene.cartesianToCanvasCoordinates(
        tile.boundingSphere.center,
      )
      if (!screen) continue
      for (const [dx, dy] of [
        [0, 0],
        [0, 12],
        [0, 24],
        [-12, 12],
        [12, 12],
        [-24, 0],
        [24, 0],
        [0, -12],
      ]) {
        const point = new Cesium.Cartesian2(
          Math.round(screen.x + dx),
          Math.round(screen.y + dy),
        )
        if (
          point.x < 0 ||
          point.y < 0 ||
          point.x >= viewer.canvas.clientWidth ||
          point.y >= viewer.canvas.clientHeight
        )
          continue
        const position = viewer.scene.pickPosition(point)
        const object = viewer.scene.pick(point, 1, 1)
        if (isTargetModelHit({ object, position }, target) && position)
          heights.push(Cesium.Cartographic.fromCartesian(position).height)
      }
      if (heights.length >= 8) break
    }
    return chooseModelGroundHeight(heights, centerHeight, radius)
  } finally {
    releaseDepthPicking()
  }
}

export function createRealScene(options: CreateRealSceneOptions): RealScene {
  const { viewer, environment, kind, collection, onChange } = options
  const defaults = createSceneConfiguration(kind, environment.getState().preset)
  let settings = normalizeSceneConfiguration(kind, { ...defaults, ...options })
  const tilesetUrl = options.tilesetUrl?.trim()
  const useTileset = Boolean(tilesetUrl) || kind === 'flood'
  const sourceUrl = useTileset
    ? tilesetUrl || DEFAULT_TILESET_URL
    : SWISS_TERRAIN_URL
  const state: RealSceneState = {
    kind: useTileset ? 'tileset' : 'terrain',
    label: useTileset
      ? tilesetUrl
        ? '用户提供的 3D Tiles 模型'
        : 'Mars3D 大雁塔周边倾斜摄影（公开示例，仅演示）'
      : 'Lac de la Gruyère 瑞士真实水库（Rossens 大坝调节）',
    sourceUrl,
    loading: true,
    ready: false,
    error: '',
    loadedTiles: 0,
    refining: false,
    warning: '',
    waterBaseHeight: null,
    waterOffset: settings.water.level,
    waterHeight: null,
    waterStatus:
      kind === 'flood'
        ? '等待模型地表采样；水位偏移为 0 时不显示水面'
        : '等待 Gruyère 水库 DEM 水面采样',
  }
  const original = {
    globeShow: viewer.scene.globe.show,
    lighting: viewer.scene.globe.enableLighting,
    globeShadows: viewer.scene.globe.shadows,
    terrainError: viewer.scene.globe.maximumScreenSpaceError,
    undergroundColor: Cesium.Color.clone(viewer.scene.globe.undergroundColor),
    terrain: viewer.terrainProvider,
    anchor: environment.getAnchor(),
    baseColor: Cesium.Color.clone(viewer.scene.globe.baseColor),
  }
  let disposed = false
  let water: ReturnType<typeof makeWaterPrimitive> | undefined
  let tileset: Cesium.Cesium3DTileset | undefined
  let baseModelMatrix: Cesium.Matrix4 | undefined
  let modelUp: Cesium.Cartesian3 | undefined
  let displayWaterBase: number | undefined
  let calibratingModel = useTileset
  let bakedLighting: Cesium.CustomShader | undefined
  let imageryLayer: Cesium.ImageryLayer | undefined
  let terrainProvider: Cesium.TerrainProvider | undefined
  let removeTileLoad: (() => void) | undefined
  let removeProcessingLimit: (() => void) | undefined
  let removeTileUnload: (() => void) | undefined
  const loadedTiles = new Set<Cesium.Cesium3DTile>()
  const pendingWaits = new Set<() => void>()
  let removeTileFailure: (() => void) | undefined
  let tileFailure = ''
  const failedTileUrls = new Set<string>()

  function applyRealLook(): void {
    if (disposed) return
    const preset = environment.getState().preset
    if (imageryLayer) {
      imageryLayer.brightness =
        (preset === 'day' ? 1 : preset === 'sunset' ? 0.78 : 0.7) *
        settings.source.imageryBrightness
      imageryLayer.saturation =
        (preset === 'day' ? 1 : 0.82) * settings.source.imagerySaturation
      imageryLayer.contrast = settings.source.imageryContrast
    }
    viewer.scene.globe.enableLighting = settings.source.terrainLighting
    viewer.scene.globe.shadows = settings.source.terrainShadows
      ? Cesium.ShadowMode.RECEIVE_ONLY
      : Cesium.ShadowMode.DISABLED
    viewer.scene.globe.maximumScreenSpaceError = settings.quality.terrainError
    if (tileset) {
      tileset.shadows = modelShadowMode()
      tileset.maximumScreenSpaceError = settings.quality.tilesetError
      tileset.cacheBytes = settings.quality.cacheMB * 1024 * 1024
      tileset.maximumCacheOverflowBytes = tileset.cacheBytes / 2
    }
  }
  function modelShadowMode(): Cesium.ShadowMode {
    return settings.source.modelShadows === 'both'
      ? Cesium.ShadowMode.ENABLED
      : settings.source.modelShadows === 'cast'
        ? Cesium.ShadowMode.CAST_ONLY
        : Cesium.ShadowMode.DISABLED
  }
  // Keep the imported placement separate so slider updates never accumulate translations.
  function applyModelPlacement(): void {
    const extra = tileset ? settings.source.modelHeightOffset : 0
    if (tileset && baseModelMatrix && modelUp && !calibratingModel) {
      const shift = Cesium.Cartesian3.multiplyByScalar(
        modelUp,
        extra,
        new Cesium.Cartesian3(),
      )
      tileset.modelMatrix = Cesium.Matrix4.multiply(
        Cesium.Matrix4.fromTranslation(shift),
        baseModelMatrix,
        new Cesium.Matrix4(),
      )
    }
    if (displayWaterBase !== undefined) {
      state.waterBaseHeight = displayWaterBase + extra
      state.waterHeight = state.waterBaseHeight + state.waterOffset
      water?.setOffset(state.waterOffset + extra)
    }
  }
  const unsubscribeLook = environment.subscribe(applyRealLook)

  function notify(): void {
    if (!disposed) onChange({ ...state })
  }

  function setError(error: unknown): void {
    if (disposed) return
    state.loading = false
    state.ready = false
    state.error = error instanceof Error ? error.message : String(error)
    state.waterStatus = '加载失败；没有替换成合成布景'
    notify()
  }

  function updateWaterVisibility(): void {
    if (!water) return
    water.primitive.show =
      settings.water.visible && (kind !== 'flood' || state.waterOffset > 0)
    water.primitive.shadows = settings.water.receiveShadows
      ? Cesium.ShadowMode.RECEIVE_ONLY
      : Cesium.ShadowMode.DISABLED
  }

  function focus(view: RealSceneView = 'overview'): void {
    if (disposed || viewer.isDestroyed()) return
    const near = view === 'near'
    const low = view === 'low'
    if (tileset) {
      const sphere = tileset.boundingSphere
      if (!sphere) return
      environment.setAnchor(Cesium.Cartesian3.clone(sphere.center))
      viewer.camera.lookAt(
        sphere.center,
        new Cesium.HeadingPitchRange(
          Cesium.Math.toRadians(28),
          Cesium.Math.toRadians(low ? -6 : near ? -8 : -10),
          sphere.radius * (low ? 1.4 : near ? 1.05 : 1.6),
        ),
      )
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
      viewer.scene.requestRender()
      return
    }
    // This Swiss elevation is only an approximate camera target, never the lake-water height.
    const cameraHeight = state.waterBaseHeight ?? GRUYERE_METADATA_ELEVATION
    const anchor = Cesium.Cartesian3.fromDegrees(
      GRUYERE_ANCHOR[0],
      GRUYERE_ANCHOR[1],
      cameraHeight,
    )
    environment.setAnchor(anchor)
    viewer.camera.lookAt(
      anchor,
      new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(12),
        Cesium.Math.toRadians(low ? -5 : near ? -8 : -12),
        low ? 1000 : near ? 2000 : 5000,
      ),
    )
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
    viewer.scene.requestRender()
  }

  async function loadSwissReservoir(): Promise<void> {
    viewer.scene.globe.show = true
    const imageryProvider = new Cesium.UrlTemplateImageryProvider({
      url: SWISS_IMAGERY_URL,
      minimumLevel: 5,
      maximumLevel: 19,
      rectangle: Cesium.Rectangle.fromDegrees(5.9, 45.8, 10.6, 47.9),
      credit: new Cesium.Credit('© swisstopo, BAFU, BFE / geo.admin.ch'),
    })
    imageryLayer = viewer.imageryLayers.addImageryProvider(imageryProvider)
    applyRealLook()
    const [provider, geojson] = await Promise.all([
      Cesium.CesiumTerrainProvider.fromUrl(SWISS_TERRAIN_URL, {
        requestVertexNormals: false,
      }),
      fetch(GRUYERE_WATER_URL).then((response) => {
        if (!response.ok)
          throw new Error('Lac de la Gruyère 水域边界 HTTP ' + response.status)
        return response.json() as Promise<unknown>
      }),
    ])
    if (disposed) return
    terrainProvider = provider
    viewer.terrainProvider = provider
    const geometry = parseReservoirGeometry(geojson)
    GRUYERE_ANCHOR[0] = geometry.anchor[0]
    GRUYERE_ANCHOR[1] = geometry.anchor[1]
    state.label = 'Lac de la Gruyère 瑞士真实水库（Rossens 大坝调节）'
    let sampled: Awaited<ReturnType<typeof sampleReservoirDisplayHeight>>
    try {
      sampled = await sampleReservoirDisplayHeight(provider, geometry)
    } catch (reason) {
      if (disposed) return
      state.warning = '真实水库地形与影像已加载；水面未显示：' + String(reason)
      state.waterStatus = 'DEM 未得到可信、近似平面的水面高程；水面保持关闭'
      state.loading = false
      state.ready = true
      notify()
      focus('overview')
      return
    }
    if (disposed) return
    displayWaterBase = sampled.height
    state.waterBaseHeight = sampled.height
    state.waterHeight = sampled.height + state.waterOffset
    state.waterStatus =
      'swisstopo DEM 14级有效样本 ' +
      sampled.count +
      ' 个；10–90分位 ' +
      sampled.minimum.toFixed(2) +
      '–' +
      sampled.maximum.toFixed(2) +
      ' m'
    const frame = Cesium.Transforms.eastNorthUpToFixedFrame(
      Cesium.Cartesian3.fromDegrees(
        geometry.anchor[0],
        geometry.anchor[1],
        sampled.height,
      ),
    )
    water = makeWaterPrimitive(
      environment,
      collection,
      frame,
      createReservoirHierarchies(geometry, sampled.height),
      state.waterOffset,
      settings.water,
    )
    updateWaterVisibility()
    state.loading = false
    state.ready = true
    notify()
    focus('overview')
  }

  async function waitForVisibleGeometry(
    target: Cesium.Cesium3DTileset,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let done = false
      let remove = () => {}
      let timer: ReturnType<typeof setTimeout> | undefined
      const cancel = () => finish(new Error('场景已销毁'))
      function finish(error?: Error): void {
        if (done) return
        done = true
        remove()
        if (timer !== undefined) clearTimeout(timer)
        pendingWaits.delete(cancel)
        if (error) reject(error)
        else resolve()
      }
      const check = () => {
        if (disposed || viewer.isDestroyed()) {
          finish(new Error('场景已销毁'))
          return
        }
        const stats = (
          target as unknown as {
            statistics: {
              numberOfTrianglesSelected: number
              numberOfPointsSelected: number
            }
          }
        ).statistics
        if (
          (stats?.numberOfTrianglesSelected ?? 0) > 0 ||
          (stats?.numberOfPointsSelected ?? 0) > 0
        )
          finish()
      }
      remove = viewer.scene.postRender.addEventListener(check)
      pendingWaits.add(cancel)
      timer = setTimeout(
        () =>
          finish(
            new Error(
              '公开模型未在45秒内显示可见网格' +
                (tileFailure ? '：' + tileFailure : ''),
            ),
          ),
        45000,
      )
      check()
      viewer.scene.requestRender()
    })
  }

  async function loadTileset(): Promise<void> {
    viewer.scene.globe.show = true
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#657466')
    imageryLayer = Cesium.ImageryLayer.fromProviderAsync(
      Cesium.ArcGisMapServerImageryProvider.fromUrl(
        'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
        { enablePickFeatures: false },
      ),
    )
    viewer.imageryLayers.add(imageryLayer)
    applyRealLook()
    // Photogrammetry already contains baked appearance; avoid applying a second PBR/IBL lighting model.
    bakedLighting = new Cesium.CustomShader({
      lightingModel: Cesium.LightingModel.UNLIT,
    })
    const [loaded, provider] = await Promise.all([
      Cesium.Cesium3DTileset.fromUrl(sourceUrl, {
        cacheBytes: settings.quality.cacheMB * 1024 * 1024,
        maximumCacheOverflowBytes: settings.quality.cacheMB * 512 * 1024,
        maximumScreenSpaceError: settings.quality.tilesetError,
        cullRequestsWhileMoving: true,
        cullRequestsWhileMovingMultiplier: 120,
        foveatedTimeDelay: 0.35,
        shadows: modelShadowMode(),
      }),
      Cesium.CesiumTerrainProvider.fromUrl(WORLD_TERRAIN_URL, {
        requestVertexNormals: false,
      }),
    ])
    if (disposed) {
      loaded.destroy()
      return
    }
    terrainProvider = provider
    viewer.terrainProvider = provider
    removeProcessingLimit = limitTilesetProcessing(loaded, 1)
    loaded.customShader = bakedLighting
    tileset = loaded
    removeTileFailure = loaded.tileFailed.addEventListener((event) => {
      if (disposed) return
      tileFailure = event.message
      failedTileUrls.add(event.url)
      state.warning =
        '公开数据有 ' +
        failedTileUrls.size +
        ' 个分块加载失败，局部可能缺失；可稍后重载或更换模型。'
      notify()
    })
    removeTileLoad = loaded.tileLoad.addEventListener((tile) => {
      if (disposed) return
      if (
        (tile.content?.trianglesLength ?? 0) === 0 &&
        (tile.content?.pointsLength ?? 0) === 0
      )
        return
      loadedTiles.add(tile)
      state.loadedTiles = loadedTiles.size
      notify()
    })
    removeTileUnload = loaded.tileUnload.addEventListener((tile) => {
      if (disposed) return
      loadedTiles.delete(tile)
      state.loadedTiles = loadedTiles.size
      notify()
    })
    if (sourceUrl === DEFAULT_TILESET_URL) {
      const up = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(
        loaded.boundingSphere.center,
        new Cesium.Cartesian3(),
      )
      const shift = Cesium.Cartesian3.multiplyByScalar(
        up,
        DEFAULT_TILESET_PLACEMENT.offset,
        new Cesium.Cartesian3(),
      )
      loaded.modelMatrix = Cesium.Matrix4.multiply(
        Cesium.Matrix4.fromTranslation(shift),
        loaded.modelMatrix,
        new Cesium.Matrix4(),
      )
    }
    baseModelMatrix = Cesium.Matrix4.clone(loaded.modelMatrix)
    modelUp = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(
      loaded.boundingSphere.center,
      new Cesium.Cartesian3(),
    )
    collection.add(loaded)
    applyRealLook()
    const sphere = loaded.boundingSphere
    if (!sphere || !Number.isFinite(sphere.radius) || sphere.radius <= 0)
      throw new Error('Tileset 没有有效的包围球，不能定位场景')
    focus('overview')
    state.waterStatus = '正在加载真实网格，随后采样模型高程'
    notify()
    await waitForVisibleGeometry(loaded)
    if (disposed) return
    const box = (
      loaded.root as unknown as {
        boundingVolume?: { boundingVolume?: unknown }
      }
    ).boundingVolume?.boundingVolume
    const boxBase = boxDisplayBaseHeight(box)
    let base: number
    try {
      base =
        sourceUrl === DEFAULT_TILESET_URL
          ? DEFAULT_TILESET_PLACEMENT.nativeGround +
            DEFAULT_TILESET_PLACEMENT.offset
          : (boxBase ??
            (await sampleTilesetGround(viewer, loaded, () => disposed, [
              ...loadedTiles,
            ])))
    } catch (reason) {
      if (disposed) return
      calibratingModel = false
      applyModelPlacement()
      state.waterStatus =
        '模型已加载；地表采样不可信，水面已停用：' + String(reason)
      state.loading = false
      state.ready = true
      notify()
      return
    }
    if (disposed) return
    displayWaterBase = base
    state.waterBaseHeight = base
    state.waterHeight = base + state.waterOffset
    state.waterStatus =
      sourceUrl === DEFAULT_TILESET_URL
        ? '示例贴地后的水面显示基准 ' +
          base.toFixed(2) +
          ' m；不是实测水位或水动力结果'
        : boxBase !== undefined
          ? '模型包围盒底部 ' +
            base.toFixed(2) +
            ' m 为显示基准；不是实测地面或水动力结果'
          : '可见模型表面低分位为显示基准；不是实测地面或水动力结果'
    if (kind === 'flood' || tilesetUrl) {
      const cartographic = Cesium.Cartographic.fromCartesian(sphere.center)
      const frame = Cesium.Transforms.eastNorthUpToFixedFrame(
        Cesium.Cartesian3.fromRadians(
          cartographic.longitude,
          cartographic.latitude,
          base,
        ),
      )
      const worldRing: Cesium.Cartesian3[] = []
      const waterRadius = Math.min(sphere.radius * 0.68, 650)
      for (let index = 0; index < 48; index++) {
        const angle = (index / 48) * Cesium.Math.TWO_PI
        worldRing.push(
          Cesium.Matrix4.multiplyByPoint(
            frame,
            new Cesium.Cartesian3(
              Math.cos(angle) * waterRadius,
              Math.sin(angle) * waterRadius,
              0,
            ),
            new Cesium.Cartesian3(),
          ),
        )
      }
      water = makeWaterPrimitive(
        environment,
        collection,
        frame,
        [new Cesium.PolygonHierarchy(worldRing)],
        state.waterOffset,
        settings.water,
      )
      updateWaterVisibility()
    }
    calibratingModel = false
    applyModelPlacement()
    state.loading = false
    state.ready = true
    notify()
  }

  viewer.scene.globe.show = true
  // Aerial imagery already contains captured shading; keep it unlit and grade it cheaply per weather.
  applyRealLook()
  // These scenes stay above ground; omit the underground backface shader branch.
  viewer.scene.globe.undergroundColor = Cesium.Color.clone(
    Cesium.Color.TRANSPARENT,
  )
  const ready = (useTileset ? loadTileset() : loadSwissReservoir()).catch(
    (error: unknown) => {
      setError(error)
      throw error
    },
  )

  return {
    ready,
    getState: () => ({
      ...state,
      refining:
        !disposed &&
        state.ready &&
        (!viewer.scene.globe.tilesLoaded ||
          Boolean(tileset && !tileset.tilesLoaded)),
    }),
    focus,
    setWaterLevel(offset: number): void {
      if (disposed || !Number.isFinite(offset)) return
      state.waterOffset = Cesium.Math.clamp(offset, 0, 20)
      settings.water.level = state.waterOffset
      state.waterHeight =
        state.waterBaseHeight === null
          ? null
          : state.waterBaseHeight + state.waterOffset
      if (water && state.waterBaseHeight !== null) {
        water.setOffset(
          state.waterOffset + (tileset ? settings.source.modelHeightOffset : 0),
        )
        updateWaterVisibility()
      }
      if (state.waterBaseHeight === null)
        state.waterStatus = '没有可信的模型基准高程，水面保持关闭'
      else if (kind === 'flood')
        state.waterStatus =
          state.waterOffset > 0
            ? '水平水位显示中；不是水动力结果'
            : '水位偏移为 0 m，洪水水面隐藏'
      notify()
      viewer.scene.requestRender()
    },
    setOptions(next: RealSceneOptions): void {
      if (disposed) return
      settings = normalizeSceneConfiguration(kind, { ...settings, ...next })
      state.waterOffset = settings.water.level
      water?.setOptions(settings.water)
      applyRealLook()
      applyModelPlacement()
      updateWaterVisibility()
      notify()
      viewer.scene.requestRender()
    },
    update(time: number): void {
      if (!disposed && water) water.update(time)
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      unsubscribeLook()
      for (const cancel of [...pendingWaits]) cancel()
      removeProcessingLimit?.()
      removeTileFailure?.()
      removeTileLoad?.()
      removeTileUnload?.()
      loadedTiles.clear()
      if (!viewer.isDestroyed()) {
        if (water && collection.contains(water.primitive))
          collection.remove(water.primitive)
        water?.dispose()
        if (tileset && collection.contains(tileset)) collection.remove(tileset)
        if (imageryLayer && viewer.imageryLayers.contains(imageryLayer))
          viewer.imageryLayers.remove(imageryLayer, true)
        if (terrainProvider && viewer.terrainProvider === terrainProvider)
          viewer.terrainProvider = original.terrain
        if (viewer.scene.globe.show)
          viewer.scene.globe.show = original.globeShow
        viewer.scene.globe.baseColor = original.baseColor
        viewer.scene.globe.enableLighting = original.lighting
        viewer.scene.globe.shadows = original.globeShadows
        viewer.scene.globe.maximumScreenSpaceError = original.terrainError
        viewer.scene.globe.undergroundColor = original.undergroundColor
        environment.setAnchor(original.anchor)
        viewer.scene.requestRender()
      }
      bakedLighting?.destroy()
      bakedLighting = undefined
      water = undefined
      tileset = undefined
      imageryLayer = undefined
      terrainProvider = undefined
    },
  }
}
