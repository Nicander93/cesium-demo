<template>
  <div id="CesiumContainer" />
</template>

<script setup lang="ts">
import * as Cesium from 'cesium'
import { ScreenSpaceEventType } from 'cesium'
import { onMounted } from 'vue'
import CesiumEventHandler from './CesiumEventHandler'

onMounted(() => {
  const viewer = new Cesium.Viewer('CesiumContainer')
  viewer.resolutionScale = window.devicePixelRatio
  viewer.scene.globe.enableLighting = true
  const handler = new CesiumEventHandler(viewer)
  const entity = viewer.entities.add({
    position: Cesium.Cartesian3.fromDegrees(116.397428, 39.90923, 0),
    point: {
      color: Cesium.Color.RED,
      pixelSize: 10,
    },
  })
  const primitive = viewer.scene.primitives.add(new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry: new Cesium.PolylineGeometry({
        positions: Cesium.Cartesian3.fromDegreesArray([
          116.397428, 39.90923, 10000,
          110.397428, 39.90923, 10000
        ]),
        width: 5
      }),
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.RED)
      }
    }),
    appearance: new Cesium.PolylineColorAppearance(),
  }))
  viewer.scene.primitives.add(primitive)

  handler.registerHandler(
    ScreenSpaceEventType.LEFT_CLICK,
    primitive,
    (e: any) => {
      console.log('primitive')
    })

  handler.registerHandler(
    ScreenSpaceEventType.LEFT_CLICK,
    entity,
    (e: any) => {
      console.log(e)
    }
  )
  Cesium.Cesium3DTileset.fromUrl(
    `https://data.mars3d.cn/3dtiles/qx-dyt/tileset.json`,
    {
      maximumScreenSpaceError: 2,
      cullRequestsWhileMovingMultiplier: 100,
      dynamicScreenSpaceError: true,
      preferLeaves: true,
      debugShowBoundingVolume: false,
      debugShowContentBoundingVolume: false,
    },
  ).then((tileset) => {
    viewer.scene.primitives.add(tileset)
    viewer.zoomTo(tileset)
    handler.registerHandler(
      ScreenSpaceEventType.LEFT_CLICK,
      tileset,
      (e: any) => {
        console.log('tileset')
      }
    )
  })

})


</script>

<style scoped></style>