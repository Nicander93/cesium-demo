<template>
  <main class="rendering-lab">
    <header class="rendering-lab__header">
      <RouterLink :to="{ path: '/' }" class="rendering-lab__back">← 演示目录</RouterLink>
      <div><h1>模型渲染对照</h1><p>同一个 glTF · 同一套摄影棚环境光 · 同步视角</p></div>
      <span class="rendering-lab__version">Cesium {{ support?.version ?? '…' }}</span>
    </header>
    <section class="rendering-lab__toolbar" aria-label="模型选择">
      <label>模型 <select v-model="selectedModel" :disabled="loading" @change="loadSelected"><option value="materials">金属与粗糙度测试</option><option value="airplane">Cesium 飞机</option></select></label>
      <label class="rendering-lab__upload">打开本地模型<input type="file" multiple aria-label="打开本地 GLB 或 glTF 及配套文件" @change="loadLocal" /></label>
      <button type="button" @click="comparison?.resetView()">重置视角</button>
      <span class="rendering-lab__model-name">{{ modelName }}</span>
    </section>
    <div class="rendering-lab__body">
      <aside class="rendering-lab__settings" aria-label="渲染设置">
        <h2>Cesium 渲染</h2>
        <label class="rendering-lab__check"><input v-model="options.enhanced" type="checkbox" />启用改进配置</label>
        <p>{{ options.enhanced ? '使用共享 HDR 环境与可调主光。' : '使用 Cesium 默认光照；右侧保留参考配置。' }}</p>
        <fieldset :disabled="!options.enhanced">
          <legend>共同光照</legend>
          <label class="rendering-lab__check"><input v-model="options.environment" type="checkbox" :disabled="!support?.ibl" />摄影棚环境光</label>
          <label>环境强度 <output>{{ options.environmentIntensity.toFixed(2) }}</output><input v-model.number="options.environmentIntensity" aria-label="环境强度" type="range" min="0" max="1" step="0.05" /></label>
          <label>主光强度 <output>{{ options.lightIntensity.toFixed(2) }}</output><input v-model.number="options.lightIntensity" aria-label="主光强度" type="range" min="0" max="3" step="0.05" /></label>
          <label>曝光 <output>{{ options.exposure.toFixed(2) }}</output><input v-model.number="options.exposure" aria-label="曝光" type="range" min="0.25" max="2.5" step="0.05" /></label>
          <label>色调映射<select v-model="options.tonemapper"><option value="neutral">PBR Neutral</option><option value="aces">ACES</option></select></label>
          <label class="rendering-lab__check"><input v-model="options.shadows" type="checkbox" />地面投影</label>
          <label class="rendering-lab__check"><input v-model="options.selfShadows" type="checkbox" :disabled="!options.shadows" />模型接收阴影</label>
          <p>接收阴影可能同时压暗 Cesium 的环境光，建议单独对照。</p>
          <label class="rendering-lab__check"><input v-model="options.ao" type="checkbox" :disabled="!support?.ao" />Cesium 环境遮蔽 AO</label>
        </fieldset>
        <button type="button" @click="resetOptions">恢复推荐配置</button>
        <p class="rendering-lab__hint">拖动旋转 · 滚轮缩放 · Shift 拖动平移</p>
        <p class="rendering-lab__hint">测试球上排为金属，下排为非金属；从左到右粗糙度增加。模型原始材质保持不变。</p>
        <p v-if="support && (!support.hdr || !support.ibl)" role="status" class="rendering-lab__warning">当前设备不支持完整 HDR / 环境反射，已使用可用能力。</p>
        <p class="rendering-lab__hint">环境预滤波、BRDF 和地面材质实现不同，这个对照用于诊断画质差距。</p>
      </aside>
      <section class="rendering-lab__viewports" aria-label="同步模型对照">
        <article class="rendering-lab__viewport"><h2>Cesium <span>{{ options.enhanced ? '改进配置' : '默认光照' }}</span></h2><div ref="cesiumHost" class="rendering-lab__canvas" /></article>
        <article class="rendering-lab__viewport"><h2>Three.js <span>摄影棚参考</span></h2><div ref="threeHost" class="rendering-lab__canvas" /></article>
        <p v-if="loading" role="status" class="rendering-lab__status">正在加载 {{ modelName }}…</p>
        <p v-if="error" role="alert" class="rendering-lab__error">{{ error }}</p>
      </section>
    </div>
  </main>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { createRenderingComparison, defaultOptions } from './rendering'
import { createLocalModel } from './model-source'
import type { ModelSource } from './model-source'

const cesiumHost = ref<HTMLElement>()
const threeHost = ref<HTMLElement>()
const options = reactive({ ...defaultOptions })
const selectedModel = ref('materials')
const modelName = ref('金属与粗糙度测试')
const loading = ref(false)
const error = ref('')
const support = ref<ReturnType<typeof createRenderingComparison>['support']>()
let comparison: ReturnType<typeof createRenderingComparison> | undefined
let localSource: ModelSource | undefined
let request = 0
let disposed = false

async function loadModel(source: ModelSource): Promise<void> {
  if (!comparison) { source.dispose(); return }
  const current = ++request
  loading.value = true
  error.value = ''
  modelName.value = source.name
  try {
    await comparison.load(source.url)
    if (disposed || current !== request) { source.dispose(); return }
    localSource?.dispose()
    localSource = source
  } catch (cause) {
    source.dispose()
    if (current === request && !disposed) error.value = String(cause instanceof Error ? cause.message : cause)
  } finally { if (current === request && !disposed) loading.value = false }
}
async function loadSelected(): Promise<void> {
  const source = selectedModel.value === 'airplane'
    ? { url: `${import.meta.env.BASE_URL}model/Cesium_Air.glb`, name: 'Cesium 飞机' }
    : { url: `${import.meta.env.BASE_URL}model-rendering/material-study.glb`, name: '金属与粗糙度测试' }
  await loadModel({ ...source, dispose: () => {} })
}
async function loadLocal(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length) return
  try { await loadModel(await createLocalModel(files)) }
  catch (cause) { error.value = String(cause instanceof Error ? cause.message : cause) }
}
function resetOptions(): void { Object.assign(options, defaultOptions) }
watch(options, () => comparison?.applyOptions(options))
onMounted(async () => {
  try {
    comparison = createRenderingComparison(cesiumHost.value!, threeHost.value!, message => { error.value = message })
    support.value = comparison.support
    await loadSelected()
  } catch (cause) { error.value = String(cause instanceof Error ? cause.message : cause) }
})
onBeforeUnmount(() => { disposed = true; request++; comparison?.dispose(); localSource?.dispose() })
</script>

<style scoped>
.rendering-lab { position: fixed; inset: 0; height: 100dvh; color: #e7e9ed; background: #171a21; display: flex; flex-direction: column; font-family: system-ui, sans-serif; overflow: auto; }
.rendering-lab__header { display: flex; align-items: center; gap: 28px; padding: 18px 24px; border-bottom: 1px solid #343944; }
.rendering-lab__header h1 { margin: 0; font-size: 21px; font-weight: 600; }
.rendering-lab__header p { margin: 5px 0 0; color: #a4acba; font-size: 13px; }
.rendering-lab__back { color: #becce7; text-decoration: none; white-space: nowrap; }
.rendering-lab__version { margin-left: auto; font-size: 12px; color: #a4acba; white-space: nowrap; }
.rendering-lab__toolbar { display: flex; align-items: center; gap: 16px; padding: 12px 24px; flex-wrap: wrap; }
.rendering-lab__model-name { color: #a4acba; font-size: 13px; }
.rendering-lab button, .rendering-lab select, .rendering-lab__upload { border: 1px solid #485264; background: #252c38; color: #e7e9ed; padding: 7px 10px; border-radius: 4px; font-size: 13px; cursor: pointer; }
.rendering-lab button:hover, .rendering-lab__upload:hover { border-color: #a5b9d9; }
.rendering-lab input:focus-visible, .rendering-lab button:focus-visible, .rendering-lab select:focus-visible, .rendering-lab a:focus-visible { outline: 2px solid #a5b9d9; outline-offset: 3px; }
.rendering-lab__upload { position: relative; }
.rendering-lab__upload input { position: absolute; opacity: 0; inset: 0; width: 100%; cursor: pointer; }
.rendering-lab__body { display: flex; flex: 1; min-height: 450px; }
.rendering-lab__settings { width: 228px; flex-shrink: 0; padding: 20px; border-right: 1px solid #343944; overflow: auto; }
.rendering-lab__settings h2 { font-size: 15px; margin: 0 0 18px; }
.rendering-lab__settings p { font-size: 12px; color: #a4acba; line-height: 1.7; }
.rendering-lab__settings fieldset { border: 0; margin: 20px 0; padding: 0; }
.rendering-lab__settings legend { font-size: 12px; color: #a4acba; margin-bottom: 14px; }
.rendering-lab__settings label { display: block; margin-bottom: 17px; font-size: 13px; }
.rendering-lab__settings output { float: right; color: #a4acba; }
.rendering-lab__settings input[type=range] { width: 100%; display: block; margin-top: 9px; accent-color: #a5b9d9; }
.rendering-lab__settings select { display: block; width: 100%; margin-top: 8px; }
.rendering-lab__check input { margin: 0 8px 0 0; accent-color: #a5b9d9; }
.rendering-lab__settings fieldset:disabled { opacity: .5; }
.rendering-lab__viewports { flex: 1; min-width: 0; display: grid; grid-template-columns: 1fr 1fr; position: relative; }
.rendering-lab__viewport { min-width: 0; display: flex; flex-direction: column; margin: 0; }
.rendering-lab__viewport + .rendering-lab__viewport { border-left: 1px solid #485264; }
.rendering-lab__viewport h2 { margin: 0; padding: 12px 16px; font-size: 14px; font-weight: 500; background: #20252e; }
.rendering-lab__viewport h2 span { float: right; font-size: 12px; color: #a4acba; }
.rendering-lab__canvas { flex: 1; min-height: 350px; position: relative; touch-action: none; }
.rendering-lab__canvas :deep(canvas) { display: block; }
.rendering-lab__status, .rendering-lab__error { position: absolute; bottom: 20px; left: 20px; right: 20px; background: #171a21ed; padding: 12px 16px; font-size: 13px; border: 1px solid #485264; }
.rendering-lab__error { color: #ffc4b9; white-space: pre-wrap; }
.rendering-lab__warning { color: #efd1a0 !important; }
@media (max-width: 900px) { .rendering-lab__settings { width: 175px; padding: 14px; } .rendering-lab__header { padding: 14px; gap: 16px; } .rendering-lab__header p { max-width: 280px; } }
@media (max-width: 650px) { .rendering-lab__header { flex-wrap: wrap; } .rendering-lab__version { margin-left: 0; } .rendering-lab__body { flex-direction: column-reverse; min-height: unset; } .rendering-lab__settings { width: auto; overflow: visible; border-right: 0; } .rendering-lab__viewports { grid-template-columns: 1fr; } .rendering-lab__viewport + .rendering-lab__viewport { border-left: 0; border-top: 1px solid #485264; } .rendering-lab__canvas { height: 360px; flex: auto; } }
</style>
