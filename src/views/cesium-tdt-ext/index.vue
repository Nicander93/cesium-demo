<template>
  <div id="cesiumContainer" class="full-size" />
  <div class="control-panel">
    <div class="panel-row">
      <label>天地图Token:</label>
      <input v-model.trim="token" placeholder="请输入天地图Token" class="token-input" />
      <button @click="reload">刷新</button>
    </div>
    <div class="panel-row">
      <label>显示地形:</label>
      <input type="checkbox" v-model="showTerrain" @change="applyTerrain" />
    </div>
    <div class="panel-row">
      <label>地形来源:</label>
      <select v-model="terrainMode" @change="applyTerrain" class="mode-select">
        <option value="tdt">天地图(elv_c)</option>
        <option value="ion">Cesium World Terrain</option>
        <option value="none">不加载</option>
      </select>
    </div>
    <div class="panel-row status-row">
      {{ status }}
    </div>
  </div>
</template>

<script setup lang="ts">
import * as Cesium from 'cesium'
import { onMounted, onUnmounted, ref } from 'vue'
import { createTdtWmtsImageryProvider, createTdtTerrainProvider } from '@/utils/cesium-util/tdt'

type TerrainMode = 'tdt' | 'ion' | 'none'

const token = ref(import.meta.env.VITE_TDT_TOKEN || '4267820f444263b4636cf16d4794417b')
const showTerrain = ref(true)
const terrainMode = ref<TerrainMode>('tdt')
const status = ref('')

let viewer: Cesium.Viewer | null = null


onMounted(() => {
  init()
})

onUnmounted(() => {
  if (viewer) {
    viewer.destroy()
    viewer = null
  }
})

const init = () => {
  status.value = ''
  viewer = new Cesium.Viewer('cesiumContainer', {
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    infoBox: false,
    selectionIndicator: false
  })
  const base = viewer.imageryLayers.get(0)
  if (base) viewer.imageryLayers.remove(base, false)
  viewer.imageryLayers.addImageryProvider(
    createTdtWmtsImageryProvider('img', token.value),
  )
  viewer.imageryLayers.addImageryProvider(
    createTdtWmtsImageryProvider('cia', token.value),
  )

  viewer.scene.globe.depthTestAgainstTerrain = true

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(86.925, 27.988, 1500000),
  })

  applyTerrain()
}

const applyTdtTerrain = async () => {
  if (!viewer) return false

  const provider = await createTdtTerrainProvider(token.value).catch(() => null)
  if (!provider) return false
  viewer.terrainProvider = provider
  return true
}

const applyTerrain = async () => {
  if (!viewer) return

  if (!showTerrain.value || terrainMode.value === 'none') {
    viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider()
    status.value = '未加载地形'
    return
  }

  status.value = '正在加载地形...'

  if (terrainMode.value === 'tdt') {
    const ok = await applyTdtTerrain()
    if (ok) {
      status.value = '已加载 天地图(elv_c) 地形'
      return
    }

    status.value = '天地图地形插件不可用，未加载地形'
    viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider()
    return
  }
  if (terrainMode.value === 'ion') {
    status.value = '已选择 Cesium World Terrain，但按需加载未实现'
  }
}

const reload = async () => {
  if (!viewer) return

  viewer.imageryLayers.removeAll()
  viewer.imageryLayers.addImageryProvider(
    createTdtWmtsImageryProvider('img', token.value),
  )
  viewer.imageryLayers.addImageryProvider(
    createTdtWmtsImageryProvider('cia', token.value),
  )

  await applyTerrain()
}

</script>

<style scoped>
.full-size {
  width: 100%;
  height: 100%;
  position: absolute;
  top: 0;
  left: 0;
}

.control-panel {
  position: absolute;
  top: 20px;
  left: 20px;
  background: rgba(0, 0, 0, 0.7);
  padding: 15px;
  border-radius: 8px;
  color: white;
  z-index: 1;
}

.panel-row {
  margin-bottom: 10px;
  display: flex;
  align-items: center;
}

.panel-row label {
  margin-right: 10px;
  min-width: 80px;
}

.token-input {
  width: 200px;
  margin-right: 10px;
  padding: 4px;
}

.mode-select {
  width: 210px;
  padding: 4px;
}

.status-row {
  max-width: 320px;
  font-size: 12px;
  opacity: 0.9;
  word-break: break-all;
}
</style>
