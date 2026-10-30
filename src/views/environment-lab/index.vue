<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  createSceneConfiguration,
  normalizeSceneConfiguration,
  type SceneConfiguration,
} from './configuration'
import EnvironmentControls from './EnvironmentControls.vue'
import { useSceneConfiguration } from './useSceneConfiguration'
import {
  createEnvironmentDemo,
  type DemoStatus,
  type EnvironmentDemo,
} from './runtime'
import { environmentPresets } from '../../environment'
import type { EnvironmentPreset } from '../../environment'
import { sceneDefinitions, type DemoScene } from './landscape'

function cloneConfig<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const configState = useSceneConfiguration()
const scene = configState.scene
const configuration = configState.configuration
const screen = ref(
  new URLSearchParams(location.search).get('presentation') === 'screen',
)
const panel = ref(!screen.value && innerWidth > 760)
const container = ref<HTMLElement>()
const status = ref<DemoStatus>()
const fatalError = ref('')
const modelError = ref('')
const copied = ref(false)
const homeUrl = import.meta.env.BASE_URL
const sourceKind = computed(() => status.value?.source?.kind ?? null)
const waterAvailable = computed(
  () => scene.value === 'city' || status.value?.source?.waterBaseHeight != null,
)
let runtime: EnvironmentDemo | undefined
let alive = true
let transition = 0
let pendingScene: Promise<unknown> | undefined
const sceneIds: DemoScene[] = ['city', 'reservoir', 'flood']
const message = computed(
  () =>
    fatalError.value ||
    modelError.value ||
    status.value?.error ||
    status.value?.environment.error,
)
const ready = computed(
  () =>
    status.value?.environment.ready &&
    !status.value.environment.pending &&
    !status.value.loading &&
    !message.value &&
    (scene.value === 'city' || status.value.source?.ready),
)
const sourceDescription = computed(() => {
  const source = status.value?.source
  if (scene.value === 'city') return '本地街区模型与演示布局。'
  if (!source) return '正在加载真实场景数据。'
  return (
    source.label +
    '。' +
    (source.kind === 'terrain'
      ? '真实库区地形、影像与官方水域边界；非实时水位和水下测量。'
      : '实景倾斜摄影；演示水位为水平面展示，不是水动力结果。')
  )
})

function updateUrl(): void {
  configState.updateUrl(screen.value)
}
function validModelUrl(value: string): string {
  const raw = value.trim()
  const url = new URL(raw)
  if (!/^https?:\/\//i.test(raw) || !['http:', 'https:'].includes(url.protocol))
    throw new Error('模型地址必须是 HTTP(S) tileset.json URL。')
  return url.href
}
function commitConfiguration(value: SceneConfiguration): void {
  configState.replace(scene.value, value)
  runtime?.applyConfiguration(configuration.value)
  updateUrl()
}
async function chooseScene(next: DemoScene): Promise<boolean> {
  const token = ++transition
  configState.setScene(next)
  modelError.value = ''
  updateUrl()
  const nextConfig = configuration.value
  let loading: Promise<unknown> | undefined
  try {
    const modelUrl = nextConfig.source.modelUrl
      ? validModelUrl(nextConfig.source.modelUrl)
      : undefined
    loading = Promise.all([
      runtime?.loadScene(next, modelUrl, nextConfig),
      runtime?.setWeather(nextConfig.weather),
    ])
    pendingScene = loading
    await loading
    if (!alive || token !== transition || !runtime) return false
    runtime.applyConfiguration(configuration.value)
    runtime.setView(configuration.value.view)
    runtime.setWaterLevel(configuration.value.water.level)
    return true
  } catch (reason) {
    if (token === transition) modelError.value = String(reason)
    return false
  } finally {
    if (loading && pendingScene === loading) pendingScene = undefined
  }
}
async function chooseWeather(next: EnvironmentPreset): Promise<void> {
  const nextConfig = cloneConfig(configuration.value)
  const defaults = createSceneConfiguration(scene.value, next).environment
  nextConfig.weather = next
  nextConfig.environment = defaults
  configState.replace(scene.value, nextConfig)
  const token = ++transition
  await runtime?.setWeather(next)
  await pendingScene
  if (!alive || token !== transition || !runtime) return
  runtime.applyConfiguration(configuration.value)
  runtime.setWaterLevel(configuration.value.water.level)
  updateUrl()
}
function chooseView(value: SceneConfiguration['view']): void {
  commitConfiguration({ ...cloneConfig(configuration.value), view: value })
  runtime?.setView(value)
}
function toggleScreen(): void {
  screen.value = !screen.value
  panel.value = false
  updateUrl()
}
async function loadModel(): Promise<void> {
  try {
    const url = validModelUrl(configuration.value.source.modelUrl)
    const next = scene.value === 'city' ? 'flood' : scene.value
    const config = cloneConfig(configState.profiles.value[next])
    config.source.modelUrl = url
    configState.replace(next, config)
    modelError.value = ''
    if (next !== scene.value) configState.setScene(next)
    updateUrl()
    await chooseScene(next)
  } catch (reason) {
    modelError.value = String(reason)
  }
}
async function restoreSource(): Promise<void> {
  const config = cloneConfig(configuration.value)
  config.source.modelUrl = ''
  configState.replace(scene.value, config)
  modelError.value = ''
  updateUrl()
  await chooseScene(scene.value)
}
function resetScene(): void {
  configState.reset(scene.value)
  updateUrl()
  void chooseScene(scene.value)
}
async function importProfiles(text: string): Promise<void> {
  try {
    configState.importProfiles(text)
    const loading = chooseScene(scene.value)
    const token = transition
    const loaded = await loading
    if (loaded && token === transition) modelError.value = ''
  } catch (reason) {
    modelError.value = '导入失败：' + String(reason)
  }
}
function exportProfiles(): void {
  const blob = new Blob([configState.exportProfiles()], {
    type: 'application/json',
  })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = 'environment-lab-profiles-v1.json'
  anchor.click()
  URL.revokeObjectURL(href)
}
async function copyLink(): Promise<void> {
  updateUrl()
  try {
    await navigator.clipboard.writeText(location.href)
    copied.value = true
    setTimeout(() => {
      if (alive) copied.value = false
    }, 1400)
  } catch {
    copied.value = false
  }
}
onMounted(async () => {
  if (!container.value) return
  try {
    runtime = createEnvironmentDemo(container.value, (value) => {
      if (alive) status.value = value
    })
    const queryConfig = configuration.value
    if (
      import.meta.env.DEV ||
      import.meta.env.VITE_ENVIRONMENT_DIAGNOSTICS === '1'
    ) {
      const host = window as unknown as { __environmentDemo?: unknown }
      host.__environmentDemo = {
        getState: () => runtime?.getState(),
        setScene: chooseScene,
        setWeather: chooseWeather,
        setOptions: (
          value: Parameters<EnvironmentDemo['environment']['setOptions']>[0],
        ) => {
          const next = cloneConfig(configuration.value)
          next.environment = { ...next.environment, ...value }
          commitConfiguration(next)
        },
        setView: chooseView,
        setConfiguration: (value: unknown) => {
          const next = normalizeSceneConfiguration(scene.value, value)
          if (next.source.modelUrl)
            next.source.modelUrl = validModelUrl(next.source.modelUrl)
          commitConfiguration(next)
          runtime?.setView(next.view)
          runtime?.setWaterLevel(next.water.level)
        },
        getConfigurations: () => cloneConfig(configState.profiles.value),
        setWaterLevel: (value: number) => {
          const next = cloneConfig(configuration.value)
          next.water.level = value
          configState.replace(scene.value, next)
          runtime?.setWaterLevel(value)
          updateUrl()
        },
        setTilesetUrl: async (value: string) => {
          const modelUrl = validModelUrl(value)
          if (scene.value === 'city') configState.setScene('flood')
          const next = cloneConfig(configuration.value)
          next.source.modelUrl = modelUrl
          commitConfiguration(next)
          await loadModel()
        },
      }
    }
    const token = ++transition
    await Promise.all([
      runtime.loadScene(
        scene.value,
        queryConfig.source.modelUrl || undefined,
        queryConfig,
      ),
      runtime.setWeather(queryConfig.weather),
    ])
    if (!alive || token !== transition || !runtime) return
    runtime.applyConfiguration(configuration.value)
    runtime.setView(configuration.value.view)
    runtime.setWaterLevel(configuration.value.water.level)
    updateUrl()
  } catch (reason) {
    fatalError.value = String(reason)
  }
})
onBeforeUnmount(() => {
  alive = false
  delete (window as unknown as { __environmentDemo?: unknown })
    .__environmentDemo
  runtime?.dispose()
  runtime = undefined
})
</script>

<template>
  <main
    class="environment-demo"
    :class="{ 'environment-demo--screen': screen }"
  >
    <div
      ref="container"
      class="environment-demo__canvas"
      aria-label="可拖动的三维环境场景"
    ></div>
    <div
      v-if="screen"
      class="environment-demo__screen-mask"
      aria-hidden="true"
      :style="{
        opacity: configuration.presentation.maskOpacity,
        '--vignette-opacity': configuration.presentation.vignette,
      }"
    ></div>
    <header class="environment-demo__header">
      <div class="environment-demo__identity">
        <a
          :href="homeUrl"
          class="environment-demo__back"
          aria-label="返回演示首页"
          >↗</a
        >
        <div>
          <p class="environment-demo__eyebrow">SCENE / ENVIRONMENT</p>
          <h1>{{ screen ? '区域环境总览' : '环境观感实验室' }}</h1>
        </div>
      </div>
      <nav class="environment-demo__scene-tabs" aria-label="演示场景">
        <button
          v-for="id in sceneIds"
          :key="id"
          :aria-pressed="scene === id"
          @click="chooseScene(id)"
        >
          {{ sceneDefinitions[id].name }}
        </button>
      </nav>
      <div class="environment-demo__actions">
        <button :aria-pressed="screen" @click="toggleScreen">
          {{ screen ? '自由浏览' : '大屏构图' }}
        </button>
        <button
          :aria-expanded="panel"
          aria-controls="environment-controls"
          @click="panel = !panel"
        >
          {{ panel ? '收起' : '环境设置' }}
        </button>
      </div>
    </header>

    <aside
      v-if="panel"
      id="environment-controls"
      class="environment-demo__panel"
    >
      <EnvironmentControls
        :model-value="configuration"
        :scene="scene"
        :source-kind="sourceKind"
        :water-available="waterAvailable"
        :screen="screen"
        :copied="copied"
        :error="modelError"
        @update:model-value="commitConfiguration"
        @weather="chooseWeather"
        @view="chooseView"
        @reset="resetScene"
        @load-model="loadModel"
        @restore-source="restoreSource"
        @export="exportProfiles"
        @import="importProfiles"
        @share="copyLink"
      />
      <p class="environment-demo__note">
        {{ sourceDescription }} 天空资源：Poly Haven / CC0。
      </p>
      <p v-if="status?.source" class="environment-demo__note">
        {{ status.source.waterStatus }}
      </p>
      <p v-if="status?.source?.warning" class="environment-demo__note">
        {{ status.source.warning }}
      </p>
    </aside>

    <div v-if="message" class="environment-demo__error" role="alert">
      {{ message }}
    </div>
    <footer
      v-if="configuration.presentation.showLabels"
      class="environment-demo__footer"
    >
      <div>
        <p class="environment-demo__eyebrow">
          {{
            scene === 'city'
              ? '01 / URBAN'
              : scene === 'reservoir'
                ? '02 / RESERVOIR'
                : '03 / FLOOD STUDY'
          }}
        </p>
        <h2>
          {{ sceneDefinitions[scene].name
          }}<span>{{ environmentPresets[configuration.weather].name }}</span>
        </h2>
        <p>{{ sceneDefinitions[scene].description }}</p>
      </div>
      <div class="environment-demo__metrics">
        <span v-if="status?.source?.refining">实景数据加载中</span>
        <span v-if="status?.source?.warning">部分数据缺失</span>
        <span :class="{ 'environment-demo__ready': ready }">{{
          ready
            ? '环境就绪'
            : status?.environment.pending
              ? '切换天空…'
              : '正在准备场景…'
        }}</span
        ><span>{{ status?.fps ?? 0 }} FPS</span
        ><span class="environment-demo__buffer">{{ status?.buffer }}</span
        ><span>相机 {{ status?.cameraHeight ?? 0 }} m</span>
      </div>
    </footer>
  </main>
</template>

<style scoped>
.environment-demo {
  position: fixed;
  inset: 0;
  background: #243239;
  color: #f0f2eb;
  font-family: Inter, 'Segoe UI', 'Microsoft YaHei', sans-serif;
  isolation: isolate;
}
.environment-demo__canvas {
  position: absolute;
  inset: 0;
}
.environment-demo__header {
  position: absolute;
  inset: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 24px 30px;
  background: linear-gradient(#142128b8, transparent);
  pointer-events: none;
}
.environment-demo__header > * {
  pointer-events: auto;
}
.environment-demo__identity {
  display: flex;
  align-items: center;
  gap: 14px;
}
.environment-demo__back {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  color: #eee8d7;
  text-decoration: none;
  border: 1px solid #ffffff38;
  border-radius: 50%;
  font-size: 22px;
  background: #15252b55;
}
.environment-demo__eyebrow {
  font-size: 10px;
  letter-spacing: 0.2em;
  color: #d4dbd0b0;
  margin: 0 0 7px;
}
h1 {
  font-size: 20px;
  letter-spacing: 0.08em;
  font-weight: 500;
  margin: 0;
}
button {
  font: inherit;
  cursor: pointer;
  color: inherit;
  border: 1px solid transparent;
  transition:
    background 0.16s,
    border-color 0.16s;
  touch-action: manipulation;
}
button:focus-visible,
a:focus-visible,
input:focus-visible {
  outline: 2px solid #edc690;
  outline-offset: 4px;
}
.environment-demo__scene-tabs {
  display: flex;
  gap: 4px;
  padding: 5px;
  border: 1px solid #ffffff20;
  border-radius: 9px;
  background: #15242bc9;
  backdrop-filter: blur(12px);
}
.environment-demo__scene-tabs button {
  padding: 11px 22px;
  background: transparent;
  border-radius: 5px;
  font-size: 13px;
  color: #bdc9c8;
}
.environment-demo__scene-tabs button[aria-pressed='true'] {
  background: #e6dfca;
  color: #253438;
}
.environment-demo__actions {
  display: flex;
  gap: 8px;
}
.environment-demo__actions button {
  background: #15252bba;
  border-color: #ffffff24;
  border-radius: 6px;
  padding: 12px 15px;
  font-size: 12px;
}
.environment-demo__actions button:hover,
.environment-demo__views button:hover {
  background: #394b4d;
}
.environment-demo__panel {
  position: absolute;
  right: 30px;
  top: 112px;
  width: 304px;
  padding: 24px;
  background: #14252cea;
  border: 1px solid #ffffff20;
  border-radius: 10px;
  box-shadow: 0 16px 50px #0003;
  backdrop-filter: blur(16px);
  max-height: calc(100% - 230px);
  overflow: auto;
}
.environment-demo__panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}
.environment-demo__panel h2 {
  font-size: 17px;
  font-weight: 500;
  margin: 0;
}
.environment-demo__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #d3b37e;
}
.environment-demo__dot--ready {
  background: #9bc3ab;
}
.environment-demo__weather {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 7px;
}
.environment-demo__weather button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 15px 0;
  background: #ffffff08;
  border: 1px solid #ffffff17;
  border-radius: 6px;
  font-size: 12px;
  color: #aebcba;
}
.environment-demo__weather button span {
  font-size: 21px;
  line-height: 1;
}
.environment-demo__weather button[aria-pressed='true'] {
  color: #f0d6a7;
  background: #d1a6651a;
  border-color: #d9b27e85;
}
.environment-demo__weather-description {
  font-size: 11px;
  color: #9eafaf;
  margin: 15px 0 22px;
}
.environment-demo__sliders {
  display: grid;
  gap: 21px;
  padding-top: 21px;
  border-top: 1px solid #ffffff15;
}
label > span {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #c9d2cf;
}
output {
  font-size: 11px;
  color: #c8b590;
  font-variant-numeric: tabular-nums;
}
input[type='range'] {
  width: 100%;
  height: 20px;
  margin-top: 9px;
  accent-color: #d4b47f;
  cursor: pointer;
  display: block;
}
.environment-demo__views {
  display: flex;
  gap: 6px;
  margin-top: 23px;
}
.environment-demo__views button {
  flex: 1;
  padding: 10px 0;
  background: #ffffff08;
  border-color: #ffffff1a;
  border-radius: 5px;
  font-size: 12px;
}
.environment-demo__share {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  margin-top: 20px;
  padding: 14px 0;
  border-top: 1px solid #ffffff20;
  background: transparent;
  font-size: 12px;
  color: #e8d5b3;
}
.environment-demo__share span {
  font-size: 20px;
}
.environment-demo__model {
  margin-top: 20px;
  font-size: 12px;
  color: #cad4cf;
}
.environment-demo__model summary {
  cursor: pointer;
  padding: 8px 0;
}
.environment-demo__model label {
  display: block;
  margin-top: 12px;
  line-height: 1.8;
}
.environment-demo__model input {
  display: block;
  width: 100%;
  margin-top: 7px;
  padding: 10px;
  border: 1px solid #ffffff38;
  border-radius: 4px;
  background: #10232b;
  color: #edf1e9;
  font: inherit;
}
.environment-demo__note {
  font-size: 10px;
  line-height: 1.9;
  color: #93a4a5;
  margin: 10px 0 0;
}
.environment-demo__footer {
  position: absolute;
  inset: auto 0 0;
  padding: 50px 30px 24px;
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 20px;
  pointer-events: none;
  background: linear-gradient(transparent, #12212bbd);
}
.environment-demo__footer h2 {
  font-size: 26px;
  font-weight: 400;
  letter-spacing: 0.12em;
  margin: 0 0 10px;
}
.environment-demo__footer h2 span {
  font-size: 10px;
  letter-spacing: 0.06em;
  border-left: 1px solid #ffffff58;
  margin-left: 15px;
  padding-left: 15px;
  color: #d8c29d;
}
.environment-demo__footer p:last-child {
  font-size: 11px;
  letter-spacing: 0.04em;
  color: #c1ccca;
  margin: 0;
}
.environment-demo__metrics {
  display: flex;
  align-items: center;
  gap: 15px;
  color: #b0bdbd;
  font-size: 10px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.environment-demo__ready {
  color: #acc8b3;
}
.environment-demo__error {
  position: absolute;
  left: 30px;
  bottom: 150px;
  max-width: 560px;
  padding: 14px 18px;
  border: 1px solid #e5b47f;
  background: #4e352ee8;
  font-size: 12px;
  line-height: 1.7;
}
.environment-demo__screen-mask {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(
      90deg,
      #0d202ddd,
      transparent 30%,
      transparent 70%,
      #0d202ddd
    ),
    linear-gradient(#0d202d99, transparent 25%, transparent 70%, #0d202dbb);
  box-shadow: inset 0 0 120px rgb(8 25 33 / var(--vignette-opacity, 0.22));
}
.environment-demo--screen .environment-demo__header {
  padding-top: 30px;
  border-top: 2px solid #c9b18380;
}
.environment-demo--screen .environment-demo__footer {
  padding-bottom: 34px;
  border-bottom: 2px solid #c9b18380;
}
@media (max-width: 1100px) {
  .environment-demo__header {
    gap: 12px;
    padding: 20px;
  }
  .environment-demo__scene-tabs button {
    padding: 10px 13px;
  }
  .environment-demo__eyebrow {
    font-size: 9px;
  }
  h1 {
    font-size: 17px;
  }
  .environment-demo__buffer {
    display: none;
  }
  .environment-demo__panel {
    right: 20px;
    top: 100px;
  }
}
@media (max-width: 760px) {
  .environment-demo__header {
    padding: 16px;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 14px;
  }
  .environment-demo__identity {
    flex: 1;
  }
  .environment-demo__actions {
    gap: 5px;
  }
  .environment-demo__actions button {
    padding: 11px 9px;
    font-size: 11px;
  }
  .environment-demo__scene-tabs {
    order: 3;
    margin: 0 auto;
  }
  .environment-demo__scene-tabs button {
    padding: 10px 20px;
  }
  .environment-demo__panel {
    top: 142px;
    right: 16px;
    left: 16px;
    width: auto;
    max-height: calc(100% - 255px);
    padding: 20px;
  }
  .environment-demo__footer {
    padding: 45px 16px 16px;
    align-items: flex-start;
    flex-direction: column;
    gap: 16px;
  }
  .environment-demo__footer h2 {
    font-size: 23px;
  }
  .environment-demo__footer p:last-child {
    font-size: 10px;
  }
  .environment-demo__metrics {
    gap: 12px;
  }
  .environment-demo__error {
    left: 16px;
    right: 16px;
    bottom: 150px;
  }
  .environment-demo__back {
    width: 35px;
    height: 35px;
  }
  .environment-demo__eyebrow {
    letter-spacing: 0.13em;
  }
}
</style>
