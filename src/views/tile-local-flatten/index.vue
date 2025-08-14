<template>
  <div id="CesiumContainer">
    <div class="card">
      <c-button @click="handleDrawFlatPolygon">绘制平面</c-button>

    </div>
  </div>
</template>

<script setup lang="ts">
import * as Cesium from "cesium";
import { onMounted } from "vue";
import { useTileLocalFlat } from "./useTileLocalFlat";
import { DrawUtil } from "../draw-util/drawUtil";
import CButton from "@/components/c-button.vue";
import { vi } from "vitest";
let viewer: Cesium.Viewer;
let drawUtil: DrawUtil;
const handleDrawFlatPolygon = () => {
  drawUtil.changeDrawMode("point");

};

onMounted(() => {
  viewer = new Cesium.Viewer("CesiumContainer", {
    scene3DOnly: true,
  });
  Cesium.createWorldTerrainAsync().then((terrain) => {
    viewer.scene.globe.terrainProvider = terrain;
  });
  viewer.resolutionScale = window.devicePixelRatio;
  // 启用地形深度测试，这样才能正确拾取3D瓦片
  viewer.scene.globe.depthTestAgainstTerrain = true;
  viewer.scene.postProcessStages.fxaa.enabled = true;

  Cesium.Cesium3DTileset.fromUrl(
    `https://data.mars3d.cn/3dtiles/qx-dyt/tileset.json`,
    {
      maximumScreenSpaceError: 2,
      cullRequestsWhileMovingMultiplier: 100,
      dynamicScreenSpaceError: true,
      preferLeaves: true,
      debugShowBoundingVolume: false,
      debugShowContentBoundingVolume: false,
      // 启用深度测试，确保3D瓦片能正确遮挡
      // enablePick: true,
    }
  ).then((tileset) => {
    viewer.scene.primitives.add(tileset);
    viewer.zoomTo(tileset);

    // 在3D瓦片加载完成后初始化绘制工具
    drawUtil = new DrawUtil(viewer);

    // 确保3D瓦片渲染在正确的深度
    tileset.show = true;

    const positions = Cesium.Cartesian3.fromDegreesArrayHeights([
      108.95959, 34.220223, 105, 108.95922, 34.220054, 105, 108.95914,
      34.219439, 105, 108.95975, 34.219573, 105, 108.95957, 34.219781, 105,
    ]);
    // 使用shaerSource的方式实现
    // const customShader = new Cesium.CustomShader({
    //   vertexShaderText: `
    //    void vertexMain(VertexInput vsInput, inout czm_modelVertexOutput vsOutput) {
    //        vec3 points[4];
    //        points[0] = vec3(${positions[0].x}, ${positions[0].y}, ${positions[0].z});
    //        points[1] = vec3(${positions[1].x}, ${positions[1].y}, ${positions[1].z});
    //        points[2] = vec3(${positions[2].x}, ${positions[2].y}, ${positions[2].z});
    //        points[3] = vec3(${positions[3].x}, ${positions[3].y}, ${positions[3].z});

    //        // 转到模型坐标系
    //        points[0] = (czm_inverseModel * vec4(points[0], 1.0)).xyz;
    //        points[1] = (czm_inverseModel * vec4(points[1], 1.0)).xyz;
    //        points[2] = (czm_inverseModel * vec4(points[2], 1.0)).xyz;
    //        points[3] = (czm_inverseModel * vec4(points[3], 1.0)).xyz;

    //        const int nCount = ${positions.length};
    //        vec2 p = vsOutput.positionMC.xy;

    //        // 射线法判断点是否在多边形内
    //        int nCross = 0;
    //        for (int i = 0; i < nCount; i++) {
    //            vec2 p1 = points[i].xy;
    //            vec2 p2;
    //            if (i < nCount - 1) {
    //                p2 = points[(i + 1)].xy;
    //            } else {
    //                p2 = points[0].xy;
    //            }

    //            if (p1.y == p2.y) continue;
    //            if (p.y < min(p1.y, p2.y)) continue;
    //            if (p.y >= max(p1.y, p2.y)) continue;

    //            float x = (p.y - p1.y) * (p2.x - p1.x) / (p2.y - p1.y) + p1.x;
    //            if (x > p.x) nCross++;
    //        }

    //        if (nCross % 2 == 1) {
    //            vsOutput.positionMC.z = 450.0;
    //        }
    //    }`,
    // });
    // tileset.customShader = customShader;

    // 使用Texture方式实现
    const customShader = useTileLocalFlat(
      positions,
      tileset.boundingSphere.center
    );
    tileset.customShader = customShader;
  });
});
</script>

<style scoped>
.card {
  z-index: 1000;
  width: 200px;
  height: 100px;
  position: absolute;
  top: 30px;
  right: 20px;
  border-radius: 5px;
  background-color: white;
}
</style>
