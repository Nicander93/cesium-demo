<template>
  <div id="CesiumContainer">
    <div class="draw-toolbar">
      <c-button class="draw-btn" @click="drawUtil?.changeDrawMode('point')">
        绘制点
      </c-button>
      <c-button class="draw-btn" @click="drawUtil?.changeDrawMode('polyline')">
        绘制线
      </c-button>
      <c-button class="draw-btn" @click="drawUtil?.changeDrawMode('polygon')">
        绘制面
      </c-button>
      <c-button class="draw-btn" @click="drawUtil?.clear()">清除</c-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import * as Cesium from "cesium";
import { onMounted, onUnmounted } from "vue";
import { DrawUtil } from "./drawUtil";
import CButton from "@/components/c-button.vue";

let drawUtil: DrawUtil | undefined;
let viewer: Cesium.Viewer
onMounted(() => {
  viewer = new Cesium.Viewer("CesiumContainer");
  viewer.resolutionScale = window.devicePixelRatio;
  viewer.scene.globe.depthTestAgainstTerrain = true;
  viewer.scene.postProcessStages.fxaa.enabled = true;
  Cesium.createWorldTerrainAsync().then((terrainProvider) => {
    viewer.terrainProvider = terrainProvider;
  });
  drawUtil = new DrawUtil(viewer);
});
onUnmounted(() => {
  viewer.destroy()
})
</script>

<style scoped>
.draw-toolbar {
  position: absolute;
  padding: 10px;
  border-radius: 5px;
  background-color: aliceblue;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 100px;
  top: 40px;
  right: 10px;
  z-index: 1000;
}
</style>
