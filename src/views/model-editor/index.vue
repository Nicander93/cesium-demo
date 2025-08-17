<template>
  <div class="layout">
    <div id="map3dContainer" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import * as Cesium from 'cesium';
import EditCesium from './EditCesium';
import GUI from 'lil-gui';

const mapInstance = ref<any>(null);
const bim = ref<any>(null);
const point = ref<any>(null);
const tiles = ref<any>(null);

const createCesium = async () => {
  // 初始化 Cesium 地图
  const map = new Cesium.Viewer('map3dContainer', {
    infoBox: false,
    selectionIndicator: false,
    shadows: true,
  });
  map.resolutionScale = window.devicePixelRatio;
  
  // 异步设置地形
  try {
    const terrainProvider = await Cesium.createWorldTerrainAsync();
    map.terrainProvider = terrainProvider;
  } catch (error) {
    console.log('Failed to load terrain:', error);
  }
  
  // 设置默认视角
  map.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(108.95186608439401, 34.21980211937744, 1000),
    orientation: {
      heading: 0.0,
      pitch: -Math.PI / 2,
      roll: 0.0
    }
  });
  
  // 启用深度测试
  map.scene.globe.depthTestAgainstTerrain = true;
  
  (window as any).deepMap = map;
  mapInstance.value = map;
  addBim(map);
};

const addBim = async (map: any) => {
  try {
    tiles.value = await Cesium.Cesium3DTileset.fromUrl(
      `https://data.mars3d.cn/3dtiles/qx-dyt/tileset.json`,
      {
        maximumScreenSpaceError: 2,
        cullRequestsWhileMovingMultiplier: 100,
        dynamicScreenSpaceError: true,
        preferLeaves: true,
        debugShowBoundingVolume: false,
        debugShowContentBoundingVolume: false,
      },
    );
    map.scene.primitives.add(tiles.value);
    map.zoomTo(tiles.value);
    
    const origin = Cesium.Cartesian3.fromDegrees(
      108.95186608439401,
      34.21980211937744,
      700,
    );
    const modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
    
    bim.value = await Cesium.Model.fromGltfAsync({
      url: '/model/Cesium_Air.glb',
      modelMatrix: modelMatrix,
      scale: 100,
    });
    map.scene.primitives.add(bim.value);
    
    point.value = map.entities.add({
      position: Cesium.Cartesian3.fromDegrees(
        108.95186608439401,
        34.21980211937744,
        500,
      ),
      point: {
        pixelSize: 10,
        color: Cesium.Color.RED,
      },
    });
    
    addGui(map);
  } catch (error) {
    console.log(`Failed to load model. ${error}`);
  }
};

const addGui = (map: any) => {
  const bimEditCesium = new EditCesium(map, {
    rotateEnabled: true,
    translateEnabled: true,
    scaleEnabled: true,
  });
  bimEditCesium.addTo(bim.value);
  
  const tilesEditCesium = new EditCesium(map, {
    rotateEnabled: true,
    translateEnabled: true,
  });
  tilesEditCesium.addTo(tiles.value);
  
  const pointEditCesium = new EditCesium(map, {
    translateEnabled: true,
  });
  pointEditCesium.addTo(point.value);
  
  const bimModel = {
    rotateEnabled: true,
    translateEnabled: true,
    scaleEnabled: true,
  };
  
  const gui = new GUI();
  const bimFolder = gui.addFolder('BIM');
  bimFolder.add(bimModel, 'rotateEnabled').onChange(() => {
    bimEditCesium.rotateEnabled = bimModel.rotateEnabled;
  });
  bimFolder.add(bimModel, 'translateEnabled').onChange(() => {
    bimEditCesium.translateEnabled = bimModel.translateEnabled;
  });
  bimFolder.add(bimModel, 'scaleEnabled').onChange(() => {
    bimEditCesium.scaleEnabled = bimModel.scaleEnabled;
  });
  
  const tilesModel = {
    rotateEnabled: true,
    translateEnabled: true,
  };
  const tilesFolder = gui.addFolder('Tiles');
  tilesFolder.add(tilesModel, 'rotateEnabled').onChange(() => {
    tilesEditCesium.rotateEnabled = tilesModel.rotateEnabled;
  });
  tilesFolder.add(tilesModel, 'translateEnabled').onChange(() => {
    tilesEditCesium.translateEnabled = tilesModel.translateEnabled;
  });
  
  const pointModel = {
    translateEnabled: true,
  };
  const pointFolder = gui.addFolder('Point');
  pointFolder.add(pointModel, 'translateEnabled').onChange(() => {
    pointEditCesium.translateEnabled = pointModel.translateEnabled;
  });
  
  pointFolder.open();
  tilesFolder.open();
  bimFolder.open();
};

onMounted(async () => {
  await createCesium();
});

onUnmounted(() => {
  if (mapInstance.value) {
    mapInstance.value.destroy();
    mapInstance.value = null;
  }
});
</script>

<style scoped>
.layout {
  width: 100%;
  height: 100vh;
}

#map3dContainer {
  width: 100%;
  height: 100%;
}
</style>
