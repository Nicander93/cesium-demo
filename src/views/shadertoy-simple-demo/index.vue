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
      in vec2 v_st;
      void main()
      {
          float iTime=czm_frameNumber/100.;
           vec2 p = 2.0 * v_st -1.0 ;
          // vec2 p = (2.0 * gl_FragCoord.xy-czm_viewport.zw)/czm_viewport.w;
          float tau = 3.1415926535*2.0;
          float a = atan(p.x,p.y);
          float r = length(p)*0.75;
          vec2 uv = vec2(a/tau,r);
          //get the color
          float xCol = (uv.x - (iTime / 3.0)) * 3.0;
          xCol = mod(xCol, 3.0);
          vec3 horColour = vec3(0.25, 0.25, 0.25);
          if (xCol < 1.0) {
              horColour.r += 1.0 - xCol;
              horColour.g += xCol;
          }
          else if (xCol < 2.0) {
              xCol -= 1.0;
              horColour.g += 1.0 - xCol;
              horColour.b += xCol;
          }
          else {
              xCol -= 2.0;
              horColour.b += 1.0 - xCol;
              horColour.r += xCol;
          }
          // draw color beam
          uv = (2.0 * uv) - 1.0;
          float beamWidth = (0.7+0.5*cos(uv.x*10.0*tau*0.15*clamp(floor(5.0 + 10.0*cos(iTime)), 0.0, 10.0))) * abs(1.0 / (30.0 * uv.y));
          vec3 horBeam = vec3(beamWidth);
          out_FragColor = vec4((( horBeam) * horColour), (( horBeam) * horColour).r+(( horBeam) * horColour).g+(( horBeam) * horColour).b);
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