<template>
  <div id="cesiumContainer">

  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import * as Cesium from 'cesium'

onMounted(() => {
  const viewer = new Cesium.Viewer('cesiumContainer', {
    scene3DOnly: true,
  })
  viewer.postProcessStages.fxaa.enabled = true
  viewer.resolutionScale = window.devicePixelRatio
  let xMin = 120.894604
  let yMin = 30.516896
  let xMax = 122.431959
  let yMax = 31.630521
  let rect = new Cesium.Rectangle(
    Cesium.Math.toRadians(xMin),
    Cesium.Math.toRadians(yMin),
    Cesium.Math.toRadians(xMax),
    Cesium.Math.toRadians(yMax)
  )
  const rectangle = new Cesium.RectangleGeometry({
    rectangle: rect,
    height: 8000
  })
  const geometry = Cesium.RectangleGeometry.createGeometry(rectangle)
  let appearance = new Cesium.MaterialAppearance({
    fragmentShaderSource: `
      // 接收从顶点着色器传来的纹理坐标
      in vec2 v_st;
      
      void main()
      {
          // 获取当前时间，用于动画效果
          float iTime = czm_frameNumber / 100.0;
          
          // 将纹理坐标从[0,1]转换到[-1,1]范围，用于极坐标计算
          vec2 p = 2.0 * v_st - 1.0;
          
          // 定义圆周率常量
          float tau = 3.1415926535 * 2.0;
          
          // 计算极坐标：角度和半径
          float a = atan(p.x, p.y);  // 计算角度
          float r = length(p) * 0.75; // 计算半径并缩放
          
          // 将极坐标转换为UV坐标系统
          vec2 uv = vec2(a / tau, r);
          
          // 创建彩虹色效果
          // 根据时间和UV坐标计算颜色索引
          float xCol = (uv.x - (iTime / 3.0)) * 3.0;
          xCol = mod(xCol, 3.0); // 确保值在0-3范围内循环
          
          // 初始化基础颜色（灰色）
          vec3 horColour = vec3(0.25, 0.25, 0.25);
          
          // 根据颜色索引创建彩虹渐变效果
          if (xCol < 1.0) {
              // 红色到绿色的过渡
              horColour.r += 1.0 - xCol;
              horColour.g += xCol;
          }
          else if (xCol < 2.0) {
              // 绿色到蓝色的过渡
              xCol -= 1.0;
              horColour.g += 1.0 - xCol;
              horColour.b += xCol;
          }
          else {
              // 蓝色到红色的过渡
              xCol -= 2.0;
              horColour.b += 1.0 - xCol;
              horColour.r += xCol;
          }
          
          // 绘制光束效果
          // 将UV坐标重新映射到[-1,1]范围
          uv = (2.0 * uv) - 1.0;
          
          // 计算光束宽度，包含动态变化和径向衰减
          float beamWidth = (0.7 + 0.5 * cos(uv.x * 10.0 * tau * 0.15 * 
                           clamp(floor(5.0 + 10.0 * cos(iTime)), 0.0, 10.0))) * 
                           abs(1.0 / (30.0 * uv.y));
          
          // 创建光束颜色
          vec3 horBeam = vec3(beamWidth);
          
          // 输出最终颜色：光束颜色与彩虹颜色的混合
          // 透明度基于RGB分量的总和
          out_FragColor = vec4(
              (horBeam * horColour), 
              (horBeam * horColour).r + (horBeam * horColour).g + (horBeam * horColour).b
          );
      }
        `
  })
  let primitive = new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry: geometry as Cesium.Geometry
    }),
    asynchronous: false, // 禁用异步几何体，避免需要配置 worker 路径
    appearance: appearance
  })

  viewer.scene.primitives.add(primitive)
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(120.89, 30.516896, 1000)
  })
})
</script>

<style scoped></style>