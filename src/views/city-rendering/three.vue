<template>
  <main class="three-city">
    <div
      ref="host"
      class="three-city__canvas"
      aria-label="Three.js 城市对照场景"
    />
    <header class="three-city__header">
      <RouterLink to="/city-rendering">← Cesium 城市页</RouterLink>
      <h1>滨水城市 · Three.js 对照</h1>
      <button @click="panelOpen = !panelOpen">
        {{ panelOpen ? '收起设置' : '环境设置' }}
      </button>
    </header>
    <aside v-show="panelOpen" class="three-city__panel">
      <p>
        同一批 GLB、街区布局、车流路径与
        HDR。天空采用纯色背景，先对比模型材质、光照和阴影。
      </p>
      <label
        >日照时间 <output>{{ options.hour.toFixed(1) }} 时</output
        ><input
          v-model.number="options.hour"
          type="range"
          min="5"
          max="20"
          step=".1"
      /></label>
      <label
        >曝光 <output>{{ options.exposure.toFixed(2) }}</output
        ><input
          v-model.number="options.exposure"
          type="range"
          min=".4"
          max="2"
          step=".05"
      /></label>
      <label
        >阳光强度 <output>{{ options.sunlight.toFixed(2) }}</output
        ><input
          v-model.number="options.sunlight"
          type="range"
          min=".2"
          max="3"
          step=".05"
      /></label>
      <label
        ><input
          v-model="options.shadows"
          type="checkbox"
        />建筑与车辆投影</label
      >
      <label
        ><input
          v-model="options.selfShadows"
          type="checkbox"
        />模型自阴影</label
      >
      <label
        ><input v-model="options.traffic" type="checkbox" />车流动画（28
        辆）</label
      >
      <label
        ><input
          v-model="options.reflections"
          type="checkbox"
        />水面动态倒影</label
      >
      <label
        >水波速度 <output>{{ options.waveSpeed.toFixed(1) }}</output
        ><input
          v-model.number="options.waveSpeed"
          type="range"
          min="0"
          max="3"
          step=".1"
      /></label>
      <button @click="Object.assign(options, threeCityDefaults)">
        还原对照参数
      </button>
      <p>
        两页使用相同预设视角。Cesium
        页关闭「体积云与大气」后，环境更接近本页；两套水面实现分别调试。
      </p>
      <RouterLink to="/model-rendering">单模型双引擎并排对照 ↗</RouterLink>
    </aside>
    <nav class="three-city__views" aria-label="场景视角">
      <button @click="lab?.resetView('overview')">街区总览</button>
      <button @click="lab?.resetView('river')">河岸看云</button>
      <button @click="lab?.resetView('street')">街道视角</button>
    </nav>
    <p class="three-city__status">
      模型 {{ status.loaded }}/{{ status.total }} · {{ status.fps }} FPS
      <span role="alert">{{ status.error }}</span>
    </p>
  </main>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { createThreeCity, threeCityDefaults } from './three-scene'
const host = ref<HTMLElement>()
const panelOpen = ref(true)
const options = reactive({ ...threeCityDefaults })
const status = reactive({ loaded: 0, total: 65, fps: 0, error: '' })
let lab: ReturnType<typeof createThreeCity> | undefined
watch(options, () => lab?.apply(options))
onMounted(() => {
  try {
    if (host.value)
      lab = createThreeCity(host.value, (value) => Object.assign(status, value))
  } catch (error) {
    status.error = String(error)
  }
})
onBeforeUnmount(() => lab?.dispose())
</script>

<style scoped>
.three-city {
  position: fixed;
  inset: 0;
  background: #a9c5d6;
  color: #f3f5f8;
  font:
    13px/1.5 system-ui,
    sans-serif;
}
.three-city__canvas {
  position: absolute;
  inset: 0;
}
.three-city__header {
  position: absolute;
  inset: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 14px 22px;
  background: linear-gradient(#131c2bee, transparent);
}
.three-city__header h1 {
  margin: 0;
  font-size: 19px;
  font-weight: 600;
  text-shadow: 0 1px 8px #000;
}
.three-city__header button {
  margin-left: auto;
}
.three-city a {
  color: #d4e4f6;
  text-decoration: none;
}
.three-city button {
  color: #eff5fc;
  border: 1px solid #8194ab5c;
  background: #1b2b3bdc;
  border-radius: 5px;
  padding: 7px 11px;
  cursor: pointer;
  font: inherit;
}
.three-city button:hover {
  background: #34506b;
}
.three-city__panel {
  position: absolute;
  right: 18px;
  top: 88px;
  bottom: 80px;
  width: 270px;
  overflow: auto;
  padding: 17px 20px;
  background: #162435ed;
  border: 1px solid #8194ab45;
  border-radius: 7px;
}
.three-city__panel label {
  display: block;
  margin: 16px 0;
}
.three-city__panel output {
  float: right;
  color: #a8cde8;
}
.three-city__panel input[type='range'] {
  display: block;
  width: 100%;
  margin-top: 8px;
  accent-color: #aad9ee;
}
.three-city__panel input[type='checkbox'] {
  margin-right: 7px;
  accent-color: #aad9ee;
}
.three-city__panel p {
  font-size: 12px;
  color: #b6c7d8;
}
.three-city__views {
  position: absolute;
  left: 22px;
  bottom: 55px;
  display: flex;
  gap: 8px;
}
.three-city__status {
  position: absolute;
  left: 22px;
  bottom: 8px;
  text-shadow: 0 1px 5px #000;
}
.three-city__status span {
  color: #ffddcf;
}
@media (max-width: 700px) {
  .three-city__header {
    padding: 12px;
    gap: 12px;
    flex-wrap: wrap;
  }
  .three-city__header h1 {
    font-size: 16px;
  }
  .three-city__panel {
    width: 225px;
    right: 10px;
    top: 105px;
    padding: 14px;
  }
  .three-city__views {
    left: 10px;
    gap: 5px;
  }
}
</style>
