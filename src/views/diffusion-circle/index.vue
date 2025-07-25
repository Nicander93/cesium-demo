<template>
  <div id="cesiumContainer">

  </div>
</template>

<script setup lang="ts">
import * as Cesium from 'cesium';
import { onMounted } from 'vue';

onMounted(() => {
  const viewer = new Cesium.Viewer('cesiumContainer');
  viewer.resolutionScale = window.devicePixelRatio;

  const instance = new Cesium.GeometryInstance({
    geometry: new Cesium.EllipseGeometry({
      center: Cesium.Cartesian3.fromDegrees(118, 23, 0),
      semiMinorAxis: 500,
      semiMajorAxis: 500,
    }),
  });

  const appearance = new Cesium.MaterialAppearance({
    material: new Cesium.Material({
      fabric: {
        uniforms: {
          color: Cesium.Color.fromCssColorString('#00E8FF'),
          time: 10
        },
        source: `czm_material czm_getMaterial(czm_materialInput materialInput)
                       {
                           // 获取默认材质
                           czm_material material = czm_getDefaultMaterial(materialInput);
                           // 设置漫反射颜色，增强亮度
                           material.diffuse = 1.5 * color.rgb;
                           // 获取纹理坐标 (0-1范围)
                           vec2 st = materialInput.st;
                           /*
                            * 计算当前像素到扩散中心的距离
                            * vec2(0.5, 0.5) 表示纹理中心点
                            */
                           float distanceFromCenter = distance(st, vec2(0.5, 0.5));
                           
                           /*
                            * 计算扩散半径, 扩散半径会随着时间从 0 到 1 变化
                            * czm_frameNumber 是当前帧数; fract是取小数部分，确保值在0-1之间
                            * time控制扩散速度，数值越大扩散越快
                            */
                           float diffusionRadius = fract(czm_frameNumber * time / 1000.0);
                           // 如果距离大于当前扩散半径，则透明
                           if(distanceFromCenter > diffusionRadius * 0.5) {
                             material.alpha = 0.0;
                             discard; // 丢弃该像素，不进行渲染
                           }else{
                             // 根据距离计算透明度，距离越远越透明
                             // distanceFromCenter/diffusionRadius 表示相对距离，越接近边缘越透明
                             material.alpha = color.a * distanceFromCenter / diffusionRadius / 1.0;
                           }
                           return material;
                       }`
      }
    })
  })

 viewer.scene.primitives.add(
    new Cesium.Primitive({
      geometryInstances: instance,
      appearance: appearance
    })
  );
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(118, 23, 1000),
  })
})
</script>

<style scoped></style>