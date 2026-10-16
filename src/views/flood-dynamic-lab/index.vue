<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import * as Cesium from 'cesium'
import {
  createCesiumFloodLayer,
  type CesiumFloodLayer,
  type FloodSurfaceBackend,
  type FloodDiagnosticMode,
} from '../../flood/cesium'
import { createDischargeExperiment } from '../../flood/experiments/discharge'
import type { FloodFrame } from '../../flood/core/dataset'

const container = ref<HTMLElement>()
const backend = ref<FloodSurfaceBackend>('gpu'),
  diagnostic = ref<FloodDiagnosticMode>('water')
const playing = ref(false),
  time = ref(0),
  discharge = ref(12),
  until = ref(35)
const flow = ref(true),
  foam = ref(true),
  particles = ref(false),
  depthMode = ref(false),
  withVelocity = ref(true)
const error = ref(''),
  revision = ref(0)
let experiment = createDischargeExperiment(),
  frame = experiment.seek(0)
let viewer: Cesium.Viewer | undefined, layer: CesiumFloodLayer | undefined
let lastDiagnostic = 0
let raf = 0,
  lastTick = 0,
  lastPaint = 0,
  removeError: (() => void) | undefined
function paint(): void {
  if (!layer) return
  layer.setVisualOptions({
    flow: flow.value,
    foam: foam.value,
    particles: particles.value,
    surfaceStyle: 'flow',
    foamLifetime: 6,
  })
  layer.setDiagnosticMode(diagnostic.value)
  const input: FloodFrame = withVelocity.value
    ? frame
    : { time: frame.time, depth: frame.depth }
  layer.update(input, depthMode.value, true)
  layer.animate(time.value)
  viewer?.scene.requestRender()
  revision.value++
}
function seek(value: number): void {
  if (value < time.value) layer?.resetVisuals()
  frame = experiment.seek(value)
  time.value = value
  paint()
}
function seekPaused(value: number): void {
  playing.value = false
  seek(value)
}
function resetVisualsAndPaint(): void {
  layer?.resetVisuals()
  paint()
}
function setBackend(value: FloodSurfaceBackend): void {
  layer?.setSurfaceBackend(value)
  backend.value = value
  revision.value++
}
function camera(kind: 'near' | 'far' = 'far'): void {
  if (!viewer) return
  const matrix = Cesium.Transforms.eastNorthUpToFixedFrame(
    Cesium.Cartesian3.fromDegrees(...experiment.grid.origin),
  )
  const target = Cesium.Matrix4.multiplyByPoint(
    matrix,
    new Cesium.Cartesian3(24, 48, 3),
    new Cesium.Cartesian3(),
  )
  viewer.camera.lookAt(
    target,
    new Cesium.HeadingPitchRange(
      0.2,
      kind === 'near' ? -0.42 : -1.05,
      kind === 'near' ? 80 : 155,
    ),
  )
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
}
function reset(): void {
  playing.value = false
  try {
    const next = createDischargeExperiment(discharge.value, until.value)
    experiment = next
    frame = next.seek(0)
    time.value = 0
    layer?.resetVisuals()
    paint()
    error.value = ''
  } catch (value) {
    handleError(value)
  }
}
function handleError(value: unknown): void {
  error.value = String(value)
  playing.value = false
}
function dispose(hostFirst = false): void {
  removeError?.()
  removeError = undefined
  if (hostFirst) viewer?.destroy()
  layer?.destroy()
  layer = undefined
  if (!hostFirst) viewer?.destroy()
  viewer = undefined
}
function createViewer(): void {
  dispose()
  error.value = ''
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
    shouldAnimate: false,
    useBrowserRecommendedResolution: false,
    msaaSamples: 4,
  })
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#15242a')
  viewer.scene.globe.depthTestAgainstTerrain = true
  viewer.scene.postProcessStages.fxaa.enabled = true
  if (viewer.scene.skyBox) viewer.scene.skyBox.show = false
  if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false
  if (viewer.scene.sun) viewer.scene.sun.show = false
  if (viewer.scene.moon) viewer.scene.moon.show = false
  const matrix = Cesium.Transforms.eastNorthUpToFixedFrame(
    Cesium.Cartesian3.fromDegrees(...experiment.grid.origin),
  )
  const direction = Cesium.Matrix4.multiplyByPointAsVector(
    matrix,
    new Cesium.Cartesian3(-0.25, -0.9, -0.55),
    new Cesium.Cartesian3(),
  )
  viewer.scene.light = new Cesium.DirectionalLight({
    direction,
    intensity: 1.5,
  })
  removeError = viewer.scene.renderError.addEventListener((_scene, value) =>
    handleError(value),
  )
  layer = createCesiumFloodLayer({
    viewer,
    grid: experiment.grid,
    surfaceBackend: backend.value,
    visuals: { particles: false },
  })
  paint()
  camera()
}
function tick(now: number): void {
  const delta = lastTick ? Math.min(0.1, (now - lastTick) / 1000) : 0
  lastTick = now
  if (playing.value && now - lastPaint >= 100) {
    try {
      seek(Math.min(180, time.value + ((now - lastPaint) / 1000) * 4))
      if (time.value >= 180) playing.value = false
    } catch (value) {
      handleError(value)
    }
    lastPaint = now
  } else if (!playing.value) lastPaint = now
  if (delta && now - lastDiagnostic >= 250) {
    revision.value++
    lastDiagnostic = now
  }
  raf = requestAnimationFrame(tick)
}
function metrics() {
  let wetCells = 0,
    frontRow = -1,
    maximumDepth = 0
  frame.depth.forEach((h, i) => {
    maximumDepth = Math.max(maximumDepth, h)
    if (h >= 0.02) {
      wetCells++
      frontRow = Math.max(frontRow, Math.floor(i / experiment.grid.columns))
    }
  })
  return { wetCells, frontRow, maximumDepth, ...experiment.simulation.balance }
}
function state() {
  return {
    time: time.value,
    playing: playing.value,
    error: error.value,
    metrics: metrics(),
    diagnostics: layer?.getDiagnostics(),
    primitiveCount: viewer?.scene.primitives.length,
    viewerAlive: !!viewer && !viewer.isDestroyed(),
  }
}
const lab = {
  getTestContext: () => ({ viewer, layer, grid: experiment.grid }),
  getState: state,
  getFrame: () => structuredClone(frame),
  seek,
  setBackend,
  camera,
  reset,
  recreate: createViewer,
  dispose,
  setPlaying: (value: boolean) => {
    playing.value = value
  },
  setDepthMode: (value: boolean) => {
    depthMode.value = value
    paint()
  },
  setDiagnostic: (value: FloodDiagnosticMode) => {
    diagnostic.value = value
    paint()
  },
  setVelocity: (value: boolean) => {
    withVelocity.value = value
    layer?.resetVisuals()
    paint()
  },
  setVisuals: (value: {
    flow?: boolean
    foam?: boolean
    particles?: boolean
  }) => {
    if (value.flow !== undefined) flow.value = value.flow
    if (value.foam !== undefined) foam.value = value.foam
    if (value.particles !== undefined) particles.value = value.particles
    paint()
  },
}
declare global {
  interface Window {
    __floodDynamicLab?: typeof lab
  }
}
onMounted(() => {
  try {
    createViewer()
  } catch (value) {
    handleError(value)
  }
  if (import.meta.env.DEV) window.__floodDynamicLab = lab
  raf = requestAnimationFrame(tick)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  if (window.__floodDynamicLab === lab) delete window.__floodDynamicLab
  dispose()
})
</script>
<template>
  <main class="flood-lab">
    <div ref="container" class="flood-lab__canvas" />
    <aside class="flood-lab__panel" :data-revision="revision">
      <RouterLink to="/water-flow-lab">← 水流渲染对照</RouterLink>
      <h1>泄洪传播与退水</h1>
      <p>
        合成河道 · 持续入流至
        {{ until }} s，随后自然出流。计算与渲染独立，适用于技术验证。
      </p>
      <label
        >水面更新方式<select v-model="backend" @change="setBackend(backend)">
          <option value="gpu">GPU 状态纹理（实验）</option>
          <option value="primitive">Primitive 对照</option>
        </select></label
      >
      <label
        >入流量（m³/s）<input
          v-model.number="discharge"
          type="number"
          min="0"
          step="1"
      /></label>
      <label
        >停止入流时刻（s）<input
          v-model.number="until"
          type="number"
          min="0"
          max="180"
      /></label>
      <button
        @click="reset"
      >
        应用工况并归零
      </button>
      <label
        >时间 {{ time.toFixed(1) }} / 180 s<input
          :value="time"
          type="range"
          min="0"
          max="180"
          step="1"
          @input="seekPaused(Number(($event.target as HTMLInputElement).value))"
      /></label>
      <div class="flood-lab__actions">
        <button @click="playing = !playing">
          {{ playing ? '暂停' : '播放 ×4' }}</button
        ><button @click="camera('near')">近景</button
        ><button @click="camera('far')">远景</button>
      </div>
      <div class="flood-lab__actions">
        <button
          v-for="t in [10, 35, 60, 120, 180]"
          :key="t"
          @click="seekPaused(t)"
        >
          {{ t }} s
        </button>
      </div>
      <label
        ><input v-model="depthMode" type="checkbox" @change="paint" />
        水深诊断</label
      >
      <label
        ><input
          v-model="withVelocity"
          type="checkbox"
          @change="resetVisualsAndPaint"
        />
        提供流速</label
      >
      <label
        ><input v-model="flow" type="checkbox" @change="paint" />
        流动纹理</label
      >
      <label
        ><input v-model="foam" type="checkbox" @change="paint" /> 泡沫</label
      >
      <label
        ><input v-model="particles" type="checkbox" @change="paint" />
        粒子</label
      >
      <p>
        当前蓄水 {{ metrics().storedVolume.toFixed(2) }} m³ · 出流
        {{ metrics().dischargedVolume.toFixed(2) }} m³<br />水量误差
        {{ metrics().balanceError.toExponential(2) }} m³
      </p>
      <details open>
        <summary>更新诊断</summary>
        <pre>{{ layer?.getDiagnostics() }}</pre>
      </details>
      <p v-if="error" role="alert">{{ error }}</p>
    </aside>
  </main>
</template>
<style scoped>
.flood-lab {
  position: fixed;
  inset: 0;
  color: #dce8e8;
  background: #15242a;
}
.flood-lab__canvas {
  height: 100%;
}
.flood-lab__panel {
  position: absolute;
  top: 16px;
  left: 16px;
  width: 300px;
  max-height: calc(100vh - 72px);
  overflow: auto;
  padding: 20px;
  background: #0d1a1ff5;
  border: 1px solid #3c555c;
  border-radius: 6px;
}
.flood-lab__panel h1 {
  font-size: 22px;
}
.flood-lab__panel p {
  color: #b3c8ca;
  font-size: 13px;
  line-height: 1.6;
}
.flood-lab__panel a {
  color: #a3d9d3;
}
.flood-lab__panel label {
  display: block;
  margin: 12px 0;
  font-size: 14px;
}
.flood-lab__panel input[type='range'],
.flood-lab__panel select {
  display: block;
  width: 100%;
  margin-top: 6px;
}
.flood-lab__panel input[type='number'] {
  width: 70px;
  margin-left: 12px;
}
.flood-lab__panel button,
.flood-lab__panel select,
.flood-lab__panel input[type='number'] {
  padding: 7px;
  color: #dce8e8;
  background: #20373e;
  border: 1px solid #55727b;
  border-radius: 3px;
}
.flood-lab__actions {
  display: flex;
  gap: 8px;
  margin: 10px 0;
}
.flood-lab__panel button {
  cursor: pointer;
}
.flood-lab__panel pre {
  font-size: 11px;
  white-space: pre-wrap;
}
@media (max-width: 800px) {
  .flood-lab__panel {
    width: 230px;
  }
}
</style>
