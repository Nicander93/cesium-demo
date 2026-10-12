<script setup lang="ts">
import * as Cesium from 'cesium'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { analyzeFloodDataset, analyzeInundation, createFloodSimulation, createValleyGrid, interpolateFrame, parseFloodDataset, createCrossValleyWall, sampleDamBreach, type FloodDataset, type FloodFrame, type FloodGrid, type FloodBarriers, type FloodAnalysis, type FloodAnalysisMetric, type InundationResult, type FloodOutlet } from '../../flood/core'
import { createCesiumFloodLayer, sampleTerrainGrid, type CesiumFloodLayer } from '../../flood/cesium'
import { createDamBreachDemo, createRealValleyLayout, realValleyName, createTibetValleyLayout, tibetValleyName } from './scenarios'

const container = ref<HTMLDivElement>()
const mode = ref<'simulation' | 'replay'>('simulation')
const running = ref(false)
const controlsCollapsed = ref(false)
const discharge = ref(350)
const duration = ref(240)
const speed = ref(20)
const depthMode = ref(false)
const detailWater = ref(true)
const error = ref('')
const exampleUrl = `${import.meta.env.BASE_URL}flood-valley-example.json`
const status = ref('设置泄洪条件，然后开始推演。')
const frame = shallowRef<FloodFrame>({ time: 0, depth: [] })
const dataset = shallowRef<FloodDataset>()
const grid = shallowRef(createValleyGrid())
const storedVolume = ref(0)
const injectedVolume = ref(0)
const dischargedVolume = ref(0)
const balanceError = ref(0)
const selectedCell = ref<number>()
const wallEnabled = ref(false)
const wallHeight = ref(3)
const wallFlow = ref(0)
const initialVolume = ref(0)
const damEnabled = ref(false)
const breachStart = ref(30)
const breachFormation = ref(60)
const breachWidth = ref(72)
const breachProgress = ref(0)
const breachCurrentWidth = ref(0)
const displayMode = ref<'water' | 'inundation' | FloodAnalysisMetric>('water')
const analysis = shallowRef<FloodAnalysis>()
const inundation = shallowRef<InundationResult>()
const analysisThreshold = ref(0.1)
const inundationLevel = ref(32)
const connectedInundation = ref(true)
let damScenario: ReturnType<typeof createDamBreachDemo> | undefined
const terrainSource = ref('合成地形')
const terrainUrl = ref('')
const longitude = ref(119)
const latitude = ref(33)
const samplingLevel = ref(14)
const sampling = ref(false)
const terrainScenario = ref('')
const outlet = ref<FloodOutlet>('north')
const outletLabel = computed(() => outlet.value === 'north' ? '北' : '南')
const groundRange = computed(() => ({ min: Math.min(...grid.value.elevation), max: Math.max(...grid.value.elevation) }))
const downstreamWetArea = computed(() => (outlet.value === 'north'
  ? frame.value.depth.slice(Math.floor(grid.value.rows * 0.45) * grid.value.columns)
  : frame.value.depth.slice(0, Math.ceil(grid.value.rows * 0.55) * grid.value.columns)).filter(h => h >= 0.02).length * grid.value.cellSize ** 2)
let samplingController: AbortController | undefined
let terrainRequest = 0
let barriers: FloodBarriers | undefined
let sourceCells: number[] | undefined
let solver = createFloodSimulation({ grid: grid.value })
let viewer: Cesium.Viewer | undefined
let renderer: CesiumFloodLayer | undefined
let handler: Cesium.ScreenSpaceEventHandler | undefined
let animation = 0
let lastTick = 0
let lastPaint = 0
let lastRecord = 0
let recording: FloodFrame[] = [solver.snapshot()]
const maxTime = computed(() => mode.value === 'simulation' ? 1800 : dataset.value ? dataset.value.frames[dataset.value.frames.length - 1].time : 0)
const maxDepth = computed(() => frame.value.depth.reduce((max, h) => Math.max(max, h), 0))
const wetArea = computed(() => frame.value.depth.filter(h => h >= 0.02).length * grid.value.cellSize ** 2)
const selectedDepth = computed(() => selectedCell.value === undefined ? undefined : frame.value.depth[selectedCell.value])
const selectedSpeed = computed(() => {
  const i = selectedCell.value
  if (i === undefined || !frame.value.velocityEast || !frame.value.velocityNorth) return undefined
  return Math.hypot(frame.value.velocityEast[i], frame.value.velocityNorth[i])
})
const analysisLabels: Record<FloodAnalysisMetric, string> = { maximumDepth: '最大水深', arrivalTime: '首次到达时间', inundationDuration: '累计淹没时间' }
const analysisUnit = computed(() => displayMode.value === 'maximumDepth' ? 'm' : 's')
const analysisScale = computed(() => {
  const key = displayMode.value
  return key !== 'water' && key !== 'inundation' ? analysis.value?.[key].reduce<number>((max, value) => Math.max(max, value ?? 0), 0) ?? 0 : 0
})
const selectedAnalysis = computed(() => {
  const i = selectedCell.value
  const key = displayMode.value
  return i !== undefined && key !== 'water' && key !== 'inundation' ? analysis.value?.[key][i] : undefined
})

function currentResult(): FloodDataset {
  if (mode.value === 'replay' && dataset.value) return dataset.value
  const current = solver.snapshot()
  const frames = current.time > recording[recording.length - 1].time ? [...recording, current] : recording
  return solver.toDataset(frames, damEnabled.value ? `${terrainScenario.value || '合成山谷'}渐进溃坝工况` : terrainScenario.value ? `${terrainScenario.value}演示工况` : '小山谷演示工况')
}

function currentBreach() {
  const options = mode.value === 'replay' ? dataset.value?.structures?.damBreach : damScenario?.damBreach
  return options ? sampleDamBreach(options, frame.value.time) : undefined
}

function analyzeCurrent(): void {
  running.value = false
  error.value = ''
  try {
    if (displayMode.value === 'inundation') {
      const reservoirCell = damScenario?.initialDepth.findIndex(h => h > 0)
      const source = selectedCell.value ?? sourceCells?.[0] ?? (reservoirCell !== undefined && reservoirCell >= 0 ? reservoirCell : lowestUpstreamCell())
      const breach = currentBreach()
      inundation.value = analyzeInundation(grid.value, { waterLevel: inundationLevel.value,
        ...(connectedInundation.value ? { seedCells: [source] } : {}),
        ...(barriers ? { barriers } : {}), ...(breach ? { damBreach: breach } : {}) })
      status.value = connectedInundation.value ? '等水位连通分析已更新；点击地形可选择水源单元。' : '已显示所有低于给定水位的有效区域，包含孤立低洼地。'
    } else {
      analysis.value = analyzeFloodDataset(currentResult(), { depthThreshold: analysisThreshold.value })
      if (displayMode.value === 'water') displayMode.value = 'maximumDepth'
      status.value = '已分析完整输入成果；到达与持续时间按相邻成果帧线性插值。'
    }
    paint()
  } catch (e) { error.value = e instanceof Error ? e.message : '淹没分析失败' }
}

function lowestUpstreamCell(): number {
  const row = outlet.value === 'north' ? Math.min(3, grid.value.rows - 1) : Math.max(0, grid.value.rows - 4)
  let lowest = row * grid.value.columns
  for (let x = 1; x < grid.value.columns; x++) if (grid.value.elevation[row * grid.value.columns + x] < grid.value.elevation[lowest]) lowest = row * grid.value.columns + x
  return lowest
}

function changeDisplay(): void {
  if (displayMode.value === 'water') { paint(); return }
  analyzeCurrent()
}

function exportAnalysis(): void {
  const result = displayMode.value === 'inundation' ? inundation.value : analysis.value
  if (!result) return
  downloadJson({ ...result, grid: grid.value, coordinates: 'local-enu', verticalDatum: 'WGS84-ellipsoid', units: { length: 'm', time: 's', area: 'm2', volume: 'm3' } }, 'flood-analysis.json')
  status.value = '已导出分析 JSON，包含网格、高程基准、单位和逐单元结果。'
}

function paint(): void {
  renderer?.updateDamBreach(currentBreach())
  const key = displayMode.value
  if (key === 'inundation' && inundation.value) renderer?.updateInundation(inundation.value)
  else if (key !== 'water' && key !== 'inundation' && analysis.value) renderer?.updateAnalysis(analysis.value[key], analysisScale.value)
  else renderer?.update(frame.value, depthMode.value, detailWater.value)
}

function rebuildScene(): void {
  barriers = mode.value === 'replay' ? dataset.value?.structures?.barriers : damEnabled.value && damScenario ? damScenario.barriers : wallEnabled.value ? createCrossValleyWall(grid.value, wallHeight.value) : undefined
  renderer?.destroy()
  if (viewer) { renderer = createCesiumFloodLayer({ viewer, grid: grid.value, ...(barriers ? { barriers } : {}), showGround: terrainSource.value === '合成地形' || mode.value === 'replay' }); renderer.focus(damEnabled.value ? { padding: 1.6 } : undefined) }
}

function changeWall(): void { rebuildScene(); reset() }

function focusBreach(): void {
  const state = currentBreach()
  if (state) renderer?.focusBreach(state, outlet.value)
}

function focusDomain(): void { renderer?.focus(terrainScenario.value ? undefined : { padding: 1.6 }) }

function changeOutlet(): void {
  sourceCells = undefined
  if (damEnabled.value) changeBreach()
  else reset()
}

function setSource(): void {
  if (selectedCell.value === undefined) return
  sourceCells = [selectedCell.value]
  reset()
  status.value = `已将选中单元设为泄洪点；${outletLabel.value}侧为开放出口。`
}

function loadDamBreach(): void {
  switchToSimulation()
  damEnabled.value = true
  discharge.value = 0
  duration.value = 0
  speed.value = 5
  wallEnabled.value = false
  changeBreach()
  status.value = '坝后已有库水。开始后先保坝蓄水，再按设定时间扩展缺口；参数为假设工况。'
}

function changeBreach(): void {
  running.value = false
  try {
    const next = createDamBreachDemo(grid.value, { startTime: breachStart.value, formationTime: breachFormation.value, finalWidth: breachWidth.value,
      upstream: outlet.value === 'south' ? 'north' : 'south' })
    // Validate before replacing the visible scene.
    createFloodSimulation({ grid: grid.value, ...next })
    damScenario = next
    rebuildScene()
    reset()
    inundationLevel.value = damScenario.waterLevel
  } catch (e) { error.value = e instanceof Error ? e.message : '溃坝参数无效' }
}

async function loadRealValley(): Promise<void> {
  if (sampling.value) return
  const layout = createRealValleyLayout()
  longitude.value = layout.origin[0]
  latitude.value = layout.origin[1]
  terrainUrl.value = ''
  await loadTerrain(layout, realValleyName)
}

async function loadTibetValley(): Promise<void> {
  if (sampling.value) return
  const layout = createTibetValleyLayout()
  longitude.value = layout.origin[0]
  latitude.value = layout.origin[1]
  terrainUrl.value = ''
  await loadTerrain(layout, tibetValleyName, true)
}

async function loadTerrain(layoutOverride?: FloodGrid, scenarioName = '', breach = false): Promise<void> {
  if (!viewer || sampling.value) return
  if (!Number.isFinite(longitude.value) || Math.abs(longitude.value) > 180 || !Number.isFinite(latitude.value) || Math.abs(latitude.value) > 85) { error.value = '经纬度超出范围（纬度需在 ±85° 内）'; return }
  running.value = false
  error.value = ''
  sampling.value = true
  status.value = '正在加载 Cesium 地形服务；完成后采样计算区域。'
  const request = ++terrainRequest
  const controller = new AbortController()
  samplingController = controller
  try {
    const url = terrainUrl.value.trim()
    const provider = url ? await Cesium.CesiumTerrainProvider.fromUrl(url, { requestVertexNormals: true }) : await Cesium.createWorldTerrainAsync({ requestVertexNormals: true })
    if (request !== terrainRequest || controller.signal.aborted) return
    const layout = layoutOverride ?? createValleyGrid()
    layout.origin = [longitude.value, latitude.value, 0]
    const next = await sampleTerrainGrid(provider, layout, {
      ...(provider.availability ? {} : { level: samplingLevel.value }),
      signal: controller.signal,
      onProgress: (done, total) => { status.value = `地形采样 ${done}/${total}；完成后重新推演。` },
    })
    const nextOutlet: FloodOutlet = scenarioName === tibetValleyName ? 'south' : scenarioName === realValleyName ? 'north' : outlet.value
    const nextDam = breach ? createDamBreachDemo(next, { startTime: breachStart.value, formationTime: breachFormation.value,
      finalWidth: breachWidth.value, upstream: nextOutlet === 'south' ? 'north' : 'south' }) : undefined
    createFloodSimulation({ grid: next, outlet: nextOutlet, ...(nextDam ? nextDam : {}) })
    const imagery = scenarioName
      ? await Cesium.createWorldImageryAsync().catch(() => undefined) : undefined
    if (request !== terrainRequest || !viewer) return
    viewer.imageryLayers.removeAll()
    if (imagery) viewer.imageryLayers.addImageryProvider(imagery)
    viewer.terrainProvider = provider
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#536b5b')
    viewer.scene.globe.enableLighting = true
    grid.value = next
    damEnabled.value = breach
    damScenario = nextDam
    outlet.value = nextOutlet
    terrainScenario.value = scenarioName
    if (scenarioName) {
      discharge.value = breach ? 0 : 350
      duration.value = breach ? 0 : 240
      speed.value = breach ? 20 : speed.value
      wallEnabled.value = false
    }
    terrainSource.value = `${url ? '自定义 TerrainProvider' : 'Cesium World Terrain'} · ${provider.availability ? '最详细可用层级' : `层级 ${samplingLevel.value}`}`
    mode.value = 'simulation'
    dataset.value = undefined
    sourceCells = undefined
    selectedCell.value = undefined
    inundationLevel.value = nextDam?.waterLevel ?? next.elevation[lowestUpstreamCell()] + 8
    rebuildScene()
    reset()
    status.value = `${scenarioName ? `${scenarioName}已载入。` : ''}计算与显示共用 ${url ? '自定义 TerrainProvider' : 'Cesium World Terrain'}；${breach ? '北侧预置假设库水，按缺口发展向南下泄。坝体与蓄水为假设设置。' : `从上游低点泄洪，${outletLabel.value}侧开放排水。`}${scenarioName && !imagery ? '底图影像不可用，使用地形配色。' : ''}`
  } catch (e) {
    if (request === terrainRequest && !controller.signal.aborted) error.value = e instanceof Error ? e.message : '地形加载失败'
  } finally { if (request === terrainRequest) sampling.value = false }
}

function cancelSampling(): void {
  terrainRequest++
  samplingController?.abort()
  sampling.value = false
}

function updateState(next: FloodFrame): void {
  frame.value = next
  storedVolume.value = next.depth.reduce((sum, h) => sum + h, 0) * grid.value.cellSize ** 2
  if (mode.value === 'simulation') {
    const balance = solver.balance
    initialVolume.value = balance.initialVolume
    injectedVolume.value = balance.injectedVolume
    dischargedVolume.value = balance.dischargedVolume
    balanceError.value = balance.balanceError
    wallFlow.value = balance.wallDischarge
    breachProgress.value = solver.breachState?.progress ?? 0
    breachCurrentWidth.value = solver.breachState?.width ?? 0
  }
}

function reset(): void {
  running.value = false
  error.value = ''
  displayMode.value = 'water'
  analysis.value = undefined
  inundation.value = undefined
  if (mode.value === 'simulation') {
    solver = createFloodSimulation({ grid: grid.value, outlet: outlet.value, ...(barriers ? { barriers } : {}), ...(sourceCells ? { sourceCells } : {}),
      ...(damEnabled.value && damScenario ? { initialDepth: damScenario.initialDepth, damBreach: damScenario.damBreach } : {}) })
    recording = [solver.snapshot()]
    lastRecord = 0
    updateState(solver.snapshot())
    status.value = '设置泄洪条件，然后开始推演。'
  } else if (dataset.value) { updateState(dataset.value.frames[0]); status.value = '已回到成果首帧。' }
  paint()
}

function toggleRunning(): void {
  if (displayMode.value !== 'water') { displayMode.value = 'water'; paint() }
  if (frame.value.time >= maxTime.value) reset()
  running.value = !running.value
  status.value = running.value ? mode.value === 'simulation' ? damEnabled.value ? '正在计算库水下泄，缺口按预设时间发展。' : '水量计算中；到达设定时长后自动停止泄洪。' : '播放外部模型成果。' : '已暂停。'
}

function stepSimulation(): void {
  if (running.value || sampling.value || mode.value !== 'simulation') return
  displayMode.value = 'water'
  solver.setInflow({ discharge: discharge.value, until: duration.value })
  updateState(solver.advance(Math.min(10, maxTime.value - solver.time)))
  if (frame.value.time > recording[recording.length - 1].time) { recording.push(frame.value); lastRecord = frame.value.time }
  paint()
  status.value = '已推进 10 秒；可继续单步观察缺口与下游传播。'
}

function stopRelease(): void {
  duration.value = solver.time
  status.value = '泄洪已停止，已有水量继续向下游流动。'
}

function setScenario(burst: boolean): void {
  reset()
  discharge.value = burst ? 1200 : 350
  duration.value = burst ? 60 : 240
}

function switchToSimulation(): void {
  cancelSampling()
  running.value = false
  mode.value = 'simulation'
  dataset.value = undefined
  grid.value = createValleyGrid()
  outlet.value = 'north'
  damEnabled.value = false
  damScenario = undefined
  terrainSource.value = '合成地形'
  terrainScenario.value = ''
  sourceCells = undefined
  if (viewer) {
    viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider()
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#15242a')
    viewer.scene.globe.enableLighting = false
    viewer.imageryLayers.removeAll()
  }
  selectedCell.value = undefined
  rebuildScene()
  reset()
}

async function importResult(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  error.value = ''
  try {
    if (file.size > 80 * 1024 * 1024) throw new Error('文件过大，请先裁剪区域或减少时间帧（上限 80 MB）')
    const next = parseFloodDataset(JSON.parse(await file.text()))
    cancelSampling()
    running.value = false
    mode.value = 'replay'
    dataset.value = next
    grid.value = next.grid
    damEnabled.value = false
    damScenario = undefined
    displayMode.value = 'water'
    analysis.value = undefined
    inundation.value = undefined
    inundationLevel.value = Math.min(...next.grid.elevation) + 8
    if (viewer) {
      viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider()
      viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#15242a')
      viewer.scene.globe.enableLighting = false
      viewer.imageryLayers.removeAll()
    }
    selectedCell.value = undefined
    rebuildScene()
    updateState(next.frames[0])
    paint()
    status.value = `已载入 ${next.name}，共 ${next.frames.length} 帧。`
  } catch (e) { error.value = e instanceof Error ? e.message : '导入失败' }
  finally { input.value = '' }
}

function seek(event: Event): void {
  if (!dataset.value) return
  updateState(interpolateFrame(dataset.value.frames, Number((event.target as HTMLInputElement).value)))
  paint()
}

function exportResult(): void {
  const result = currentResult()
  downloadJson(result, 'valley-flood.json')
  status.value = '已导出标准 JSON，可通过“导入成果”再次播放；坝体与溃口参数随成果保存。'
}

function downloadJson(result: unknown, filename: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(result)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function tick(now: number): void {
  animation = requestAnimationFrame(tick)
  renderer?.animate(now / 1000)
  if (now - lastTick < 100) return
  const elapsed = lastTick ? Math.min((now - lastTick) / 1000, 0.2) : 0
  lastTick = now
  if (!running.value) return
  try {
    const seconds = Math.min(elapsed * speed.value, maxTime.value - frame.value.time)
    if (mode.value === 'simulation') {
      solver.setInflow({ discharge: discharge.value, until: duration.value })
      updateState(solver.advance(seconds))
      if (solver.time - lastRecord >= 10) { recording.push(frame.value); lastRecord = solver.time }
    } else if (dataset.value) updateState(interpolateFrame(dataset.value.frames, frame.value.time + seconds))
    if (now - lastPaint >= 250) { paint(); lastPaint = now }
    if (frame.value.time >= maxTime.value - 1e-6) { running.value = false; paint(); status.value = '已到达最后时刻。' }
  } catch (e) { running.value = false; error.value = e instanceof Error ? e.message : '推演失败' }
}

onMounted(() => {
  try {
    if (!container.value) return
    viewer = new Cesium.Viewer(container.value, {
      baseLayer: false, terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      animation: false, timeline: false, baseLayerPicker: false, geocoder: false,
      homeButton: false, sceneModePicker: false, navigationHelpButton: false,
      fullscreenButton: false, infoBox: false, selectionIndicator: false,
    })
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#15242a')
    viewer.scene.globe.depthTestAgainstTerrain = true
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#14212a')
    viewer.scene.skyBox.show = false
    viewer.scene.sun.show = false
    viewer.scene.moon.show = false
    viewer.scene.skyAtmosphere.show = false
    viewer.scene.light = new Cesium.DirectionalLight({ direction: new Cesium.Cartesian3(-0.5, -0.3, -0.8), intensity: 1.5 })
    const scene = new URLSearchParams(window.location.search).get('scene')
    if (scene === 'synthetic-breach' || scene === 'synthetic') {
      renderer = createCesiumFloodLayer({ viewer, grid: grid.value })
      renderer.focus()
    }
    updateState(solver.snapshot())
    handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas)
    handler.setInputAction((movement: { position: Cesium.Cartesian2 }) => {
      if (!viewer) return
      const position = viewer.scene.pickPosition(movement.position)
      if (!position) { selectedCell.value = undefined; return }
      const matrix = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(...grid.value.origin))
      const local = Cesium.Matrix4.multiplyByPoint(Cesium.Matrix4.inverseTransformation(matrix, new Cesium.Matrix4()), position, new Cesium.Cartesian3())
      const x = Math.floor(local.x / grid.value.cellSize)
      const y = Math.floor(local.y / grid.value.cellSize)
      const index = y * grid.value.columns + x
      selectedCell.value = x >= 0 && x < grid.value.columns && y >= 0 && y < grid.value.rows && grid.value.active?.[index] !== false ? index : undefined
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
    animation = requestAnimationFrame(tick)
    if (scene === 'real-valley') void loadRealValley()
    else if (scene === 'synthetic-breach') loadDamBreach()
    else if (scene !== 'synthetic') { terrainSource.value = '正在加载 Cesium 世界地形'; void loadTibetValley() }
  } catch (e) { error.value = e instanceof Error ? e.message : 'Cesium 初始化失败' }
})

onBeforeUnmount(() => {
  cancelSampling()
  cancelAnimationFrame(animation)
  handler?.destroy()
  renderer?.destroy()
  if (viewer && !viewer.isDestroyed()) viewer.destroy()
})
</script>

<template>
  <section class="flood-demo">
    <div ref="container" class="flood-demo__scene" />
    <button class="flood-demo__toggle" :aria-expanded="!controlsCollapsed" @click="controlsCollapsed = !controlsCollapsed">{{ controlsCollapsed ? '展开控制' : '收起控制' }}</button>
    <aside v-show="!controlsCollapsed" class="flood-demo__panel" aria-label="洪水推演控制">
      <p class="flood-demo__eyebrow">CESIUM · FLOOD LAB</p>
      <h1>{{ mode === 'simulation' ? damEnabled ? '渐进溃坝推演' : '地形洪水推演' : '洪水成果回放' }}</h1>
      <p class="flood-demo__intro">{{ mode === 'simulation' ? `局部惯性浅水近似 · ${terrainSource}` : '外部模型成果 · 标准网格回放' }}</p>
      <div class="flood-demo__actions">
        <button :disabled="!viewer || sampling" @click="toggleRunning">{{ running ? '暂停' : mode === 'simulation' ? damEnabled ? '开始溃坝' : '开始推演' : '播放成果' }}</button>
        <button class="flood-demo__secondary" :disabled="sampling" @click="reset">重置</button>
      </div>
      <template v-if="mode === 'simulation'">
        <button class="flood-demo__secondary flood-demo__wide" :disabled="running || sampling || frame.time >= maxTime" @click="stepSimulation">推进 10 秒</button>
        <button class="flood-demo__secondary flood-demo__wide" :disabled="sampling" @click="loadTibetValley">西藏真实地形溃坝</button>
        <button class="flood-demo__secondary flood-demo__wide" :disabled="sampling" @click="loadRealValley">瑞士真实山谷（泄洪）</button>
        <button class="flood-demo__secondary flood-demo__wide flood-demo__scenario" :disabled="sampling" @click="loadDamBreach">溃坝原理示例（合成山谷）</button>
        <details v-if="damEnabled" class="flood-demo__terrain" open>
          <summary>溃口设置</summary>
          <div class="flood-demo__actions"><button class="flood-demo__secondary" @click="focusBreach">查看坝口</button><button class="flood-demo__secondary" @click="focusDomain">查看全域</button></div>
          <label>开始破坏时刻（s）<input v-model.number="breachStart" type="number" min="0" step="10" @change="changeBreach" /></label>
          <label>缺口形成时间（s）<input v-model.number="breachFormation" type="number" min="1" step="10" @change="changeBreach" /></label>
          <label>最终缺口宽度（m）<input v-model.number="breachWidth" type="number" min="1" max="144" step="12" @change="changeBreach" /></label>
          <p>缺口进度 {{ (breachProgress * 100).toFixed(0) }}% · 当前宽度 {{ breachCurrentWidth.toFixed(1) }} m<br />当前过坝流量 {{ Math.abs(wallFlow).toFixed(2) }} m³/s（{{ Math.abs(wallFlow) < 1e-6 ? '无净流' : wallFlow < 0 ? '向南' : '向北' }}）<br />初始库水 {{ Math.round(initialVolume).toLocaleString() }} m³；缺口逐渐拓宽、降低。改变参数会重置库水。</p>
        </details>
        <p v-if="terrainScenario" class="flood-demo__balance">{{ terrainScenario }} · {{ grid.columns * grid.cellSize }} × {{ grid.rows * grid.cellSize }} m<br />采样高程 {{ groundRange.min.toFixed(1) }}–{{ groundRange.max.toFixed(1) }} m（局部 ENU）<br />真实地形，假设泄洪工况。</p>
        <details class="flood-demo__terrain">
          <summary>Cesium 地形与泄洪点</summary>
          <label>原点经度<input v-model.number="longitude" type="number" step="0.001" /></label>
          <label>原点纬度<input v-model.number="latitude" type="number" step="0.001" /></label>
          <label>地形服务 URL（留空使用世界地形）<input v-model="terrainUrl" type="text" placeholder="https://…/terrain/" /></label>
          <label>无可用层级信息时的采样层级<input v-model.number="samplingLevel" type="number" min="0" max="24" /></label>
          <label>下游开放出口<select v-model="outlet" :disabled="sampling" @change="changeOutlet"><option value="north">北侧</option><option value="south">南侧</option></select></label>
          <button v-if="!sampling" class="flood-demo__secondary flood-demo__wide" @click="loadTerrain()">加载并采样地形</button>
          <button v-else class="flood-demo__secondary flood-demo__wide" @click="cancelSampling">取消采样</button>
          <button class="flood-demo__secondary flood-demo__wide" :disabled="selectedCell === undefined || sampling || damEnabled" @click="setSource">选中单元设为泄洪点</button>
          <p>网格从原点向东、向北延伸。改变地形或挡墙会重置推演；世界地形使用项目的 Cesium ion 凭据。</p>
          <button class="flood-demo__secondary flood-demo__wide" @click="switchToSimulation">恢复合成山谷</button>
        </details>
        <template v-if="!damEnabled">
        <label class="flood-demo__check"><input v-model="wallEnabled" type="checkbox" :disabled="sampling" @change="changeWall" />启用横谷挡墙</label>
        <label v-if="wallEnabled" class="flood-demo__field">墙高（相对相邻地面）<output>{{ wallHeight }} m</output><input v-model.number="wallHeight" aria-label="墙高" type="range" min="0.5" max="10" step="0.5" :disabled="sampling" @change="changeWall" /></label>
        <p v-if="wallEnabled" class="flood-demo__balance">水位超过各段墙顶后漫流；当前过墙流量 {{ wallFlow.toFixed(2) }} m³/s（正值向北）。</p>
        <label class="flood-demo__field">泄洪流量 <output>{{ discharge }} m³/s</output><input v-model.number="discharge" aria-label="泄洪流量" type="range" min="0" max="1500" step="50" /></label>
        <label class="flood-demo__field">泄洪持续时间 <output>{{ Math.round(duration) }} s</output><input v-model.number="duration" aria-label="泄洪持续时间" type="range" min="0" max="600" step="30" /></label>
        <button class="flood-demo__secondary flood-demo__wide" @click="stopRelease">停止泄洪，继续排水</button>
        <div class="flood-demo__actions"><button class="flood-demo__secondary" @click="setScenario(false)">持续泄洪</button><button class="flood-demo__secondary" @click="setScenario(true)">短时大流量</button></div>
        </template>
      </template>
      <template v-else>
        <label class="flood-demo__field">时间轴 <output>{{ frame.time.toFixed(1) }} s</output><input :value="frame.time" aria-label="成果时间轴" type="range" :min="dataset?.frames[0].time ?? 0" :max="maxTime" step="0.1" @input="seek" /></label>
        <button class="flood-demo__secondary flood-demo__wide" @click="switchToSimulation">返回内置推演</button>
      </template>
      <label class="flood-demo__field">时间倍率 <output>{{ speed }}×</output><input v-model.number="speed" aria-label="时间倍率" type="range" min="1" max="60" step="1" /></label>
      <label class="flood-demo__select">显示内容<select v-model="displayMode" :disabled="sampling" @change="changeDisplay">
        <option value="water">动态水面</option><option value="maximumDepth">成果分析：最大水深</option><option value="arrivalTime">成果分析：首次到达时间</option><option value="inundationDuration">成果分析：累计淹没时间</option><option value="inundation">指定水位：连通淹没</option>
      </select></label>
      <details class="flood-demo__terrain" :open="displayMode !== 'water'">
        <summary>淹没分析</summary>
        <template v-if="displayMode === 'inundation'">
          <label>水位（局部 ENU 米）<input v-model.number="inundationLevel" type="number" step="0.5" /></label>
          <label class="flood-demo__check"><input v-model="connectedInundation" type="checkbox" />只分析与水源连通的区域</label>
          <p>水源为点击选中的单元；未选择时使用库水单元或上游低点。地形与挡墙隔开的低洼处不会自动进水；水位需高于墙顶才连通。</p>
        </template>
        <template v-else>
          <label>淹没水深阈值（m）<input v-model.number="analysisThreshold" type="number" min="0.001" step="0.1" /></label>
          <p>分析输入成果中的全部时间帧。内置推演约每 10 秒记录一帧；初始已淹没的单元到达时间记为首帧时间。</p>
        </template>
        <button class="flood-demo__secondary flood-demo__wide" :disabled="sampling" @click="analyzeCurrent">计算 / 更新淹没分析</button>
        <button class="flood-demo__secondary flood-demo__wide" :disabled="displayMode === 'water' || (displayMode === 'inundation' ? !inundation : !analysis)" @click="exportAnalysis">导出分析 JSON</button>
      </details>
      <template v-if="displayMode === 'water'">
        <label class="flood-demo__check"><input v-model="depthMode" type="checkbox" @change="paint" />显示水深配色</label>
        <label class="flood-demo__check"><input v-model="detailWater" type="checkbox" @change="paint" />细节水面（关闭对比基础效果）</label>
        <p v-if="detailWater && !depthMode" class="flood-demo__balance">波浪法线 · 流速驱动细节 · 岸边泡沫 · 天空近似反射；细节不改变计算水量。</p>
      </template>
      <div v-if="displayMode === 'water'" class="flood-demo__metrics">
        <div><span>模拟时间</span><strong>{{ frame.time.toFixed(1) }} <small>s</small></strong></div>
        <div><span>最大水深</span><strong>{{ maxDepth.toFixed(2) }} <small>m</small></strong></div>
        <div><span>淹没面积 ≥ 2 cm</span><strong>{{ (wetArea / 10000).toFixed(2) }} <small>ha</small></strong></div>
        <div><span>域内水量</span><strong>{{ Math.round(storedVolume).toLocaleString() }} <small>m³</small></strong></div>
      </div>
      <p v-if="displayMode === 'inundation' && inundation" class="flood-demo__balance">等水位淹没面积 {{ (inundation.area / 10000).toFixed(2) }} ha · 蓄水体积 {{ Math.round(inundation.volume).toLocaleString() }} m³<br />最大水深 {{ inundation.maxDepth.toFixed(2) }} m<br />{{ inundation.touchesBoundary ? '淹没已接触计算区边界；面积只统计本区域。' : '淹没位于计算区域内部。' }} 等水位分析不包含传播时间。</p>
      <p v-else-if="displayMode !== 'water' && analysis" class="flood-demo__balance">成果范围 {{ analysis.fromTime.toFixed(1) }}–{{ analysis.toTime.toFixed(1) }} s<br />曾淹没面积 {{ (analysis.inundatedArea / 10000).toFixed(2) }} ha · 最大采样时刻面积 {{ (analysis.peakSampledArea / 10000).toFixed(2) }} ha<br />最大水深 {{ analysis.maxDepth.toFixed(2) }} m；阈值 {{ analysis.depthThreshold }} m。持续时间仅累计此范围，末帧仍有水不代表已退水。</p>
      <p v-else-if="mode === 'simulation'" class="flood-demo__balance">初始库水 {{ Math.round(initialVolume).toLocaleString() }} m³ · 累计输入 {{ Math.round(injectedVolume).toLocaleString() }} m³ · 下游排出 {{ Math.round(dischargedVolume).toLocaleString() }} m³<br />水量平衡误差 {{ balanceError.toExponential(2) }} m³</p>
      <p v-else class="flood-demo__balance">{{ frame.velocityEast ? '成果含东西、南北流速分量。' : '成果未提供流速；仅展示水深，不推断流向。' }}</p>
      <div class="flood-demo__actions"><button class="flood-demo__secondary" @click="exportResult">导出成果</button><label class="flood-demo__import">导入成果<input type="file" accept=".json,application/json" @change="importResult" /></label></div>
      <a class="flood-demo__example" :href="exampleUrl" download>下载水深示例 JSON</a>
      <p class="flood-demo__status" role="status">{{ status }}</p>
      <p v-if="error" class="flood-demo__error" role="alert">{{ error }}</p>
      <p class="flood-demo__note">{{ mode === 'simulation' ? `计算区域 ${grid.columns * grid.cellSize} × ${grid.rows * grid.cellSize} m，${outletLabel}侧为开放出口。实验模型尚未经过工程校准。` : `成果网格 ${grid.columns} × ${grid.rows}，单元 ${grid.cellSize} m。运动与淹没范围来自输入成果。` }} 点击地形查看单元；拖动旋转，滚轮缩放。</p>
    </aside>
    <div class="flood-demo__caption">
      <span>{{ displayMode === 'inundation' ? inundation?.connected === false ? '指定水位淹没（含孤立低地）' : '指定水位连通淹没' : displayMode !== 'water' ? analysisLabels[displayMode] : mode === 'simulation' ? damEnabled ? '坝后蓄水 → 缺口发展 → 下游洪水' : terrainScenario || '上游泄洪 → 曲折河道 → 下游低洼区' : dataset?.name }}</span>
      <p v-if="terrainScenario">{{ terrainScenario }} · {{ frame.time.toFixed(1) }} s · {{ terrainSource }}</p>
      <p v-if="displayMode === 'water' && mode === 'simulation'">下游区域淹没 {{ (downstreamWetArea / 10000).toFixed(2) }} ha（网格{{ outletLabel }}侧 55%）</p>
      <p v-if="displayMode !== 'water' && displayMode !== 'inundation' && selectedCell !== undefined">选中单元：{{ selectedAnalysis == null ? '未达到淹没阈值或为无效区域' : `${selectedAnalysis.toFixed(2)} ${analysisUnit}` }}</p>
      <p v-else-if="displayMode === 'inundation' && selectedCell !== undefined">选中单元水深 {{ (inundation?.depth[selectedCell] ?? 0).toFixed(2) }} m；点击“计算 / 更新”将此单元作为水源。</p>
      <p v-else-if="selectedDepth !== undefined">选中单元：水深 {{ selectedDepth.toFixed(2) }} m · {{ selectedSpeed === undefined ? '未提供流速' : `流速 ${selectedSpeed.toFixed(2)} m/s` }}</p>
      <p v-else>点击场景查看水深与流速</p>
      <div v-if="displayMode !== 'water' && displayMode !== 'inundation'" class="flood-demo__legend flood-demo__legend--analysis"><span>0 {{ analysisUnit }}</span><i /><span>{{ analysisScale.toFixed(1) }} {{ analysisUnit }}</span></div>
      <div v-else-if="depthMode || displayMode === 'inundation'" class="flood-demo__legend"><span>0 m</span><i /><span>≥ 5 m</span></div>
    </div>
  </section>
</template>

<style scoped>
.flood-demo { position: fixed; inset: 60px 0 0; background: #15242a; color: #edf5f4; font-family: system-ui, sans-serif; }
.flood-demo__scene { width: 100%; height: 100%; }
.flood-demo .flood-demo__toggle { position: absolute; top: 10px; right: 10px; background: #20383e; color: #edf5f4; border-color: #466165; z-index: 2; }
.flood-demo__panel { position: absolute; top: 18px; left: 18px; width: 310px; max-height: calc(100% - 36px); overflow-y: auto; background: rgba(16, 30, 35, .96); border: 1px solid #395052; border-radius: 8px; padding: 22px; }
.flood-demo__eyebrow { font-size: 10px; letter-spacing: .16em; color: #89c6bc; margin-bottom: 10px; }
.flood-demo h1 { font-size: 25px; font-weight: 600; }
.flood-demo__intro { margin: 8px 0 18px; color: #a5bdbd; font-size: 12px; }
.flood-demo__actions { display: flex; gap: 8px; margin: 12px 0; }
.flood-demo button, .flood-demo__import { min-height: 38px; flex: 1; border: 1px solid #7fc6b5; background: #8bd2bc; color: #112e27; border-radius: 4px; padding: 8px 10px; font: inherit; font-size: 12px; cursor: pointer; text-align: center; }
.flood-demo button:disabled { opacity: .4; cursor: default; }
.flood-demo .flood-demo__secondary, .flood-demo__import { background: #20383e; border-color: #466165; color: #d4e6e3; }
.flood-demo__wide { width: 100%; }
.flood-demo__scenario { margin-top: 8px; }
.flood-demo__select { display: block; margin-top: 18px; font-size: 12px; color: #b8cdcd; }
.flood-demo__select select { display: block; width: 100%; margin-top: 8px; padding: 8px; background: #20383e; color: #edf5f4; border: 1px solid #466165; }
.flood-demo__field { display: block; font-size: 12px; margin-top: 17px; color: #b8cdcd; }
.flood-demo output { float: right; color: #edf5f4; font-variant-numeric: tabular-nums; }
.flood-demo input[type=range] { display: block; width: 100%; margin-top: 10px; accent-color: #8bd2bc; }
.flood-demo__check { display: flex; gap: 8px; font-size: 12px; margin: 18px 0; }
.flood-demo input[type=checkbox] { accent-color: #8bd2bc; }
.flood-demo__metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; border-top: 1px solid #395052; padding-top: 16px; }
.flood-demo__metrics span { display: block; font-size: 10px; color: #a5bdbd; margin-bottom: 4px; }
.flood-demo__metrics strong { font-weight: 500; font-size: 20px; font-variant-numeric: tabular-nums; }
.flood-demo small { font-size: 10px; color: #a5bdbd; }
.flood-demo__balance, .flood-demo__note, .flood-demo__status { color: #a5bdbd; font-size: 11px; line-height: 1.7; margin-top: 14px; }
.flood-demo__status { color: #c5e1d9; }
.flood-demo__note { border-top: 1px solid #395052; padding-top: 12px; }
.flood-demo__import { position: relative; overflow: hidden; }
.flood-demo__import input { position: absolute; inset: 0; width: 100%; opacity: 0; cursor: pointer; }
.flood-demo__error { color: #ffb9a9; font-size: 12px; margin-top: 10px; }
.flood-demo__example { color: #9bd4c5; font-size: 11px; }
.flood-demo__terrain { font-size: 11px; color: #b8cdcd; margin: 16px 0; }
.flood-demo__terrain summary { cursor: pointer; }
.flood-demo__terrain label { display: block; margin: 12px 0; }
.flood-demo__terrain input { display: block; width: 100%; margin-top: 5px; padding: 6px; border: 1px solid #466165; background: #20383e; color: white; }
.flood-demo__terrain input[type=checkbox] { display: inline-block; width: auto; margin-top: 0; }
.flood-demo__terrain button { margin-top: 8px; }
.flood-demo__terrain p { line-height: 1.7; margin-top: 10px; }
.flood-demo__caption { position: absolute; right: 22px; bottom: 35px; padding: 14px 18px; background: rgba(16, 30, 35, .9); border-left: 2px solid #8bd2bc; font-size: 12px; max-width: calc(100% - 380px); }
.flood-demo__caption p { color: #a5bdbd; font-size: 11px; margin-top: 8px; }
.flood-demo__legend { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
.flood-demo__legend i { width: 120px; height: 7px; background: linear-gradient(to right, #38c7e5, #c0381f); }
.flood-demo__legend--analysis i { background: linear-gradient(to right, #1466d9, #21c7ad, #f57329); }
.flood-demo button:focus-visible, .flood-demo input:focus-visible, .flood-demo__import:focus-within { outline: 2px solid white; outline-offset: 3px; }
@media (max-width: 700px) { .flood-demo__panel { top: 8px; left: 8px; width: 260px; max-height: 52%; padding: 16px; } .flood-demo__caption { left: 8px; right: 8px; bottom: 32px; max-width: none; } }
</style>
