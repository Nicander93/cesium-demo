<script setup lang="ts">
import * as Cesium from 'cesium'
import GUI from 'lil-gui'
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
} from 'vue'
import { RouterLink } from 'vue-router'
import {
  createAnimation,
  parseAnimationDefinition,
  type AnimationDefinition,
  type AnimationTrackDefinition,
  type CameraKeyframe,
  type CameraTrackOptions,
  type FlowArrowOptions,
  type FountainOptions,
  type FlyLineOptions,
  type GeoPoint,
} from '@/animation'
import { inspectAnimations } from '@/animation/runtime'

type LocationId = 'guiyang' | 'equator' | 'high-latitude'
type ViewId = 'overview' | 'fountain' | 'side'
type TrackKind = AnimationTrackDefinition['kind']
type TrackOptions = AnimationTrackDefinition['options']
type AnimationInstance = ReturnType<typeof createAnimation>
type TimelineState = AnimationInstance['timeline']['state']

interface LocationPreset {
  label: string
  lon: number
  lat: number
}

interface TrackEditPatch {
  at?: number
  duration?: number
  fill?: 'none' | 'hold'
  options?: Record<string, unknown>
}

const cesiumVersion = (Cesium as unknown as { VERSION: string }).VERSION
const locations: Record<LocationId, LocationPreset> = {
  guiyang: { label: '贵阳', lon: 106.6302, lat: 26.647 },
  equator: { label: '赤道', lon: 0, lat: 0 },
  'high-latitude': { label: '高纬度', lon: 18.9553, lat: 69.6492 },
}
const kindLabels: Record<TrackKind, string> = {
  'fly-line': '空间飞线',
  'flow-arrow': '流向箭头',
  fountain: '喷泉粒子',
  camera: '相机轨道',
}
const stateLabels: Record<TimelineState, string> = {
  idle: '空闲',
  playing: '播放中',
  paused: '已暂停',
  stopped: '已停止',
  destroyed: '已销毁',
}
const host = ref<HTMLDivElement>()
const guiHost = ref<HTMLDivElement>()
const fileInput = ref<HTMLInputElement>()
const locationId = ref<LocationId>('guiyang')
const viewId = ref<ViewId>('overview')
const notice = ref('动画定义已加载，可选择轨道并编辑参数。')
const errors = ref<string[]>([])
const validationError = ref('')
const jsonDraft = ref('')
const selectedId = ref<string>()
const timelineState = ref<TimelineState>('idle')
const timelineTime = ref(0)
const timelineDuration = ref(12)
const timelineSpeed = ref(1)
const seekReport = ref<{ exact: string[]; reset: string[] }>({
  exact: [],
  reset: [],
})
const definition = shallowRef<AnimationDefinition>({
  schemaVersion: 1,
  duration: 12,
  loop: 'none',
  tracks: [],
})
const viewer = shallowRef<Cesium.Viewer>()
const location = computed(() => locations[locationId.value])
const tracks = computed(() => definition.value.tracks)
const selectedTrack = computed(() =>
  tracks.value.find((track) => track.id === selectedId.value),
)
const playheadPercent = computed(() =>
  timelineDuration.value > 0
    ? (timelineTime.value / timelineDuration.value) * 100
    : 0,
)
const versionLabel = computed(
  () => `Cesium ${cesiumVersion} · Timeline 编辑试验场`,
)
const cameraTrackActive = computed(
  () =>
    timelineState.value === 'playing' &&
    tracks.value.some((track) => track.kind === 'camera'),
)
let animation: AnimationInstance | undefined
let gui: GUI | undefined
let removeTimelineListener: (() => void) | undefined
let removeRenderError: (() => void) | undefined
let removePostRender: (() => void) | undefined
let savedCameraInputs: boolean | undefined
let disposed = false
let renderedFrames = 0

function cloneDefinition(value: AnimationDefinition): AnimationDefinition {
  return structuredClone(value)
}

function localPoint(
  east: number,
  north: number,
  up: number,
  preset = location.value,
): GeoPoint {
  const frame = Cesium.Transforms.eastNorthUpToFixedFrame(
    Cesium.Cartesian3.fromDegrees(preset.lon, preset.lat, 0),
  )
  const world = Cesium.Matrix4.multiplyByPoint(
    frame,
    new Cesium.Cartesian3(east, north, up),
    new Cesium.Cartesian3(),
  )
  const point = Cesium.Cartographic.fromCartesian(world)
  if (!point) throw new Error('ENU 坐标转换失败')
  return {
    lon: Cesium.Math.toDegrees(point.longitude),
    lat: Cesium.Math.toDegrees(point.latitude),
    height: point.height,
  }
}

function makeTrack(kind: TrackKind, at = 0): AnimationTrackDefinition {
  const id = `${kind}-${crypto.randomUUID().slice(0, 8)}`
  if (kind === 'fly-line') {
    const options: FlyLineOptions = {
      positions: [
        localPoint(-650, -85, 95),
        localPoint(-380, -85, 218),
        localPoint(-70, -85, 285),
        localPoint(250, -85, 232),
        localPoint(650, -85, 108),
      ],
      color: '#64d9ff',
      widthPx: 4,
      speed: 0.35,
    }
    return { id, kind, at, duration: 8, fill: 'hold', options }
  }
  if (kind === 'flow-arrow') {
    const options: FlowArrowOptions = {
      positions: [
        localPoint(-650, 145, 64),
        localPoint(-410, 145, 168),
        localPoint(-100, 145, 232),
        localPoint(220, 145, 187),
        localPoint(650, 145, 82),
      ],
      color: '#ffc477',
      widthPx: 20,
      speed: 0.25,
      spacing: 26,
    }
    return { id, kind, at, duration: 8, fill: 'hold', options }
  }
  if (kind === 'fountain') {
    const options: FountainOptions = {
      position: localPoint(0, 0, 0),
      emissionRate: 90,
      lifetime: 9.5,
      minSpeed: 18,
      maxSpeed: 46,
      gravity: 9.8,
      particleSizePx: 7,
      color: '#ffb5de',
      quality: 'standard',
    }
    return { id, kind, at, duration: 8, fill: 'none', options }
  }
  const keyframe = captureCameraKeyframe(0)
  const options: CameraTrackOptions = {
    keyframes: [keyframe, { ...keyframe, time: 2 }],
  }
  return { id, kind: 'camera', at, duration: 8, fill: 'hold', options }
}

function initialDefinition(): AnimationDefinition {
  return parseAnimationDefinition({
    schemaVersion: 1,
    duration: 30,
    loop: 'none',
    tracks: [
      { ...makeTrack('fly-line', 0), duration: 20 },
      { ...makeTrack('flow-arrow', 3), duration: 24 },
      { ...makeTrack('fountain', 8), duration: 18 },
    ],
  })
}

function setCameraInputLock(playing: boolean): void {
  const v = viewer.value
  const hasCameraTrack = definition.value.tracks.some(
    (track) => track.kind === 'camera',
  )
  if (playing && hasCameraTrack && v && !v.isDestroyed()) {
    if (savedCameraInputs === undefined)
      savedCameraInputs = v.scene.screenSpaceCameraController.enableInputs
    v.scene.screenSpaceCameraController.enableInputs = false
    return
  }
  restoreCameraInputs()
}

function restoreCameraInputs(): void {
  const v = viewer.value
  if (savedCameraInputs !== undefined && v && !v.isDestroyed())
    v.scene.screenSpaceCameraController.enableInputs = savedCameraInputs
  savedCameraInputs = undefined
}

function refreshTimeline(): void {
  if (!animation) return
  const timeline = animation.timeline
  timelineState.value = timeline.state
  timelineTime.value = timeline.timeSeconds
  timelineDuration.value = timeline.duration
  timelineSpeed.value = timeline.speed
  setCameraInputLock(timeline.state === 'playing')
  gui
    ?.controllersRecursive()
    .forEach((controller) => controller.updateDisplay())
}

function replaceAnimation(input: unknown, announce = true): boolean {
  let parsed: AnimationDefinition
  try {
    parsed = parseAnimationDefinition(input)
  } catch (error) {
    reportValidationError(error)
    return false
  }

  const v = viewer.value
  const previous = animation
  const previousTime = previous?.timeline.timeSeconds ?? 0
  const previousSpeed = previous?.timeline.speed ?? 1
  const wasPlaying = previous?.timeline.state === 'playing'
  let next: AnimationInstance | undefined
  try {
    if (v && !v.isDestroyed()) next = createAnimation(v, parsed)
    if (next) {
      next.timeline.setSpeed(previousSpeed)
      if (wasPlaying) {
        next.timeline.play()
        next.timeline.seek(Math.min(previousTime, parsed.duration))
      } else {
        next.timeline.seek(Math.min(previousTime, parsed.duration))
      }
    }
  } catch (error) {
    next?.destroy()
    reportError(error)
    return false
  }

  removeTimelineListener?.()
  restoreCameraInputs()
  animation = next
  previous?.destroy()
  definition.value = parsed
  timelineTime.value = Math.min(previousTime, parsed.duration)
  timelineDuration.value = parsed.duration
  timelineSpeed.value = previousSpeed
  timelineState.value = next?.timeline.state ?? 'idle'
  selectedId.value = parsed.tracks.some(
    (track) => track.id === selectedId.value,
  )
    ? selectedId.value
    : parsed.tracks[0]?.id
  if (next) {
    removeTimelineListener = next.timeline.subscribe(refreshTimeline)
    refreshTimeline()
  }
  jsonDraft.value = JSON.stringify(parsed, null, 2)
  validationError.value = ''
  try {
    localStorage.setItem('animation-lab-definition-v1', jsonDraft.value)
  } catch {
    notice.value = '浏览器不允许本地保存；仍可导出 JSON 文件。'
  }
  if (announce) notice.value = '动画定义已应用，当前 timeline 可继续预览。'
  rebuildGui()
  return true
}

function updateSelected(patch: TrackEditPatch): void {
  const id = selectedId.value
  if (!id) return
  const current = definition.value.tracks.find((track) => track.id === id)
  if (!current) return
  const updated = {
    ...current,
    ...(patch.at === undefined ? {} : { at: patch.at }),
    ...(patch.duration === undefined ? {} : { duration: patch.duration }),
    ...(patch.fill === undefined ? {} : { fill: patch.fill }),
    options: patch.options
      ? { ...current.options, ...patch.options }
      : current.options,
  }
  const candidate = {
    ...definition.value,
    duration: Math.max(
      definition.value.duration,
      updated.at + updated.duration,
    ),
    tracks: definition.value.tracks.map((track) =>
      track.id === id ? updated : track,
    ),
  }
  replaceAnimation(candidate, false)
}

function addEffect(kind: TrackKind): string | undefined {
  if (
    kind === 'camera' &&
    definition.value.tracks.some((track) => track.kind === 'camera')
  ) {
    notice.value = '当前定义已有相机轨道，请在该轨道上继续添加关键帧。'
    return undefined
  }
  const next = cloneDefinition(definition.value)
  const at = Math.min(timelineTime.value, next.duration)
  const track = makeTrack(kind, at)
  next.tracks.push(track)
  next.duration = Math.max(next.duration, at + track.duration)
  selectedId.value = track.id
  if (!replaceAnimation(next)) return undefined
  notice.value = `${kindLabels[kind]}已添加到 ${at.toFixed(1)} 秒。`
  return track.id
}

function selectTrack(id: string): void {
  if (!definition.value.tracks.some((track) => track.id === id)) return
  selectedId.value = id
  rebuildGui()
}

function removeSelected(): void {
  const id = selectedId.value
  if (!id) return
  const next = cloneDefinition(definition.value)
  next.tracks = next.tracks.filter((track) => track.id !== id)
  selectedId.value = next.tracks[0]?.id
  replaceAnimation(next)
  notice.value = '已移除所选轨道。'
}

function handleTimelineAction(
  action: 'play' | 'pause' | 'resume' | 'stop' | 'destroy' | 'create',
): void {
  try {
    if (action === 'create') {
      replaceAnimation(definition.value)
      return
    }
    if (action === 'destroy') {
      removeTimelineListener?.()
      removeTimelineListener = undefined
      restoreCameraInputs()
      animation?.destroy()
      animation = undefined
      timelineState.value = 'destroyed'
      notice.value = 'Timeline 实例已销毁，场景可重新创建实例。'
      return
    }
    const timeline = animation?.timeline
    if (!timeline) return
    if (action === 'play') timeline.play()
    else if (action === 'pause') timeline.pause()
    else if (action === 'resume') timeline.resume()
    else timeline.stop()
    refreshTimeline()
  } catch (error) {
    reportError(error)
  }
}

function seek(time: number): void {
  if (!animation) return
  try {
    seekReport.value = animation.timeline.seek(time)
    refreshTimeline()
  } catch (error) {
    reportError(error)
  }
}

function setSpeed(speed: number): void {
  if (!animation) return
  try {
    animation.timeline.setSpeed(speed)
    refreshTimeline()
  } catch (error) {
    reportError(error)
  }
}

function captureCameraKeyframe(time = timelineTime.value): CameraKeyframe {
  const v = viewer.value
  if (!v || v.isDestroyed()) {
    const preset = locations[locationId.value]
    return {
      time,
      position: { lon: preset.lon, lat: preset.lat, height: 1600 },
      heading: 0,
      pitch: -45,
      roll: 0,
      easing: 'smoothstep',
    }
  }
  const position = Cesium.Cartographic.fromCartesian(v.camera.positionWC)
  if (!position) throw new Error('当前相机位置无法转换为地理坐标')
  return {
    time,
    position: {
      lon: Cesium.Math.toDegrees(position.longitude),
      lat: Cesium.Math.toDegrees(position.latitude),
      height: position.height,
    },
    heading: Cesium.Math.toDegrees(v.camera.heading),
    pitch: Cesium.Math.toDegrees(v.camera.pitch),
    roll: Cesium.Math.toDegrees(v.camera.roll),
    easing: 'smoothstep',
  }
}

function captureKeyframe(time = timelineTime.value): void {
  let track = selectedTrack.value
  if (!track || track.kind !== 'camera') {
    const id = addEffect('camera')
    track = definition.value.tracks.find((item) => item.id === id)
  }
  if (!track || track.kind !== 'camera') return
  const next = cloneDefinition(definition.value)
  const selected = next.tracks.find((item) => item.id === track?.id)
  if (!selected || selected.kind !== 'camera') return
  const keyframeTime = time - selected.at
  if (
    !Number.isFinite(keyframeTime) ||
    keyframeTime < 0 ||
    keyframeTime > selected.duration
  ) {
    reportValidationError('关键帧时间必须位于相机轨道的持续时间范围内。')
    return
  }
  const keyframe = captureCameraKeyframe(keyframeTime)
  const options = selected.options as CameraTrackOptions
  const existingIndex = options.keyframes.findIndex(
    (item) => item.time === keyframe.time,
  )
  if (existingIndex >= 0) options.keyframes[existingIndex] = keyframe
  else options.keyframes.push(keyframe)
  options.keyframes.sort((a, b) => a.time - b.time)
  if (!replaceAnimation(next)) return
  selectedId.value = selected.id
  notice.value = `已在 ${time.toFixed(2)} 秒记录相机关键帧。`
}

function setView(id: ViewId): void {
  const v = viewer.value
  if (!v || v.isDestroyed()) return
  viewId.value = id
  const target = Cesium.Cartesian3.fromDegrees(
    location.value.lon,
    location.value.lat,
    0,
  )
  const view =
    id === 'fountain'
      ? new Cesium.HeadingPitchRange(0.2, -0.38, 310)
      : id === 'side'
        ? new Cesium.HeadingPitchRange(1.12, -0.08, 920)
        : new Cesium.HeadingPitchRange(0.34, -0.56, 2100)
  v.camera.lookAt(target, view)
  v.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
  v.scene.requestRender()
}

function relocatePoint(
  point: GeoPoint,
  from: LocationPreset,
  to: LocationPreset,
): GeoPoint {
  const oldOrigin = Cesium.Cartesian3.fromDegrees(from.lon, from.lat, 0)
  const oldFrame = Cesium.Transforms.eastNorthUpToFixedFrame(oldOrigin)
  const world = Cesium.Cartesian3.fromDegrees(
    point.lon,
    point.lat,
    point.height ?? 0,
  )
  const local = Cesium.Matrix4.inverseTransformation(
    oldFrame,
    new Cesium.Matrix4(),
  )
  const offset = Cesium.Matrix4.multiplyByPoint(
    local,
    world,
    new Cesium.Cartesian3(),
  )
  return localPoint(offset.x, offset.y, offset.z, to)
}

function setLocation(id: LocationId): void {
  const oldLocation = location.value
  const newLocation = locations[id]
  locationId.value = id
  const next = cloneDefinition(definition.value)
  for (const track of next.tracks) {
    if (track.kind === 'fly-line' || track.kind === 'flow-arrow')
      track.options.positions = track.options.positions.map((point) =>
        relocatePoint(point, oldLocation, newLocation),
      )
    else if (track.kind === 'fountain')
      track.options.position = relocatePoint(
        track.options.position,
        oldLocation,
        newLocation,
      )
    else
      track.options.keyframes = track.options.keyframes.map((keyframe) => ({
        ...keyframe,
        position: relocatePoint(keyframe.position, oldLocation, newLocation),
      }))
  }
  replaceAnimation(next)
  setView(viewId.value)
}

function reportError(value: unknown): void {
  const message = value instanceof Error ? value.message : String(value)
  if (!errors.value.includes(message)) errors.value = [...errors.value, message]
  notice.value = message
}

function reportValidationError(value: unknown): void {
  validationError.value = value instanceof Error ? value.message : String(value)
  notice.value = validationError.value
}

function addPointControls(
  folder: GUI,
  point: GeoPoint,
  commit: (point: GeoPoint) => void,
): void {
  const model = { lon: point.lon, lat: point.lat, height: point.height ?? 0 }
  const finish = () => commit({ ...model })
  folder
    .add(model, 'lon', -180, 180, 0.00001)
    .name('经度 / 度')
    .onFinishChange(finish)
  folder
    .add(model, 'lat', -90, 90, 0.00001)
    .name('纬度 / 度')
    .onFinishChange(finish)
  folder
    .add(model, 'height', -1000, 100000, 0.5)
    .name('椭球高 / 米')
    .onFinishChange(finish)
}

function rebuildGui(): void {
  if (!guiHost.value) return
  gui?.destroy()
  gui = new GUI({ container: guiHost.value, title: '参数面板', width: 300 })
  const timelineFolder = gui.addFolder('Timeline')
  const timelineModel = reactive({
    duration: definition.value.duration,
    loop: definition.value.loop ?? 'none',
  })
  const minimumDuration = Math.max(
    1,
    ...definition.value.tracks.map((item) => item.at + item.duration),
  )
  timelineFolder
    .add(
      timelineModel,
      'duration',
      minimumDuration,
      Math.max(300, minimumDuration, definition.value.duration),
      0.5,
    )
    .name('总时长 / 秒')
    .onFinishChange((duration: number) => {
      const next = cloneDefinition(definition.value)
      next.duration = duration
      replaceAnimation(next)
    })
  timelineFolder
    .add(timelineModel, 'loop', { 不循环: 'none', 循环: 'repeat' })
    .name('循环方式')
    .onChange((loop: 'none' | 'repeat') => {
      const next = cloneDefinition(definition.value)
      next.loop = loop
      replaceAnimation(next)
    })
  timelineFolder.open()

  const track = selectedTrack.value
  if (!track) return
  const trackFolder = gui.addFolder(`${kindLabels[track.kind]} · ${track.id}`)
  const trackModel = reactive({
    at: track.at,
    duration: track.duration,
    fill: track.fill ?? 'none',
  })
  trackFolder
    .add(trackModel, 'at', 0, Math.max(300, definition.value.duration), 0.1)
    .name('开始时间 / 秒')
    .onFinishChange((at: number) => updateSelected({ at }))
  trackFolder
    .add(trackModel, 'duration', 0.1, 300, 0.1)
    .name('持续时间 / 秒')
    .onFinishChange((duration: number) => updateSelected({ duration }))
  trackFolder
    .add(trackModel, 'fill', { 不填充: 'none', 保持末态: 'hold' })
    .name('结束填充')
    .onChange((fill: 'none' | 'hold') => updateSelected({ fill }))

  const options = track.options as TrackOptions & Record<string, unknown>
  const defaults =
    track.kind === 'fountain'
      ? {
          emissionRate: 90,
          lifetime: 5,
          minSpeed: 22,
          maxSpeed: 28,
          gravity: 9.8,
          particleSizePx: 7,
          color: '#bcecff',
          quality: 'standard',
        }
      : {
          color: '#49b7ff',
          widthPx: track.kind === 'flow-arrow' ? 20 : 6,
          speed: 0.35,
          direction: 'forward',
          opacity: 1,
          spacing: 10,
        }
  const model = { ...defaults, ...options } as Record<string, unknown>
  const updateOption = (key: string, value: unknown) =>
    updateSelected({ options: { [key]: value } })
  if (track.kind === 'fly-line' || track.kind === 'flow-arrow') {
    trackFolder
      .addColor(model, 'color')
      .name('颜色')
      .onFinishChange((value: string) => updateOption('color', value))
    trackFolder
      .add(model, 'widthPx', 1, 64, 1)
      .name('线宽 / px')
      .onFinishChange((value: number) => updateOption('widthPx', value))
    trackFolder
      .add(model, 'speed', 0, 20, 0.05)
      .name('流动 / 次每秒')
      .onFinishChange((value: number) => updateOption('speed', value))
    trackFolder
      .add(model, 'direction', { 正向: 'forward', 反向: 'backward' })
      .name('方向')
      .onChange((value: 'forward' | 'backward') =>
        updateOption('direction', value),
      )
    trackFolder
      .add(model, 'opacity', 0, 1, 0.01)
      .name('透明度')
      .onFinishChange((value: number) => updateOption('opacity', value))
    if (track.kind === 'flow-arrow')
      trackFolder
        .add(model, 'spacing', 1, 200, 1)
        .name('全路径图案数')
        .onFinishChange((value: number) => updateOption('spacing', value))
    const path = track.options.positions
    const geometryFolder = trackFolder.addFolder('路径节点 / WGS84').close()
    path.forEach((point, index) => {
      const pointFolder = geometryFolder.addFolder(`节点 ${index + 1}`).close()
      addPointControls(pointFolder, point, (updated) => {
        const positions = path.map((item) => ({ ...item }))
        positions[index] = updated
        updateOption('positions', positions)
      })
    })
    geometryFolder
      .add(
        {
          add() {
            const last = path[path.length - 1]
            if (!last) return
            const longitude = last.lon + 0.001
            updateOption('positions', [
              ...path,
              { ...last, lon: longitude > 180 ? longitude - 360 : longitude },
            ])
          },
        },
        'add',
      )
      .name('增加末端节点')
    const remove = geometryFolder
      .add(
        {
          remove() {
            updateOption('positions', path.slice(0, -1))
          },
        },
        'remove',
      )
      .name('删除末端节点')
    if (path.length <= 2) remove.disable()
  } else if (track.kind === 'fountain') {
    trackFolder
      .addColor(model, 'color')
      .name('颜色')
      .onFinishChange((value: string) => updateOption('color', value))
    trackFolder
      .add(model, 'emissionRate', 0, 2000, 1)
      .name('发射率')
      .onFinishChange((value: number) => updateOption('emissionRate', value))
    trackFolder
      .add(model, 'lifetime', 0.05, 30, 0.05)
      .name('粒子寿命')
      .onFinishChange((value: number) => updateOption('lifetime', value))
    trackFolder
      .add(model, 'minSpeed', 0, 300, 1)
      .name('最小速度')
      .onFinishChange((value: number) => updateOption('minSpeed', value))
    trackFolder
      .add(model, 'maxSpeed', 0, 300, 1)
      .name('最大速度')
      .onFinishChange((value: number) => updateOption('maxSpeed', value))
    trackFolder
      .add(model, 'gravity', 0, 100, 0.1)
      .name('重力')
      .onFinishChange((value: number) => updateOption('gravity', value))
    trackFolder
      .add(model, 'particleSizePx', 1, 64, 1)
      .name('粒子尺寸 / px')
      .onFinishChange((value: number) => updateOption('particleSizePx', value))
    trackFolder
      .add(model, 'quality', { 基础: 'basic', 标准: 'standard' })
      .name('质量')
      .onChange((value: 'basic' | 'standard') => updateOption('quality', value))
    addPointControls(
      trackFolder.addFolder('发射位置 / WGS84').close(),
      track.options.position,
      (position) => updateOption('position', position),
    )
  } else {
    const keyframeModel = reactive({ count: track.options.keyframes.length })
    trackFolder.add(keyframeModel, 'count').name('关键帧数量').disable()
    trackFolder
      .add({ record: () => captureKeyframe() }, 'record')
      .name('记录当前相机')
    const keyframes = track.options.keyframes
    keyframes.forEach((keyframe, index) => {
      const keyFolder = trackFolder
        .addFolder(`镜头 ${index + 1} / ${keyframe.time.toFixed(2)}s`)
        .close()
      const keyModel = {
        time: keyframe.time,
        heading: keyframe.heading,
        pitch: keyframe.pitch,
        roll: keyframe.roll,
        easing: keyframe.easing ?? 'linear',
      }
      const updateKey = (patch: Partial<CameraKeyframe>) => {
        const nextKeys = keyframes.map((key) => ({
          ...key,
          position: { ...key.position },
        }))
        nextKeys[index] = { ...keyframe, ...patch }
        updateOption('keyframes', nextKeys)
      }
      const timeControl = keyFolder
        .add(keyModel, 'time', 0, track.duration, 0.1)
        .name('时间 / 秒')
        .onFinishChange((time: number) => updateKey({ time }))
      if (index === 0) timeControl.disable()
      keyFolder
        .add(keyModel, 'heading', -360, 360, 0.1)
        .name('朝向 / 度')
        .onFinishChange((heading: number) => updateKey({ heading }))
      keyFolder
        .add(keyModel, 'pitch', -90, 90, 0.1)
        .name('俯仰 / 度')
        .onFinishChange((pitch: number) => updateKey({ pitch }))
      keyFolder
        .add(keyModel, 'roll', -360, 360, 0.1)
        .name('翻滚 / 度')
        .onFinishChange((roll: number) => updateKey({ roll }))
      keyFolder
        .add(keyModel, 'easing', { 线性: 'linear', 平滑: 'smoothstep' })
        .name('到下一帧插值')
        .onChange((easing: 'linear' | 'smoothstep') => updateKey({ easing }))
      addPointControls(
        keyFolder.addFolder('镜头位置').close(),
        keyframe.position,
        (position) => updateKey({ position }),
      )
      const remove = keyFolder
        .add(
          {
            remove() {
              updateOption(
                'keyframes',
                keyframes.filter((_key, keyIndex) => keyIndex !== index),
              )
            },
          },
          'remove',
        )
        .name('删除此关键帧')
      if (index === 0 || keyframes.length <= 2) remove.disable()
    })
  }
  trackFolder.open()
}

function exportDefinition(): string {
  return JSON.stringify(definition.value, null, 2)
}

function downloadDefinition(): void {
  const json = exportDefinition()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'animation-definition.json'
  link.click()
  URL.revokeObjectURL(url)
  jsonDraft.value = json
}

function importDefinition(json: string): void {
  jsonDraft.value = json
  try {
    const parsed = parseAnimationDefinition(JSON.parse(json) as unknown)
    if (replaceAnimation(parsed)) notice.value = 'JSON 已导入并保存到本地。'
  } catch (error) {
    reportValidationError(error)
  }
}

async function handleFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  importDefinition(await file.text())
  input.value = ''
}

function createViewer(): void {
  disposeViewer()
  if (!host.value || disposed) return
  errors.value = []
  try {
    const v = new Cesium.Viewer(host.value, {
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
      requestRenderMode: true,
      maximumRenderTimeChange: Number.POSITIVE_INFINITY,
      shouldAnimate: false,
    })
    viewer.value = v
    v.scene.backgroundColor = Cesium.Color.fromCssColorString('#07111c')
    v.scene.globe.baseColor = Cesium.Color.fromCssColorString('#12283a')
    v.scene.globe.enableLighting = false
    if (v.scene.skyBox) v.scene.skyBox.show = false
    if (v.scene.skyAtmosphere) v.scene.skyAtmosphere.show = false
    removePostRender = v.scene.postRender.addEventListener(() => {
      renderedFrames++
      refreshTimeline()
    })
    removeRenderError = v.scene.renderError.addEventListener((_scene, error) =>
      reportError(error),
    )
    let saved = false
    try {
      const local = localStorage.getItem('animation-lab-definition-v1')
      if (local) {
        definition.value = parseAnimationDefinition(
          JSON.parse(local) as unknown,
        )
        saved = true
      }
    } catch (error) {
      reportValidationError(error)
    }
    if (!saved) definition.value = initialDefinition()
    jsonDraft.value = JSON.stringify(definition.value, null, 2)
    selectedId.value = definition.value.tracks[0]?.id
    replaceAnimation(definition.value, false)
    setView('overview')
  } catch (error) {
    reportError(error)
  }
}

function disposeViewer(): void {
  removeRenderError?.()
  removeRenderError = undefined
  removePostRender?.()
  removePostRender = undefined
  removeTimelineListener?.()
  removeTimelineListener = undefined
  restoreCameraInputs()
  animation?.destroy()
  animation = undefined
  const v = viewer.value
  if (v && !v.isDestroyed()) v.destroy()
  viewer.value = undefined
  timelineState.value = 'destroyed'
}

function viewerFirstDestroy(): void {
  const v = viewer.value
  if (v && !v.isDestroyed()) v.destroy()
  removeRenderError?.()
  removeRenderError = undefined
  removePostRender?.()
  removePostRender = undefined
  removeTimelineListener?.()
  removeTimelineListener = undefined
  animation?.destroy()
  animation = undefined
  restoreCameraInputs()
  viewer.value = undefined
  timelineState.value = 'destroyed'
  notice.value = '已先销毁 Viewer，再清理 timeline。'
}

function getDevState() {
  const v = viewer.value
  let resources: ReturnType<typeof inspectAnimations> | undefined
  if (v && !v.isDestroyed()) {
    try {
      resources = inspectAnimations(v)
    } catch (error) {
      reportError(error)
    }
  }
  const clock =
    v && !v.isDestroyed()
      ? {
          shouldAnimate: v.clock.shouldAnimate,
          multiplier: v.clock.multiplier,
          currentTime: Cesium.JulianDate.toDate(
            v.clock.currentTime,
          ).toISOString(),
        }
      : undefined
  const gl =
    v && !v.isDestroyed()
      ? (v.canvas.getContext('webgl2') ?? v.canvas.getContext('webgl'))
      : undefined
  return {
    version: versionLabel.value,
    definition: cloneDefinition(definition.value),
    timeline: animation
      ? {
          state: animation.timeline.state,
          timeSeconds: animation.timeline.timeSeconds,
          duration: animation.timeline.duration,
          speed: animation.timeline.speed,
          driver: animation.timeline.driver,
        }
      : undefined,
    selectedId: selectedId.value,
    seekReport: {
      exact: [...seekReport.value.exact],
      reset: [...seekReport.value.reset],
    },
    effects: animation
      ? [...animation.effects.entries()].map(([id, effect]) => ({
          id,
          state: effect.state,
        }))
      : [],
    resources,
    primitiveCount: v && !v.isDestroyed() ? v.scene.primitives.length : 0,
    entityCount: v && !v.isDestroyed() ? v.entities.values.length : 0,
    clock,
    sceneTilesLoaded: v && !v.isDestroyed() ? v.scene.globe.tilesLoaded : false,
    renderedFrames,
    cameraInputsEnabled:
      v && !v.isDestroyed()
        ? v.scene.screenSpaceCameraController.enableInputs
        : undefined,
    camera:
      v && !v.isDestroyed()
        ? {
            position: {
              x: v.camera.positionWC.x,
              y: v.camera.positionWC.y,
              z: v.camera.positionWC.z,
            },
            heading: v.camera.heading,
            pitch: v.camera.pitch,
            roll: v.camera.roll,
          }
        : undefined,
    validationError: validationError.value,
    ready: Boolean(
      v &&
        !v.isDestroyed() &&
        v.canvas.isConnected &&
        errors.value.length === 0,
    ),
    errors: [...errors.value],
    ...(gl ? { renderer: String(gl.getParameter(gl.RENDERER)) } : {}),
  }
}

const animationLab = {
  getState: getDevState,
  getDefinition: () => cloneDefinition(definition.value),
  setDefinition: (input: unknown) => replaceAnimation(input),
  action: handleTimelineAction,
  addEffect,
  selectTrack,
  updateSelected,
  removeSelected,
  seek,
  setSpeed,
  captureCameraKeyframe: captureKeyframe,
  exportDefinition,
  importDefinition,
  setLocation,
  setView,
  viewerFirstDestroy,
  recreateViewer: createViewer,
}
declare global {
  interface Window {
    __animationLab?: typeof animationLab
  }
}

onMounted(() => {
  createViewer()
  requestAnimationFrame(rebuildGui)
  if (import.meta.env.DEV) window.__animationLab = animationLab
})

onBeforeUnmount(() => {
  disposed = true
  if (window.__animationLab === animationLab) delete window.__animationLab
  gui?.destroy()
  gui = undefined
  disposeViewer()
})
</script>

<template>
  <main class="animation-lab">
    <div
      ref="host"
      class="animation-lab__globe"
      aria-label="离线 Cesium 动画场景"
    />

    <header class="animation-lab__header">
      <RouterLink class="animation-lab__back" to="/"
        >← <span>示例首页</span></RouterLink
      >
      <div class="animation-lab__heading">
        <p class="animation-lab__eyebrow">SPATIAL MOTION / TIMELINE LAB</p>
        <h1>GIS 动画实验场</h1>
        <p>组合场景效果与相机关键帧，在离线地球上编辑、预览和保存动画。</p>
      </div>
      <span class="animation-lab__version">{{ versionLabel }}</span>
    </header>

    <aside class="animation-lab__scene" aria-label="场景设置">
      <label
        >场景
        <select
          :value="locationId"
          @change="
            setLocation(
              ($event.target as HTMLSelectElement).value as LocationId,
            )
          "
        >
          <option value="guiyang">贵阳</option>
          <option value="equator">赤道</option>
          <option value="high-latitude">高纬度</option>
        </select>
      </label>
      <label
        >视角
        <select
          :value="viewId"
          @change="
            setView(($event.target as HTMLSelectElement).value as ViewId)
          "
        >
          <option value="overview">全景</option>
          <option value="fountain">喷泉近景</option>
          <option value="side">侧视</option>
        </select>
      </label>
    </aside>

    <section class="animation-lab__panel" aria-label="动画参数面板">
      <div ref="guiHost" class="animation-lab__gui" />
      <div class="animation-lab__add">
        <span>添加轨道</span>
        <button @click="addEffect('fly-line')">＋ 飞线</button>
        <button @click="addEffect('flow-arrow')">＋ 箭头</button>
        <button @click="addEffect('fountain')">＋ 喷泉</button>
        <button @click="addEffect('camera')">＋ 相机</button>
      </div>
      <div class="animation-lab__files">
        <button @click="downloadDefinition">导出 JSON</button>
        <button @click="fileInput?.click()">导入 JSON</button>
        <input
          ref="fileInput"
          type="file"
          accept="application/json,.json"
          @change="handleFileChange"
        />
      </div>
      <p class="animation-lab__notice" role="status">{{ notice }}</p>
      <p v-if="validationError" class="animation-lab__error" role="alert">
        {{ validationError }}
      </p>
      <p v-if="errors.length" class="animation-lab__error" role="alert">
        {{ errors.at(-1) }}
      </p>
    </section>

    <section class="animation-lab__timeline" aria-label="动画时间轴">
      <div class="animation-lab__transport">
        <div class="animation-lab__buttons">
          <button
            :disabled="timelineState === 'playing'"
            @click="handleTimelineAction('play')"
          >
            播放
          </button>
          <button
            :disabled="timelineState !== 'playing'"
            @click="handleTimelineAction('pause')"
          >
            暂停
          </button>
          <button
            :disabled="timelineState !== 'paused'"
            @click="handleTimelineAction('resume')"
          >
            继续
          </button>
          <button @click="handleTimelineAction('stop')">停止</button>
        </div>
        <label class="animation-lab__speed"
          >速度
          <select
            :value="timelineSpeed"
            @change="
              setSpeed(Number(($event.target as HTMLSelectElement).value))
            "
          >
            <option :value="0.25">0.25×</option>
            <option :value="0.5">0.5×</option>
            <option :value="1">1×</option>
            <option :value="2">2×</option>
            <option :value="4">4×</option>
          </select>
        </label>
        <span class="animation-lab__clock"
          >{{ timelineTime.toFixed(2) }} <i>/</i>
          {{ timelineDuration.toFixed(2) }} 秒</span
        >
        <span class="animation-lab__state">{{
          stateLabels[timelineState]
        }}</span>
      </div>
      <p v-if="cameraTrackActive" class="animation-lab__camera-warning">
        相机轨道正在播放，场景鼠标控制已暂时锁定。
      </p>
      <div class="animation-lab__ruler">
        <span>0s</span><span>{{ (timelineDuration / 2).toFixed(1) }}s</span
        ><span>{{ timelineDuration.toFixed(1) }}s</span>
      </div>
      <div
        class="animation-lab__tracks"
        :style="{ height: `${Math.max(42, tracks.length * 28 + 8)}px` }"
      >
        <button
          v-for="(track, index) in tracks"
          :key="track.id"
          class="animation-lab__track"
          :class="[
            `animation-lab__track--${track.kind}`,
            { 'is-selected': selectedId === track.id },
          ]"
          :style="{
            left: `${(track.at / timelineDuration) * 100}%`,
            top: `${index * 28 + 4}px`,
            width: `${Math.max(1.5, (track.duration / timelineDuration) * 100)}%`,
          }"
          :title="`${kindLabels[track.kind]} · ${track.id} · ${track.at}s + ${track.duration}s`"
          @click="selectTrack(track.id)"
        >
          <span>{{ track.id }}</span>
        </button>
        <span
          class="animation-lab__playhead"
          :style="{ left: `${playheadPercent}%` }"
        />
      </div>
      <input
        class="animation-lab__scrubber"
        type="range"
        min="0"
        :max="timelineDuration"
        step="0.01"
        :value="timelineTime"
        aria-label="时间轴播放头"
        @input="seek(Number(($event.target as HTMLInputElement).value))"
      />
      <div class="animation-lab__track-list">
        <span class="animation-lab__track-heading">轨道</span>
        <button
          v-for="track in tracks"
          :key="`row-${track.id}`"
          :class="{ 'is-selected': selectedId === track.id }"
          @click="selectTrack(track.id)"
        >
          {{ kindLabels[track.kind] }} · {{ track.id }}
          <small
            >{{ track.at.toFixed(1) }}–{{
              (track.at + track.duration).toFixed(1)
            }}s</small
          >
        </button>
        <button
          v-if="selectedTrack"
          class="animation-lab__remove"
          @click="removeSelected"
        >
          移除所选
        </button>
        <button
          v-if="selectedTrack?.kind === 'camera'"
          @click="captureKeyframe()"
        >
          记录相机关键帧
        </button>
      </div>
      <div
        v-if="seekReport.exact.length || seekReport.reset.length"
        class="animation-lab__seek-report"
      >
        Seek 精确：{{ seekReport.exact.join('、') || '无' }} · 重置：{{
          seekReport.reset.join('、') || '无'
        }}
      </div>
    </section>
    <footer class="animation-lab__footer">
      {{ location.label }} · Ellipsoid 地形 · 本地场景
    </footer>
  </main>
</template>

<style scoped>
.animation-lab {
  position: fixed;
  inset: 0;
  --timeline-height: min(40vh, 340px);
  overflow: hidden;
  background: #07111c;
  color: #d5e2ec;
  font-family: Inter, 'Segoe UI', sans-serif;
}
.animation-lab__globe {
  position: absolute;
  inset: 0;
}
.animation-lab__header {
  position: absolute;
  z-index: 2;
  top: 24px;
  left: 28px;
  right: 28px;
  display: flex;
  align-items: flex-start;
  gap: 20px;
  pointer-events: none;
}
.animation-lab__header > * {
  pointer-events: auto;
}
.animation-lab__back {
  flex: 0 0 auto;
  padding: 9px 12px;
  border: 1px solid rgba(157, 189, 212, 0.16);
  border-radius: 8px;
  color: #b8c8d4;
  text-decoration: none;
  font-size: 12px;
}
.animation-lab__back:hover {
  color: white;
  border-color: rgba(100, 217, 255, 0.5);
}
.animation-lab__heading {
  margin-right: auto;
}
.animation-lab__heading h1 {
  margin: 4px 0;
  color: #eef7fc;
  font-size: 21px;
  font-weight: 600;
}
.animation-lab__heading > p:last-child {
  margin: 0;
  color: #a3b5c3;
  font-size: 11px;
}
.animation-lab__eyebrow {
  margin: 0;
  color: #68cfe8;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.16em;
}
.animation-lab__version {
  margin-top: 8px;
  color: #879cac;
  font-size: 10px;
}
.animation-lab__scene {
  position: absolute;
  z-index: 2;
  top: 112px;
  left: 28px;
  display: flex;
  gap: 8px;
}
.animation-lab__scene label,
.animation-lab__speed {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #9aafbd;
  font-size: 10px;
}
.animation-lab select {
  padding: 6px 9px;
  border: 1px solid rgba(157, 189, 212, 0.17);
  border-radius: 6px;
  background: #0c1b28;
  color: #d5e2ec;
  font: inherit;
}
.animation-lab__panel {
  position: absolute;
  z-index: 2;
  top: 150px;
  right: 24px;
  bottom: calc(var(--timeline-height) + 58px);
  width: 320px;
  overflow-y: auto;
  padding: 10px;
  border: 1px solid rgba(167, 201, 225, 0.15);
  border-radius: 12px;
  background: rgba(7, 18, 29, 0.87);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(16px);
  scrollbar-width: thin;
}
.animation-lab__gui :deep(.lil-gui) {
  width: 100% !important;
  --background-color: rgba(10, 25, 38, 0.92);
  --text-color: #d1dee7;
  --title-background-color: #102638;
  --widget-color: #19394b;
  --hover-color: #21495d;
  --focus-color: #26718b;
  --number-color: #9beaff;
  --string-color: #b7e9f5;
  font-size: 11px;
}
.animation-lab__add,
.animation-lab__files {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 2px 7px;
  border-top: 1px solid rgba(174, 201, 220, 0.1);
}
.animation-lab__add > span {
  flex-basis: 100%;
  color: #94aaba;
  font-size: 10px;
}
.animation-lab button {
  min-height: 27px;
  padding: 0 8px;
  border: 1px solid rgba(157, 189, 212, 0.16);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.035);
  color: #ccdae3;
  cursor: pointer;
  font: inherit;
  font-size: 10px;
}
.animation-lab button:hover:not(:disabled) {
  border-color: rgba(100, 217, 255, 0.48);
  background: rgba(100, 217, 255, 0.1);
  color: #f4fbff;
}
.animation-lab button:focus-visible,
.animation-lab select:focus-visible,
.animation-lab input:focus-visible {
  outline: 2px solid #75d8ff;
  outline-offset: 2px;
}
.animation-lab button:disabled {
  opacity: 0.4;
  cursor: default;
}
.animation-lab__files input {
  display: none;
}
.animation-lab__notice,
.animation-lab__error {
  margin: 4px 2px;
  color: #a9c1ce;
  font-size: 10px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.animation-lab__error {
  color: #ff9e9e;
}
.animation-lab__timeline {
  position: absolute;
  z-index: 2;
  right: 24px;
  bottom: 42px;
  left: 24px;
  height: var(--timeline-height);
  overflow-y: auto;
  padding: 14px 16px 10px;
  border: 1px solid rgba(167, 201, 225, 0.16);
  border-radius: 12px;
  background: rgba(7, 18, 29, 0.92);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(18px);
}
.animation-lab__transport {
  display: flex;
  align-items: center;
  gap: 14px;
}
.animation-lab__buttons {
  display: flex;
  gap: 6px;
}
.animation-lab__buttons button:first-child {
  border-color: rgba(100, 217, 255, 0.45);
  color: #a7eaff;
}
.animation-lab__clock {
  margin-left: auto;
  color: #dce9f1;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}
.animation-lab__clock i {
  color: #667f90;
  font-style: normal;
}
.animation-lab__state {
  min-width: 42px;
  color: #75d8bf;
  font-size: 10px;
}
.animation-lab__camera-warning {
  position: absolute;
  top: 12px;
  right: 18px;
  margin: 0;
  color: #ffd188;
  font-size: 10px;
}
.animation-lab__ruler {
  display: flex;
  justify-content: space-between;
  margin: 15px 0 5px;
  color: #71899a;
  font-size: 9px;
  font-variant-numeric: tabular-nums;
}
.animation-lab__tracks {
  position: relative;
  height: 42px;
  max-height: 150px;
  overflow-y: auto;
  border: 1px solid rgba(132, 166, 190, 0.13);
  border-radius: 6px;
  background: repeating-linear-gradient(
    90deg,
    rgba(138, 167, 186, 0.12) 0 1px,
    transparent 1px 10%
  );
}
.animation-lab__track {
  position: absolute;
  top: 5px;
  height: 30px;
  overflow: hidden;
  white-space: nowrap;
  text-align: left;
}
.animation-lab__track--fly-line {
  background: rgba(54, 176, 218, 0.4) !important;
}
.animation-lab__track--flow-arrow {
  background: rgba(221, 158, 79, 0.4) !important;
}
.animation-lab__track--fountain {
  background: rgba(218, 114, 177, 0.4) !important;
}
.animation-lab__track--camera {
  background: rgba(135, 173, 255, 0.42) !important;
}
.animation-lab__track.is-selected {
  outline: 1px solid #bdefff;
}
.animation-lab__track span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
}
.animation-lab__playhead {
  position: absolute;
  z-index: 1;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #f6fbff;
  box-shadow: 0 0 8px #75d8ff;
  pointer-events: none;
}
.animation-lab__scrubber {
  display: block;
  width: 100%;
  height: 14px;
  margin: 2px 0 0;
  accent-color: #75d8ff;
  cursor: ew-resize;
}
.animation-lab__track-list {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  overflow-x: auto;
  white-space: nowrap;
  scrollbar-width: thin;
}
.animation-lab__track-heading {
  margin-right: 3px;
  color: #8299a9;
  font-size: 9px;
}
.animation-lab__track-list button {
  flex: 0 0 auto;
}
.animation-lab__track-list button.is-selected {
  border-color: #5bcbe9;
  color: #a9edff;
}
.animation-lab__track-list small {
  margin-left: 5px;
  color: #859cab;
}
.animation-lab__track-list .animation-lab__remove {
  margin-left: auto;
  color: #d99da0;
}
.animation-lab__seek-report {
  margin-top: 5px;
  color: #8198a8;
  font-size: 9px;
}
.animation-lab__footer {
  position: absolute;
  right: 28px;
  bottom: 16px;
  color: #8298a8;
  font-size: 10px;
  pointer-events: none;
}
@media (max-width: 760px) {
  .animation-lab__header {
    top: 10px;
    left: 10px;
    right: 10px;
    gap: 10px;
  }
  .animation-lab__heading {
    padding-top: 30px;
    margin-left: -80px;
  }
  .animation-lab__heading h1 {
    font-size: 16px;
  }
  .animation-lab__heading > p:last-child {
    max-width: 260px;
    font-size: 9px;
  }
  .animation-lab__version {
    display: none;
  }
  .animation-lab__scene {
    top: 105px;
    left: 10px;
  }
  .animation-lab__panel {
    top: 145px;
    right: 10px;
    bottom: calc(var(--timeline-height) + 40px);
    width: min(290px, calc(100vw - 20px));
  }
  .animation-lab__timeline {
    right: 8px;
    bottom: 28px;
    left: 8px;
    padding: 10px;
  }
  .animation-lab__transport {
    gap: 6px;
    flex-wrap: wrap;
  }
  .animation-lab__buttons {
    gap: 3px;
  }
  .animation-lab__buttons button {
    padding: 0 6px;
  }
  .animation-lab__speed {
    gap: 3px;
  }
  .animation-lab__clock {
    font-size: 10px;
  }
  .animation-lab__camera-warning {
    top: 2px;
    right: 9px;
  }
  .animation-lab__footer {
    right: 12px;
    bottom: 7px;
    font-size: 9px;
  }
}
</style>
