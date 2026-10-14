<script setup lang="ts">
import { onMounted, onBeforeUnmount, reactive, ref, nextTick } from 'vue'
import * as Cesium from 'cesium'
import {
  WaterSurface,
  createWaterPreset,
  type WaterPresetName,
  type WaterPresetOptions,
} from '../../water'
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
  error = ref('')
const mode = ref<'imagery' | 'current' | 'enhanced'>('enhanced')
const presetName = ref<WaterPresetName>('calm-lake')
const config = reactive(createWaterPreset())
const diagnostics = ref<ReturnType<WaterSurface['getDiagnostics']>>()
const reflectionNotice = ref('')
const fps = ref(0)
const cameraView = ref<'near' | 'overview' | 'far'>('overview')
let viewer: Cesium.Viewer | undefined,
  water: WaterSurface | undefined,
  request = 0
let ring: WaterCoordinate[] | undefined,
  provider: Cesium.TerrainProvider | undefined
let removeRenderError: (() => void) | undefined,
  removeImageryError: (() => void) | undefined
let removePostRender: (() => void) | undefined
function focus(view: 'near' | 'overview' | 'far' | boolean = 'overview'): void {
  const kind = typeof view === 'boolean' ? (view ? 'near' : 'overview') : view
  cameraView.value = kind
  if (!viewer) return
  const target = Cesium.Cartesian3.fromDegrees(
    kind === 'near' ? 7.895 : 7.891,
    kind === 'near' ? 46.694 : 46.695,
    height.value ?? 615,
  )
  viewer.camera.lookAt(
    target,
    new Cesium.HeadingPitchRange(
      kind === 'near' ? 4.7 : 2.7,
      kind === 'near' ? -0.9 : -0.75,
      kind === 'near' ? 1400 : kind === 'far' ? 6000 : 3100,
    ),
  )
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
}
function setWaterHeight(): void {
  if (height.value === undefined || !Number.isFinite(height.value)) return
  if (water) water.height = height.value
}
function applyMode(): void {
  if (!water) return
  water.show = mode.value !== 'imagery'
  reflectionNotice.value = ''
  if (mode.value === 'enhanced') water.setOptions({ ...config })
  else
    water.setOptions({
      waveModel: 'legacy',
      reflection: false,
      waveStrength: 0.6,
      waveSpeed: 1,
      rippleSize: 150,
      waterAlpha: 0.85,
      waterColor: Cesium.Color.fromCssColorString('#0b6a76'),
      reflectivity: 0.3,
      reflectionStrength: 1,
      specularIntensity: 1,
      sunShiny: 100,
      distortionScale: 3.7,
    })
  diagnostics.value = water.getDiagnostics()
}
function applyOptions(): void {
  mode.value = 'enhanced'
  // Native v-model handlers commit during the same event; read the completed reactive update.
  void nextTick(() => {
    if (water && !water.isDestroyed()) applyMode()
  })
}
function restorePreset(): void {
  Object.assign(config, createWaterPreset(presetName.value))
  applyOptions()
}
async function changeQuality(): Promise<void> {
  await nextTick()
  config.reflectionMaxSize =
    config.quality === 'low' ? 512 : config.quality === 'high' ? 1536 : 1024
  config.reflectionMaxFps =
    config.quality === 'low' ? 10 : config.quality === 'high' ? 30 : 15
  applyOptions()
}
function changeColor(event: Event): void {
  if (event.target instanceof HTMLInputElement) {
    config.waterColor = Cesium.Color.fromCssColorString(event.target.value)
    applyOptions()
  }
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
      ...config,
      normalMapUrl:
        import.meta.env.BASE_URL + 'cesium/Assets/Textures/waterNormals.jpg',
      onError: (value) => {
        reflectionNotice.value = String(value)
      },
    })
    applyMode()
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
    cameraPosition: viewer
      ? Cesium.Cartesian3.clone(viewer.camera.positionWC)
      : undefined,
    diagnostics: water?.getDiagnostics(),
    options: water?.getOptions(),
    mode: mode.value,
    cameraView: cameraView.value,
    shaderSource: water?.getWaterShaderSource(),
    visualTime: water?.material.uniforms.time,
    fps: fps.value,
  }),
  getWaterBounds: () => {
    if (!viewer || !ring || height.value === undefined) return undefined
    const points = ring
      .map((p) =>
        viewer?.scene.cartesianToCanvasCoordinates(
          Cesium.Cartesian3.fromDegrees(p[0], p[1], height.value),
        ),
      )
      .filter((p): p is Cesium.Cartesian2 => !!p)
    if (!points.length) return undefined
    const x = Math.max(355, Math.floor(Math.min(...points.map((p) => p.x)))),
      y = Math.max(0, Math.floor(Math.min(...points.map((p) => p.y))))
    const right = Math.min(
      viewer.canvas.clientWidth,
      Math.ceil(Math.max(...points.map((p) => p.x))),
    )
    const bottom = Math.min(
      viewer.canvas.clientHeight,
      Math.ceil(Math.max(...points.map((p) => p.y))),
    )
    return right > x && bottom > y
      ? { x, y, width: right - x, height: bottom - y }
      : undefined
  },
  focus,
  load,
  setMode: (value: 'imagery' | 'current' | 'enhanced') => {
    mode.value = value
    applyMode()
  },
  setPreset: (name: WaterPresetName) => {
    presetName.value = name
    restorePreset()
  },
  setOptions: (options: Partial<WaterPresetOptions>) => {
    if (!water) return
    water.setOptions({ ...config, ...options })
    Object.assign(config, options)
    mode.value = 'enhanced'
    water.show = true
  },
  setTime: (seconds: number) => water?.setVisualTime(seconds),
  freeze: () => {
    config.waveSpeed = 0
    if (water) water.setOptions({ waveSpeed: 0 })
  },
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
      shouldAnimate: false,
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
    let frames = 0,
      frameCount = 0,
      statsAt = performance.now()
    removePostRender = viewer.scene.postRender.addEventListener(() => {
      frameCount++
      const now = performance.now()
      if (now - statsAt >= 1000) {
        fps.value = Math.round((frameCount * 1000) / (now - statsAt))
        frameCount = 0
        statsAt = now
      }
      if (++frames % 15 === 0 && water)
        diagnostics.value = water.getDiagnostics()
    })
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
  removePostRender?.()
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
      <p>真实地形与官方湖岸 · 无实测流速，波纹表示风浪。</p>
      <label
        >对照显示
        <select v-model="mode" @change="applyMode">
          <option value="imagery">仅影像</option>
          <option value="current">当前水面（旧）</option>
          <option value="enhanced">可调多尺度水面</option>
        </select>
      </label>
      <div class="real-water__actions">
        <button @click="focus('near')">近景</button
        ><button @click="focus('overview')">俯瞰</button
        ><button @click="focus('far')">远景</button>
      </div>
      <label
        >默认预设<select v-model="presetName" @change="restorePreset">
          <option value="calm-lake">平静湖面</option>
          <option value="windy-lake">有风湖面</option>
        </select></label
      >
      <div class="real-water__actions">
        <button @click="restorePreset">恢复预设</button
        ><button @click="load">重新加载数据</button>
      </div>
      <fieldset>
        <legend>颜色与透光</legend>
        <label
          >水色<input
            type="color"
            :value="config.waterColor.toCssHexString()"
            @input="changeColor"
        /></label>
        <label for="water-waterAlpha">不透明度 <output>{{ config.waterAlpha.toFixed(2) }}</output
          ><input id="water-waterAlpha"
            v-model.number="config.waterAlpha"
            type="range"
            min="0.2"
            max="1"
            step="0.01"
            @input="applyOptions"
        /></label>
      </fieldset>
      <fieldset>
        <legend>波纹与动画</legend>
        <label for="water-waveLength">主波长 <output>{{ config.waveLength }} m</output
          ><input id="water-waveLength"
            v-model.number="config.waveLength"
            type="range"
            min="4"
            max="160"
            step="2"
            @input="applyOptions"
        /></label>
        <label for="water-waveStrength">整体强度 <output>{{ config.waveStrength.toFixed(2) }}</output
          ><input id="water-waveStrength"
            v-model.number="config.waveStrength"
            type="range"
            min="0"
            max="2"
            step="0.05"
            @input="applyOptions"
        /></label>
        <label for="water-detailStrength">细节强度 <output>{{ config.detailStrength.toFixed(2) }}</output
          ><input id="water-detailStrength"
            v-model.number="config.detailStrength"
            type="range"
            min="0"
            max="2"
            step="0.05"
            @input="applyOptions"
        /></label>
        <label for="water-waveIrregularity">波纹不规则度 <output>{{ config.waveIrregularity.toFixed(2) }}</output
          ><input id="water-waveIrregularity"
            v-model.number="config.waveIrregularity"
            type="range"
            min="0"
            max="1"
            step="0.05"
            @input="applyOptions"
        /></label>
        <label for="water-waveDirection">风浪方向 <output>{{ config.waveDirection }}°</output
          ><input id="water-waveDirection"
            v-model.number="config.waveDirection"
            type="range"
            min="0"
            max="360"
            step="5"
            @input="applyOptions"
        /></label>
        <label for="water-waveSpeed">动画速度 <output>{{ config.waveSpeed.toFixed(2) }}×</output
          ><input id="water-waveSpeed"
            v-model.number="config.waveSpeed"
            type="range"
            min="0"
            max="2"
            step="0.05"
            @input="applyOptions"
        /></label>
      </fieldset>
      <fieldset>
        <legend>反射与高光</legend>
        <label for="water-reflectionStrength"><input id="water-reflectionStrength"
            v-model="config.reflection"
            type="checkbox"
            @change="applyOptions"
          />
          场景反射（包括地形）</label
        >
        <label
          >反射强度 <output>{{ config.reflectionStrength.toFixed(2) }}</output
          ><input
            v-model.number="config.reflectionStrength"
            type="range"
            min="0"
            max="1"
            step="0.05"
            @input="applyOptions"
        /></label>
        <label for="water-reflectivity">基础反射率 <output>{{ config.reflectivity.toFixed(2) }}</output
          ><input id="water-reflectivity"
            v-model.number="config.reflectivity"
            type="range"
            min="0"
            max="0.5"
            step="0.01"
            @input="applyOptions"
        /></label>
        <label for="water-roughness">粗糙度 <output>{{ config.roughness.toFixed(2) }}</output
          ><input id="water-roughness"
            v-model.number="config.roughness"
            type="range"
            min="0"
            max="1"
            step="0.05"
            @input="applyOptions"
        /></label>
        <label for="water-specularIntensity">高光强度 <output>{{ config.specularIntensity.toFixed(2) }}</output
          ><input id="water-specularIntensity"
            v-model.number="config.specularIntensity"
            type="range"
            min="0"
            max="2"
            step="0.05"
            @input="applyOptions"
        /></label>
        <label for="water-distortionScale">倒影扰动 <output>{{ config.distortionScale.toFixed(1) }}</output
          ><input id="water-distortionScale"
            v-model.number="config.distortionScale"
            type="range"
            min="0"
            max="8"
            step="0.2"
            @input="applyOptions"
        /></label>
        <label
          >反射质量<select v-model="config.quality" @change="changeQuality">
            <option value="low">流畅</option>
            <option value="balanced">均衡</option>
            <option value="high">精细</option>
          </select></label
        >
        <p>
          {{
            diagnostics?.reflectionAvailable
              ? '场景反射已生效'
              : config.reflection && mode === 'enhanced'
                ? '反射准备中或已降级；请查看加载状态'
                : '场景反射已关闭'
          }}
        </p>
      </fieldset>
      <details>
        <summary>数据与渲染状态</summary>
        <dl>
          <dt>地形</dt>
          <dd>{{ terrainStatus }}</dd>
          <dt>水域</dt>
          <dd>{{ waterStatus }}</dd>
          <dt>影像</dt>
          <dd>{{ imageryStatus }}</dd>
        </dl>
        <label v-if="height !== undefined"
          >展示水位（服务场景高程，米）<input
            v-model.number="height"
            type="number"
            step="0.1"
            @change="setWaterHeight"
        /></label>
        <p>{{ heightNote }}</p>
        <p>
          反射 {{ diagnostics?.reflectionWidth ?? 0 }} ×
          {{ diagnostics?.reflectionHeight ?? 0 }} · 更新
          {{ diagnostics?.reflectionFrames ?? 0 }} 次 · 几何
          {{ diagnostics?.geometryCreated ?? 0 }} 份 · 主画面 {{ fps }} FPS
        </p>
        <p v-if="reflectionNotice || diagnostics?.error">
          {{ diagnostics?.error || reflectionNotice }}
        </p>
        <p>
          地形/影像 © swisstopo · 水域 ©
          FOEN/BAFU。局部裁剪边渐隐；源垂直基准未核定，此处不是实测水位或工程配准。
        </p>
      </details>
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
.real-water__panel select {
  width: 100%;
  margin-top: 6px;
  padding: 6px;
  color: #e1eded;
  background: #28464b;
  border: 1px solid #587d80;
}
.real-water__panel fieldset {
  margin-top: 16px;
  padding: 10px;
  border: 1px solid #52716f;
}
.real-water__panel legend {
  padding: 0 6px;
  font-size: 14px;
}
.real-water__panel input[type='range'] {
  width: 100%;
  display: block;
  margin-top: 6px;
}
.real-water__panel output {
  float: right;
  font-variant-numeric: tabular-nums;
}
.real-water__panel input[type='color'] {
  width: 45px;
  margin-left: 10px;
  height: 25px;
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
