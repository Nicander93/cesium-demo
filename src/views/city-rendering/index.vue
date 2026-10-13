<template>
  <main class="city-lab">
    <div ref="host" class="city-lab__canvas" aria-label="滨水城市三维场景" />
    <header class="city-lab__header">
      <RouterLink to="/">← 演示目录</RouterLink>
      <RouterLink to="/city-three">Three.js 城市对照 ↗</RouterLink>
      <div>
        <h1>滨水城市 · 环境实验</h1>
        <p>影像地球 / Kenney 示意街区 / 动态车流</p>
      </div>
      <button @click="panelOpen = !panelOpen">
        {{ panelOpen ? '收起设置' : '环境设置' }}
      </button>
    </header>
    <aside v-show="panelOpen" class="city-lab__panel" aria-label="城市环境设置">
      <h2>天气与光线</h2>
      <div class="city-lab__presets">
        <button @click="usePreset('day')">晴天</button
        ><button @click="usePreset('sunset')">夕照</button
        ><button @click="usePreset('rain')">雨天</button>
      </div>
      <label
        >日照时间 <output>{{ timeLabel }}</output
        ><input
          v-model.number="options.hour"
          type="range"
          min="5"
          max="20"
          step="0.1"
      /></label>
      <label
        >曝光 <output>{{ options.exposure.toFixed(2) }}</output
        ><input
          v-model.number="options.exposure"
          type="range"
          min="0.4"
          max="2"
          step="0.05"
      /></label>
      <label
        >阳光强度 <output>{{ options.sunlight.toFixed(2) }}</output
        ><input
          v-model.number="options.sunlight"
          type="range"
          min="0.2"
          max="3"
          step="0.05"
      /></label>
      <label class="city-lab__check"
        ><input
          v-model="options.shadows"
          type="checkbox"
        />建筑与车辆投影</label
      >
      <label class="city-lab__check"
        ><input
          v-model="options.selfShadows"
          :disabled="!options.shadows"
          type="checkbox"
        />模型自阴影（实验）</label
      >
      <label class="city-lab__check"
        ><input v-model="options.clouds" type="checkbox" />体积云与大气</label
      >
      <label class="city-lab__check"
        ><input
          v-model="options.aerialPerspective"
          :disabled="!options.clouds"
          type="checkbox"
        />地表大气透视</label
      >
      <label class="city-lab__check"
        ><input
          v-model="options.groundCloudShadows"
          :disabled="!options.clouds"
          type="checkbox"
        />地表云影（实验）</label
      >
      <label
        >云量 <output>{{ Math.round(options.coverage * 100) }}%</output
        ><input
          v-model.number="options.coverage"
          :disabled="!options.clouds"
          type="range"
          min="0.05"
          max="0.95"
          step="0.01"
      /></label>
      <label
        >云亮度 <output>{{ options.cloudBrightness.toFixed(2) }}</output
        ><input
          v-model.number="options.cloudBrightness"
          :disabled="!options.clouds"
          type="range"
          min="0.5"
          max="2.5"
          step="0.05"
        />
      </label>
      <label
        >云底高度 <output>{{ options.cloudAltitude }} m</output
        ><input
          v-model.number="options.cloudAltitude"
          :disabled="!options.clouds"
          type="range"
          min="500"
          max="3000"
          step="50"
      /></label>
      <label
        >云层厚度 <output>{{ options.cloudThickness }} m</output
        ><input
          v-model.number="options.cloudThickness"
          :disabled="!options.clouds"
          type="range"
          min="300"
          max="1800"
          step="50"
      /></label>
      <label
        >体积光强度 <output>{{ options.volumeLight.toFixed(1) }}</output
        ><input
          v-model.number="options.volumeLight"
          :disabled="!options.clouds"
          type="range"
          min="0"
          max="4"
          step="0.1"
      /></label>
      <p>
        河岸视角适合看云和光束。降低云底、增加厚度后，转动视角观察云的层次；夕照可观察逆光。
      </p>
      <h2>水面</h2>
      <label
        >波浪强度 <output>{{ options.waveStrength.toFixed(1) }}</output
        ><input
          v-model.number="options.waveStrength"
          type="range"
          min="0"
          max="2.5"
          step="0.1"
        />
      </label>
      <label
        >波浪速度 <output>{{ options.waveSpeed.toFixed(1) }}</output
        ><input
          v-model.number="options.waveSpeed"
          type="range"
          min="0"
          max="2.5"
          step="0.1"
        />
      </label>
      <p>风速也会影响波浪。强度为 0 可看平静倒影，速度为 0 可暂停波纹。</p>
      <h2>降雨与地面</h2>
      <label
        >雨量 <output>{{ Math.round(options.rain * 100) }}%</output
        ><input
          v-model.number="options.rain"
          type="range"
          min="0"
          max="1"
          step="0.01"
      /></label>
      <label
        >风速 <output>{{ options.wind.toFixed(0) }} m/s</output
        ><input
          v-model.number="options.wind"
          type="range"
          min="0"
          max="20"
          step="1"
      /></label>
      <label
        >道路湿润 <output>{{ Math.round(options.wetness * 100) }}%</output
        ><input
          v-model.number="options.wetness"
          type="range"
          min="0"
          max="1"
          step="0.01"
      /></label>
      <label class="city-lab__check"
        ><input v-model="options.puddles" type="checkbox" />局部积水实验</label
      >
      <label class="city-lab__check"
        ><input
          v-model="options.reflections"
          type="checkbox"
        />水面场景倒影</label
      >
      <p>积水位于东岸车道，尝试街道视角。湿润与积水为视觉实验，可独立控制。</p>
      <h2>交通与画质</h2>
      <label class="city-lab__check"
        ><input v-model="options.traffic" type="checkbox" />车流动画</label
      >
      <label
        >车辆数量 <output>{{ options.vehicles }}</output
        ><input
          v-model.number="options.vehicles"
          type="range"
          min="0"
          max="40"
          step="1"
      /></label>
      <label
        >行驶速度 <output>{{ Math.round(options.speed * 3.6) }} km/h</output
        ><input
          v-model.number="options.speed"
          type="range"
          min="0"
          max="18"
          step="1"
      /></label>
      <label
        >画质<select v-model="options.quality">
          <option value="low">流畅</option>
          <option value="balanced">均衡</option>
          <option value="high">精细</option>
        </select></label
      >
      <p>云、水面倒影与雨粒子会增加 GPU 开销；卡顿时切换「流畅」。</p>
      <a
        href="https://kenney.nl/assets/city-kit-commercial"
        target="_blank"
        rel="noreferrer"
        >模型来源 · Kenney CC0 ↗</a
      >
    </aside>
    <nav class="city-lab__views" aria-label="场景视角">
      <button @click="lab?.resetView('earth')">地球总览</button
      ><button @click="lab?.resetView('overview')">街区总览</button
      ><button @click="lab?.resetView('river')">河岸看云</button
      ><button @click="lab?.resetView('clouds')">进入云层</button
      ><button @click="lab?.resetView('street')">街道积水</button>
    </nav>
    <section class="city-lab__status" aria-live="polite">
      <span>{{ status.phase }} {{ status.loaded }}/{{ status.total }}</span>
      <span>{{
        status.sky === 'loading'
          ? '正在加载云与大气…'
          : status.sky === 'ready'
            ? '体积云已就绪'
            : '云管线未就绪'
      }}</span>
      <span v-if="status.fps">{{ status.fps }} FPS</span>
    </section>
    <p v-if="status.warning || error" class="city-lab__error" role="alert">
      {{ error || status.warning }}
    </p>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { createCityScene, type CityStatus } from './scene'
import { defaultOptions, presets } from './environment'

const host = ref<HTMLElement>()
const panelOpen = ref(true)
const options = reactive({ ...defaultOptions })
const status = reactive<CityStatus>({
  phase: '准备街区',
  loaded: 0,
  total: 65,
  sky: 'loading',
  warning: '',
  fps: 0,
})
const error = ref('')
let lab: ReturnType<typeof createCityScene> | undefined
const timeLabel = computed(() => {
  const minutes = Math.round(options.hour * 60)
  return `${Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`
})
function usePreset(name: keyof typeof presets): void {
  Object.assign(options, presets[name])
}
watch(options, () => lab?.apply(options))
onMounted(() => {
  try {
    if (!host.value) throw new Error('场景容器未就绪')
    lab = createCityScene(host.value, (update) => Object.assign(status, update))
  } catch (cause) {
    error.value = String(cause instanceof Error ? cause.message : cause)
  }
})
onBeforeUnmount(() => lab?.dispose())
</script>

<style scoped>
.city-lab {
  position: fixed;
  inset: 0;
  background: #b7cbd7;
  color: #f3f5f8;
  font:
    13px/1.5 system-ui,
    sans-serif;
}
.city-lab__canvas {
  position: absolute;
  inset: 0;
}
.city-lab__header {
  position: absolute;
  inset: 0 0 auto;
  padding: 14px 22px;
  display: flex;
  align-items: center;
  gap: 28px;
  background: linear-gradient(#131c2beb, #131c2b00);
  pointer-events: none;
}
.city-lab__header a,
.city-lab__header button {
  pointer-events: auto;
}
.city-lab__header h1 {
  font-size: 19px;
  font-weight: 600;
  margin: 0;
  text-shadow: 0 1px 8px #000;
}
.city-lab__header p {
  color: #d4deea;
  margin: 3px 0 0;
  font-size: 12px;
  text-shadow: 0 1px 6px #000;
}
.city-lab a {
  color: #d4e4f6;
  text-decoration: none;
}
.city-lab button,
.city-lab select {
  color: #eff5fc;
  border: 1px solid #8194ab5c;
  background: #1b2b3bdc;
  border-radius: 5px;
  padding: 7px 11px;
  cursor: pointer;
  font: inherit;
}
.city-lab button:hover {
  background: #34506b;
}
.city-lab__header button {
  margin-left: auto;
}
.city-lab__panel {
  position: absolute;
  right: 18px;
  top: 88px;
  bottom: 72px;
  width: 270px;
  overflow: auto;
  padding: 17px 20px;
  background: #162435ed;
  border: 1px solid #8194ab45;
  border-radius: 7px;
  scrollbar-width: thin;
}
.city-lab__panel h2 {
  font-size: 13px;
  letter-spacing: 0.04em;
  margin: 15px 0 11px;
  color: #fff;
}
.city-lab__panel h2:first-child {
  margin-top: 0;
}
.city-lab__panel label {
  display: block;
  margin: 11px 0;
  color: #dbe5f2;
}
.city-lab__panel output {
  float: right;
  color: #a8cde8;
  font-variant-numeric: tabular-nums;
}
.city-lab__panel input[type='range'] {
  display: block;
  width: 100%;
  margin: 8px 0 0;
  accent-color: #aad9ee;
  cursor: pointer;
}
.city-lab__panel input[type='checkbox'] {
  margin-right: 7px;
  accent-color: #aad9ee;
}
.city-lab__panel select {
  width: 100%;
  display: block;
  margin-top: 7px;
}
.city-lab__panel p {
  color: #aabbd0;
  font-size: 11px;
  margin: 8px 0;
}
.city-lab__presets {
  display: flex;
  gap: 6px;
}
.city-lab__presets button {
  flex: 1;
}
.city-lab__views {
  position: absolute;
  left: 22px;
  bottom: 55px;
  display: flex;
  gap: 8px;
}
.city-lab__status {
  position: absolute;
  left: 180px;
  right: 22px;
  bottom: 15px;
  display: flex;
  gap: 20px;
  font-size: 11px;
  text-shadow: 0 1px 5px #000;
  pointer-events: none;
}
.city-lab__error {
  position: absolute;
  left: 22px;
  bottom: 105px;
  max-width: min(700px, calc(100vw - 330px));
  color: #ffe1d9;
  background: #3a2825e8;
  padding: 10px 14px;
  border-radius: 5px;
  overflow-wrap: anywhere;
}
@media (max-width: 700px) {
  .city-lab__header {
    padding: 12px;
    gap: 12px;
    flex-wrap: wrap;
  }
  .city-lab__header h1 {
    font-size: 16px;
  }
  .city-lab__header p {
    display: none;
  }
  .city-lab__panel {
    width: 235px;
    top: 74px;
    right: 10px;
    bottom: 86px;
    padding: 13px;
  }
  .city-lab__views {
    left: 10px;
    bottom: 57px;
    gap: 5px;
  }
  .city-lab__status {
    left: 10px;
    gap: 9px;
    flex-wrap: wrap;
    bottom: 8px;
  }
  .city-lab__error {
    max-width: calc(100vw - 20px);
    left: 10px;
  }
}
</style>
