<template>
  <div id="cesiumContainer">

  </div>
  <div class="camera-info">
    <div>经度: {{ cameraInfo.longitude }}°</div>
    <div>纬度: {{ cameraInfo.latitude }}°</div>
    <div>高度: {{ cameraInfo.height }}m</div>
  </div>
  
  <div class="water-controls">
    <div class="control-item">
      <label>水面高度:</label>
      <input 
        type="number" 
        v-model="waterHeight" 
        @input="updateWaterHeight"
        min="0" 
        max="1000" 
        step="1"
        placeholder="输入高度(米)"
      />
      <span>米</span>
    </div>
  </div>
</template>

<script setup lang="ts">
// 水面反射效果演示
import { WaterSurface } from './WaterSurface';
import * as Cesium from 'cesium'
import { onMounted, ref } from 'vue'
window.Cesium = Cesium;

// 相机信息响应式数据
const cameraInfo = ref({
  longitude: 0,
  latitude: 0,
  height: 0
});

// 水面高度响应式数据
const waterHeight = ref(44);

// 设置 Cesium Ion 访问令牌
Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI5OWQ2NGJkZS0yODlmLTRlZjItYjZhYy03Mjc5MmM2OWM0OTkiLCJpZCI6NDAyNDQsImlhdCI6MTY2ODIzODM1OX0.au0c5QRIKaUh_Crsz6sfDfdSj2ePoQyaRcXcoXdcqOw'

// 更新相机信息的函数
function updateCameraInfo(viewer: Cesium.Viewer) {
  const camera = viewer.camera;
  const position = camera.position;
  const cartographic = Cesium.Cartographic.fromCartesian(position);
  
  cameraInfo.value = {
    longitude: parseFloat(Cesium.Math.toDegrees(cartographic.longitude).toFixed(6)),
    latitude: parseFloat(Cesium.Math.toDegrees(cartographic.latitude).toFixed(6)),
    height: Math.round(cartographic.height)
  };
}

async function initWaterDemo(): Promise<{
  viewer: any;
  waterSurface: any;
  updateWaterProperties: () => void;
  waterControls: any;
}> {
  // 创建Cesium viewer
  const viewer = new Cesium.Viewer("cesiumContainer", {
    infoBox: false,
    fullscreenButton: false,
    vrButton: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    navigationHelpButton: false,
    navigationInstructionsInitiallyVisible: false,
    animation: false,
    baseLayerPicker: false,
    // terrainProvider: await Cesium.createWorldTerrainAsync(),
  });

  // 隐藏版权信息
  (viewer.cesiumWidget.creditContainer as HTMLElement).style.display = "none";
  viewer.scene.globe.depthTestAgainstTerrain = false;
  viewer.scene.debugShowFramesPerSecond = true;

  // 监听相机移动事件
  viewer.camera.moveEnd.addEventListener(() => {
    updateCameraInfo(viewer);
  });

  // 定义水面多边形位置（只包含经纬度，高度由height参数控制）
  const waterPositions = [
    Cesium.Cartographic.fromDegrees(119.031533, 33.593063, 0),
    Cesium.Cartographic.fromDegrees(119.030249, 33.592114, 0),
    Cesium.Cartographic.fromDegrees(119.032524, 33.591157, 0),
    Cesium.Cartographic.fromDegrees(119.033232, 33.592346, 0),
    Cesium.Cartographic.fromDegrees(119.032454, 33.592552, 0),
  ];

  // 加载3D瓦片集
  try {
    // const tileset = await Cesium.Cesium3DTileset.fromIonAssetId(40866);
    const tileset = await Cesium.Cesium3DTileset.fromUrl('https://data.mars3d.cn/3dtiles/qx-simiao/tileset.json', {
      skipLevelOfDetail: true,
      baseScreenSpaceError: 1024,
      skipScreenSpaceErrorFactor: 16,
      skipLevels: 1,
      immediatelyLoadDesiredLevelOfDetail: false,
      loadSiblings: false,
      cullWithChildrenBounds: true
    });
    
    // 期望抬高的米数
    const deltaHeight = 110;

    // 1. 取模型中心的经纬高
    const bounding = tileset.boundingSphere;
    const centerCarto = Cesium.Cartographic.fromCartesian(bounding.center);

    // 2. 计算“原始位置”与“抬高后位置”对应的 Cartesian3
    const surface = Cesium.Cartesian3.fromRadians(
      centerCarto.longitude,
      centerCarto.latitude,
      centerCarto.height
    );
    const offset  = Cesium.Cartesian3.fromRadians(
      centerCarto.longitude,
      centerCarto.latitude,
      centerCarto.height + deltaHeight
    );

    // 3. 两点相减得到沿当地法线方向的平移向量
    const translation = Cesium.Cartesian3.subtract(offset, surface, new Cesium.Cartesian3());

    // 4. 应用到 tileset
    tileset.modelMatrix = Cesium.Matrix4.fromTranslation(translation);
    
    viewer.scene.primitives.add(tileset);

    // 等待瓦片集准备就绪后再缩放
    await (tileset as any).readyPromise;
  
    viewer.zoomTo(tileset);
  } catch (error) {
    console.warn("无法加载3D瓦片集:", error);
  } finally {
    
    // viewer.camera.setView({
    //   destination: Cesium.Cartesian3.fromDegrees( 119.47758, 28.44004, 500),
    //   orientation: {
    //     heading: 0.0,
    //     pitch: -0.5,
    //     roll: 0.0
    //   }
    // });
    
    // 初始化相机信息
    updateCameraInfo(viewer);
  }

  // 水面配置选项
  const waterSurfaceOptions = {
    scene: viewer.scene,
    positions: waterPositions,
    height: 44,      // 设置水面高度为163米
    rippleSize: 100,
    waterColor: Cesium.Color.fromCssColorString("#001e0f"),
    waterAlpha: 0.9,
    reflectivity: 0.3,
    sunShiny: 100,
    distortionScale: 3.7,
    normalMapUrl: "/img/waterNormals.jpg"
  };

  // 创建水面反射效果
  const waterSurface = new WaterSurface(waterSurfaceOptions);

  // 控制参数
  const waterControls = {
    波纹大小: 50,
    透明度: 0.9,
    反射率: 0.3,
    扭曲: 3.7,
    高度: 44,
  };

  // 更新水面属性的函数
  function updateWaterProperties(): void {
    waterSurface.rippleSize = waterControls.波纹大小;
    waterSurface.waterAlpha = waterControls.透明度;
    waterSurface.reflectivity = waterControls.反射率;
    waterSurface.distortionScale = waterControls.扭曲;
    waterSurface.height = waterControls.高度;
  }

  // 初始化水面属性
  updateWaterProperties();

  // 如果需要GUI控制，可以添加lil-gui
  // const gui = new GUI();
  // gui.add(waterControls, "波纹大小").min(0).max(300).onChange(updateWaterProperties);
  // gui.add(waterControls, "透明度").min(0).max(1).onChange(updateWaterProperties);
  // gui.add(waterControls, "反射率").min(0).max(1).onChange(updateWaterProperties);
  // gui.add(waterControls, "扭曲").min(0).max(8).onChange(updateWaterProperties);
  // gui.add(waterControls, "高度").min(70).max(100).onChange(updateWaterProperties);

  return {
    viewer,
    waterSurface,
    updateWaterProperties,
    waterControls
  };
}

// 全局变量存储waterSurface实例
let globalWaterSurface: any = null;

// 更新水面高度的函数
const updateWaterHeight = () => {
  if (globalWaterSurface) {
    globalWaterSurface.height = waterHeight.value;
    console.log('水面高度已更新为:', waterHeight.value, '米');
  }
};
onMounted(async () => {
  const result = await initWaterDemo();
  globalWaterSurface = result.waterSurface;
})
</script>

<style scoped>
.camera-info {
  position: fixed;
  bottom: 20px;
  left: 20px;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 10px 15px;
  border-radius: 5px;
  font-family: monospace;
  font-size: 14px;
  z-index: 1000;
}

.camera-info div {
  margin: 2px 0;
}

.water-controls {
  position: fixed;
  top: 20px;
  right: 20px;
  background: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 15px;
  border-radius: 8px;
  font-family: 'Arial', sans-serif;
  font-size: 14px;
  z-index: 1000;
  min-width: 200px;
}

.control-item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.control-item label {
  font-weight: bold;
  min-width: 80px;
}

.control-item input {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: white;
  padding: 5px 8px;
  border-radius: 4px;
  font-size: 14px;
  width: 80px;
}

.control-item input:focus {
  outline: none;
  border-color: #4CAF50;
  background: rgba(255, 255, 255, 0.2);
}

.control-item input::placeholder {
  color: rgba(255, 255, 255, 0.5);
}

.control-item span {
  color: #4CAF50;
  font-weight: bold;
}
</style>