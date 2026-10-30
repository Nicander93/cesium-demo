<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { createFirstPersonLab, type InteriorQuality, type WalkStatus } from './runtime'

const host = ref<HTMLElement>()
const fatal = ref('')
const status = ref<WalkStatus>()
const expanded = ref(false)
const exposure = ref(1.15)
const occlusion = ref(true)
const quality = ref<InteriorQuality>('high')
const scene = ref(new URLSearchParams(location.search).get('scene') === 'living-room' ? 'living-room' : 'modern-hall')
const fixture = new URLSearchParams(location.search).get('fixture') === 'procedural'
const showSettings = computed(() => expanded.value || fixture)
const modeLabel = computed(() => status.value?.mode === 'walking' ? '键鼠漫游' : status.value?.mode === 'navigate' ? status.value.navigationMessage : status.value?.mode === 'inspect' ? (status.value.sliced ? '剖切查看' : '建筑总览') : '已暂停')
let lab: ReturnType<typeof createFirstPersonLab> | undefined

function initialize(): void {
  if (!host.value) return
  lab?.destroy(); status.value = undefined; fatal.value = ''
  try { lab = createFirstPersonLab(host.value, next => { status.value = next; quality.value = next.quality; exposure.value = next.exposure; occlusion.value = next.occlusion }) }
  catch (error) { fatal.value = String(error) }
}
function switchScene(): void {
  const url = new URL(location.href)
  url.searchParams.set('scene', scene.value)
  history.replaceState(history.state, '', url)
  initialize()
}
function enter(): void { lab?.enter(); expanded.value = false }
function navigate(): void { lab?.navigate(); expanded.value = false }
function inspect(): void { lab?.inspect(); lab?.setSlice(true) }
function viewpoint(id: string): void { lab?.spawnAt(id); lab?.navigate() }
onMounted(initialize)
onBeforeUnmount(() => { lab?.destroy(); lab = undefined })
</script>

<template>
  <main class="walk-lab">
    <div ref="host" class="walk-lab__scene" aria-label="Cesium 建筑室内浏览场景" />
    <nav class="walk-lab__navigation" aria-label="其他示例">
      <RouterLink to="/">← 示例集</RouterLink><RouterLink to="/vegetation-lab">植被种植</RouterLink>
    </nav>
    <section class="walk-lab__panel" aria-label="室内浏览控制">
      <div class="walk-lab__title"><span class="walk-lab__eyebrow">CESIUM / INTERIOR</span><span class="walk-lab__fps">{{ status?.fps ?? 0 }} FPS</span></div>
      <h1>{{ fixture ? '房屋步行调试' : scene === 'modern-hall' ? '建筑室内浏览' : '真实客厅漫游' }}</h1>
      <p class="walk-lab__state" role="status">{{ status?.ready ? modeLabel : (status?.stage ?? '准备室内场景…') }}</p>
      <div class="walk-lab__actions">
        <button v-if="!fixture" class="walk-lab__primary" :disabled="!status?.ready" @click="navigate">点击行走</button>
        <button :class="{ 'walk-lab__primary': fixture }" :disabled="!status?.ready" @click="enter">{{ fixture ? '进入行走' : '键鼠漫游' }}</button>
        <button :disabled="!status?.ready" @click="lab?.pause()">暂停</button>
        <button :disabled="!status?.ready" @click="fixture ? lab?.inspect() : inspect()">{{ fixture ? '俯视检查' : '剖切总览' }}</button>
        <button :aria-expanded="showSettings" @click="expanded = !expanded">场景与画质</button>
      </div>
      <div v-if="showSettings" class="walk-lab__settings">
        <template v-if="!fixture">
          <label>示范场景<select v-model="scene" @change="switchScene"><option value="modern-hall">现代建筑大厅 · 29 × 10 m</option><option value="living-room">原客厅 · 5.6 × 4.2 m</option></select></label>
          <div class="walk-lab__actions"><button v-for="point in status?.spawns" :key="point.id" :disabled="!status?.ready" @click="viewpoint(point.id)">{{ point.label }}</button></div>
          <p class="walk-lab__description">点击地面直线前往；遇到墙或家具会停止，可分段点击绕行。</p>
          <label class="walk-lab__check"><input type="checkbox" :checked="status?.sliced ?? false" :disabled="status?.mode !== 'inspect'" @change="lab?.setSlice(($event.target as HTMLInputElement).checked)" />隐藏上方结构（剖切）</label>
          <label v-if="status?.sliced">剖切高度 <output>{{ status.sliceHeight.toFixed(1) }} m</output><input type="range" min="0.8" max="12" step="0.1" :value="status.sliceHeight" @input="lab?.setSliceHeight(Number(($event.target as HTMLInputElement).value))" /></label>
          <label>画质<select v-model="quality" @change="lab?.setQuality(quality)"><option value="high">高 · 更清晰</option><option value="balanced">均衡</option><option value="performance">性能</option></select></label>
          <label>曝光 <output>{{ exposure.toFixed(2) }}</output><input v-model.number="exposure" type="range" min="0.5" max="2.5" step="0.05" @input="lab?.setExposure(exposure)" /></label>
          <label class="walk-lab__check"><input v-model="occlusion" type="checkbox" @change="lab?.setOcclusion(occlusion)" />环境遮蔽</label>
        </template>
        <div v-else class="walk-lab__actions"><button @click="lab?.spawnOutdoor()">室外出生点</button><button @click="lab?.spawnIndoor()">室内出生点</button></div>
        <dl v-if="status" class="walk-lab__readout">
          <div><dt>位置</dt><dd>{{ status.player.x.toFixed(2) }}, {{ status.player.y.toFixed(2) }} m</dd></div>
          <div><dt>脚下高度</dt><dd>{{ status.player.footHeight.toFixed(3) }} m</dd></div>
          <div><dt>绘制倍率</dt><dd>{{ status.renderScale.toFixed(2) }}×</dd></div>
          <div v-if="!fixture"><dt>碰撞三角形</dt><dd>{{ status.collisionTriangles.toLocaleString() }}</dd></div>
        </dl>
      </div>
      <p v-if="fatal || status?.error" class="walk-lab__error" role="alert">{{ fatal || status?.error }}</p>
    </section>
    <p class="walk-lab__help">{{ status?.mode === 'inspect' ? '拖动旋转 · 滚轮缩放 · 选择视点进入室内' : status?.mode === 'navigate' ? '单击地面前往 · 按住左键转向 · Esc 暂停' : 'W A S D 移动 · Shift 快走 · 鼠标转头 · Esc 暂停' }}</p>
    <p v-if="!fixture && status?.author" class="walk-lab__credit"><a :href="status.sourceUrl" target="_blank" rel="noreferrer">{{ status.author }}</a> · <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noreferrer">{{ status.license }}</a></p>
    <div v-if="status?.mode === 'walking'" class="walk-lab__crosshair" aria-hidden="true">+</div>
  </main>
</template>

<style scoped>
.walk-lab { position: fixed; inset: 0; overflow: hidden; background: #c8cbd0; color: #26352f; font: 13px/1.5 system-ui, 'Microsoft YaHei', sans-serif; }
.walk-lab__scene { position: absolute; inset: 0; }
.walk-lab__navigation { position: absolute; top: 16px; left: 20px; display: flex; gap: 18px; padding: 7px 12px; border: 1px solid #ffffff90; border-radius: 5px; background: #f6f4eddb; font-size: 12px; }
.walk-lab a { color: #3d5e4f; text-decoration: none; }
.walk-lab__panel { position: absolute; bottom: 60px; left: 20px; width: 284px; max-height: calc(100vh - 155px); box-sizing: border-box; overflow-y: auto; padding: 16px; border: 1px solid #fdfdf9c0; border-radius: 7px; background: #f7f5efee; box-shadow: 0 8px 28px #19271c20; }
.walk-lab__title { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.walk-lab__eyebrow { font-size: 9px; letter-spacing: .15em; color: #64786d; }
.walk-lab__fps { font: 10px/1.5 ui-monospace, monospace; color: #6a766f; }
.walk-lab h1 { margin: 4px 0 3px; font-size: 19px; font-weight: 600; letter-spacing: -.03em; }
.walk-lab__state { margin: 0 0 10px; font-size: 11px; color: #6c7c72; }
.walk-lab__actions { display: flex; flex-wrap: wrap; gap: 6px; }
.walk-lab button { min-height: 30px; padding: 4px 9px; border: 1px solid #cbd3c8; border-radius: 4px; background: #fff; color: #3d5547; font: inherit; font-size: 11px; cursor: pointer; }
.walk-lab button:hover { border-color: #718c77; }
.walk-lab button:disabled { opacity: .5; cursor: default; }
.walk-lab .walk-lab__primary { color: white; background: #365f48; border-color: #365f48; }
.walk-lab__settings { margin-top: 14px; padding-top: 9px; border-top: 1px solid #dbe0d6; }
.walk-lab__description, .walk-lab__note { font-size: 11px; color: #6c7b70; }
.walk-lab label { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; margin: 12px 0; font-size: 11px; }
.walk-lab input[type=range] { width: 100%; accent-color: #4e7259; }
.walk-lab select { max-width: 188px; padding: 5px; border: 1px solid #cbd3c8; border-radius: 4px; background: white; color: #3d5547; font: inherit; }
.walk-lab .walk-lab__check { justify-content: flex-start; }
.walk-lab__readout { margin: 14px 0 6px; font-size: 10px; }
.walk-lab__readout div { display: flex; justify-content: space-between; margin: 4px 0; gap: 8px; }
.walk-lab dt { color: #6d7b70; } .walk-lab dd { margin: 0; font-variant-numeric: tabular-nums; }
.walk-lab__help { position: absolute; bottom: 14px; left: 20px; margin: 0; padding: 6px 10px; border-radius: 4px; background: #f5f3ecdb; color: #5c6d60; font-size: 11px; }
.walk-lab__help strong { color: #385640; }
.walk-lab__credit { position: absolute; right: 16px; bottom: 8px; font-size: 10px; color: #697169; background: #f7f5efb0; padding: 3px 7px; }
.walk-lab__error { color: #a43434; font-size: 11px; }
.walk-lab__crosshair { position: absolute; top: 50%; left: 50%; color: #ffffffa0; font-size: 17px; pointer-events: none; transform: translate(-50%, -50%); text-shadow: 0 1px 3px #0008; }
@media (max-width: 720px) { .walk-lab__panel { left: 10px; bottom: 62px; width: 248px; padding: 12px; } .walk-lab__navigation { left: 10px; top: 10px; } .walk-lab__help { left: 10px; right: 10px; bottom: 10px; font-size: 10px; } .walk-lab__credit { display: none; } }
</style>




