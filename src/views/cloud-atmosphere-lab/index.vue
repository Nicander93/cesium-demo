<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import * as Cesium from 'cesium'
import { EffectCoordinator } from './effect-coordinator'
import { sceneResolutionScale } from './render-budget'
import type { CommunityResources } from './community-resources'
import { defaultLabState, readLabState, writeLabState, type LabState, type ProviderId, type ViewId, type WeatherId, type QualityId } from './url-state'
import type { LabEffect, ProviderDiagnostic } from './providers'
import { createCommunityResourceCache } from './community-resource-loader'
import { communityCloudTopM, buildCommunityPresentationSettings, needsCommunityRebuild } from './provider-settings'
import { createDebouncedSizeWatcher, type DrawingBufferSize, type DebouncedSizeWatcher } from './resize-watcher'
import type { AtmosphereLabDevApi, AtmosphereLabDevState } from './dev-api'
import { buildCameraPose } from './camera-presets'

const host = ref<HTMLDivElement>()
const viewer = shallowRef<Cesium.Viewer>()
const state = reactive(readLabState(location.search))
const diagnostic = ref<ProviderDiagnostic>({ provider: state.provider, status: 'loading', detail: '正在创建单一 Cesium Viewer' })
const coordinator = new EffectCoordinator<LabEffect>()
const errorText = ref('')
const actualCameraHeightM = ref<number>()
const cloudVisibility = ref(1)
const cloudRenderingActive = ref(true)
const presentationSettings = computed(() => buildCommunityPresentationSettings(state))
let lastCameraReadoutAt = 0
const actualCameraHeightLabel = computed(() => actualCameraHeightM.value === undefined ? '读取中' : actualCameraHeightM.value >= 10000 ? (actualCameraHeightM.value / 1000).toFixed(1) + ' km' : Math.round(actualCameraHeightM.value) + ' m')
const settingsOpen = ref(false)
let removeRenderError: (() => void) | undefined
let removePostRender: (() => void) | undefined
let removeTileLoadProgress: (() => void) | undefined
let tileLoadQueueLength: number | undefined
let removeImageryError: (() => void) | undefined
let removeImageryReady: (() => void) | undefined
let removeImageryTileError: (() => void) | undefined
let removeWindowErrors: (() => void) | undefined
let resizeObserver: ResizeObserver | undefined
let resizeWatcher: DebouncedSizeWatcher | undefined
let removeWindowResize: (() => void) | undefined
let communityRebuildCount = 0
let disposed = false
let refreshTimer: number | undefined
let tick: number | undefined
let lastProvider = state.provider
let lastQuality = state.quality
let lastAppliedState = { ...state }
let communityResources: CommunityResources | undefined
let localPresetApplied = state.provider === 'local'

const providers: { id: ProviderId; label: string; note: string }[] = [
  { id: 'basic', label: '无云基线', note: '只检查天空与地球；没有云层' },
  { id: 'current', label: '旧管线（对照基线）', note: '保留旧云形对照；清晰度和云内效果未通过' },
  { id: 'community', label: '社区管线（研发主线）', note: '集中修复颗粒、光照和运动稳定性' },
  { id: 'local', label: '局部积云（造型实验）', note: '固定地点形态参考；不作为最终方案' },
]
const views: { id: ViewId; label: string }[] = [
  { id: 'ground', label: '地面' }, { id: 'inside', label: '云内' }, { id: 'cloudscape', label: '云海' }, { id: 'above', label: '云上' }, { id: 'orbit', label: '轨道' },
]
const presetLabels: Record<WeatherId, string> = { sunny: '晴天', sunset: '夕照', overcast: '阴天' }
const qualityTitles = computed<Record<QualityId, string>>(() => {
  if (state.provider === 'community') return { reference: '细节', balanced: '流畅' }
  if (state.provider === 'current') return { reference: '192步', balanced: '128步' }
  if (state.provider === 'local') return { reference: '256步', balanced: '144步' }
  return { reference: '无云', balanced: '无云' }
})
const qualityLabels = computed<Record<QualityId, string>>(() => {
  if (state.provider === 'community') return { reference: '1/4边长 · 128步上限 · 时域重建', balanced: '1/4边长 · 96步上限 · 时域重建' }
  if (state.provider === 'current') return { reference: '0.75× · 192步 · TAA关闭', balanced: '0.75× · 128步 · TAA关闭' }
  if (state.provider === 'local') return { reference: '全分辨率 · 256固定步 · 无 TAA', balanced: '全分辨率 · 144固定步 · 无 TAA' }
  return { reference: '基础天空不含云 march（不可用）', balanced: '基础天空不含云 march（不可用）' }
})
const statusLabel = computed(() => {
  if (state.provider === 'basic' && diagnostic.value.status === 'ready') return '无云参考'
  return ({ loading: '初始化', initialized: '等待首帧', ready: '渲染中', failed: '失败' }[diagnostic.value.status])
})
const resolutionLabel = computed(() => diagnostic.value.width && diagnostic.value.height ? `${diagnostic.value.width} × ${diagnostic.value.height}` : '未报告')
const historyResetLabel = computed(() => diagnostic.value.rebuildCount === undefined
  ? '—'
  : `#${diagnostic.value.rebuildCount} · ${diagnostic.value.historyReset ?? '原因未记录'}`)
const cameraDescription = computed(() => {
  if (state.view === 'ground') return '道路低空：约 1.3 km 外，指向柱体顶部约 150 m'
  if (state.view === 'inside') return `云内：${Math.round(state.cloudBaseM + state.cloudThicknessM * 0.5)} m`
  if (state.view === 'cloudscape') return '斜看积云云顶：主云层上方 1.5 km'
  if (state.view === 'above') return state.provider === 'local'
    ? `局部云顶：${Math.round(state.cloudBaseM + state.cloudThicknessM)} m；镜头在其上 2 km`
    : `最高活动云顶：${Math.round(communityCloudTopM(state))} m；镜头在其上 2 km`
  return '轨道：地表上方约 18,000 km'
})

function getDevState(): AtmosphereLabDevState {
  const v = viewer.value
  const collection = v?.scene.postProcessStages as unknown as {
    length: number
    get(index: number): { name?: string; ready?: boolean; enabled?: boolean }
  } | undefined
  const stages = collection
    ? Array.from({ length: collection.length }, (_, index) => {
        const stage = collection.get(index)
        return { name: stage.name ?? `stage-${index}`, ready: Boolean(stage.ready), enabled: stage.enabled !== false }
      })
    : []
  const activeEffect = coordinator.current
  activeEffect?.isReady()
  const activeDiagnostic = activeEffect?.diagnostic()
  const camera = v?.camera
  const cartographic = camera ? Cesium.Cartographic.fromCartesian(camera.positionWC) : undefined
  const cameraState = camera && cartographic ? {
    longitude: Cesium.Math.toDegrees(cartographic.longitude),
    latitude: Cesium.Math.toDegrees(cartographic.latitude),
    height: cartographic.height,
    heading: camera.heading,
    pitch: camera.pitch,
    roll: camera.roll,
    position: { x: camera.positionWC.x, y: camera.positionWC.y, z: camera.positionWC.z },
    direction: { x: camera.directionWC.x, y: camera.directionWC.y, z: camera.directionWC.z },
  } : undefined
  const context = (v?.scene as unknown as { context?: { drawingBufferWidth: number; drawingBufferHeight: number } } | undefined)?.context
  const canvas = v?.scene.canvas
  return {
    state: { ...state },
    camera: cameraState,
    canvas: canvas ? {
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
      bufferWidth: context?.drawingBufferWidth ?? canvas.width,
      bufferHeight: context?.drawingBufferHeight ?? canvas.height,
    } : undefined,
    postProcess: { count: stages.length, ready: stages.every((stage) => stage.ready), stages },
    diagnostic: { ...diagnostic.value, staticSampleCount: activeDiagnostic?.staticSampleCount, activeEffect: activeDiagnostic ? { ...activeDiagnostic } : undefined },
    errors: [...new Set([errorText.value, diagnostic.value.renderError].filter((message): message is string => Boolean(message)))],
    scene: {
      globeVisible: v?.scene.globe.show ?? false,
      skyVisible: v?.scene.skyAtmosphere?.show ?? false,
      globeAtmosphere: v?.scene.globe.showGroundAtmosphere,
      fogRendered: v?.scene.fog.enabled && v?.scene.fog.renderable,
      globeLighting: v?.scene.globe.enableLighting,
      cloudVisible: activeDiagnostic?.cloudVisible ?? false,
      activeProvider: activeDiagnostic?.provider,
      tilesLoaded: v?.scene.globe.tilesLoaded ?? false,
      tileLoadQueueLength,
      imageryLayerCount: v?.scene.globe.imageryLayers.length ?? 0,
      primitiveCount: v?.scene.primitives.length ?? 0,
    },
  }
}

function installDevApi() {
  if (!import.meta.env.DEV && import.meta.env.VITE_CLOUD_LAB_DIAGNOSTICS !== '1') return
  const api: AtmosphereLabDevApi = {
    getState: getDevState,
    setProvider: chooseProvider,
    setView: chooseView,
    setWeather: chooseWeather,
    setAtmosphereDebug(mode) { coordinator.current?.setAtmosphereDebug?.(mode) },
    setCameraPose(pose) {
      const v = viewer.value
      if (!v || !Number.isFinite(pose.height) || !Number.isFinite(pose.pitch) || pose.height < 1) return
      const camera = v.camera
      const { longitude, latitude } = camera.positionCartographic
      camera.setView({
        destination: Cesium.Cartesian3.fromRadians(longitude, latitude, pose.height),
        orientation: { heading: pose.heading ?? camera.heading, pitch: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pose.pitch)), roll: 0 },
      })
      v.scene.requestRender()
    },
    setCameraHeight(heightM) {
      const v = viewer.value
      if (!v || !Number.isFinite(heightM) || heightM < 1) return
      const camera = v.camera
      const { longitude, latitude } = camera.positionCartographic
      camera.setView({
        destination: Cesium.Cartesian3.fromRadians(longitude, latitude, heightM),
        orientation: { heading: camera.heading, pitch: camera.pitch, roll: camera.roll },
      })
      v.scene.requestRender()
    },
    setOptions(options) {
      if (options.quality) state.quality = options.quality
      if (options.coverage !== undefined) state.coverage = Math.min(1, Math.max(0, options.coverage))
      if (options.cloudBaseM !== undefined) state.cloudBaseM = Math.min(12000, Math.max(500, options.cloudBaseM))
      if (options.cloudThicknessM !== undefined) state.cloudThicknessM = Math.min(8000, Math.max(200, options.cloudThicknessM))
      if (options.exposure !== undefined) state.exposure = Math.min(4, Math.max(0.1, options.exposure))
      if (options.sunHour !== undefined && Number.isFinite(options.sunHour)) state.sunHour = Math.min(20, Math.max(5, options.sunHour))
      if (options.animated !== undefined) state.animated = options.animated
      if (options.cloudPresentation) state.cloudPresentation = options.cloudPresentation
      if (options.cloudForm) state.cloudForm = options.cloudForm
      if (options.cloudSampling) state.cloudSampling = options.cloudSampling
      if (options.cloudLighting) state.cloudLighting = options.cloudLighting
      if (options.cloudShadows !== undefined) state.cloudShadows = options.cloudShadows
      if (state.view === 'inside' || state.view === 'above' || state.view === 'cloudscape') setCamera(state.view)
      applyStateChange()
      startWindLoop()
    },
  }
  window.__atmosphereLab = api
}

function recordRuntimeError(error: unknown) {
  if (disposed || !import.meta.env.DEV || state.provider === 'basic') return
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  errorText.value = message
  report({
    ...diagnostic.value,
    status: 'failed',
    renderError: message,
    detail: '开发态捕获到未被 scene.renderError 上报的异步错误；未阻止原始错误传播',
  })
}

function installRuntimeErrorListeners() {
  if (!import.meta.env.DEV) return
  const handleError = (event: ErrorEvent) => recordRuntimeError(event.error ?? event.message)
  const handleRejection = (event: PromiseRejectionEvent) => recordRuntimeError(event.reason)
  window.addEventListener('error', handleError)
  window.addEventListener('unhandledrejection', handleRejection)
  removeWindowErrors = () => {
    window.removeEventListener('error', handleError)
    window.removeEventListener('unhandledrejection', handleRejection)
  }
}

function updateUrl() {
  history.replaceState(null, '', `${location.pathname}${writeLabState(state)}`)
}
function report(next: ProviderDiagnostic) {
  if (disposed) return
  diagnostic.value = { ...next }
}
function updateClock() {
  const v = viewer.value
  if (!v) return
  // The fixed weather epoch is independent of this local solar clock.
  const localMinutes = Math.round(state.sunHour * 60)
  const date = new Date(Date.UTC(2024, 5, 21, 0, localMinutes - 8 * 60, 0))
  v.clock.currentTime = Cesium.JulianDate.fromDate(date)
  v.clock.shouldAnimate = false
  v.scene.requestRender()
}
function setCamera(view: ViewId) {
  state.view = view
  if (state.provider === 'local') localPresetApplied = true
  const v = viewer.value
  if (!v) return
  applyCameraPose(view)
  v.scene.requestRender()
}
function applyCameraPose(view: ViewId) {
  const v = viewer.value
  if (!v) return
  const pose = buildCameraPose(view, state)
  v.camera.setView({
    destination: pose.destination,
    orientation: { direction: pose.direction, up: pose.up },
  })
}
function providerFactory(id: ProviderId) {
  const v = viewer.value!
  const snapshot = { ...state }
  return async (signal: AbortSignal) => {
    const importStart = performance.now()
    const providers = await import('./providers')
    performance.measure('cloud-provider-module', { start: importStart, end: performance.now() })
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    const context = { viewer: v, state: snapshot, signal, report, communityResources }
    if (id === 'basic') return providers.createBasicProvider(context)
    if (id === 'current') return providers.createCurrentProvider(context)
    if (id === 'local') return providers.createLocalCumulusProvider(context)
    return providers.createCommunityProvider(context)
  }
}
async function startProvider(reason = 'provider change') {
  if (refreshTimer !== undefined) { window.clearTimeout(refreshTimer); refreshTimer = undefined }
  const v = viewer.value
  if (!v || disposed) return
  errorText.value = ''
  const selected = state.provider
  const onFirstRender = () => {
    const now = performance.now()
    const updateReadout = now - lastCameraReadoutAt > 200
    if (updateReadout) {
      actualCameraHeightM.value = v.camera.positionCartographic.height
      lastCameraReadoutAt = now
    }
    if (disposed || selected !== state.provider) return
    const current = diagnostic.value
    const active = coordinator.current
    if (current.provider !== selected || active?.diagnostic().provider !== selected) return
    if (!active.isReady()) return
    const mounted = active.diagnostic()
    if (updateReadout) {
      cloudVisibility.value = mounted.cloudVisibility ?? 1
      cloudRenderingActive.value = mounted.cloudRenderingActive ?? true
    }
    if (current.status === 'initialized') {
      report({ ...current, ...mounted, rebuildCount: current.rebuildCount, historyReset: current.historyReset, status: 'ready', detail: `${current.detail}；postRender 已确认活动效果 stage.ready` })
    } else if (current.status === 'ready' && (current.width !== mounted.width || current.height !== mounted.height)) {
      report({ ...current, width: mounted.width, height: mounted.height })
    }
  }
  removePostRender?.()
  removePostRender = v.scene.postRender.addEventListener(onFirstRender)
  try {
    const active = await coordinator.switchTo(providerFactory(selected))
    if (!active || disposed || selected !== state.provider) return
    if (diagnostic.value.status === 'failed') return
    if (selected === 'community') { coordinator.current?.update({ ...state }); commitCommunityMount(reason) }
    v.scene.requestRender()
    // Rendering can be paused during tab initialization; leave status at initialized until postRender.
  } catch (error) {
    if (disposed || selected !== state.provider) return
    const message = error instanceof Error ? error.message : String(error)
    errorText.value = message
    report({ provider: selected, status: 'failed', detail: message, renderError: diagnostic.value.renderError })
  }
}
function scheduleProviderRefresh(reason = 'cloud parameters changed') {
  if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
  refreshTimer = window.setTimeout(() => { refreshTimer = undefined; void startProvider(reason) }, 180)
}
function applyScenePixelBudget() {
  const v = viewer.value
  const container = host.value
  if (!v || !container) return
  const scale = sceneResolutionScale(container.clientWidth, container.clientHeight)
  if (Math.abs(v.resolutionScale - scale) > 1e-4) { v.resolutionScale = scale; v.resize() }
}
function measureDrawingBuffer(): DrawingBufferSize {
  const context = (viewer.value?.scene as unknown as { context?: { drawingBufferWidth?: number; drawingBufferHeight?: number } } | undefined)?.context
  return { width: context?.drawingBufferWidth ?? 0, height: context?.drawingBufferHeight ?? 0 }
}
function handleDrawingBufferResize(next: DrawingBufferSize, previous: DrawingBufferSize) {
  if (disposed || state.provider !== 'community') return
  const reason = `drawing buffer resize ${previous.width}×${previous.height} → ${next.width}×${next.height}`
  scheduleProviderRefresh(reason)
}
function commitCommunityMount(reason: string) {
  const mounted = coordinator.current?.diagnostic()
  if (!mounted || mounted.provider !== 'community' || mounted.status !== 'initialized') return
  communityRebuildCount += 1
  const createdFor = {
    width: mounted.renderTargetWidth ?? measureDrawingBuffer().width,
    height: mounted.renderTargetHeight ?? measureDrawingBuffer().height,
  }
  report({ ...mounted, rebuildCount: communityRebuildCount, historyReset: reason })
  resizeWatcher?.reset(createdFor)
  const actual = measureDrawingBuffer()
  if (actual.width !== createdFor.width || actual.height !== createdFor.height) resizeWatcher?.schedule()
}
function applyStateChange() {
  updateUrl()
  updateClock()
  if (state.provider !== lastProvider || state.quality !== lastQuality) {
    const reason = state.provider !== lastProvider ? `provider changed to ${state.provider}` : `quality changed to ${state.quality}`
    lastProvider = state.provider
    lastQuality = state.quality
    void startProvider(reason)
  } else if (state.provider === 'community' && needsCommunityRebuild(lastAppliedState, state)) {
    scheduleProviderRefresh()
  } else {
    coordinator.current?.update({ ...state })
  }
  lastAppliedState = { ...state }
  viewer.value?.scene.requestRender()
}
function chooseProvider(id: ProviderId) {
  state.provider = id
  if (id === 'local' && !localPresetApplied) {
    applyCameraPose(state.view)
    localPresetApplied = true
  }
  applyStateChange()
}
function chooseWeather(id: WeatherId) {
  state.weather = id
  state.coverage = id === 'sunny' ? 0.32 : id === 'sunset' ? 0.44 : 0.68
  state.sunHour = id === 'sunset' ? 18.5 : 14
  applyStateChange()
}
function chooseQuality(id: QualityId) { state.quality = id; applyStateChange() }
function chooseView(id: ViewId) { setCamera(id); updateUrl() }
function controlChanged() { applyStateChange() }
function recoverBasic() { chooseProvider('basic') }
function copyLink() {
  void navigator.clipboard?.writeText(location.href).then(() => { errorText.value = '已复制当前实验链接' }).catch(() => { errorText.value = '当前浏览器未开放剪贴板权限' })
}
function startWindLoop() {
  if (tick !== undefined) cancelAnimationFrame(tick)
  const frame = () => {
    if (!state.animated || disposed) return
    viewer.value?.scene.requestRender()
    tick = requestAnimationFrame(frame)
  }
  if (state.animated) tick = requestAnimationFrame(frame)
}

onMounted(() => {
  if (!host.value || disposed) return
  try {
    const v = new Cesium.Viewer(host.value, {
      baseLayer: false,
      baseLayerPicker: false,
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      animation: false,
      timeline: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      selectionIndicator: false,
      infoBox: false,
      requestRenderMode: false,
      useBrowserRecommendedResolution: true,
      skyBox: false,
    })
    if (disposed) { v.destroy(); return }
    viewer.value = v
    communityResources = createCommunityResourceCache(v)
    applyScenePixelBudget()
    // Resource preparation overlaps lazy shader-module loading. This Viewer
    // remains interactive while the cloud implementation is being fetched.
    if (state.provider === 'community') void communityResources.get(state.shapeMipmaps || state.cloudSampling === 'filtered').catch(() => undefined)
    removeTileLoadProgress = v.scene.globe.tileLoadProgressEvent.addEventListener((pending: number) => {
      tileLoadQueueLength = pending
    })
    installDevApi()
    installRuntimeErrorListeners()
    resizeWatcher = createDebouncedSizeWatcher(measureDrawingBuffer, handleDrawingBufferResize, 180)
    const scheduleResizeCheck = () => { applyScenePixelBudget(); resizeWatcher?.schedule() }
    window.addEventListener('resize', scheduleResizeCheck)
    removeWindowResize = () => window.removeEventListener('resize', scheduleResizeCheck)
    resizeObserver = new ResizeObserver(scheduleResizeCheck)
    resizeObserver.observe(host.value)
    v.scene.globe.baseColor = Cesium.Color.fromCssColorString('#172c3d')
    v.scene.globe.enableLighting = true
    v.scene.globe.depthTestAgainstTerrain = true
    v.scene.backgroundColor = Cesium.Color.fromCssColorString('#07111c')
    v.clock.currentTime = Cesium.JulianDate.fromDate(new Date(Date.UTC(2024, 5, 21, 6)))
    v.clock.shouldAnimate = false
    const imageryUrl = import.meta.env.VITE_CITY_IMAGERY_URL ||
      'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
    const imagery = Cesium.ImageryLayer.fromProviderAsync(
      Cesium.ArcGisMapServerImageryProvider.fromUrl(imageryUrl, { enablePickFeatures: false }),
    )
    const imageryError = () => {
      if (disposed) return
      imagery.show = false
      errorText.value = 'ArcGIS 影像瓦片加载失败，已保留椭球底色；请检查网络或 VITE_CITY_IMAGERY_URL 配置'
      diagnostic.value = { ...diagnostic.value, detail: errorText.value }
      v.scene.requestRender()
    }
    removeImageryError = imagery.errorEvent.addEventListener(imageryError)
    removeImageryReady = imagery.readyEvent.addEventListener((provider) => {
      if (!disposed) removeImageryTileError = provider.errorEvent.addEventListener(imageryError)
    })
    v.imageryLayers.add(imagery)
    v.entities.add({ name: 'Cloud Lab · reference block', position: Cesium.Cartesian3.fromDegrees(119.0317, 33.5921, 20), box: { dimensions: new Cesium.Cartesian3(130, 90, 40), material: Cesium.Color.fromCssColorString('#b6a98d'), outline: true, outlineColor: Cesium.Color.WHITE } })
    v.entities.add({ name: 'Cloud Lab · tower', position: Cesium.Cartesian3.fromDegrees(119.0323, 33.5925, 75), box: { dimensions: new Cesium.Cartesian3(45, 45, 150), material: Cesium.Color.fromCssColorString('#69849a'), outline: true, outlineColor: Cesium.Color.WHITE } })
    v.entities.add({ name: 'Cloud Lab · terrain marker', position: Cesium.Cartesian3.fromDegrees(119.0309, 33.5918, 35), ellipsoid: { radii: new Cesium.Cartesian3(18, 18, 35), material: Cesium.Color.fromCssColorString('#b96c51') } })
    removeRenderError = v.scene.renderError.addEventListener((_scene, error) => {
      if (disposed) return
      const message = error instanceof Error ? error.stack ?? error.message : String(error)
      errorText.value = message
      report({ ...diagnostic.value, status: 'failed', renderError: message, detail: 'Cesium 报告了真实 renderError；可用下方按钮切回基础天空' })
      v.scene.requestRender()
    })
    setCamera(state.view)
    updateClock()
    void startProvider('initial mount')
    startWindLoop()
  } catch (error) {
    if (disposed) return
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    errorText.value = message
    report({ provider: state.provider, status: 'failed', detail: `Cesium Viewer 初始化失败：${message}` })
  }
})
watch(() => state.animated, () => { startWindLoop(); applyStateChange() })
onBeforeUnmount(async () => {
  disposed = true
  if (window.__atmosphereLab) delete window.__atmosphereLab
  if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
  if (tick !== undefined) cancelAnimationFrame(tick)
  removeRenderError?.()
  removePostRender?.()
  removeTileLoadProgress?.()
  removeImageryError?.()
  removeImageryReady?.()
  removeImageryTileError?.()
  removeWindowErrors?.()
  resizeObserver?.disconnect()
  resizeWatcher?.dispose()
  removeWindowResize?.()
  await coordinator.dispose()
  await communityResources?.destroy()
  communityResources = undefined
  viewer.value?.destroy()
  viewer.value = undefined
})
</script>

<template>
  <main class="lab-shell">
    <section class="viewport" aria-label="云与大气 Cesium 对照场景">
      <div ref="host" class="cesium-host" style="touch-action: none"></div>
      <div class="topline">
        <div class="brand"><strong>云与大气实验</strong><small>{{ providers.find((item) => item.id === state.provider)?.label }}{{ state.provider === 'basic' ? '' : ' · 未验收' }}</small></div>
        <div class="status-chip" :class="diagnostic.status"><i></i>{{ statusLabel }}</div>
        <button v-if="state.provider === 'basic'" class="top-button primary" @click="chooseProvider('community')">打开研发主线</button>
        <button class="top-button copy-control" @click="copyLink">复制链接</button>
        <button class="top-button" :aria-expanded="settingsOpen" @click="settingsOpen = !settingsOpen">{{ settingsOpen ? '收起设置' : '设置' }}</button>
      </div>
      <div class="view-switcher" aria-label="相机视角">
        <button v-for="item in views" :key="item.id" :class="{ active: state.view === item.id }" @click="chooseView(item.id)">{{ item.label }}</button>
      </div>
      <div class="scene-caption"><strong>{{ state.provider === 'basic' ? '当前模式没有云' : presetLabels[state.weather] }}</strong><span>机位预设：{{ cameraDescription }}</span><span>实际相机高度：{{ actualCameraHeightLabel }}</span></div>
      <div class="error-banner" v-if="diagnostic.status === 'failed' || errorText">
        <div><strong>{{ diagnostic.status === 'failed' ? '效果未能启动' : '诊断' }}</strong><pre>{{ errorText || diagnostic.renderError || diagnostic.detail }}</pre></div>
        <button @click="recoverBasic">切回无云参考</button>
      </div>
    </section>

    <aside v-show="settingsOpen" class="control-panel" aria-label="实验设置">
      <div class="panel-heading"><div><small>实验设置</small><h1>渲染对照</h1></div><button class="close-button" aria-label="收起设置" @click="settingsOpen = false">×</button></div>
      <p class="experiment-note"><strong>研发中，尚无最终效果。</strong>社区管线为当前研发主线，其余路径用于对照。“渲染中”只表示渲染已启动。</p>

      <section class="control-section">
        <div class="section-title"><h2>实现路径</h2></div>
        <div class="provider-list">
          <button v-for="item in providers" :key="item.id" class="provider-row" :class="{ selected: state.provider === item.id }" @click="chooseProvider(item.id)">
            <span class="radio"></span><span class="provider-copy"><strong>{{ item.label }}</strong><small>{{ item.note }}</small></span><span v-if="state.provider === item.id" class="selected-mark">已选</span>
          </button>
        </div>
      </section>

      <section class="control-section">
        <div class="section-title"><h2>天气与光照</h2></div>
        <div class="segmented">
          <button v-for="item in (['sunny','sunset','overcast'] as WeatherId[])" :key="item" :class="{ active: state.weather === item }" @click="chooseWeather(item)">{{ presetLabels[item] }}</button>
        </div>
        <div class="range-row"><label for="exposure">云曝光</label><input id="exposure" v-model.number="state.exposure" :disabled="state.provider === 'basic'" type="range" min="0.1" max="4" step="0.05" @change="controlChanged"><output>{{ state.exposure.toFixed(2) }}</output></div>
        <div class="range-row"><label for="sun-hour">日照时间</label><input id="sun-hour" v-model.number="state.sunHour" type="range" min="5" max="20" step="0.25" @change="controlChanged"><output>{{ Math.floor(state.sunHour).toString().padStart(2, '0') }}:{{ Math.round((state.sunHour % 1) * 60).toString().padStart(2, '0') }}</output></div>
      </section>

      <section class="control-section">
        <div class="section-title"><h2>云体参数</h2></div>
        <p v-if="state.provider === 'basic'" class="basic-note">当前模式没有云。选择有云实现后可调整参数。</p>
        <div class="range-row"><label for="coverage">云量</label><input id="coverage" v-model.number="state.coverage" :disabled="state.provider === 'basic'" type="range" min="0" max="1" step="0.01" @change="controlChanged"><output>{{ Math.round(state.coverage * 100) }}%</output></div>
        <div class="range-row"><label for="base">云底高度</label><input id="base" v-model.number="state.cloudBaseM" :disabled="state.provider === 'basic'" type="range" min="500" max="12000" step="100" @change="controlChanged"><output>{{ (state.cloudBaseM / 1000).toFixed(1) }} km</output></div>
        <div class="range-row"><label for="thickness">云层厚度</label><input id="thickness" v-model.number="state.cloudThicknessM" :disabled="state.provider === 'basic'" type="range" min="200" max="8000" step="100" @change="controlChanged"><output>{{ (state.cloudThicknessM / 1000).toFixed(1) }} km</output></div>
        <template v-if="state.provider === 'community'">
          <div class="segmented" aria-label="云体形态">
            <button :class="{ active: state.cloudForm === 'cumulus' }" @click="state.cloudForm = 'cumulus'; controlChanged()">立体积云</button>
            <button :class="{ active: state.cloudForm === 'layered' }" @click="state.cloudForm = 'layered'; controlChanged()">原云形对照</button>
          </div>
          <div class="segmented" aria-label="云层展示方式">
            <button :class="{ active: state.cloudPresentation === 'adaptive' }" @click="state.cloudPresentation = 'adaptive'; controlChanged()">地面优先</button>
            <button :class="{ active: state.cloudPresentation === 'full' }" @click="state.cloudPresentation = 'full'; controlChanged()">完整云层</button>
          </div>
          <label><input v-model="state.cloudShadows" type="checkbox" @change="controlChanged()"> 云影与地表融合</label>
          <p class="basic-note">地面优先：{{ (presentationSettings.heightFadeStart / 1000).toFixed(1) }}–{{ (presentationSettings.heightFadeEnd / 1000).toFixed(1) }} km 逐渐淡出，高空保留大气，方便看地图。</p>
        </template>
      </section>

      <section class="control-section quality-section">
        <div class="section-title"><h2>采样方式（实验）</h2></div>
        <div class="quality-choice">
          <button v-for="item in (['reference','balanced'] as QualityId[])" :key="item" :class="{ active: state.quality === item }" :disabled="state.provider === 'basic'" @click="chooseQuality(item)"><strong>{{ qualityTitles[item] }}</strong><small>{{ qualityLabels[item] }}</small></button>
        </div>
        <label class="wind-toggle"><span><strong>云层风场</strong><small>动画独立于太阳时钟</small></span><input v-model="state.animated" :disabled="state.provider === 'basic'" type="checkbox"><i></i></label>
      </section>

      <section class="diagnostics">
        <div class="section-title"><h2>运行诊断</h2></div>
        <div class="diag-grid">
          <div><small>实际输出</small><strong>{{ resolutionLabel }}</strong></div>
          <div><small>TAA / 重投影</small><strong>{{ diagnostic.temporalResolve ? '真实重投影' : '关闭' }}</strong></div>
          <div><small>阴影锚定</small><strong>{{ diagnostic.shadowAnchor || '—' }}</strong></div>
          <div><small>历史重建</small><strong>{{ historyResetLabel }}</strong></div>
          <div v-if="state.provider === 'community'"><small>云层显示 / 计算</small><strong>{{ Math.round(cloudVisibility * 100) }}% / {{ cloudRenderingActive ? '运行' : '暂停' }}</strong></div>
        </div>
        <p class="diag-detail">{{ cameraDescription }} · {{ diagnostic.detail }}</p>
        <p v-if="diagnostic.renderError" class="render-error">{{ diagnostic.renderError }}</p>
      </section>
      <footer><span>分辨率 / 历史重建</span><span>Cesium 1.132</span></footer>
    </aside>
  </main>
</template>

<style scoped>
.lab-shell{position:relative;width:100vw;height:100dvh;min-height:0;overflow:hidden;background:#07111c;color:#edf2ee;font-family:Inter,"Segoe UI",sans-serif}
.viewport,.cesium-host{position:absolute;inset:0}.viewport{overflow:hidden}.cesium-host{z-index:0}
.topline{position:absolute;z-index:3;top:12px;left:14px;right:14px;display:flex;align-items:center;gap:8px;min-height:38px}
.brand{margin-right:auto;padding:6px 10px;border:1px solid #ffffff26;border-radius:8px;background:#101d27d9;backdrop-filter:blur(12px)}
.brand strong,.brand small{display:block}.brand strong{font-size:12px;font-weight:650}.brand small{margin-top:2px;font-size:9px;color:#b4c3c0}
.status-chip,.top-button{height:34px;border:1px solid #ffffff30;border-radius:8px;background:#101d27e8;color:#e4ece8;font-size:10px;padding:0 11px;display:flex;align-items:center;gap:7px;white-space:nowrap;backdrop-filter:blur(12px)}
.status-chip i{width:6px;height:6px;border-radius:50%;background:#d3a65d}.status-chip.ready i{background:#82c69e}.status-chip.failed i{background:#e17868}
.top-button{cursor:pointer}.top-button:hover{background:#273e46}.top-button.primary{border-color:#9ebaa6;background:#d6e3d7;color:#20342c}
.view-switcher{position:absolute;z-index:3;top:62px;left:14px;display:flex;gap:2px;padding:4px;background:#101d27dc;border:1px solid #ffffff2b;border-radius:10px;backdrop-filter:blur(12px)}
.view-switcher button{border:0;background:transparent;color:#bdcbc8;border-radius:7px;padding:7px 11px;font-size:10px;cursor:pointer}.view-switcher button.active{color:#20342c;background:#d5e2d5}
.scene-caption{position:absolute;z-index:2;left:16px;bottom:16px;display:flex;flex-direction:column;gap:4px;max-width:min(420px,calc(100vw - 32px));color:#edf2ee;text-shadow:0 2px 10px #061017}
.scene-caption strong{font-size:15px;font-weight:600}.scene-caption span{font-size:10px;color:#c4d0cc}
.error-banner{position:absolute;z-index:4;top:108px;left:14px;right:14px;max-width:760px;padding:12px;display:flex;align-items:flex-start;gap:12px;background:#3e2524ed;border:1px solid #a86158;border-radius:10px;color:#fff}
.error-banner div{min-width:0;flex:1}.error-banner strong{display:block;font-size:11px;margin-bottom:5px}.error-banner pre{max-height:180px;margin:0;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:10px/1.45 ui-monospace,monospace;color:#f0d0ca}
.error-banner button{flex:none;border:1px solid #d69a8f;background:#6d3730;color:#fff;border-radius:7px;padding:8px 10px;font-size:10px;cursor:pointer}
.control-panel{position:absolute;z-index:5;top:58px;right:12px;bottom:12px;width:min(310px,calc(100vw - 24px));padding:16px 17px 13px;background:#f1f2ee;color:#202c31;border:1px solid #ffffff80;border-radius:12px;overflow-y:auto;box-shadow:0 16px 48px #06101755}
.panel-heading{display:flex;align-items:center;justify-content:space-between;padding-bottom:12px;border-bottom:1px solid #d9dfdb}.panel-heading small{font-size:9px;color:#758d80}.panel-heading h1{margin-top:4px;font:500 20px/1 Georgia,serif;letter-spacing:-.03em}
.experiment-note{margin:12px 0 0;padding:9px;border:1px solid #d6dcd6;border-radius:7px;font-size:10px;line-height:1.6;color:#65756b}.experiment-note strong{display:block;color:#3d5145}
.close-button{width:30px;height:30px;border:1px solid #d8ded9;border-radius:7px;background:#fafbf8;color:#66736d;font-size:20px;line-height:1;cursor:pointer}
.control-section{padding:12px 0;border-bottom:1px solid #d9dfdb}.section-title{display:flex;align-items:center;gap:8px;margin-bottom:10px}.section-title h2{font-size:11px;font-weight:650;letter-spacing:.03em}
.provider-list{display:grid;gap:5px}.provider-row{width:100%;border:1px solid #dce1dd;background:#f8f9f6;border-radius:8px;padding:8px 9px;display:flex;align-items:center;text-align:left;gap:8px;cursor:pointer;color:#344247}.provider-row.selected{border-color:#7f9a88;background:#edf2ed;box-shadow:inset 0 0 0 1px #cad9ce}
.radio{width:11px;height:11px;border:1px solid #a5b0ab;border-radius:50%;flex:none}.selected .radio{border:3px solid #68876f;background:#eef4ed}.provider-copy{flex:1}.provider-copy strong,.provider-copy small{display:block}.provider-copy strong{font-size:10px}.provider-copy small{margin-top:3px;color:#81908e;font-size:9px}.selected-mark{color:#6b8b73;font-size:9px}
.segmented{display:grid;grid-template-columns:repeat(3,1fr);padding:3px;background:#e4e8e4;border-radius:8px}.segmented button{border:0;background:transparent;border-radius:6px;padding:8px 2px;color:#71807c;font-size:10px;cursor:pointer}.segmented button.active{background:#fff;color:#33423c;box-shadow:0 1px 3px #13201818}
.range-row{display:grid;grid-template-columns:72px 1fr 42px;align-items:center;gap:8px;margin-top:12px}.range-row label{font-size:10px;color:#667471}.range-row input{width:100%;accent-color:#688b73}.range-row input:disabled{opacity:.4}.range-row output{text-align:right;color:#61786b;font:10px ui-monospace,monospace}
.basic-note{margin:0 0 6px;color:#82908a;font-size:9px;line-height:1.4}
.quality-choice{display:grid;grid-template-columns:1fr 1fr;gap:7px}.quality-choice button{min-width:0;border:1px solid #dce1dd;background:#f8f9f6;border-radius:8px;padding:8px;text-align:left;cursor:pointer;color:#4a5b57}.quality-choice button.active{border-color:#89a08e;background:#e9f0e9}.quality-choice button:disabled{opacity:.55;cursor:not-allowed}
.quality-choice strong,.quality-choice small{display:block}.quality-choice strong{font-size:10px}.quality-choice small{margin-top:4px;font-size:8px;color:#7f8c87;white-space:normal}
.wind-toggle{margin-top:9px;padding:8px 9px;border:1px solid #dce1dd;border-radius:8px;display:flex;align-items:center;justify-content:space-between;cursor:pointer}.wind-toggle strong,.wind-toggle small{display:block}.wind-toggle strong{font-size:10px}.wind-toggle small{margin-top:3px;color:#84918c;font-size:9px}.wind-toggle input{accent-color:#769780}
.diagnostics{padding:12px 0 8px}.diag-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.diag-grid>div{padding:7px;background:#e8ece8;border-radius:6px}.diag-grid small,.diag-grid strong{display:block}.diag-grid small{font-size:8px;color:#87928d}.diag-grid strong{margin-top:4px;font:10px ui-monospace,monospace;color:#485a52}.diag-detail,.render-error{margin-top:8px;font-size:9px;color:#778681;line-height:1.45;overflow-wrap:anywhere}.render-error{color:#a4493c}
.control-panel footer{display:flex;justify-content:space-between;padding-top:10px;border-top:1px solid #d9dfdb;color:#8b9791;font:8px ui-monospace,monospace}
@media(max-width:700px){.topline{left:8px;right:8px;top:8px;gap:5px}.brand{padding:5px 7px}.brand strong{font-size:10px}.brand small{font-size:8px}.status-chip,.top-button{height:32px;padding:0 7px;font-size:9px}.top-button.copy-control{display:none}.view-switcher{left:8px;top:54px}.view-switcher button{padding:7px 8px}.control-panel{top:96px;right:8px;bottom:8px;width:calc(100vw - 16px);max-width:360px;padding:13px}.scene-caption{left:10px;bottom:10px}.error-banner{top:98px;left:8px;right:8px;padding:9px}.error-banner button{padding:7px;font-size:9px}}
</style>







