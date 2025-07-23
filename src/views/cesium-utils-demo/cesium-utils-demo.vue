<template>
  <div id="cesiumContainer">
    <div class="control-panel">
      <h3>Cesium工具类演示</h3>
      
      <div class="section">
        <h4>图层管理</h4>
        <button @click="addGeoJsonLayer">添加GeoJSON图层</button>
        <button @click="add3DTileset">添加3D瓦片</button>
        <button @click="addXyzLayer">添加XYZ图层</button>
      </div>

      <div class="section">
        <h4>Primitive</h4>
        <button @click="addPointPrimitive">添加点Primitive</button>
        <button @click="addPolygonPrimitive">添加面Primitive</button>
        <button @click="addBoxPrimitive">添加盒子</button>
      </div>

      <div class="section">
        <h4>Entity</h4>
        <button @click="addPointEntity">添加点Entity</button>
        <button @click="addBillboard">添加Billboard</button>
        <button @click="addPolylineEntity">添加线Entity</button>
      </div>

      <div class="section">
        <h4>管理操作</h4>
        <button @click="listLayers">列出图层</button>
        <button @click="clearAll">清除所有</button>
      </div>

      <div class="layer-list" v-if="layerList.length > 0">
        <h4>当前图层：</h4>
        <div v-for="layer in layerList" :key="layer.id" class="layer-item">
          <span>{{ layer.name }} ({{ layer.type }})</span>
          <button @click="toggleLayer(layer.id)" :class="{ active: layer.visible }">
            {{ layer.visible ? '隐藏' : '显示' }}
          </button>
          <button @click="flyToLayer(layer.id)">飞行到</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import * as Cesium from 'cesium';
import { onMounted, ref } from 'vue';
import { CesiumUtils, createCesiumUtils } from '@/utils/cesium-util/cesiumUtils';

let viewer: Cesium.Viewer;
let cesiumUtils: CesiumUtils;
const layerList = ref<Array<{id: string, name: string, type: string, visible: boolean}>>([]);

// 设置 Cesium Ion 访问令牌
Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI5OWQ2NGJkZS0yODlmLTRlZjItYjZhYy03Mjc5MmM2OWM0OTkiLCJpZCI6NDAyNDQsImlhdCI6MTY2ODIzODM1OX0.au0c5QRIKaUh_Crsz6sfDfdSj2ePoQyaRcXcoXdcqOw';

onMounted(async () => {
  // 初始化Cesium viewer
  viewer = new Cesium.Viewer('cesiumContainer', {
    terrainProvider: await Cesium.createWorldTerrainAsync(),
    timeline: false,
    animation: false,
    homeButton: true,
    sceneModePicker: true,
    baseLayerPicker: true,
    navigationHelpButton: false,
    geocoder: false
  });

  // 创建CesiumUtils实例
  cesiumUtils = createCesiumUtils(viewer);

  // 设置初始相机位置
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(116.4, 39.9, 1000000)
  });
});

// 添加GeoJSON图层
const addGeoJsonLayer = async () => {
  try {
    // 创建一个简单的GeoJSON数据
    const geoJsonData = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [116.4, 39.9]
          },
          properties: {
            name: "北京"
          }
        },
        {
          type: "Feature", 
          geometry: {
            type: "Point",
            coordinates: [121.5, 31.2]
          },
          properties: {
            name: "上海"
          }
        }
      ]
    };

    await cesiumUtils.createLayer({
      type: 'geojson',
      data: geoJsonData,
      name: 'GeoJSON城市点',
      style: {
        point: {
          pixelSize: 10,
          color: Cesium.Color.YELLOW,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2
        }
      }
    });

    updateLayerList();
    console.log('GeoJSON图层已添加');
  } catch (error) {
    console.error('添加GeoJSON图层失败:', error);
  }
};

// 添加3D瓦片集
const add3DTileset = async () => {
  try {
    await cesiumUtils.create3DTileset({
      url: 'https://data.mars3d.cn/3dtiles/qx-simiao/tileset.json',
      name: '3D建筑模型',
      maximumScreenSpaceError: 1
    });

    updateLayerList();
    console.log('3D瓦片集已添加');
  } catch (error) {
    console.error('添加3D瓦片集失败:', error);
  }
};

// 添加XYZ图层
const addXyzLayer = () => {
  try {
    cesiumUtils.createLayer({
      type: 'xyz',
      url: 'https://map.geoq.cn/ArcGIS/rest/services/ChinaOnlineStreetPurplishBlue/MapServer/tile/{z}/{y}/{x}',
      name: '彩色地图图层'
    });

    updateLayerList();
    console.log('XYZ图层已添加');
  } catch (error) {
    console.error('添加XYZ图层失败:', error);
  }
};

// 添加点Primitive
const addPointPrimitive = () => {
  try {
    cesiumUtils.createPrimitive({
      type: 'point',
      positions: [
        Cesium.Cartesian3.fromDegrees(116.4, 39.9, 0),
        Cesium.Cartesian3.fromDegrees(116.5, 39.8, 0),
        Cesium.Cartesian3.fromDegrees(116.3, 40.0, 0)
      ],
      material: '#ff0000',
      radius: 50000
    });

    console.log('点Primitive已添加');
  } catch (error) {
    console.error('添加点Primitive失败:', error);
  }
};

// 添加面Primitive
const addPolygonPrimitive = () => {
  try {
    cesiumUtils.createPrimitive({
      type: 'polygon',
      positions: [
        Cesium.Cartesian3.fromDegrees(116.2, 39.8, 0),
        Cesium.Cartesian3.fromDegrees(116.6, 39.8, 0),
        Cesium.Cartesian3.fromDegrees(116.6, 40.0, 0),
        Cesium.Cartesian3.fromDegrees(116.2, 40.0, 0)
      ],
      material: '#00ff00',
      height: 0,
      extrudedHeight: 100000
    });

    console.log('面Primitive已添加');
  } catch (error) {
    console.error('添加面Primitive失败:', error);
  }
};

// 添加盒子Primitive
const addBoxPrimitive = () => {
  try {
    cesiumUtils.createPrimitive({
      type: 'box',
      position: Cesium.Cartesian3.fromDegrees(116.4, 39.9, 50000),
      dimensions: new Cesium.Cartesian3(100000, 100000, 100000),
      material: '#0000ff'
    });

    console.log('盒子Primitive已添加');
  } catch (error) {
    console.error('添加盒子Primitive失败:', error);
  }
};

// 添加点Entity
const addPointEntity = () => {
  try {
    cesiumUtils.createEntity({
      position: Cesium.Cartesian3.fromDegrees(116.4, 39.9, 100000),
      name: '点Entity',
      point: {
        pixelSize: 15,
        color: Cesium.Color.CYAN,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
      }
    });

    console.log('点Entity已添加');
  } catch (error) {
    console.error('添加点Entity失败:', error);
  }
};

// 添加Billboard
const addBillboard = () => {
  try {
    cesiumUtils.createBillboard({
      position: Cesium.Cartesian3.fromDegrees(116.5, 39.8, 0),
      text: '这是一个标签',
      name: '文字Billboard',
      font: '16pt sans-serif',
      fillColor: '#ffffff',
      outlineColor: '#000000',
      outlineWidth: 2,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND
    });

    console.log('Billboard已添加');
  } catch (error) {
    console.error('添加Billboard失败:', error);
  }
};

// 添加线Entity
const addPolylineEntity = () => {
  try {
    cesiumUtils.createEntity({
      name: '线Entity',
      polyline: {
        positions: [
          [116.2, 39.7],
          [116.3, 39.8],
          [116.4, 39.9],
          [116.5, 40.0],
          [116.6, 40.1]
        ].map(pos => Cesium.Cartesian3.fromDegrees(pos[0], pos[1])),
        width: 5,
        material: Cesium.Color.ORANGE,
        clampToGround: true
      }
    });

    console.log('线Entity已添加');
  } catch (error) {
    console.error('添加线Entity失败:', error);
  }
};

// 更新图层列表
const updateLayerList = () => {
  layerList.value = cesiumUtils.getLayers();
};

// 列出所有图层
const listLayers = () => {
  updateLayerList();
  console.log('当前图层列表:', layerList.value);
};

// 切换图层显示状态
const toggleLayer = (id: string) => {
  const layer = layerList.value.find(l => l.id === id);
  if (layer) {
    cesiumUtils.setLayerVisible(id, !layer.visible);
    updateLayerList();
  }
};

// 飞行到图层
const flyToLayer = async (id: string) => {
  try {
    await cesiumUtils.flyTo(id);
  } catch (error) {
    console.error('飞行到图层失败:', error);
  }
};

// 清除所有数据
const clearAll = () => {
  cesiumUtils.clear();
  layerList.value = [];
  console.log('所有数据已清除');
};
</script>

<style scoped>
#cesiumContainer {
  width: 100%;
  height: 100vh;
  position: relative;
}

.control-panel {
  position: absolute;
  top: 20px;
  left: 20px;
  background: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 20px;
  border-radius: 8px;
  z-index: 1000;
  max-width: 350px;
  max-height: 80vh;
  overflow-y: auto;
}

.control-panel h3 {
  margin: 0 0 15px 0;
  color: #4CAF50;
}

.section {
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
}

.section:last-child {
  border-bottom: none;
  margin-bottom: 0;
}

.section h4 {
  margin: 0 0 10px 0;
  color: #ffffff;
  font-size: 14px;
}

button {
  background: #4CAF50;
  color: white;
  border: none;
  padding: 6px 12px;
  margin: 2px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: background-color 0.3s;
}

button:hover {
  background: #45a049;
}

button:active {
  background: #3d8b40;
}

.layer-list {
  margin-top: 20px;
  padding-top: 15px;
  border-top: 1px solid rgba(255, 255, 255, 0.3);
}

.layer-item {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12px;
}

.layer-item span {
  flex: 1;
  margin-right: 8px;
}

.layer-item button {
  margin-left: 4px;
  padding: 4px 8px;
  font-size: 10px;
}

.layer-item button.active {
  background: #2196F3;
}

.layer-item button.active:hover {
  background: #1976D2;
}
</style> 