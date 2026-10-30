<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
} from 'vue'
import {
  createLandscapeShowcase,
  type LandscapeShowcase,
  type ShowcaseStatus,
} from './runtime'
import {
  defaultShowcaseOptions,
  normalizeShowcaseOptions,
  showcaseScenes,
  type ShowcaseOptions,
  type ShowcaseScene,
  type ShowcaseView,
  type ShowcaseWeather,
} from './settings'

const params = new URLSearchParams(location.search)
const selected = ref<ShowcaseScene>(
  params.get('scene') === 'coast' ? 'coast' : 'mountain',
)
const view = ref<ShowcaseView>(
  params.get('view') === 'shore'
    ? 'shore'
    : params.get('view') === 'overview'
      ? 'overview'
      : 'hero',
)
const profiles = reactive<Record<ShowcaseScene, ShowcaseOptions>>({
  mountain: defaultShowcaseOptions('mountain'),
  coast: defaultShowcaseOptions('coast'),
})
try {
  const saved = JSON.parse(
    localStorage.getItem('landscape-showcase:profiles:v1') ?? 'null',
  )
  if (saved?.version === 1)
    for (const id of ['mountain', 'coast'] as const)
      profiles[id] = normalizeShowcaseOptions(id, saved.profiles?.[id] ?? {})
} catch {
  /* Use defaults if browser storage is unavailable. */
}
const initial = { ...profiles[selected.value] }
if (params.get('weather') === 'day' || params.get('weather') === 'sunset')
  initial.weather = params.get('weather') as ShowcaseWeather
for (const key of [
  'exposure',
  'waveStrength',
  'waveLength',
  'roughness',
  'reflectionStrength',
  'foamWidth',
] as const)
  if (params.has(key)) initial[key] = Number(params.get(key))
for (const key of ['reflection', 'foam'] as const)
  if (params.has(key)) initial[key] = params.get(key) === '1'
if (params.has('waterColor'))
  initial.waterColor = params.get('waterColor') ?? initial.waterColor
if (params.has('quality'))
  initial.quality = params.get('quality') === 'low' ? 'low' : 'balanced'
profiles[selected.value] = normalizeShowcaseOptions(selected.value, initial)
const options = computed(() => profiles[selected.value])
const definition = computed(() => showcaseScenes[selected.value])
const canvas = ref<HTMLElement>()
const status = shallowRef<ShowcaseStatus>()
const panel = ref(false),
  copied = ref(false),
  fatalError = ref('')
const message = computed(
  () =>
    fatalError.value || status.value?.error || status.value?.environment.error,
)
const ready = computed(
  () =>
    status.value &&
    !status.value.loading &&
    status.value.environment.ready &&
    !status.value.environment.pending &&
    !message.value,
)
const home = import.meta.env.BASE_URL
let runtime: LandscapeShowcase | undefined
let alive = true
const fields = [
  { key: 'exposure', label: '画面曝光', min: 0.4, max: 1.8, step: 0.01 },
  { key: 'waveStrength', label: '水波强度', min: 0, max: 2, step: 0.01 },
  { key: 'waveLength', label: '主波尺度', min: 4, max: 60, step: 1 },
  { key: 'roughness', label: '水面粗糙度', min: 0.08, max: 0.6, step: 0.01 },
  {
    key: 'reflectionStrength',
    label: '倒影强度',
    min: 0,
    max: 1.5,
    step: 0.01,
  },
  { key: 'foamWidth', label: '岸线白沫宽度', min: 1, max: 16, step: 0.5 },
] as const
function persist(): void {
  try {
    localStorage.setItem(
      'landscape-showcase:profiles:v1',
      JSON.stringify({ version: 1, profiles }),
    )
  } catch {
    /* Keep the active scene usable without storage. */
  }
  const query = new URLSearchParams({
    scene: selected.value,
    weather: options.value.weather,
    view: view.value,
  })
  for (const [key, value] of Object.entries(options.value))
    query.set(
      key,
      typeof value === 'boolean' ? (value ? '1' : '0') : String(value),
    )
  history.replaceState(null, '', location.pathname + '?' + query)
}
async function chooseScene(next: ShowcaseScene): Promise<void> {
  selected.value = next
  persist()
  await runtime?.loadScene(next, profiles[next])
  if (alive && selected.value === next) runtime?.setView(view.value)
}
function updateOptions(patch: Partial<ShowcaseOptions>): void {
  profiles[selected.value] = normalizeShowcaseOptions(selected.value, {
    ...options.value,
    ...patch,
  })
  persist()
  runtime?.setOptions(options.value)
}
function updateNumber(key: (typeof fields)[number]['key'], event: Event): void {
  updateOptions({ [key]: Number((event.target as HTMLInputElement).value) })
}
function chooseWeather(weather: ShowcaseWeather): void {
  updateOptions({ weather })
}
function chooseView(next: ShowcaseView): void {
  view.value = next
  runtime?.setView(next)
  persist()
}
function resetOptions(): void {
  profiles[selected.value] = defaultShowcaseOptions(selected.value)
  runtime?.setOptions(options.value)
  persist()
}
async function copyLink(): Promise<void> {
  persist()
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
function handleKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') panel.value = false
}
onMounted(async () => {
  if (!canvas.value) return
  window.addEventListener('keydown', handleKey)
  try {
    runtime = createLandscapeShowcase(canvas.value, (state) => {
      if (alive) status.value = state
    })
    if (import.meta.env.DEV)
      (
        window as unknown as { __landscapeShowcase?: unknown }
      ).__landscapeShowcase = {
        getState: () => runtime?.getState(),
        setScene: chooseScene,
        setOptions: updateOptions,
        setWeather: chooseWeather,
        setView: chooseView,
        setRoaming: (value: boolean) => runtime?.setRoaming(value),
      }
    await runtime.loadScene(selected.value, options.value)
    if (!alive) return
    runtime.setView(view.value)
    persist()
  } catch (reason) {
    fatalError.value = String(reason)
  }
})
onBeforeUnmount(() => {
  alive = false
  window.removeEventListener('keydown', handleKey)
  delete (window as unknown as { __landscapeShowcase?: unknown })
    .__landscapeShowcase
  runtime?.dispose()
  runtime = undefined
})
</script>

<template>
  <main class="showcase">
    <div
      ref="canvas"
      class="showcase__canvas"
      aria-label="可拖动的山水与海岸三维场景"
    ></div>
    <header class="showcase__header">
      <a :href="home" class="showcase__brand"
        ><span aria-hidden="true">↖</span
        ><span>SCENE STUDIES<small>山海 · 景观渲染</small></span></a
      >
      <nav class="showcase__scenes" aria-label="景观场景">
        <button
          v-for="(scene, id) in showcaseScenes"
          :key="id"
          :aria-pressed="selected === id"
          @click="chooseScene(id)"
        >
          {{ scene.title }}
        </button>
      </nav>
      <div class="showcase__actions">
        <button
          :aria-expanded="panel"
          aria-controls="showcase-controls"
          @click="panel = !panel"
        >
          {{ panel ? '收起调校' : '画面调校'
          }}<span aria-hidden="true">＋</span>
        </button>
      </div>
    </header>

    <aside v-if="panel" id="showcase-controls" class="showcase__panel">
      <div class="showcase__panel-heading">
        <div>
          <p>LIGHT / WATER / SHORE</p>
          <h2>画面调校</h2>
        </div>
        <button aria-label="关闭画面调校" @click="panel = false">×</button>
      </div>
      <div class="showcase__weather">
        <button
          :aria-pressed="options.weather === 'day'"
          @click="chooseWeather('day')"
        >
          晴日</button
        ><button
          :aria-pressed="options.weather === 'sunset'"
          @click="chooseWeather('sunset')"
        >
          落日
        </button>
      </div>
      <label v-for="field in fields" :key="field.key" class="showcase__range"
        ><span
          >{{ field.label
          }}<output
            >{{ Number(options[field.key]).toFixed(field.step < 1 ? 2 : 0)
            }}{{
              field.key === 'waveLength' || field.key === 'foamWidth'
                ? ' m'
                : ''
            }}</output
          ></span
        ><input
          type="range"
          :aria-label="field.label"
          :min="field.min"
          :max="field.max"
          :step="field.step"
          :value="options[field.key]"
          @input="updateNumber(field.key, $event)"
      /></label>
      <label class="showcase__row"
        >水体颜色<input
          type="color"
          :value="options.waterColor"
          @input="
            updateOptions({
              waterColor: ($event.target as HTMLInputElement).value,
            })
          "
      /></label>
      <label class="showcase__row"
        >山体与场景倒影<input
          type="checkbox"
          :checked="options.reflection"
          @change="
            updateOptions({
              reflection: ($event.target as HTMLInputElement).checked,
            })
          "
      /></label>
      <label class="showcase__row"
        >岸线白沫<input
          type="checkbox"
          :checked="options.foam"
          @change="
            updateOptions({ foam: ($event.target as HTMLInputElement).checked })
          "
      /></label>
      <label class="showcase__row"
        >渲染档位<select
          aria-label="渲染档位"
          :value="options.quality"
          @change="
            updateOptions({
              quality: ($event.target as HTMLSelectElement)
                .value as ShowcaseOptions['quality'],
            })
          "
        >
          <option value="balanced">均衡</option>
          <option value="low">流畅</option>
        </select></label
      >
      <div class="showcase__panel-actions">
        <button @click="resetOptions">恢复本场景</button
        ><button @click="copyLink">
          {{ copied ? '链接已复制' : '复制场景链接' }}
        </button>
      </div>
      <details class="showcase__source">
        <summary>场景资料</summary>
        <p>{{ definition.source }}</p>
        <p v-if="selected === 'mountain'">
          水面依据公开水域边界和地形样本作展示，不代表实时库水位。
        </p>
        <p v-else>海岸、道路和城市布局为演示布景，树木与建筑复用本地资源。</p>
        <p v-if="status?.waterHeight != null">
          显示水面 {{ status.waterHeight.toFixed(2) }} m
        </p>
      </details>
    </aside>

    <div v-if="message" class="showcase__error" role="alert">
      <p>{{ message }}</p>
      <button @click="chooseScene(selected)">重新载入场景</button>
    </div>
    <footer class="showcase__footer">
      <div class="showcase__caption">
        <p>{{ definition.subtitle }}</p>
        <h1>{{ definition.title }}</h1>
        <span>{{ definition.description }}</span>
      </div>
      <div class="showcase__navigation">
        <nav aria-label="景观机位">
          <button :aria-pressed="view === 'hero'" @click="chooseView('hero')">
            {{ selected === 'mountain' ? '山水长镜' : '海岸大道' }}</button
          ><button
            :aria-pressed="view === 'shore'"
            @click="chooseView('shore')"
          >
            贴岸近看</button
          ><button
            :aria-pressed="view === 'overview'"
            @click="chooseView('overview')"
          >
            空间总览
          </button>
        </nav>
        <button
          class="showcase__roam"
          :disabled="!ready"
          :aria-pressed="status?.roaming"
          @click="runtime?.setRoaming(!status?.roaming)"
        >
          <span aria-hidden="true">{{ status?.roaming ? 'Ⅱ' : '▷' }}</span
          >{{ status?.roaming ? '停止巡游' : '缓慢巡游' }}
        </button>
      </div>
      <div class="showcase__metrics" role="status">
        <span :class="{ showcase__ready: ready }">{{
          ready
            ? status?.refining
              ? '实景数据细化中'
              : '场景就绪'
            : status?.stage || '准备场景'
        }}</span
        ><small v-if="status"
          >{{ status.fps || '—' }} FPS <i>·</i> P95
          {{ status.p95.toFixed(1) }} ms</small
        ><small v-if="status?.warning">{{ status.warning }}</small>
      </div>
    </footer>
    <div
      v-if="status?.loading"
      class="showcase__loading"
      aria-hidden="true"
    ></div>
  </main>
</template>

<style scoped>
.showcase {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: #15252e;
  color: #f3f3e9;
  font-family: Inter, 'Microsoft YaHei', sans-serif;
}
.showcase__canvas {
  position: absolute;
  inset: 0;
}
.showcase__header {
  position: absolute;
  inset: 0 0 auto;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 22px;
  padding: 24px 30px;
  pointer-events: none;
  background: linear-gradient(#11252b75, transparent);
}
.showcase__header a,
.showcase__header button {
  pointer-events: auto;
}
.showcase__brand {
  display: flex;
  align-items: center;
  gap: 15px;
  color: inherit;
  text-decoration: none;
  font-size: 11px;
  letter-spacing: 0.2em;
  text-shadow: 0 1px 9px #0006;
}
.showcase__brand > span:first-child {
  font-size: 26px;
}
.showcase__brand small {
  display: block;
  letter-spacing: 0.18em;
  font-size: 10px;
  color: #dae3d9;
  margin-top: 6px;
}
.showcase button {
  font: inherit;
  cursor: pointer;
  color: inherit;
}
.showcase__scenes {
  display: flex;
  gap: 4px;
  padding: 5px;
  background: #102a2fc9;
  border: 1px solid #dce5d126;
  border-radius: 7px;
  pointer-events: auto;
}
.showcase__scenes button {
  padding: 11px 24px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  font-size: 12px;
  letter-spacing: 0.08em;
  color: #cbd8d2;
}
.showcase__scenes button[aria-pressed='true'] {
  background: #e5e8d5;
  color: #263b3e;
}
.showcase__actions {
  justify-self: end;
}
.showcase__actions button {
  border: 1px solid #e4edda36;
  border-radius: 5px;
  background: #102a2fd9;
  padding: 13px 17px;
  font-size: 11px;
}
.showcase__actions span {
  margin-left: 24px;
  color: #d5d9b8;
}
.showcase__panel {
  position: absolute;
  right: 30px;
  top: 93px;
  width: 286px;
  max-height: calc(100% - 230px);
  box-sizing: border-box;
  overflow: auto;
  padding: 23px;
  background: #102c32ed;
  border: 1px solid #d5dfd92b;
  border-radius: 7px;
  box-shadow: 0 18px 55px #05191c33;
  scrollbar-width: thin;
  scrollbar-color: #5a7474 transparent;
}
.showcase__panel-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.showcase__panel-heading p {
  margin: 0 0 7px;
  font-size: 8px;
  letter-spacing: 0.16em;
  color: #a5b7b4;
}
.showcase__panel-heading h2 {
  font-size: 17px;
  font-weight: 500;
  margin: 0;
}
.showcase__panel-heading button {
  background: none;
  border: 0;
  font-size: 23px;
  color: #b1c1bb;
}
.showcase__weather {
  display: flex;
  gap: 6px;
}
.showcase__weather button {
  flex: 1;
  border: 1px solid #aec0b745;
  border-radius: 4px;
  background: transparent;
  padding: 9px;
  font-size: 11px;
}
.showcase__weather button[aria-pressed='true'] {
  background: #dde4c2;
  color: #263b3e;
}
.showcase__range {
  display: block;
  margin: 18px 0;
}
.showcase__range > span {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: #cfdbd3;
}
.showcase__range output {
  color: #d8dcae;
  font-variant-numeric: tabular-nums;
}
.showcase__range input {
  display: block;
  width: 100%;
  accent-color: #d9deb6;
  margin: 9px 0 0;
}
.showcase__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
  font-size: 10px;
  margin: 15px 0;
  color: #cfdbd3;
}
.showcase__row input[type='checkbox'] {
  accent-color: #d9deb6;
}
.showcase__row input[type='color'] {
  width: 39px;
  height: 24px;
  padding: 0;
  border: 0;
  background: transparent;
}
.showcase__row select {
  background: #183b40;
  border: 1px solid #abbfaf50;
  color: inherit;
  padding: 6px;
  font-size: 10px;
  border-radius: 3px;
}
.showcase__panel-actions {
  display: flex;
  gap: 8px;
  border-top: 1px solid #dce7d125;
  padding-top: 16px;
  margin-top: 20px;
}
.showcase__panel-actions button {
  flex: 1;
  border: 1px solid #aebfaf45;
  background: transparent;
  border-radius: 3px;
  font-size: 10px;
  padding: 8px 0;
}
.showcase__source {
  margin-top: 19px;
  font-size: 9px;
  line-height: 1.8;
  color: #a6bbb5;
}
.showcase__source summary {
  cursor: pointer;
  color: #c6d3c7;
}
.showcase__source p {
  margin: 9px 0;
}
.showcase__footer {
  position: absolute;
  inset: auto 0 0;
  padding: 48px 30px 39px;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 22px;
  align-items: end;
  pointer-events: none;
  background: linear-gradient(transparent, #09242e8a);
}
.showcase__caption p {
  font-size: 8px;
  letter-spacing: 0.2em;
  color: #d0dccd;
  margin: 0 0 12px;
}
.showcase__caption h1 {
  font-size: 29px;
  font-weight: 400;
  letter-spacing: 0.13em;
  margin: 0 0 9px;
}
.showcase__caption > span {
  font-size: 10px;
  color: #cbdad1;
  letter-spacing: 0.1em;
}
.showcase__navigation {
  display: flex;
  align-items: center;
  gap: 12px;
  pointer-events: auto;
}
.showcase__navigation nav {
  display: flex;
  gap: 5px;
  border: 1px solid #cad8c435;
  border-radius: 5px;
  padding: 4px;
  background: #123038d9;
}
.showcase__navigation nav button {
  border: 0;
  border-radius: 3px;
  background: transparent;
  font-size: 10px;
  padding: 11px 13px;
  color: #d1dfd1;
}
.showcase__navigation nav button[aria-pressed='true'] {
  background: #dfe5c8;
  color: #243c3c;
}
.showcase__roam {
  border: 1px solid #bdcdb840;
  border-radius: 5px;
  background: #123038d9;
  padding: 15px;
  font-size: 10px;
}
.showcase__roam span {
  margin-right: 9px;
}
.showcase__roam:disabled {
  opacity: 0.5;
  cursor: default;
}
.showcase__metrics {
  justify-self: end;
  text-align: right;
  font-size: 10px;
  line-height: 1.8;
  color: #d2dfd5;
  max-width: 240px;
}
.showcase__metrics > span:before {
  content: '';
  display: inline-block;
  width: 5px;
  height: 5px;
  margin-right: 8px;
  background: #d8b77a;
  border-radius: 50%;
}
.showcase__metrics .showcase__ready:before {
  background: #b7d6a3;
}
.showcase__metrics small {
  display: block;
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  color: #bbcbbf;
}
.showcase__metrics i {
  font-style: normal;
  margin: 0 8px;
}
.showcase__error {
  position: absolute;
  top: 110px;
  left: 30px;
  max-width: 450px;
  padding: 14px 18px;
  background: #4a2523ed;
  border: 1px solid #f8b7a266;
  border-radius: 5px;
  font-size: 12px;
  line-height: 1.8;
}
.showcase__error p {
  margin: 0 0 8px;
}
.showcase__error button {
  border: 1px solid #e8c9ad69;
  border-radius: 3px;
  background: transparent;
  padding: 7px 12px;
  font-size: 10px;
}
.showcase__loading {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, #e1e4be, transparent);
  animation: showcase-progress 2s ease-in-out infinite;
  transform-origin: left;
}
.showcase button:focus-visible,
.showcase a:focus-visible {
  outline: 2px solid #e0e8bc;
  outline-offset: 3px;
}
@keyframes showcase-progress {
  0% {
    transform: scaleX(0.1);
    opacity: 0.3;
  }
  50% {
    transform: scaleX(0.65);
    opacity: 1;
  }
  100% {
    transform: scaleX(1);
    opacity: 0;
  }
}
@media (max-width: 1000px) {
  .showcase__header {
    padding: 18px;
    gap: 12px;
  }
  .showcase__brand {
    font-size: 9px;
    gap: 8px;
  }
  .showcase__scenes button {
    padding: 11px 16px;
  }
  .showcase__footer {
    padding: 40px 18px 39px;
    grid-template-columns: 1fr auto;
    gap: 18px;
  }
  .showcase__caption {
    grid-column: 1;
  }
  .showcase__navigation {
    grid-column: 1 / -1;
    grid-row: 2;
    justify-self: center;
  }
  .showcase__metrics {
    grid-column: 2;
    grid-row: 1;
  }
  .showcase__panel {
    right: 18px;
    top: 83px;
    max-height: calc(100% - 240px);
  }
}
@media (max-width: 620px) {
  .showcase__header {
    grid-template-columns: 1fr auto;
  }
  .showcase__brand small {
    display: none;
  }
  .showcase__brand {
    font-size: 8px;
  }
  .showcase__brand > span:first-child {
    font-size: 20px;
  }
  .showcase__scenes {
    grid-column: 1 / -1;
    grid-row: 2;
    justify-self: start;
  }
  .showcase__scenes button {
    padding: 9px 18px;
  }
  .showcase__actions {
    grid-column: 2;
    grid-row: 1;
  }
  .showcase__actions button {
    padding: 10px 12px;
  }
  .showcase__actions span {
    margin-left: 12px;
  }
  .showcase__panel {
    top: 125px;
    max-height: calc(100% - 290px);
    width: min(286px, calc(100% - 36px));
  }
  .showcase__caption h1 {
    font-size: 25px;
  }
  .showcase__caption p {
    font-size: 7px;
    max-width: 200px;
    line-height: 1.8;
  }
  .showcase__metrics {
    max-width: 125px;
    font-size: 9px;
  }
  .showcase__metrics small {
    font-size: 8px;
  }
  .showcase__navigation {
    gap: 7px;
  }
  .showcase__navigation nav button {
    padding: 10px;
    font-size: 9px;
  }
  .showcase__roam {
    font-size: 9px;
    padding: 14px 10px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .showcase__loading {
    animation: none;
  }
}
</style>
