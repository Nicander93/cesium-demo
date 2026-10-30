<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { createVegetationLab, type VegetationLab, type VegetationSettings, type VegetationStatus, type PlantingMode } from './runtime'
import { DEFAULT_TERRAIN, type TerrainOptions } from './terrain'
import { SPECIES, SPECIES_IDS } from './species'

const container = ref<HTMLElement>()
const fileInput = ref<HTMLInputElement>()
const status = ref<VegetationStatus>()
const notice = ref('等待地形高程和树木纹理准备完成。')
const fatal = ref('')
const batchCount = ref(1000)
const query = new URLSearchParams(location.search)
const terrainOptions = reactive<TerrainOptions>({ ...DEFAULT_TERRAIN,
  kind: query.get('surface') === 'synthetic' ? 'synthetic' : 'terrain',
  longitude: Number(query.get('lon') ?? DEFAULT_TERRAIN.longitude), latitude: Number(query.get('lat') ?? DEFAULT_TERRAIN.latitude),
})
const settings = reactive<VegetationSettings>({ mode: 'brush', species: 'pine', speciesPool: [...SPECIES_IDS], foliageLighting: true, spacing: terrainOptions.kind === 'terrain' ? 5 : 2.4, scaleMin: 0.8, scaleMax: 1.25, radius: 16, density: 5, seed: 42, lod: true, shadows: false, maxSlope: 40 })
const selectionMessage = computed(() => settings.speciesPool.length ? `已选 ${settings.speciesPool.length} 种 · 新种植时等概率随机` : '请先勾选至少一种植被')
const modes: { id: PlantingMode; label: string }[] = [{ id: 'navigate', label: '浏览' }, { id: 'single', label: '单株' }, { id: 'brush', label: '笔刷' }, { id: 'area', label: '框选' }, { id: 'erase', label: '擦除' }]
let runtime: VegetationLab | undefined
let alive = true
let generation = 0
function update(): void {
  const { seed: _seed, ...patch } = settings
  runtime?.setSettings({ ...patch, speciesPool: [...settings.speciesPool] })
}
function selectAll(): void { settings.speciesPool = [...SPECIES_IDS]; update() }
function clearSelection(): void { settings.speciesPool = []; update() }
function chooseMode(mode: PlantingMode): void { settings.mode = mode; runtime?.setSettings({ mode }) }
async function scatter(): Promise<void> {
  const count = await runtime?.fill(batchCount.value)
  if (alive) notice.value = `本次种植 ${count ?? 0} 株；坡度、最小间距和可用面积会限制实际数量。`
}
async function initialize(): Promise<void> {
  if (!container.value) return
  const currentGeneration = ++generation
  fatal.value = ''; notice.value = '正在加载真实地形和树木纹理…'
  runtime?.destroy()
  runtime = undefined
  status.value = undefined
  try {
    if (!Number.isFinite(terrainOptions.longitude) || !Number.isFinite(terrainOptions.latitude) || Math.abs(terrainOptions.longitude) > 180 || Math.abs(terrainOptions.latitude) > 85) throw new Error('请输入有效经纬度。')
    if (terrainOptions.kind === 'terrain' && !/^https?:$/.test(new URL(terrainOptions.terrainUrl).protocol)) throw new Error('地形 URL 需要使用 HTTP 或 HTTPS。')
    const next = createVegetationLab(container.value, value => { if (alive && currentGeneration === generation) status.value = value }, { ...terrainOptions })
    runtime = next
    next.setSettings({ ...settings })
    await next.ready
    if (!alive || runtime !== next) return
    const added = await next.fill(1000)
    if (alive && runtime === next) {
      if (terrainOptions.kind === 'terrain') next.closeView()
      notice.value = `已种植 ${added} 株。拖动笔刷继续种植，树根高程会批量精校。`
    }
  } catch (error) { if (alive && currentGeneration === generation) fatal.value = String(error) }
}
function save(): void {
  if (!runtime) return
  const url = URL.createObjectURL(new Blob([runtime.exportJson()], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = 'cesium-vegetation.json'; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function load(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    if (file.size > 20_000_000) throw new Error('文件超过 20 MB。')
    runtime?.importJson(await file.text()); notice.value = '植被 JSON 已导入，可撤销。'
  } catch (error) { notice.value = String(error) }
  input.value = ''
}
onMounted(() => { void initialize() })
onBeforeUnmount(() => { alive = false; runtime?.destroy() })
</script>

<template>
  <main class="vegetation-lab">
    <div ref="container" class="vegetation-lab__canvas" aria-label="Cesium 植被种植场景" />
    <header class="vegetation-lab__header">
      <RouterLink to="/">← 示例集</RouterLink>
      <h1>植被种植实验</h1>
      <span>Cesium · 480 × 480 m {{ status?.terrain.kind === 'synthetic' ? '合成基准' : '真实地形种植区' }}</span>
    </header>
    <aside class="vegetation-lab__panel" aria-label="植被种植设置">
      <p class="vegetation-lab__eyebrow">PLANTING LAB</p>
      <h2>把一片树林种下来</h2>
      <p>混合乔木、灌木与草丛。勾选想种的种类，沿真实地形随机刷种。</p>
      <details class="vegetation-lab__terrain-options"><summary>地形与位置 · {{ terrainOptions.kind === 'terrain' ? '真实山坡' : '合成基准' }}</summary>
      <fieldset :disabled="status?.busy ?? false">
        <legend>种植地形</legend>
        <label>场景<select v-model="terrainOptions.kind"><option value="terrain">真实地形 · 阿尔卑斯山坡</option><option value="synthetic">合成性能基准</option></select></label>
        <p>{{ status?.terrain.stage ?? '正在初始化' }}<br />{{ status?.terrain.imagery }}</p>
        <p v-if="status?.terrain.ready && status.terrain.kind === 'terrain'">地面高程 {{ status.terrain.minHeight.toFixed(1) }} — {{ status.terrain.maxHeight.toFixed(1) }} m · {{ status.terrain.sampleCount }} 个预采样点</p>
        <details><summary>地形服务和位置</summary>
          <div class="vegetation-lab__row"><label>经度<input v-model.number="terrainOptions.longitude" type="number" step="0.001" /></label><label>纬度<input v-model.number="terrainOptions.latitude" type="number" step="0.001" /></label></div>
          <label>地形服务<input v-model="terrainOptions.terrainUrl" class="vegetation-lab__url" type="url" /></label>
          <label>影像模板<input v-model="terrainOptions.imageryUrl" class="vegetation-lab__url" type="text" /></label>
          <p>可填写自己的 quantized-mesh 地形与 XYZ 影像模板；影像可留空。切换区域会重新开始种植。</p>
        </details>
        <button @click="initialize">加载地形 / 重新开始</button>
      </fieldset>
      </details>
      <fieldset :disabled="!status?.ready || status.busy">
        <legend>种植工具</legend>
        <nav class="vegetation-lab__tools" aria-label="种植工具">
          <button v-for="mode in modes" :key="mode.id" :aria-pressed="settings.mode === mode.id" @click="chooseMode(mode.id)">{{ mode.label }}</button>
        </nav>
        <div class="vegetation-lab__species" role="group" aria-label="随机种植的植被种类">
          <label v-for="item in SPECIES" :key="item.id" class="vegetation-lab__species-option" :class="{ 'vegetation-lab__species-option--selected': settings.speciesPool.includes(item.id) }">
            <input v-model="settings.speciesPool" type="checkbox" :value="item.id" :aria-label="item.label" @change="update" />
            <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" :style="{ color: item.color }"><path :d="item.path" fill="currentColor" /></svg>
            <span><strong>{{ item.label }}</strong><small>{{ item.description }}</small></span>
          </label>
        </div>
        <div class="vegetation-lab__selection"><span role="status">{{ selectionMessage }}</span><button type="button" @click="selectAll">全选</button><button type="button" @click="clearSelection">取消全选</button></div>
        <p class="vegetation-lab__selection-note">只勾选一种可单独种植。选择变化仅影响新种植，已有植被保持原样。</p>
        <label>笔刷半径 <output>{{ settings.radius }} m</output><input v-model.number="settings.radius" type="range" min="2" max="40" step="1" @input="update" /></label>
        <label>种植密度 <output>{{ settings.density }} 株 / 100 m²</output><input v-model.number="settings.density" type="range" min="1" max="30" @input="update" /></label>
        <label>最小间距 <output>{{ settings.spacing }} m</output><input v-model.number="settings.spacing" type="range" min="0.5" max="10" step="0.1" @input="update" /></label>
        <label>最大坡度 <output>{{ settings.maxSlope }}°</output><input v-model.number="settings.maxSlope" type="range" min="0" max="70" @input="update" /></label>
        <div class="vegetation-lab__row"><label>最小缩放<input v-model.number="settings.scaleMin" type="number" min="0.25" :max="settings.scaleMax" step="0.05" @change="update" /></label><label>最大缩放<input v-model.number="settings.scaleMax" type="number" :min="settings.scaleMin" max="3" step="0.05" @change="update" /></label></div>
        <label>随机种子<input v-model.number="settings.seed" type="number" step="1" @change="runtime?.setSettings({ seed: settings.seed })" /></label>
        <div class="vegetation-lab__row"><button :disabled="!status?.canUndo" @click="runtime?.undo()">撤销</button><button :disabled="!status?.canRedo" @click="runtime?.redo()">重做</button><button @click="runtime?.clear()">清空</button></div>
      </fieldset>
      <fieldset :disabled="!status?.ready || status.busy">
        <legend>批量与性能</legend>
        <div class="vegetation-lab__row"><select v-model.number="batchCount" aria-label="批量种植数量"><option :value="1000">1,000 株</option><option :value="5000">5,000 株</option><option :value="20000">20,000 株</option></select><button :disabled="!settings.speciesPool.length" @click="scatter">追加种植</button></div>
        <label class="vegetation-lab__check"><input v-model="settings.lod" type="checkbox" @change="runtime?.setSettings({ lod: settings.lod })" />远处使用简化树形</label>
        <label class="vegetation-lab__check"><input v-model="settings.foliageLighting" type="checkbox" @change="runtime?.setSettings({ foliageLighting: settings.foliageLighting })" />自然叶片受光（改善背光发黑）</label>
        <label class="vegetation-lab__check"><input v-model="settings.shadows" type="checkbox" @change="runtime?.setSettings({ shadows: settings.shadows })" />投射树木阴影（增加渲染开销）</label>
        <div class="vegetation-lab__row"><button @click="runtime?.overview()">全景</button><button @click="runtime?.closeView()">近看</button><button @click="save">导出 JSON</button><button @click="fileInput?.click()">导入</button></div>
        <button v-if="status?.terrain.kind === 'terrain'" @click="runtime?.reproject()">重新校准树根高程</button>
        <input ref="fileInput" type="file" accept="application/json,.json" hidden @change="load" />
      </fieldset>
      <dl class="vegetation-lab__metrics" aria-label="实时运行状态">
        <div><dt>植被</dt><dd data-testid="plant-count">{{ status?.count.toLocaleString() ?? '0' }}</dd></div>
        <div><dt>实例批次</dt><dd>{{ status?.batches ?? 0 }}</dd></div>
        <div><dt>FPS</dt><dd>{{ status?.fps ?? '—' }}</dd></div>
        <div><dt>帧耗时 P95</dt><dd>{{ status?.frameP95.toFixed(1) ?? '—' }} ms</dd></div>
        <div><dt>已显示实例</dt><dd>{{ status?.loadedInstances.toLocaleString() ?? 0 }}</dd></div>
        <div><dt>待更新分块</dt><dd>{{ status?.pending ?? 0 }}</dd></div>
        <div><dt>树根待校准</dt><dd>{{ status?.heightPending ?? 0 }}</dd></div>
        <div><dt>地形</dt><dd class="vegetation-lab__small">{{ status?.terrain.kind === 'synthetic' ? '合成' : '真实 DEM' }}</dd></div>
      </dl>
      <p class="vegetation-lab__note">48 m 分块 · GPU 实例化 · 远近 LOD。五种程序化示范植被，松针/树皮纹理来自 Poly Haven CC0；真实地形和卫星影像来自 swisstopo。</p>
      <p class="vegetation-lab__notice" role="status">{{ fatal || status?.error || status?.terrain.error || (status?.busy ? '正在分批种植…' : notice) }}</p>
      <RouterLink to="/first-person-lab">进入室内行走示例 →</RouterLink>
    </aside>
  </main>
</template>

<style scoped>
.vegetation-lab { position: fixed; inset: 0; overflow: hidden; color: #21372d; font: 14px/1.5 system-ui, sans-serif; }
.vegetation-lab__canvas { position: absolute; inset: 0; }
.vegetation-lab__header { position: absolute; top: 20px; left: 24px; right: 24px; display: flex; align-items: center; gap: 22px; padding: 10px 18px; border: 1px solid #ffffffa0; background: #f5f8f0eb; border-radius: 8px; }
.vegetation-lab__header h1 { font-size: 17px; margin: 0; }
.vegetation-lab a { color: #386244; text-decoration: none; }
.vegetation-lab__header span { margin-left: auto; font-size: 12px; color: #657969; }
.vegetation-lab__panel { position: absolute; left: 24px; top: 94px; bottom: 24px; width: 324px; box-sizing: border-box; overflow-y: auto; padding: 22px; border: 1px solid #d5dfd0; border-radius: 8px; background: #f8faf3f5; box-shadow: 0 12px 35px #233e351c; }
.vegetation-lab__eyebrow { font-size: 11px; letter-spacing: 0.15em; color: #58764c; margin: 0; }
.vegetation-lab h2 { font-size: 21px; margin: 6px 0 8px; font-weight: 600; }
.vegetation-lab p { font-size: 12px; color: #63735e; }
.vegetation-lab fieldset { margin: 18px 0 0; padding: 12px 0 0; border: 0; border-top: 1px solid #dce4d4; }
.vegetation-lab legend { font-size: 12px; font-weight: 600; padding-right: 8px; }
.vegetation-lab label { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px; margin: 10px 0; font-size: 12px; }
.vegetation-lab input[type=range] { width: 100%; accent-color: #4c7448; }
.vegetation-lab select, .vegetation-lab input[type=number] { min-width: 0; max-width: 145px; padding: 5px 7px; color: inherit; border: 1px solid #c8d5c1; border-radius: 4px; background: #fff; }
.vegetation-lab input[type=number] { width: 74px; }
.vegetation-lab .vegetation-lab__url { width: 100%; box-sizing: border-box; padding: 5px; border: 1px solid #c8d5c1; border-radius: 4px; font-size: 10px; background: white; }
.vegetation-lab summary { cursor: pointer; font-size: 12px; color: #52694c; }
.vegetation-lab__small { font-size: 13px !important; }
.vegetation-lab__row, .vegetation-lab__tools { display: flex; flex-wrap: wrap; gap: 6px; }
.vegetation-lab__row label { flex: 1; }
.vegetation-lab button { padding: 7px 9px; border: 1px solid #bdcdb4; border-radius: 4px; background: #f3f6ee; color: #365a34; cursor: pointer; font: inherit; font-size: 12px; }
.vegetation-lab button[aria-pressed=true] { color: white; background: #486b3d; border-color: #486b3d; }
.vegetation-lab button:hover { border-color: #486b3d; }
.vegetation-lab button:disabled, .vegetation-lab fieldset:disabled { opacity: .55; cursor: default; }
.vegetation-lab__check { justify-content: flex-start !important; }
.vegetation-lab__terrain-options { margin-top: 18px; }
.vegetation-lab__species { display: grid; gap: 5px; margin-top: 12px; }
.vegetation-lab .vegetation-lab__species-option { display: flex; flex-wrap: nowrap; justify-content: flex-start; gap: 9px; margin: 0; padding: 7px 9px; border: 1px solid #d9e1d0; border-radius: 5px; background: #fff9; cursor: pointer; }
.vegetation-lab .vegetation-lab__species-option--selected { border-color: #96b080; background: #edf3e5; }
.vegetation-lab__species-option input { margin: 0; accent-color: #4c7448; }
.vegetation-lab__species-option svg { flex: 0 0 30px; }
.vegetation-lab__species-option strong { display: block; font-size: 12px; font-weight: 600; }
.vegetation-lab__species-option small { display: block; color: #76846d; font-size: 10px; }
.vegetation-lab__selection { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; color: #586e4d; font-size: 10px; }
.vegetation-lab__selection span { flex-basis: 100%; }
.vegetation-lab__selection button { padding: 3px 7px; font-size: 10px; }
.vegetation-lab .vegetation-lab__selection-note { font-size: 10px; line-height: 1.5; }
.vegetation-lab__metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 20px; }
.vegetation-lab__metrics div { border-top: 1px solid #d7e0cf; padding-top: 5px; }
.vegetation-lab dt { font-size: 10px; color: #73806c; }
.vegetation-lab dd { margin: 0; font-size: 19px; font-variant-numeric: tabular-nums; }
.vegetation-lab__note { line-height: 1.6; }
.vegetation-lab__notice { min-height: 36px; border-left: 2px solid #7e9c60; padding-left: 8px; }
@media (max-width: 700px) { .vegetation-lab__header { left: 10px; right: 10px; top: 10px; gap: 12px; } .vegetation-lab__header span { display: none; } .vegetation-lab__panel { left: 10px; top: 76px; bottom: 10px; width: 276px; padding: 16px; } }
</style>
