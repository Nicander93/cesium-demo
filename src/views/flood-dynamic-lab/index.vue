<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, reactive } from 'vue'
import * as Cesium from 'cesium'
import {
  createCesiumFloodLayer,
  getFloodAppearancePreset,
  type FloodAppearanceOptions,
  sampleTerrainGrid,
  type CesiumFloodLayer,
  type FloodSurfaceBackend,
  type FloodDiagnosticMode,
} from '../../flood/cesium'
import {
  createDischargeExperiment,
  createTerrainDischargeExperiment,
} from '../../flood/experiments/discharge'
import { swissTerrainUrl, swissImageryUrl } from '../../water/terrain-water'
import { analyzeInundation } from '../../flood/core/analysis'
import type { FloodFrame } from '../../flood/core/dataset'

const appearance = reactive(getFloodAppearancePreset('muddy'))
const foamIntensity = ref(0.75),
  foamLifetime = ref(6)
function setAppearance(value: FloodAppearanceOptions = appearance): void {
  layer?.setAppearanceOptions(value)
  Object.assign(appearance, layer?.getAppearanceOptions() ?? value)
  revision.value++
}
function restoreAppearance(): void {
  setAppearance(getFloodAppearancePreset('muddy'))
}
const container = ref<HTMLElement>()
const environment = ref<'synthetic' | 'real'>(
  new URLSearchParams(location.search).get('environment') === 'real'
    ? 'real'
    : 'synthetic',
)
const frameMode = ref<'simulation' | 'level'>('simulation')
const loading = ref(false),
  terrainStatus = ref('未加载'),
  imageryStatus = ref('未加载')
const lightingModel = ref<'legacy' | 'microfacet'>('microfacet'),
  roughness = ref(0.32),
  lightIntensity = ref(1.5)
let realGrid:
  | ReturnType<typeof createTerrainDischargeExperiment>['grid']
  | undefined
let terrainController: AbortController | undefined,
  terrainRequest = 0
let removeImageryError: (() => void) | undefined
const backend = ref<FloodSurfaceBackend>('gpu'),
  diagnostic = ref<FloodDiagnosticMode>('water')
const playing = ref(false),
  time = ref(0),
  discharge = ref(12),
  until = ref(35)
const flow = ref(true),
  foam = ref(false),
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
    foamLifetime: foamLifetime.value,
    foamIntensity: foamIntensity.value,
  })
  layer.setDiagnosticMode(diagnostic.value)
  const renderFrame = frameMode.value === 'level' ? createLevelFrame() : frame
  const input: FloodFrame = withVelocity.value
    ? renderFrame
    : { time: renderFrame.time, depth: renderFrame.depth }
  layer.update(input, depthMode.value, true)
  layer.animate(time.value)
  viewer?.scene.requestRender()
  revision.value++
}
function createLevelFrame(): FloodFrame {
  const grid = experiment.grid
  let seed = 0
  for (let i = 1; i < grid.elevation.length; i++)
    if (grid.elevation[i] < grid.elevation[seed]) seed = i
  const depth = analyzeInundation(grid, {
    waterLevel: grid.elevation[seed] + 2,
    seedCells: [seed],
  }).depth
  return { time: time.value, depth }
}
function changeFrameMode(): void {
  playing.value = false
  if (frameMode.value === 'simulation') frame = experiment.seek(time.value)
  layer?.resetVisuals()
  paint()
}
function seek(value: number): void {
  if (value < time.value) layer?.resetVisuals()
  if (!Number.isFinite(value) || value < 0 || value > experiment.maximumTime)
    throw new RangeError('实验时间超出范围')
  if (frameMode.value === 'simulation') frame = experiment.seek(value)
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
  const grid = experiment.grid,
    row = Math.floor(grid.rows / 2)
  let column = Math.floor(grid.columns / 2)
  if (environment.value === 'real')
    for (let x = 1; x < grid.columns - 1; x++)
      if (
        grid.elevation[row * grid.columns + x] <
        grid.elevation[row * grid.columns + column]
      )
        column = x
  const target = Cesium.Matrix4.multiplyByPoint(
    matrix,
    new Cesium.Cartesian3(
      (column + 0.5) * grid.cellSize,
      (row + 0.5) * grid.cellSize,
      grid.elevation[row * grid.columns + column] + 3,
    ),
    new Cesium.Cartesian3(),
  )
  viewer.camera.lookAt(
    target,
    new Cesium.HeadingPitchRange(
      0.2,
      kind === 'near' ? -0.42 : -1.05,
      Math.hypot(experiment.grid.columns, experiment.grid.rows) *
        experiment.grid.cellSize *
        (kind === 'near' ? 0.75 : 1.45),
    ),
  )
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
}
function reset(): void {
  playing.value = false
  try {
    if (loading.value || (environment.value === 'real' && !realGrid)) return
    const next =
      environment.value === 'real'
        ? createTerrainDischargeExperiment(
            realGrid!,
            discharge.value,
            until.value,
          )
        : createDischargeExperiment(discharge.value, until.value)
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
  terrainController?.abort()
  terrainController = undefined
  terrainRequest++
  removeImageryError?.()
  removeImageryError = undefined
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
  loading.value = false
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
  if (environment.value === 'real') void loadEnvironment('real')
  else {
    createLayer()
    camera()
  }
}
function createLayer(): void {
  if (!viewer) return
  layer?.destroy()
  layer = createCesiumFloodLayer({
    viewer,
    grid: experiment.grid,
    surfaceBackend: backend.value,
    showGround: environment.value === 'synthetic',
    visuals: { particles: false },
    appearance: { ...appearance },
    lighting: { model: lightingModel.value, roughness: roughness.value },
  })
  paint()
}
function setLighting(): void {
  layer?.setLightingOptions({
    model: lightingModel.value,
    roughness: roughness.value,
  })
  if (viewer) {
    viewer.scene.light.intensity = lightIntensity.value
    viewer.scene.requestRender()
  }
}
async function loadEnvironment(value: 'synthetic' | 'real'): Promise<void> {
  if (!viewer) return
  terrainController?.abort()
  const controller = new AbortController(),
    request = ++terrainRequest,
    host = viewer
  terrainController = controller
  const current = () =>
    request === terrainRequest &&
    !controller.signal.aborted &&
    viewer === host &&
    !host.isDestroyed()
  environment.value = value
  playing.value = false
  loading.value = true
  error.value = ''
  time.value = 0
  layer?.destroy()
  layer = undefined
  realGrid = undefined
  removeImageryError?.()
  removeImageryError = undefined
  host.imageryLayers.removeAll()
  try {
    if (value === 'synthetic') {
      host.terrainProvider = new Cesium.EllipsoidTerrainProvider()
      host.scene.globe.enableLighting = false
      if (host.scene.skyAtmosphere) host.scene.skyAtmosphere.show = false
      const matrix = Cesium.Transforms.eastNorthUpToFixedFrame(
        Cesium.Cartesian3.fromDegrees(119, 33, 100),
      )
      const direction = Cesium.Matrix4.multiplyByPointAsVector(
        matrix,
        new Cesium.Cartesian3(-0.25, -0.9, -0.55),
        new Cesium.Cartesian3(),
      )
      host.scene.light = new Cesium.DirectionalLight({
        direction,
        intensity: lightIntensity.value,
      })
      discharge.value = 12
      until.value = 35
      experiment = createDischargeExperiment(discharge.value, until.value)
      terrainStatus.value = '合成地形'
      imageryStatus.value = '无影像'
    } else {
      terrainStatus.value = '加载 swisstopo 真实地形'
      imageryStatus.value = 'SWISSIMAGE 按需加载'
      host.clock.currentTime = Cesium.JulianDate.fromIso8601(
        '2026-06-21T10:00:00Z',
      )
      host.scene.light = new Cesium.SunLight({
        intensity: lightIntensity.value,
      })
      host.scene.globe.enableLighting = true
      if (host.scene.skyAtmosphere) host.scene.skyAtmosphere.show = true
      host.scene.atmosphere.dynamicLighting =
        Cesium.DynamicAtmosphereLightingType.SCENE_LIGHT
      const imagery = new Cesium.UrlTemplateImageryProvider({
        url: swissImageryUrl,
        minimumLevel: 5,
        maximumLevel: 19,
        rectangle: Cesium.Rectangle.fromDegrees(5.9, 45.8, 10.6, 47.9),
        credit: '© swisstopo SWISSIMAGE',
      })
      removeImageryError = imagery.errorEvent.addEventListener(() => {
        if (current()) imageryStatus.value = '影像瓦片请求失败'
      })
      host.imageryLayers.addImageryProvider(imagery)
      const layout = {
        columns: 64,
        rows: 64,
        cellSize: 8,
        origin: [7.907, 46.575, 0] as [number, number, number],
        elevation: [] as number[],
      }
      // Position the host camera while network sampling is pending; no synthetic water is shown here.
      host.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(7.907, 46.577, 1600),
        orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
      })
      const provider = await Cesium.CesiumTerrainProvider.fromUrl(
        swissTerrainUrl,
        { requestVertexNormals: true },
      )
      if (!current()) return
      host.terrainProvider = provider
      const sampled = await sampleTerrainGrid(provider, layout, {
        level: 17,
        signal: controller.signal,
        onProgress: (completed, total) => {
          if (current())
            terrainStatus.value = '采样真实高程 ' + completed + '/' + total
        },
      })
      if (!current()) return
      realGrid = sampled
      discharge.value = 80
      until.value = 60
      experiment = createTerrainDischargeExperiment(
        sampled,
        discharge.value,
        until.value,
      )
      terrainStatus.value =
        'swisstopo 地形 · ' +
        sampled.columns +
        '×' +
        sampled.rows +
        ' · 8 m · L17 固定采样'
    }
    frame = experiment.seek(0)
    createLayer()
    camera()
  } catch (value) {
    if (current()) {
      terrainStatus.value = '地形加载失败，停止生成水面'
      handleError(value)
    }
  } finally {
    if (current()) loading.value = false
  }
}
function tick(now: number): void {
  const delta = lastTick ? Math.min(0.1, (now - lastTick) / 1000) : 0
  lastTick = now
  if (playing.value && !loading.value && now - lastPaint >= 100) {
    try {
      seek(
        Math.min(
          experiment.maximumTime,
          time.value + ((now - lastPaint) / 1000) * 4,
        ),
      )
      if (time.value >= experiment.maximumTime) playing.value = false
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
    frameMode: frameMode.value,
    foam: foam.value,
    sourceCells: experiment.sourceCells,
    outlet: experiment.outlet,
    environment: environment.value,
    loading: loading.value,
    terrainStatus: terrainStatus.value,
    imageryStatus: imageryStatus.value,
    lighting: layer?.getLightingDiagnostics(),
    appearance: layer?.getAppearanceOptions(),
    tilesLoaded: viewer?.scene.globe.tilesLoaded,
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
  setAppearance,
  restoreAppearance,
  loadEnvironment,
  setFrameMode: (value: 'simulation' | 'level') => {
    frameMode.value = value
    changeFrameMode()
  },
  setLighting: (value: {
    model?: 'legacy' | 'microfacet'
    roughness?: number
    intensity?: number
    environmentIntensity?: number
    specularIntensity?: number
    skyEnvironment?: boolean
  }) => {
    if (value.model) lightingModel.value = value.model
    if (value.roughness !== undefined) roughness.value = value.roughness
    if (value.intensity !== undefined) lightIntensity.value = value.intensity
    setLighting()
    const { intensity: _intensity, ...options } = value
    layer?.setLightingOptions(options)
  },
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
        {{
          environment === 'real'
            ? '瑞士劳特布龙嫩 · 真实地形、假设泄洪'
            : '合成河道'
        }}
        · 持续入流至
        {{ until }} s，随后自然出流。计算与渲染独立，适用于技术验证。
      </p>
      <label
        >验证环境<select
          v-model="environment"
          @change="loadEnvironment(environment)"
        >
          <option value="synthetic">合成河道（诊断）</option>
          <option value="real">瑞士真实地形与影像</option>
        </select></label
      >
      <p v-if="environment === 'real'">
        {{ terrainStatus }}<br />{{ imageryStatus
        }}<br />地形采样不含实测河床、流速及边界条件；当前入流为假设工况。
      </p>
      <label
        >水面数据<select
          v-model="frameMode"
          :disabled="loading"
          @change="changeFrameMode"
        >
          <option value="simulation">假设泄洪推演</option>
          <option value="level">静水光照对照（低点以上 2 m）</option>
        </select></label
      >
      <p v-if="frameMode === 'level'">
        连通静水面用于单独检查光照，水位为人为设定，未运行推演。下方水量统计仍属于推演工况。
      </p>
      <details>
        <summary>光照原始参数</summary>
        <label
          >光照模型<select v-model="lightingModel" @change="setLighting">
            <option value="microfacet">GGX + 大气环境（无地形倒影）</option>
            <option value="legacy">旧材质对照</option>
          </select></label
        >
        <label
          >粗糙度 {{ roughness.toFixed(2)
          }}<input
            v-model.number="roughness"
            type="range"
            min="0.05"
            max="1"
            step="0.01"
            @input="setLighting"
        /></label>
        <label
          >宿主灯光强度 {{ lightIntensity.toFixed(2)
          }}<input
            v-model.number="lightIntensity"
            type="range"
            min="0"
            max="3"
            step="0.05"
            @input="setLighting"
        /></label>
      </details>
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
          :max="experiment.maximumTime"
      /></label>
      <button @click="reset" :disabled="loading">应用工况并归零</button>
      <label
        >时间 {{ time.toFixed(1) }} / {{ experiment.maximumTime }} s<input
          :value="time"
          type="range"
          min="0"
          :max="experiment.maximumTime"
          :disabled="loading"
          step="1"
          @input="
            seekPaused(Number(($event.target as HTMLInputElement).value))
          "
      /></label>
      <div class="flood-lab__actions">
        <button :disabled="loading || !layer" @click="playing = !playing">
          {{ playing ? '暂停' : '播放 ×4' }}</button
        ><button @click="camera('near')">近景</button
        ><button @click="camera('far')">远景</button>
      </div>
      <div class="flood-lab__actions">
        <button
          v-for="t in environment === 'real'
            ? [30, 60, 120, 300, 600]
            : [10, 35, 60, 120, 180]"
          :disabled="loading || !layer"
          :key="t"
          @click="seekPaused(t)"
        >
          {{ t }} s
        </button>
      </div>
      <details open>
        <summary>水色与外观</summary>
        <p>默认黄褐浑水；仅调整外观，不改变水深、流速和推演时间。</p>
        <label
          >浅水颜色
          <input
            v-model="appearance.shallowColor"
            type="color"
            @input="setAppearance()"
        /></label>
        <label
          >深水颜色
          <input
            v-model="appearance.deepColor"
            type="color"
            @input="setAppearance()"
        /></label>
        <label
          >泡沫颜色
          <input
            v-model="appearance.foamColor"
            type="color"
            @input="setAppearance()"
        /></label>
        <label
          >整体不透明度 {{ appearance.opacity.toFixed(2)
          }}<input
            v-model.number="appearance.opacity"
            type="range"
            min="0"
            max="1"
            step="0.01"
            @input="setAppearance()"
        /></label>
        <label
          >透光深度 {{ appearance.opacityDepth.toFixed(3) }} m<input
            v-model.number="appearance.opacityDepth"
            type="range"
            min="0.005"
            max="1"
            step="0.005"
            @input="setAppearance()"
        /></label>
        <p>透光深度越小，薄水层越能遮住底图；它不改变计算水深。</p>
        <label
          >日光体色强度 {{ appearance.bodyScattering.toFixed(2)
          }}<input
            v-model.number="appearance.bodyScattering"
            type="range"
            min="0"
            max="1"
            step="0.05"
            @input="setAppearance()"
        /></label>
        <label
          >色深过渡尺度 {{ appearance.colorDepth.toFixed(2) }} m<input
            v-model.number="appearance.colorDepth"
            type="range"
            min="0.05"
            max="10"
            step="0.05"
            @input="setAppearance()"
        /></label>
        <label
          >细波强度 {{ appearance.waveStrength.toFixed(2)
          }}<input
            v-model.number="appearance.waveStrength"
            type="range"
            min="0"
            max="3"
            step="0.05"
            @input="setAppearance()"
        /></label>
        <label
          >流动细节强度 {{ appearance.flowStrength.toFixed(2)
          }}<input
            v-model.number="appearance.flowStrength"
            type="range"
            min="0"
            max="3"
            step="0.05"
            @input="setAppearance()"
        /></label>
        <label
          >泡沫强度 {{ foamIntensity.toFixed(2)
          }}<input
            v-model.number="foamIntensity"
            type="range"
            min="0"
            max="1"
            step="0.05"
            @input="paint"
        /></label>
        <label
          >泡沫消散时间 {{ foamLifetime }} s<input
            v-model.number="foamLifetime"
            type="range"
            min="1"
            max="120"
            step="1"
            @input="paint"
        /></label>
        <button @click="restoreAppearance">恢复黄褐浑水外观</button>
      </details>
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
      <p v-if="frameMode === 'simulation'">
        当前蓄水 {{ metrics().storedVolume.toFixed(2) }} m³ · 出流
        {{ metrics().dischargedVolume.toFixed(2) }} m³<br />水量误差
        {{ metrics().balanceError.toExponential(2) }} m³
      </p>
      <details>
        <summary>更新诊断</summary>
        <pre>{{ layer?.getDiagnostics() }}</pre>
        <pre>{{ layer?.getLightingDiagnostics() }}</pre>
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
