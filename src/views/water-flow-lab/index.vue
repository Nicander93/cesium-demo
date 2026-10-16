<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import * as Cesium from 'cesium'
import { createCesiumFloodLayer, type CesiumFloodLayer, type FloodDiagnosticMode } from '../../flood/cesium'
import { createFlowFixture, createFixtureFrame, flowFixtureIds, type FlowFixtureId } from '../../flood/experiments/flow-fixtures'

const cesiumVersion = (Cesium as unknown as { VERSION: string }).VERSION
const fixtureChoices = flowFixtureIds.map(id => ({ id, name: createFlowFixture(id).name }))
const container = ref<HTMLElement>()
const fixtureId = ref<FlowFixtureId>('slow')
const diagnostic = ref<FloodDiagnosticMode>('water')
const algorithm = ref<'current' | 'basic' | 'flow'>('flow')
const particles = ref(false)
const withVelocity = ref(true)
const playing = ref(true)
const visualTime = ref(0)
const error = ref('')
const renderedFrames = ref(0)
const gpu = ref('尚未读取')
let fixture = createFlowFixture('slow')
let viewer: Cesium.Viewer | undefined
let layer: CesiumFloodLayer | undefined
let removePostRender: (() => void) | undefined
let removeRenderError: (() => void) | undefined
let raf = 0, lastTick = 0, lastPaint = -1
let arrows: Cesium.Entity[] = []

function paint(): void {
  if (!layer) return
  layer.setVisualOptions({ surfaceStyle: algorithm.value === 'flow' ? 'flow' : 'baseline', particles: particles.value, foamLifetime: algorithm.value === 'flow' ? 6 : 18 })
  layer.setDiagnosticMode(diagnostic.value)
  layer.update(createFixtureFrame(fixture, visualTime.value, withVelocity.value), false,
    diagnostic.value !== 'water' || algorithm.value !== 'basic')
  layer.animate(visualTime.value)
  arrows.forEach(arrow => { arrow.show = diagnostic.value === 'velocity' && withVelocity.value })
  viewer?.scene.requestRender()
}

function setCamera(kind: 'overview' | 'near' | 'far' = 'overview'): void {
  if (!viewer) return
  const matrix = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(...fixture.grid.origin))
  const target = Cesium.Matrix4.multiplyByPoint(matrix, new Cesium.Cartesian3(40, 64, 1), new Cesium.Cartesian3())
  viewer.camera.lookAt(target, new Cesium.HeadingPitchRange(0.18, kind === 'near' ? -0.42 : -1.05, kind === 'near' ? 80 : kind === 'far' ? 370 : 185))
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
}

function createArrows(): void {
  if (!viewer) return
  const matrix = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(...fixture.grid.origin))
  for (let y = 5; y < fixture.grid.rows - 5; y += 8) for (let x = 5; x < fixture.grid.columns - 5; x += 6) {
    const i = y * fixture.grid.columns + x
    if (fixture.frame.depth[i] < 0.04) continue
    const east = fixture.frame.velocityEast[i], north = fixture.frame.velocityNorth[i]
    const speed = Math.hypot(east, north)
    if (speed < 0.01) continue
    const px = (x + 0.5) * 2, py = (y + 0.5) * 2, z = fixture.grid.elevation[i] + fixture.frame.depth[i] + 0.4
    const positions = [[px, py, z], [px + east / speed * 5, py + north / speed * 5, z]].map(p =>
      Cesium.Matrix4.multiplyByPoint(matrix, new Cesium.Cartesian3(...p), new Cesium.Cartesian3()))
    arrows.push(viewer.entities.add({ show: false, polyline: { positions, width: 6,
      material: new Cesium.PolylineArrowMaterialProperty(Cesium.Color.WHITE) } }))
  }
}

function recreateLayer(): void {
  if (!viewer) return
  layer?.destroy()
  arrows.forEach(arrow => viewer?.entities.remove(arrow))
  arrows = []
  layer = createCesiumFloodLayer({ viewer, grid: fixture.grid })
  visualTime.value = 0
  lastPaint = -1
  createArrows()
  paint()
}

function changeFixture(): void {
  fixture = createFlowFixture(fixtureId.value)
  recreateLayer()
  setCamera()
}

function seek(time: number): void {
  if (!Number.isFinite(time) || time < 0 || time > 30) throw new Error('对照时间必须在 0–30 秒之间')
  layer?.resetVisuals()
  const step = 0.5
  for (let t = 0; t < time; t += step) {
    visualTime.value = t
    paint()
  }
  visualTime.value = time
  paint()
}

function changeAlgorithm(): void { seek(visualTime.value) }

function tick(now: number): void {
  const dt = lastTick ? Math.min(0.1, (now - lastTick) / 1000) : 0
  lastTick = now
  if (playing.value && layer) {
    visualTime.value += dt
    if (visualTime.value - lastPaint >= 0.1) { paint(); lastPaint = visualTime.value }
    else layer.animate(visualTime.value)
  }
  raf = requestAnimationFrame(tick)
}

function handleError(value: unknown): void {
  error.value = value instanceof Error ? value.message : String(value)
  playing.value = false
}

function disposeViewer(): void {
  removePostRender?.()
  removeRenderError?.()
  removePostRender = removeRenderError = undefined
  layer?.destroy()
  layer = undefined
  arrows = []
  viewer?.destroy()
  viewer = undefined
}

function createViewer(): void {
  disposeViewer()
  error.value = ''
  renderedFrames.value = 0
  if (!container.value) return
  try {
    viewer = new Cesium.Viewer(container.value, {
      baseLayer: false, terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false,
      sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false,
      infoBox: false, selectionIndicator: false, shouldAnimate: false,
      useBrowserRecommendedResolution: false, msaaSamples: 4,
    })
    viewer.scene.postProcessStages.fxaa.enabled = true
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#15242a')
    viewer.scene.globe.depthTestAgainstTerrain = true
    if (viewer.scene.skyBox) viewer.scene.skyBox.show = false
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = false
    if (viewer.scene.sun) viewer.scene.sun.show = false
    if (viewer.scene.moon) viewer.scene.moon.show = false
    const matrix = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(...fixture.grid.origin))
    const direction = Cesium.Matrix4.multiplyByPointAsVector(matrix, new Cesium.Cartesian3(-0.25, -0.9, -0.55), new Cesium.Cartesian3())
    viewer.scene.light = new Cesium.DirectionalLight({ direction, intensity: 1.5 })
    removePostRender = viewer.scene.postRender.addEventListener(() => { renderedFrames.value++ })
    removeRenderError = viewer.scene.renderError.addEventListener((_scene, value) => handleError(value))
    const gl = viewer.canvas.getContext('webgl2') ?? viewer.canvas.getContext('webgl')
    gpu.value = gl ? String(gl.getParameter(gl.RENDERER)) : '无法获取 WebGL 上下文'
    recreateLayer()
    setCamera()
  } catch (value) { handleError(value) }
}

// Development-only access to the same controls for real browser acceptance.
const lab = {
  getState: () => ({ fixture: fixtureId.value, diagnostic: diagnostic.value, algorithm: algorithm.value,
    playing: playing.value, particles: particles.value, withVelocity: withVelocity.value, time: visualTime.value,
    renderedFrames: renderedFrames.value, gpu: gpu.value, error: error.value,
    shaderSource: layer?.getWaterShaderSource(), cesiumVersion: cesiumVersion,
    viewerAlive: !!viewer && !viewer.isDestroyed(), layerAlive: !!layer && !layer.isDestroyed(),
    primitiveCount: viewer?.scene.primitives.length, entityCount: viewer?.entities.values.length }),
  setFixture: (id: FlowFixtureId) => { fixtureId.value = id; changeFixture() },
  setDiagnostic: (mode: FloodDiagnosticMode) => { diagnostic.value = mode; paint() },
  setAlgorithm: (value: 'current' | 'basic' | 'flow') => { algorithm.value = value; changeAlgorithm() },
  setParticles: (enabled: boolean) => { particles.value = enabled; paint() },
  setVelocity: (enabled: boolean) => { withVelocity.value = enabled; layer?.resetVisuals(); paint() },
  setPlaying: (enabled: boolean) => { playing.value = enabled },
  seek, setCamera, recreate: createViewer, dispose: disposeViewer,
}
declare global { interface Window { __waterFlowLab?: typeof lab } }
onMounted(() => {
  createViewer()
  if (import.meta.env.DEV) window.__waterFlowLab = lab
  raf = requestAnimationFrame(tick)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  if (window.__waterFlowLab === lab) delete window.__waterFlowLab
  disposeViewer()
})
</script>

<template>
  <div class="flow-lab">
    <div ref="container" class="flow-lab__canvas" />
    <aside class="flow-lab__panel">
      <RouterLink to="/">← 示例首页</RouterLink>
      <h1>水流渲染对照</h1>
      <p><RouterLink to="/flood-dynamic-lab">泄洪传播与退水实验 →</RouterLink></p>
      <RouterLink to="/water-real-terrain">查看真实地形与湖岸 →</RouterLink>
      <p>合成数据 · 无需 Ion、影像或 DEM</p>
      <label>固定工况
        <select v-model="fixtureId" @change="changeFixture">
          <option v-for="choice in fixtureChoices" :key="choice.id" :value="choice.id">{{ choice.name }}</option>
        </select>
      </label>
      <label>诊断视图
        <select v-model="diagnostic" @change="paint">
          <option value="water">水面</option><option value="velocity">速度场与方向箭头</option>
          <option value="foam-source">泡沫生成源</option><option value="foam">泡沫覆盖</option>
        </select>
      </label>
      <label>水流算法对照
        <select v-model="algorithm" @change="changeAlgorithm">
          <option value="flow">流场法线与局部泡沫（实验）</option><option value="current">旧细节水面</option><option value="basic">基础水面</option>
        </select>
      </label>
      <label class="flow-lab__check"><input v-model="withVelocity" type="checkbox" @change="layer?.resetVisuals(); paint()" />提供速度场</label>
      <label class="flow-lab__check"><input v-model="particles" type="checkbox" @change="paint" />显示流动粒子（独立对照）</label>
      <div class="flow-lab__actions">
        <button @click="playing = !playing">{{ playing ? '暂停' : '播放' }}</button>
        <button @click="playing = false; seek(0)">归零</button>
        <button @click="playing = false; seek(15)">固定 15 秒</button>
      </div>
      <div class="flow-lab__actions">
        <button @click="setCamera('overview')">俯瞰</button><button @click="setCamera('near')">近景</button>
        <button @click="createViewer">重建 Viewer</button>
      </div>
      <output class="flow-lab__time">{{ visualTime.toFixed(2) }} s · {{ playing ? '播放中' : '已冻结' }}</output>
      <p v-if="!withVelocity">缺少速度输入：关闭流向与输运，只显示基础波纹。</p>
      <p>{{ fixture.description }}</p>
      <p v-if="diagnostic === 'velocity'">速度色带 0–4 m/s；箭头仅表示方向。</p>
      <p v-if="diagnostic === 'foam-source'">蓝→黄：0–0.42 覆盖率/秒。{{ algorithm === 'flow' ? '实验来源：速度梯度、压缩与顺流水面落差。' : '旧来源：浅水与 Froude 数。' }}</p>
      <p v-if="diagnostic === 'foam'">蓝→黄：覆盖率 0–1。与泡沫生成源分别诊断。</p>
      <p>反射为天空近似；实验画质仍需评审。所有对照共享水深、速度、相机和时间。</p>
      <details><summary>渲染状态</summary><p>Cesium {{ cesiumVersion }} · {{ renderedFrames }} 帧</p><p>{{ gpu }}</p></details>
      <p v-if="error" role="alert" class="flow-lab__error">{{ error }}</p>
    </aside>
  </div>
</template>

<style scoped>
.flow-lab { position: fixed; inset: 0; overflow: hidden; color: #dce8e8; background: #15242a; }
.flow-lab__canvas { height: 100%; }
.flow-lab__panel { position: absolute; top: 16px; left: 16px; width: 300px; max-height: calc(100vh - 32px); overflow: auto; padding: 20px; background: rgba(13, 26, 31, .96); border: 1px solid #3c555c; border-radius: 6px; }
.flow-lab__panel h1 { font-size: 22px; margin: 16px 0 8px; }
.flow-lab__panel a { color: #a3d9d3; }
.flow-lab__panel p { font-size: 13px; line-height: 1.6; margin: 10px 0; color: #b3c8ca; }
.flow-lab__panel label { display: block; margin-top: 16px; font-size: 14px; }
.flow-lab__panel select { display: block; width: 100%; margin-top: 6px; padding: 8px; color: #dce8e8; background: #20373e; border: 1px solid #55727b; border-radius: 3px; }
.flow-lab__panel .flow-lab__check { display: flex; align-items: center; gap: 8px; }
.flow-lab__actions { display: flex; gap: 6px; margin-top: 14px; }
.flow-lab__actions button { flex: 1; padding: 8px 4px; border: 1px solid #5b7b80; border-radius: 3px; background: #29444b; color: #e1eeed; cursor: pointer; }
.flow-lab__actions button:hover { background: #3b5c62; }
.flow-lab__time { display: block; margin-top: 12px; font-variant-numeric: tabular-nums; }
.flow-lab__panel .flow-lab__error { color: #ffb5a8; }
@media (max-width: 700px) { .flow-lab__panel { width: 240px; max-height: 48vh; padding: 12px; } }
</style>
