<template>
  <div id="cesiumContainer">

  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import * as Cesium from 'cesium'

onMounted(() => {
  const viewer = new Cesium.Viewer('cesiumContainer', {
    scene3DOnly: true
  })
  let geometry = Cesium.BoxGeometry.fromDimensions({
    dimensions: new Cesium.Cartesian3(100.0, 100.0, 100.0)
  })
  let position = Cesium.Cartesian3.fromDegrees(120, 30, 10)
  let instance = new Cesium.GeometryInstance({
    geometry: geometry,
    modelMatrix: Cesium.Transforms.eastNorthUpToFixedFrame(position)
  })
  let appearance = new Cesium.MaterialAppearance({
    fragmentShaderSource: `
     in vec3 v_color;
     void main()
     {
       out_FragColor = vec4(v_color,0.5);
     }
    `,
    vertexShaderSource: `
     in vec3 position3DHigh;
     in vec3 position3DLow;
     in vec3 normal;
     in vec2 st;
     in float batchId;
     out vec3 v_positionEC;
     out vec3 v_normalEC;
     out vec2 v_st;
     out vec3 v_color;
     void main()
     {
        vec3 positionModel=position3DHigh + position3DLow;
        if(positionModel.z>0.){
            v_color=vec3(0.,1.0,0.);
        }else{
            v_color=vec3(1.0,0.,0.);
        }
        gl_Position=czm_modelViewProjection*vec4(positionModel,1.);
     }`
  })
  let primitive = viewer.scene.primitives.add(
    new Cesium.Primitive({
      geometryInstances: instance,
      appearance: appearance
    })
  )
  console.log(appearance.getFragmentShaderSource())
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(120, 30, 1000)
  })
})
</script>

<style scoped></style>