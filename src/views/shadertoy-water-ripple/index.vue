<template>
  <div id="CesiumContainer" />
</template>

<script setup lang="ts">
import * as Cesium from "cesium";
import waterJpg from "./water.jpg";
import { onMounted } from "vue";

onMounted(() => {
  const viewer = new Cesium.Viewer("CesiumContainer");
  viewer.resolutionScale = window.devicePixelRatio;
  viewer.postProcessStages.fxaa.enabled = true;
  let xMin = 120.894604;
  let yMin = 30.516896;
  let xMax = 122.431959;
  let yMax = 31.630521;

  let rect = new Cesium.Rectangle(
    Cesium.Math.toRadians(xMin),
    Cesium.Math.toRadians(yMin),
    Cesium.Math.toRadians(xMax),
    Cesium.Math.toRadians(yMax)
  );
  const rectangle = new Cesium.RectangleGeometry({
    rectangle: rect,
    height: 8000,
  });
  const geometry = Cesium.RectangleGeometry.createGeometry(rectangle);
  let primitive = new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry: geometry,
    }),
    asynchronous: false,
  });
  let appearance = new Cesium.MaterialAppearance({
    material: new Cesium.Material({
      fabric: {
        uniforms: {
          image: waterJpg,
        },
      },
    }),
  });
  primitive.appearance = appearance;
  viewer.scene.primitives.add(primitive);
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(120.894604, 30.516896, 10000),
  });
});
</script>

<style scoped></style>
