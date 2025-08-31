<template>
  <div id="CesiumContainer" />
</template>

<script setup lang="ts">
import * as Cesium from 'cesium';
import { onMounted } from 'vue';
import { ImprovedNoise } from './ImporvedNoise';
import CustomPrimitive from './CustomPrimitive'
import GUI from 'lil-gui';

const gui = new GUI();
onMounted(() => {
  const viewer = new Cesium.Viewer('CesiumContainer', {
    shouldAnimate: true,
  })
  viewer.resolutionScale = window.devicePixelRatio;
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(120.14046454, 30.27415039, 100.0),
  })

  const size = 128;
  const data = new Uint8Array(size * size * size);
  let i = 0;
  const perlin = ImprovedNoise();
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // vector.set( x, y, z ).divideScalar( size );
        const vector = new Cesium.Cartesian3(x, y, z);
        // 将当前体素坐标归一化到[0,1]区间，便于后续噪声采样
        Cesium.Cartesian3.divideByScalar(vector, size, vector);
        const d = perlin.noise(
          vector.x * 6.5,
          vector.y * 6.5,
          vector.z * 6.5,
        );
        data[i++] = d * 128 + 128;
      }
    }
  }
  const viewModel = {
    steps: 100,
    threshold: 0.6,
    size: 128,
  };


  const dim_temp = new Cesium.Cartesian3(1, 1, 1);
  const geometry = Cesium.BoxGeometry.fromDimensions({
    dimensions: dim_temp,
    vertexFormat: Cesium.VertexFormat.POSITION_AND_ST,
  });

  const primitive_modelMatrix = Cesium.Matrix4.multiplyByTranslation(
    Cesium.Transforms.eastNorthUpToFixedFrame(
      Cesium.Cartesian3.fromDegrees(120.14046454, 30.27415039),
    ),
    new Cesium.Cartesian3(0.0, 0.0, 10.0),
    new Cesium.Matrix4(),
  );

  const options = {
    modelMatrix: primitive_modelMatrix,
    geometry: geometry,
    data: data,
    dim: dim_temp,
    viewModel: viewModel,
  };
  const primitive = new CustomPrimitive(options);
  gui.add(viewModel, 'steps').min(0).max(100).onChange(() => {
    viewModel.steps = viewModel.steps;
    primitive.change({
      steps: viewModel.steps,
    });
  });
  gui.add(viewModel, 'threshold').min(0).max(1).onChange(() => {
    viewModel.threshold = viewModel.threshold;
    primitive.change({
      threshold: viewModel.threshold,
    });
  });

  viewer.scene.primitives.add(primitive);
  viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(
      120.14046454,
      30.27415039,
      10.0,
    ),
    box: {
      dimensions: dim_temp,
      fill: false,
      outline: true,
      outlineColor: Cesium.Color.YELLOW,
    },
  });
})
</script>

<style scoped></style>