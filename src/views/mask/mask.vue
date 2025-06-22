<script setup lang="ts">
import { onMounted, ref } from 'vue';
import * as Cesium from 'cesium';
import { ShaderMask } from './cesium-shader-mask';

const viewer = ref<Cesium.Viewer | null>(null);
const shaderMask = ref<ShaderMask | null>(null);

// 生成圆形坐标的辅助函数
const generateCircleCoordinates = (center: [number, number], radius: number, segments: number = 32): [number, number][] => {
  const coordinates: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    const lng = center[0] + radius * Math.cos(angle);
    const lat = center[1] + radius * Math.sin(angle);
    coordinates.push([lng, lat]);
  }
  return coordinates;
};

const initViewer = () => {
  // 初始化 Cesium Viewer
  viewer.value = new Cesium.Viewer('cesiumContainer', {
    // terrainProvider: Cesium.createWorldTerrainAsync(),
    timeline: false,
    animation: false,
    homeButton: true,
    sceneModePicker: true,
    baseLayerPicker: true,
    navigationHelpButton: false,
    geocoder: false
  });
};

const setupMask = () => {
  if (!viewer.value) return;

  // 创建着色器遮罩
  shaderMask.value = new ShaderMask(viewer.value, {
    maskColor: [0.0, 0.0, 0.0, 0.6], // 黑色半透明遮罩
    fadeDistance: 0.5 // 边缘渐变距离（度）
  });

  // 添加一个矩形遮罩区域（北京周边）
  const beijingArea: [number, number][] = [
    [116.0, 39.5],
    [117.0, 39.5],
    [117.0, 40.5],
    [116.0, 40.5],
    [116.0, 39.5]
  ];
  shaderMask.value.addMaskPolygon(beijingArea);

  // 添加一个圆形遮罩区域（上海周边）
  const shanghaiCenter: [number, number] = [121.5, 31.2];
  const radius = 0.5;
  const shanghaiArea = generateCircleCoordinates(shanghaiCenter, radius, 16);
  shaderMask.value.addMaskPolygon(shanghaiArea);
};

const addTestData = () => {
  if (!viewer.value) return;

  // 添加一些测试数据点
  const testPoints = [
    { name: '北京', position: [116.4, 39.9] },
    { name: '上海', position: [121.5, 31.2] },
    { name: '广州', position: [113.3, 23.1] },
    { name: '深圳', position: [114.1, 22.5] }
  ];

  testPoints.forEach(point => {
    viewer.value!.entities.add({
      position: Cesium.Cartesian3.fromDegrees(point.position[0], point.position[1]),
      point: {
        pixelSize: 10,
        color: Cesium.Color.YELLOW,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2
      },
      label: {
        text: point.name,
        font: '14pt sans-serif',
        pixelOffset: new Cesium.Cartesian2(0, -50),
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE
      }
    });
  });

  // 设置相机视角
  viewer.value.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(116.4, 39.9, 2000000)
  });
};

// 控制函数
const toggleMask = () => {
  if (shaderMask.value?.globalMaskEntity) {
    shaderMask.value.globalMaskEntity.show = !shaderMask.value.globalMaskEntity.show;
  }
};

const changeMaskColor = (r: number, g: number, b: number, a: number) => {
  shaderMask.value?.setMaskColor([r, g, b, a]);
};

const changeFadeDistance = (distance: number) => {
  shaderMask.value?.setFadeDistance(distance);
};

onMounted(() => {
  initViewer();
  setupMask();
  addTestData();
});
</script>

<template>
  <div class="mask-container">
    <div id="cesiumContainer" class="cesium-container"></div>
    
    <!-- 控制面板 -->
    <div class="control-panel">
      <h3>遮罩控制</h3>
      
      <div class="control-group">
        <button @click="toggleMask" class="control-button">
          切换遮罩显示
        </button>
      </div>
      
      <div class="control-group">
        <label>遮罩透明度:</label>
        <input 
          type="range" 
          min="0" 
          max="1" 
          step="0.1" 
          @input="(e) => changeMaskColor(0, 0, 0, parseFloat((e.target as HTMLInputElement).value))"
          value="0.6"
          class="slider"
        />
      </div>
      
      <div class="control-group">
        <label>边缘渐变距离:</label>
        <input 
          type="range" 
          min="0" 
          max="2" 
          step="0.1" 
          @input="(e) => changeFadeDistance(parseFloat((e.target as HTMLInputElement).value))"
          value="0.5"
          class="slider"
        />
      </div>
      
      <div class="control-group">
        <button @click="() => changeMaskColor(1, 0, 0, 0.6)" class="color-button red">
          红色遮罩
        </button>
        <button @click="() => changeMaskColor(0, 0, 1, 0.6)" class="color-button blue">
          蓝色遮罩
        </button>
        <button @click="() => changeMaskColor(0, 0, 0, 0.6)" class="color-button black">
          黑色遮罩
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask-container {
  position: relative;
  width: 100%;
  height: 100%;
}

.cesium-container {
  width: 100%;
  height: 100%;
}

.control-panel {
  position: absolute;
  top: 20px;
  right: 20px;
  background: rgba(42, 42, 42, 0.9);
  color: white;
  padding: 20px;
  border-radius: 8px;
  min-width: 250px;
  font-family: 'Arial', sans-serif;
  backdrop-filter: blur(10px);
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
}

.control-panel h3 {
  margin: 0 0 15px 0;
  font-size: 16px;
  text-align: center;
  border-bottom: 1px solid #555;
  padding-bottom: 10px;
}

.control-group {
  margin-bottom: 15px;
}

.control-group label {
  display: block;
  margin-bottom: 5px;
  font-size: 12px;
  color: #ccc;
}

.control-button {
  width: 100%;
  padding: 10px;
  background: #4CAF50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.3s;
}

.control-button:hover {
  background: #45a049;
}

.slider {
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: #555;
  outline: none;
  cursor: pointer;
}

.color-button {
  width: 30%;
  padding: 8px;
  margin: 2px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  color: white;
  transition: opacity 0.3s;
}

.color-button:hover {
  opacity: 0.8;
}

.color-button.red {
  background: #f44336;
}

.color-button.blue {
  background: #2196F3;
}

.color-button.black {
  background: #333;
}
</style>