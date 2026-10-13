<template>
  <div ref="container" class="water-demo__map" />
  <section class="water-controls" aria-label="水面设置">
    <label class="water-controls__row" for="water-height">水面高度
      <input id="water-height" v-model.number="waterHeight" type="number" min="0" max="1000" step="1" @change="updateHeight" /> 米
    </label>
    <label class="water-controls__row" for="water-opacity">水面不透明度
      <input id="water-opacity" v-model.number="waterAlpha" type="range" min="0.5" max="1" step="0.05" @input="updateOpacity" />
      <output for="water-opacity">{{ Math.round(waterAlpha * 100) }}%</output>
    </label>
    <label class="water-controls__row" for="water-quality">画质
      <select id="water-quality" v-model="quality" @change="updateQuality">
        <option value="low">流畅</option><option value="balanced">均衡</option><option value="high">精细</option>
      </select>
    </label>
    <label class="water-controls__row"><input v-model="reflection" type="checkbox" @change="updateReflection" /> 实时反射</label>
    <label class="water-controls__row"><input v-model="foam" type="checkbox" @change="updateFoam" /> 岸边浪花</label>
    <label v-if="foam" class="water-controls__row" for="foam-width">浪花宽度
      <input id="foam-width" v-model.number="foamWidth" type="range" min="0.5" max="6" step="0.5" @input="updateFoam" />
      <output for="foam-width">{{ foamWidth }} 米</output>
    </label>
    <div class="water-controls__actions"><button type="button" @click="focusWater">聚焦水面</button><button type="button" @click="focusShore">近岸视角</button><button type="button" :disabled="!tileset" @click="focusModel">聚焦模型</button></div>
    <p class="water-controls__status" role="status">{{ status }}</p>
    <p v-if="error" class="water-controls__error" role="alert">{{ error }}</p>
    <p v-if="diagnostics?.error" class="water-controls__error" role="status">{{ diagnostics.reflectionEnabled ? '反射正在恢复，可手动重试。' : '反射暂不可用，可手动重试。' }} <button type="button" @click="retryReflection">重试反射</button></p>
    <p v-if="diagnostics?.shoreError" class="water-controls__error" role="status">岸边采样暂不可用，正在重试。</p>
    <details class="water-controls__diagnostics">
      <summary>加载与性能</summary>
      <dl>
        <dt>水面首帧</dt><dd>{{ formatMs(diagnostics?.readyMs ?? null) }}</dd>
        <dt>模型元数据</dt><dd>{{ formatMs(modelReadyMs) }}</dd>
        <dt>反射尺寸</dt><dd>{{ diagnostics?.reflectionWidth ?? 0 }} × {{ diagnostics?.reflectionHeight ?? 0 }}</dd>
        <dt>反射目标创建</dt><dd>{{ diagnostics?.reflectionTargetsCreated ?? 0 }} 次</dd>
        <dt>几何创建</dt><dd>{{ diagnostics?.geometryCreated ?? 0 }} 次</dd>
        <dt>反射更新</dt><dd>{{ diagnostics?.reflectionFrames ?? 0 }} 次</dd>
        <dt>反射状态</dt><dd>{{ diagnostics?.reflectionAvailable ? '正常' : diagnostics?.error ? '恢复中' : '暂停' }}</dd>
        <dt>岸边采样</dt><dd>{{ diagnostics?.shoreWidth ?? 0 }} × {{ diagnostics?.shoreHeight ?? 0 }}</dd>
        <dt>岸边更新</dt><dd>{{ diagnostics?.shoreFrames ?? 0 }} 次</dd>
        <dt>最近反射 CPU 提交</dt><dd>{{ formatMs(diagnostics?.lastReflectionMs ?? null) }}</dd>
        <dt>当前帧率</dt><dd>{{ fps }} FPS</dd>
      </dl>
    </details>
  </section>
  <div class="camera-info">经度 {{ cameraInfo.longitude }}° · 纬度 {{ cameraInfo.latitude }}° · 高度 {{ cameraInfo.height }}m</div>
</template>

<script setup lang="ts">
import * as Cesium from 'cesium'
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { WaterSurface, type WaterQuality } from '../../water'

const container = ref<HTMLElement>()
const waterHeight = ref(44)
const quality = ref<WaterQuality>('high')
const waterAlpha = ref(1)
const reflection = ref(new URLSearchParams(window.location.search).get('reflection') !== 'off')
const foam = ref(true)
const foamWidth = ref(2)
const status = ref('正在初始化水面…')
const error = ref('')
const cameraInfo = ref({ longitude: 0, latitude: 0, height: 0 })
const diagnostics = shallowRef<ReturnType<WaterSurface['getDiagnostics']>>()
const modelReadyMs = ref<number | null>(null)
const fps = ref(0)
const tileset = shallowRef<Cesium.Cesium3DTileset>()
let viewer: Cesium.Viewer | undefined
let water: WaterSurface | undefined
let disposed = false
let removeCameraListener: (() => void) | undefined
let removeFrameListener: (() => void) | undefined
let removeModelProgress: (() => void) | undefined
let diagnosticsTimer: ReturnType<typeof setInterval> | undefined
const positions = [
  Cesium.Cartographic.fromDegrees(119.031533, 33.593063),
  Cesium.Cartographic.fromDegrees(119.030249, 33.592114),
  Cesium.Cartographic.fromDegrees(119.032524, 33.591157),
  Cesium.Cartographic.fromDegrees(119.033232, 33.592346),
  Cesium.Cartographic.fromDegrees(119.032454, 33.592552),
]

onMounted(() => {
  if (!container.value) return
  const started = performance.now()
  viewer = new Cesium.Viewer(container.value, {
    infoBox: false, fullscreenButton: false, vrButton: false, geocoder: false, homeButton: false,
    sceneModePicker: false, selectionIndicator: false, timeline: false, navigationHelpButton: false,
    animation: false, baseLayerPicker: false, baseLayer: false,
    useBrowserRecommendedResolution: false,
  })
  viewer.scene.globe.depthTestAgainstTerrain = false
  water = new WaterSurface({
    scene: viewer.scene, positions, height: waterHeight.value, quality: quality.value,
    rippleSize: 50, waterAlpha: waterAlpha.value, reflectivity: 0.3, sunShiny: 100, distortionScale: 3.7,
    reflection: reflection.value,
    foam: foam.value, foamWidth: foamWidth.value,
    normalMapUrl: `${import.meta.env.BASE_URL}img/waterNormals.jpg`,
    onError: reason => { console.warn('Water reflection will retry', reason) },
  })
  focusWater()
  updateCameraInfo()
  removeCameraListener = viewer.camera.moveEnd.addEventListener(updateCameraInfo)
  let frames = 0
  let lastFrameSample = performance.now()
  removeFrameListener = viewer.scene.postRender.addEventListener(() => {
    frames++
    const now = performance.now()
    if (now - lastFrameSample >= 1000) {
      fps.value = Math.round(frames * 1000 / (now - lastFrameSample))
      frames = 0
      lastFrameSample = now
    }
  })
  diagnosticsTimer = setInterval(() => { diagnostics.value = water?.getDiagnostics() }, 1000)
  void water.ready.then(ready => { if (ready && !disposed && modelReadyMs.value === null) status.value = '水面已显示，场景模型加载中…' })
  // Imagery and the context model are independent of water initialization.
  void loadImagery()
  void loadModel(started)
})

async function loadImagery(): Promise<void> {
  try {
    const provider = await Cesium.createWorldImageryAsync()
    if (!disposed && viewer) viewer.imageryLayers.addImageryProvider(provider)
  } catch { if (!disposed) error.value = '影像加载失败，水面和模型仍可使用。' }
}

async function loadModel(started: number): Promise<void> {
  let loaded: Cesium.Cesium3DTileset | undefined
  try {
    loaded = await Cesium.Cesium3DTileset.fromUrl('https://data.mars3d.cn/3dtiles/qx-simiao/tileset.json', { maximumScreenSpaceError: modelScreenSpaceError() })
    if (disposed || !viewer) { loaded.destroy(); return }
    modelReadyMs.value = performance.now() - started
    const center = Cesium.Cartographic.fromCartesian(loaded.boundingSphere.center)
    const surface = Cesium.Cartesian3.fromRadians(center.longitude, center.latitude, center.height)
    const offset = Cesium.Cartesian3.fromRadians(center.longitude, center.latitude, center.height + 110)
    loaded.modelMatrix = Cesium.Matrix4.fromTranslation(Cesium.Cartesian3.subtract(offset, surface, new Cesium.Cartesian3()))
    viewer.scene.primitives.add(loaded)
    tileset.value = loaded
    status.value = '水面已显示，模型细节加载中…'
    removeModelProgress = loaded.loadProgress.addEventListener((pending: number, processing: number) => {
      if (!disposed) status.value = pending + processing > 0 ? '水面已显示，模型细节加载中…' : '水面与场景已就绪'
    })
    viewer.scene.requestRender()
  } catch {
    if (loaded && !loaded.isDestroyed()) loaded.destroy()
    if (!disposed) { status.value = '水面已就绪'; error.value = '场景模型加载失败，可以继续查看和调整水面。' }
  }
}

function updateCameraInfo(): void {
  if (!viewer) return
  const position = viewer.camera.positionCartographic
  cameraInfo.value = { longitude: Number(Cesium.Math.toDegrees(position.longitude).toFixed(6)), latitude: Number(Cesium.Math.toDegrees(position.latitude).toFixed(6)), height: Math.round(position.height) }
}

function focusWater(): void {
  if (!viewer) return
  viewer.camera.lookAt(Cesium.Cartesian3.fromDegrees(119.0317, 33.5921, waterHeight.value), new Cesium.HeadingPitchRange(-0.4, -0.5, 450))
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
  updateCameraInfo()
}

function focusModel(): void {
  if (viewer && tileset.value) void viewer.zoomTo(tileset.value, new Cesium.HeadingPitchRange(-0.4, -0.5, tileset.value.boundingSphere.radius * 2.5))
}

function focusShore(): void {
  if (!viewer) return
  viewer.camera.lookAt(Cesium.Cartesian3.fromDegrees(119.0317, 33.5921, waterHeight.value), new Cesium.HeadingPitchRange(-0.4, -0.2, 150))
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
  updateCameraInfo()
}

function updateHeight(): void {
  if (typeof waterHeight.value !== 'number' || !Number.isFinite(waterHeight.value) || waterHeight.value < 0 || waterHeight.value > 1000) {
    waterHeight.value = water?.height ?? 44
    return
  }
  if (water) water.height = waterHeight.value
  diagnostics.value = water?.getDiagnostics()
}
function modelScreenSpaceError(): number { return quality.value === 'high' ? 4 : quality.value === 'balanced' ? 8 : 16 }
function updateQuality(): void {
  water?.setOptions({ quality: quality.value })
  if (tileset.value) tileset.value.maximumScreenSpaceError = modelScreenSpaceError()
  diagnostics.value = water?.getDiagnostics()
}
function updateOpacity(): void { water?.setOptions({ waterAlpha: waterAlpha.value }) }
function updateReflection(): void { water?.setOptions({ reflection: reflection.value }); diagnostics.value = water?.getDiagnostics() }
function retryReflection(): void { reflection.value = true; updateReflection() }
function updateFoam(): void { water?.setOptions({ foam: foam.value, foamWidth: foamWidth.value }); diagnostics.value = water?.getDiagnostics() }
function formatMs(value: number | null): string { return value === null ? '等待中' : `${Math.round(value * 10) / 10} ms` }

onBeforeUnmount(() => {
  disposed = true
  if (diagnosticsTimer) clearInterval(diagnosticsTimer)
  removeCameraListener?.()
  removeFrameListener?.()
  removeModelProgress?.()
  water?.destroy()
  water = undefined
  tileset.value = undefined
  viewer?.destroy()
  viewer = undefined
})
</script>

<style scoped>
.water-demo__map { position: absolute; inset: 0; }
.water-controls { position: absolute; top: 18px; right: 18px; width: 250px; padding: 14px; color: #eef5f4; background: rgb(15 28 30 / 88%); border: 1px solid rgb(255 255 255 / 18%); border-radius: 8px; font-size: 13px; }
.water-controls__row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.water-controls input[type=number] { width: 74px; }
.water-controls input[type=range] { min-width: 0; width: 80px; padding: 0; }
.water-controls output { font-variant-numeric: tabular-nums; }
.water-controls input, .water-controls select { padding: 4px 6px; color: #eef5f4; background: #253c3f; border: 1px solid #557073; border-radius: 4px; }
.water-controls__actions { display: flex; flex-wrap: wrap; gap: 6px; }
.water-controls button { padding: 5px 9px; border: 1px solid #557073; color: #eef5f4; background: #253c3f; border-radius: 4px; cursor: pointer; }
.water-controls button:disabled { opacity: .4; cursor: default; }
.water-controls__status { margin: 10px 0 0; color: #a9ceca; font-size: 12px; }
.water-controls__error { color: #ffd395; }
.water-controls__diagnostics { margin-top: 10px; font-size: 12px; }
.water-controls__diagnostics summary { cursor: pointer; }
.water-controls__diagnostics dl { display: grid; grid-template-columns: 1fr auto; gap: 5px; margin-bottom: 0; }
.water-controls__diagnostics dd { margin: 0; font-variant-numeric: tabular-nums; }
.camera-info { position: absolute; left: 18px; bottom: 30px; padding: 8px 12px; background: rgb(15 28 30 / 80%); color: #eef5f4; border-radius: 4px; font-size: 12px; }
@media (max-width: 520px) { .water-controls { top: 64px; right: 10px; width: 216px; } .camera-info { left: 10px; right: 10px; font-size: 11px; } }
</style>
