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

type TerrainMode = 'tdt' | 'ion' | 'none'
type AnyWindow = Window & {
  Cesium?: any
  __tdtCesium?: any
  __tdtPluginPromise?: Promise<boolean>
}

const token = ref(import.meta.env.VITE_TDT_TOKEN || '4267820f444263b4636cf16d4794417b')
const showTerrain = ref(true)
const terrainMode = ref<TerrainMode>('tdt')
const status = ref('')

let viewer: Cesium.Viewer | null = null

const tdtSubdomains = ['0', '1', '2', '3', '4', '5', '6', '7']

const tdtWmts = {
  img: 'https://t{s}.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={TileMatrix}&TILEROW={TileRow}&TILECOL={TileCol}&tk=',
  cia: 'https://t{s}.tianditu.gov.cn/cia_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cia&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={TileMatrix}&TILEROW={TileRow}&TILECOL={TileCol}&tk=',
}

const tdtPluginScripts = [
  'https://api.tianditu.gov.cn/cdn/plugins/cesium/Cesium_ext_min.js',
  'https://api.tianditu.gov.cn/cdn/plugins/cesium/long.min.js',
  'https://api.tianditu.gov.cn/cdn/plugins/cesium/bytebuffer.min.js',
  'https://api.tianditu.gov.cn/cdn/plugins/cesium/protobuf.min.js',
  'https://api.tianditu.gov.cn/cdn/plugins/cesium/cesiumTdt.js',
]

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
  viewer.imageryLayers.addImageryProvider(
    createTdtImageryProvider(tdtWmts.img + token.value, 'img'),
  )
  viewer.imageryLayers.addImageryProvider(
    createTdtImageryProvider(tdtWmts.cia + token.value, 'cia'),
  )

  viewer.scene.globe.depthTestAgainstTerrain = true

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(86.925, 27.988, 1500000),
  })

  applyTerrain()
}

const createTdtImageryProvider = (url: string, layer: string) => {
  return new Cesium.WebMapTileServiceImageryProvider({
    url,
    layer,
    style: 'default',
    format: 'tiles',
    tileMatrixSetID: 'w',
    subdomains: tdtSubdomains,
    maximumLevel: 18,
  })
}

const loadScriptOnce = (url: string) => {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[data-tdt-plugin="${url}"]`) as HTMLScriptElement | null
    if (existing) {
      if ((existing as any).__loaded) resolve()
      else existing.addEventListener('load', () => resolve(), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = url
    script.async = false
    script.defer = false
    script.setAttribute('data-tdt-plugin', url)
    script.addEventListener('load', () => {
      ;(script as any).__loaded = true
      resolve()
    })
    script.addEventListener('error', () => reject(new Error(`Failed to load script: ${url}`)))
    document.head.appendChild(script)
  })
}

const ensureTdtPluginLoaded = async () => {
  const w = window as AnyWindow
  if (w.__tdtPluginPromise) return w.__tdtPluginPromise

  w.__tdtPluginPromise = (async () => {
    if (!w.__tdtCesium) {
      const mutable: any = {}
      for (const key of Object.keys(Cesium as any)) mutable[key] = (Cesium as any)[key]
      w.__tdtCesium = mutable
    }

    w.Cesium = w.__tdtCesium

    for (const url of tdtPluginScripts) {
      await loadScriptOnce(url)
    }

    return Boolean(w.Cesium && w.Cesium.GeoTerrainProvider)
  })()

  return w.__tdtPluginPromise
}

const applyTdtTerrain = async () => {
  if (!viewer) return false

  const loaded = await ensureTdtPluginLoaded().catch(() => false)
  if (!loaded) return false

  const w = window as AnyWindow
  const CesiumExt = w.Cesium
  if (!CesiumExt?.GeoTerrainProvider) return false

  const urls = tdtSubdomains.map(
    (s) => `https://t${s}.tianditu.gov.cn/mapservice/swdx?T=elv_c&tk=${token.value}`,
  )

  viewer.terrainProvider = new CesiumExt.GeoTerrainProvider({ urls })
  return true
}

const applyIonTerrain = async () => {
  if (!viewer) return
  try {
    const provider = await Cesium.createWorldTerrainAsync()
    viewer.terrainProvider = provider
    status.value = '已加载 Cesium World Terrain'
  } catch {
    viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider()
    status.value = '地形加载失败，已回退到椭球'
  }
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

    status.value = '天地图地形插件不可用，已回退到 Cesium World Terrain'
    await applyIonTerrain()
    return
  }

  await applyIonTerrain()
}

const reload = async () => {
  if (!viewer) return

  viewer.imageryLayers.removeAll()
  viewer.imageryLayers.addImageryProvider(
    createTdtImageryProvider(tdtWmts.img + token.value, 'img'),
  )
  viewer.imageryLayers.addImageryProvider(
    createTdtImageryProvider(tdtWmts.cia + token.value, 'cia'),
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
