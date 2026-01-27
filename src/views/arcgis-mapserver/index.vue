<script setup lang="ts">
import { onMounted } from 'vue'
import * as Cesium from 'cesium'
// @ts-ignore
import { ArcGisMapServerImageryProviderExt } from './ArcGisMapServerImageryProviderExt'

onMounted(() => {
  const viewer = new Cesium.Viewer('cesiumContainer', {
    baseLayer: Cesium.ImageryLayer.fromProviderAsync(
      ArcGisMapServerImageryProviderExt.fromUrl(
        '/mapServer/geoscene/rest/services/dem/GZ_DEM_RED_16M_S/MapServer',
      ),
    ),
  })
  //   const viewer = new Cesium.Viewer('cesiumContainer')
  //    Cesium.ArcGisMapServerImageryProvider.fromBasemapType(
  //       Cesium.ArcGisBaseMapType.SATELLITE,
  //   ArcGisMapServerImageryProviderExt.fromUrl('/mapServer/geoscene/rest/services/dem/GZ_DEM_RED_16M_S/MapServer')
  //   .then((imageryProvider) => {
  //     viewer.imageryLayers.addImageryProvider(imageryProvider)
  //   })
})
</script>

<template>
  <div class="arcgis-mapserver">
    <div id="cesiumContainer"></div>
  </div>
</template>

<style scoped>
.arcgis-mapserver {
  height: 100%;
}
</style>
