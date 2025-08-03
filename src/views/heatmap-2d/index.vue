<template>
  <div id="CesiumContainer" />
</template>

<script setup lang="ts">
import * as Cesium from "cesium";
// import * as h337 from "@/libs/heatmap/heatmap.js";
import { onMounted } from "vue";
import heatmapData from "./heatmapData.js";

onMounted(() => {
  Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI5OWQ2NGJkZS0yODlmLTRlZjItYjZhYy03Mjc5MmM2OWM0OTkiLCJpZCI6NDAyNDQsImlhdCI6MTY2ODIzODM1OX0.au0c5QRIKaUh_Crsz6sfDfdSj2ePoQyaRcXcoXdcqOw'
  const viewer = new Cesium.Viewer("CesiumContainer", {
    scene3DOnly: true
  });
  let xMin = 180, yMin = 90, xMax = 0, yMax = 0;
  //获取热力图数据的矩形范围
  heatmapData.forEach(data => {
    xMin = Math.min(data.lng, xMin);
    yMin = Math.min(data.lat, yMin);
    xMax = Math.max(data.lng, xMax);
    yMax = Math.max(data.lat, yMax);
  })
  //热力图数据矩形范围的长和宽
  let w = xMax - xMin;
  let h = yMax - yMin;
  //定义用于绘制热力图画布的宽高
  let canvasWidth = w * 500;
  let canvasHeight = h * 500;
  //将经纬度数据坐标转换到画布的坐标系上
  let convertData: Array<{ x: number, y: number, value: number }> = [];
  heatmapData.forEach(data => {
    let x = (data.lng - xMin) / w * canvasWidth;
    let y = -(data.lat - yMax) / h * canvasHeight;
    convertData.push({
      x: x,
      y: y,
      value: data.count
    })
  })

  // 创建一个独立的容器，避免与 Cesium 的 Canvas 冲突
  let container = document.createElement('div')
  container.style.height = canvasHeight + 'px'
  container.style.width = canvasWidth + 'px'
  document.body.append(container)

  //创建热力图对象
  const heatmapInstance = h337.create({
    container: container,
    radius: 25, //给定半径
    maxOpacity: 0.8,
    minOpacity: 0
  })
  heatmapInstance.setData({
    data: convertData,
    max: 100
  })
  let rect = new Cesium.Rectangle(Cesium.Math.toRadians(xMin), Cesium.Math.toRadians(yMin), Cesium.Math.toRadians(xMax), Cesium.Math.toRadians(yMax));
  viewer.entities.add({
    rectangle: {
      coordinates: rect,
      material: heatmapInstance._renderer.canvas
    }
  })
})
</script>