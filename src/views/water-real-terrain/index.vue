<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import * as Cesium from 'cesium'
import { WaterSurface } from '../../water'
import {
  swissTerrainUrl,
  swissImageryUrl,
  parseBrienzBoundary,
  sampleLakeDisplayHeight,
  type WaterCoordinate,
} from '../../water/terrain-water'
const container = ref<HTMLElement>()
const terrainStatus = ref('等待加载'),
  waterStatus = ref('等待加载'),
  imageryStatus = ref('等待加载')
const height = ref<number>(),
  heightNote = ref(''),
  reflection = ref(false),
  error = ref('')
let viewer: Cesium.Viewer | undefined,
  water: WaterSurface | undefined,
  request = 0
let ring: WaterCoordinate[] | undefined,
  provider: Cesium.TerrainProvider | undefined
let removeRenderError: (() => void) | undefined,
  removeImageryError: (() => void) | undefined
function focus(near = false): void {
  if (!viewer) return
  const target = Cesium.Cartesian3.fromDegrees(
    7.891,
    46.695,
    height.value ?? 615,
  )
  viewer.camera.lookAt(
    target,
    new Cesium.HeadingPitchRange(2.7, near ? -0.35 : -0.75, near ? 1300 : 3100),
  )
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
}
function setWaterHeight(): void {
  if (height.value === undefined || !Number.isFinite(height.value)) return
  if (water) water.height = height.value
}
function setReflection(): void {
  water?.setOptions({ reflection: reflection.value })
}
async function createWater(id: number): Promise<void> {
  if (!viewer || !provider || !ring) return
  waterStatus.value = '采样 DEM 已制图湖面展示高程'
  try {
    const sampled = await sampleLakeDisplayHeight(provider, ring)
    if (id !== request || !viewer) return
    height.value = Number(sampled.height.toFixed(2))
    heightNote.value =
      'DEM 湖面 ' +
      sampled.minimum.toFixed(2) +
      '–' +
      sampled.maximum.toFixed(2) +
      ' m，' +
      sampled.count +
      ' 点上包络 + 0.25 m；不是实时水位，源高程基准未核定。'
    water = new WaterSurface({
      scene: viewer.scene,
      positions: ring.map((p) => Cesium.Cartographic.fromDegrees(...p)),
      height: height.value,
      quality: 'balanced',
      reflection: reflection.value,
      foam: false,
      waterAlpha: 0.85,
      edgeFadeWidth: 0.08,
      waveStrength: 0.6,
      rippleSize: 150,
      normalMapUrl:
        import.meta.env.BASE_URL + 'cesium/Assets/Textures/waterNormals.jpg',
      waterColor: Cesium.Color.fromCssColorString('#0b6a76'),
      onError: (value) => {
        error.value = String(value)
      },
    })
    const ready = await water.ready
    if (id !== request || !viewer) return
    if (ready) waterStatus.value = '官方水域面已显示 · 无流速数据，静态湖面'
    focus()
  } catch (value) {
    if (id === request) waterStatus.value = '水面停止生成：' + String(value)
  }
}
async function load(): Promise<void> {
  if (!viewer) return
  const id = ++request
  water?.destroy()
  water = undefined
  ring = undefined
  provider = undefined
  terrainStatus.value = '加载公开地形服务'
  waterStatus.value = '加载本地官方水域面'
  error.value = ''
  height.value = undefined
  heightNote.value = ''
  removeImageryError?.()
  viewer.imageryLayers.removeAll()
  try {
    const imagery = new Cesium.UrlTemplateImageryProvider({
      url: swissImageryUrl,
      minimumLevel: 5,
      maximumLevel: 19,
      rectangle: Cesium.Rectangle.fromDegrees(5.9, 45.8, 10.6, 47.9),
      credit: '© swisstopo SWISSIMAGE',
    })
    removeImageryError = imagery.errorEvent.addEventListener(() => {
      if (id === request)
        imageryStatus.value = '影像瓦片请求失败；地形和水域仍可独立加载'
    })
    viewer.imageryLayers.addImageryProvider(imagery)
    imageryStatus.value = 'SWISSIMAGE 已添加；瓦片按需加载'
  } catch (value) {
    imageryStatus.value = '影像不可用：' + String(value)
  }
  const terrainTask = Cesium.CesiumTerrainProvider.fromUrl(swissTerrainUrl, {
    requestVertexNormals: true,
  })
    .then((value) => {
      if (id !== request || !viewer) return
      provider = value
      viewer.terrainProvider = value
      terrainStatus.value = 'swisstopo 真实地形已接入'
    })
    .catch((value) => {
      if (id === request) terrainStatus.value = '地形不可用：' + String(value)
    })
  const boundaryTask = fetch(
    import.meta.env.BASE_URL + 'water/brienz-water.geojson',
  )
    .then(async (response) => {
      if (!response.ok) throw new Error('水域文件 HTTP ' + response.status)
      const value = parseBrienzBoundary(await response.json())
      if (id === request) {
        ring = value
        waterStatus.value = '官方水域面已载入，等待 DEM 展示高程'
      }
    })
    .catch((value) => {
      if (id === request)
        waterStatus.value = '缺少可信水域，停止生成水面：' + String(value)
    })
  await Promise.allSettled([terrainTask, boundaryTask])
  if (id === request) await createWater(id)
}
const lab = {
  getState: () => ({
    terrainStatus: terrainStatus.value,
    waterStatus: waterStatus.value,
    imageryStatus: imageryStatus.value,
    height: height.value,
    error: error.value,
    hasWater: !!water && !water.isDestroyed(),
    terrainProvider: !!provider,
    positions: ring?.length,
    tilesLoaded: viewer?.scene.globe.tilesLoaded,
    diagnostics: water?.getDiagnostics(),
  }),
  focus,
  load,
}
declare global {
  interface Window {
    __realWaterLab?: typeof lab
  }
}
onMounted(() => {
  try {
    if (!container.value) return
    viewer = new Cesium.Viewer(container.value, {
      baseLayer: false,
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      useBrowserRecommendedResolution: false,
      msaaSamples: 4,
    })
    viewer.scene.postProcessStages.fxaa.enabled = true
    viewer.scene.globe.depthTestAgainstTerrain = true
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#455a52')
    if (viewer.scene.skyBox) viewer.scene.skyBox.show = false
    removeRenderError = viewer.scene.renderError.addEventListener(
      (_scene, value) => {
        error.value = String(value)
      },
    )
    focus()
    if (import.meta.env.DEV) window.__realWaterLab = lab
    void load()
  } catch (value) {
    error.value = String(value)
  }
})
onBeforeUnmount(() => {
  request++
  removeRenderError?.()
  removeImageryError?.()
  water?.destroy()
  viewer?.destroy()
  viewer = undefined
  delete window.__realWaterLab
})
</script>
<template>
  <div class="real-water">
    <div ref="container" class="real-water__canvas" />
    <aside class="real-water__panel">
      <RouterLink to="/water-flow-lab">← 合成水流对照</RouterLink>
      <h1>真实地形 · 布里恩茨湖岸</h1>
      <p>
        水域来自瑞士官方湖泊数据，不使用 DEM
        最低点推断河道。无水动力速度数据，显示静态湖面。直线截断是局部展示范围，边缘渐隐，不代表真实岸线。
      </p>
      <dl>
        <dt>地形</dt>
        <dd>{{ terrainStatus }}</dd>
        <dt>水域 / 水位</dt>
        <dd>{{ waterStatus }}</dd>
        <dt>影像</dt>
        <dd>{{ imageryStatus }}</dd>
      </dl>
      <label v-if="height !== undefined"
        >展示水位（地形服务场景高程，米）<input
          v-model.number="height"
          type="number"
          step="0.1"
          @change="setWaterHeight"
      /></label>
      <p>{{ heightNote }}</p>
      <label
        ><input v-model="reflection" type="checkbox" @change="setReflection" />
        场景反射（实验）</label
      >
      <div class="real-water__actions">
        <button @click="focus(false)">俯瞰</button
        ><button @click="focus(true)">近岸</button
        ><button @click="load">重新加载</button>
      </div>
      <p>
        地形 © swisstopo · 水域 © FOEN/BAFU · 影像 © swisstopo
        SWISSIMAGE。外部服务失败时保留独立状态；缺水域或展示高程时停止水面生成。
      </p>
      <p>
        DEM
        不提供湖底水深；源垂直基准未核定，当前展示高度不是实时水位、已转换椭球高或工程配准成果。查看水位调整和边界叠合后，再接入实际河流/洪水数据。
      </p>
      <p v-if="error" role="alert">{{ error }}</p>
    </aside>
  </div>
</template>
<style scoped>
.real-water {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: #192b32;
  color: #e1eded;
}
.real-water__canvas {
  height: 100%;
}
.real-water__panel {
  position: absolute;
  top: 16px;
  left: 16px;
  width: 330px;
  max-height: calc(100vh - 32px);
  overflow: auto;
  padding: 20px;
  border: 1px solid #52716f;
  border-radius: 6px;
  background: rgba(15, 31, 35, 0.96);
}
.real-water__panel h1 {
  font-size: 21px;
  margin: 16px 0;
}
.real-water__panel p,
.real-water__panel dd {
  font-size: 13px;
  line-height: 1.7;
  margin: 8px 0;
  color: #bcd0ce;
}
.real-water__panel a {
  color: #a7d7cc;
}
.real-water__panel dt {
  font-size: 14px;
  margin-top: 12px;
}
.real-water__panel label {
  display: block;
  font-size: 13px;
  margin-top: 12px;
}
.real-water__panel input[type='number'] {
  width: 100%;
  padding: 6px;
  margin-top: 6px;
  background: #28464b;
  color: #fff;
  border: 1px solid #587d80;
}
.real-water__actions {
  display: flex;
  gap: 8px;
  margin: 16px 0;
}
.real-water__actions button {
  flex: 1;
  padding: 8px;
  background: #29494e;
  color: #fff;
  border: 1px solid #64898b;
  cursor: pointer;
}
@media (max-width: 700px) {
  .real-water__panel {
    width: 270px;
    max-height: 48vh;
  }
}
</style>
