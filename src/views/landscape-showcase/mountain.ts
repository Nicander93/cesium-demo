import * as Cesium from 'cesium'
import type { EnvironmentController } from '../../environment'
import {
  parseReservoirGeometry,
  sampleReservoirDisplayHeight,
  createReservoirSamplePoints,
} from '../environment-lab/reservoir-data'
import type { CoastScene } from './coast'
import type { ShowcaseView } from './settings'

export const showcaseTerrainUrl =
  'https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1/'
const imageryUrl =
  'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg'

export async function createMountainScene(options: {
  viewer: Cesium.Viewer
  environment: EnvironmentController
  isCancelled: () => boolean
  onProgress: (message: string) => void
}): Promise<CoastScene> {
  const { viewer, environment, isCancelled, onProgress } = options
  onProgress('载入真实山地与水域边界')
  const [provider, geojson] = await Promise.all([
    Cesium.CesiumTerrainProvider.fromUrl(showcaseTerrainUrl, {
      requestVertexNormals: false,
    }),
    fetch(
      import.meta.env.BASE_URL + 'landscape-showcase/mauvoisin.geojson',
    ).then(async (response) => {
      if (!response.ok) throw new Error('Mauvoisin 水域边界加载失败')
      return response.json() as Promise<unknown>
    }),
  ])
  if (isCancelled()) throw new Error('场景已切换')
  const geometry = parseReservoirGeometry(geojson, 'Lac de Mauvoisin')
  if (
    geometry.polygons.length !== 1 ||
    geometry.polygons[0]!.rings.length !== 1
  )
    throw new Error('当前山地场景需要单个无孔洞的水域边界')
  const originalTerrain = viewer.terrainProvider
  const originalLimit = Cesium.Rectangle.clone(
    viewer.scene.globe.cartographicLimitRectangle,
  )
  viewer.scene.globe.cartographicLimitRectangle = Cesium.Rectangle.fromDegrees(
    7.27,
    45.9,
    7.44,
    46.055,
  )
  viewer.terrainProvider = provider
  viewer.scene.globe.show = true
  viewer.scene.globe.enableLighting = false
  viewer.scene.globe.dynamicAtmosphereLighting = true
  viewer.scene.globe.dynamicAtmosphereLightingFromSun = false
  viewer.scene.globe.shadows = Cesium.ShadowMode.DISABLED
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#535c57')
  const imagery = viewer.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
      url: imageryUrl,
      // Four overview tiles cover this study area without a world-level imagery ramp.
      minimumLevel: 11,
      maximumLevel: 19,
      rectangle: Cesium.Rectangle.fromDegrees(7.27, 45.9, 7.44, 46.055),
      credit: '© swisstopo SWISSIMAGE / BAFU',
    }),
  )
  const removeImageryError =
    imagery.imageryProvider.errorEvent.addEventListener(() =>
      onProgress('公开影像仍在加载；地形与水面独立运行'),
    )
  let disposed = false
  function dispose(): void {
    if (disposed) return
    disposed = true
    removeImageryError()
    if (!viewer.isDestroyed()) {
      if (viewer.imageryLayers.contains(imagery))
        viewer.imageryLayers.remove(imagery, true)
      if (viewer.terrainProvider === provider) {
        viewer.terrainProvider = originalTerrain
        viewer.scene.globe.cartographicLimitRectangle = originalLimit
      }
    }
  }
  try {
    onProgress('采样库区地形，确定展示水面')
    const sampled = await sampleReservoirDisplayHeight(provider, geometry)
    if (isCancelled()) {
      dispose()
      throw new Error('场景已切换')
    }
    const anchor = Cesium.Cartesian3.fromDegrees(
      ...geometry.anchor,
      sampled.height,
    )
    environment.setAnchor(anchor)
    const candidates = createReservoirSamplePoints(geometry).sort(
      (a, b) => a[1] - b[1],
    )
    const at = (fraction: number) => {
      const reference =
        candidates[
          Math.min(
            candidates.length - 1,
            Math.floor(candidates.length * fraction),
          )
        ]!
      return (
        candidates
          .filter((p) => Math.abs(p[1] - reference[1]) < 0.00001)
          .sort(
            (a, b) =>
              Math.abs(a[0] - geometry.anchor[0]) -
              Math.abs(b[0] - geometry.anchor[0]),
          )[0] ?? reference
      )
    }
    const north = at(0.76),
      center = at(0.5),
      south = at(0.22)
    function focus(view: ShowcaseView = 'hero'): void {
      if (disposed || isCancelled()) return
      const eye = view === 'shore' ? center : north
      const target = view === 'overview' ? center : south
      const rise = view === 'overview' ? 650 : view === 'shore' ? 65 : 145
      const destination = Cesium.Cartesian3.fromDegrees(
        ...eye,
        sampled.height + rise,
      )
      const targetPosition = Cesium.Cartesian3.fromDegrees(
        ...target,
        sampled.height + 8,
      )
      const direction = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.subtract(
          targetPosition,
          destination,
          new Cesium.Cartesian3(),
        ),
        new Cesium.Cartesian3(),
      )
      const normal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(
        destination,
        new Cesium.Cartesian3(),
      )
      const right = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.cross(direction, normal, new Cesium.Cartesian3()),
        new Cesium.Cartesian3(),
      )
      const up = Cesium.Cartesian3.cross(
        right,
        direction,
        new Cesium.Cartesian3(),
      )
      viewer.camera.setView({ destination, orientation: { direction, up } })
      viewer.scene.requestRender()
    }
    const ring = geometry.polygons[0]!.rings[0]!
    onProgress('Mauvoisin 真实地形 · ' + sampled.count + ' 个有效水域样点')
    return {
      anchor,
      waterPositions: ring.map((p) => Cesium.Cartographic.fromDegrees(...p)),
      shoreline: ring.map((p) => Cesium.Cartographic.fromDegrees(...p)),
      waterHeight: sampled.height,
      focus,
      update: () => {},
      dispose,
      modelCount: 0,
      treeCount: 0,
    }
  } catch (error) {
    dispose()
    throw error
  }
}
