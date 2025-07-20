<template>
  <div id="cesiumContainer">

  </div>
</template>

<script setup lang="ts">
import * as Cesium from 'cesium'
import { onMounted } from 'vue'

onMounted(() => {
  const viewer = new Cesium.Viewer('cesiumContainer')

  const positions = new Float64Array([
    1, -1, 1, // 0
    -1, -1, 1,  //1
    -1, 1, 1,  //2
    1, 1, 1, //3
    0, 0, -1  //4
  ])
  const indices = new Uint16Array([
    4, 0, 1,  // ABE面
    4, 1, 2,//BCE面
    4, 2, 3, //CDE面
    4, 3, 0, // DAE面
    0, 1, 2,  //平面拆分的三角形 ABC
    0, 3, 1//平面拆分的三角形 ABD
  ])
  let boundingSphere = Cesium.BoundingSphere.fromVertices(positions)
  let m = Cesium.Transforms.eastNorthUpToFixedFrame(
    Cesium.Cartesian3.fromDegrees(120.0, 30.0, 100)
  )
  let geometry = new Cesium.Geometry({
    attributes: {
      position: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.DOUBLE,
        componentsPerAttribute: 3,
        values: positions
      })
    },
    indices: indices,
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere: boundingSphere
  })
  const instance = new Cesium.GeometryInstance({
    geometry: geometry,
    modelMatrix: m,
    attributes: {
      color: Cesium.ColorGeometryInstanceAttribute.fromColor(
        Cesium.Color.RED
      )
    }
  })
  viewer.scene.primitives.add(
    new Cesium.Primitive({
      geometryInstances: instance,
      appearance: new Cesium.PerInstanceColorAppearance({
        translucent: true
      }),
      asynchronous: false
    })
  )
  // const positions = new Float64Array([
  //   1, -1, 1, // 0
  //   -1, -1, 1,  //1
  //   -1, 1, 1,  //2
  //   1, 1, 1, //3
  //   0, 0, -1  //4
  // ])
  // const indices = new Uint16Array([
  //   4, 0, 1,  // ABE面
  //   4, 1, 2,//BCE面
  //   4, 2, 3, //CDE面
  //   4, 3, 0, // DAE面
  //   0, 1, 2,  //平面拆分的三角形 ABC
  //   0, 3, 1//平面拆分的三角形 ABD
  // ])
  // let boundingSphere = Cesium.BoundingSphere.fromVertices(positions)
  // let m = Cesium.Transforms.eastNorthUpToFixedFrame(
  //   Cesium.Cartesian3.fromDegrees(120.0, 30.0, 0)
  // )
  // let geometry = new Cesium.Geometry({
  //   attributes: {
  //     position: new Cesium.GeometryAttribute({
  //       componentDatatype: Cesium.ComponentDatatype.DOUBLE,
  //       componentsPerAttribute: 3,
  //       values: positions
  //     })
  //   },
  //   indices: indices,
  //   primitiveType: Cesium.PrimitiveType.TRIANGLES,
  //   boundingSphere: boundingSphere,
  //   vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT
  // })
  // const instance = new Cesium.GeometryInstance({
  //   geometry: geometry,
  //   modelMatrix: m,
  //   attributes: {
  //     color: Cesium.ColorGeometryInstanceAttribute.fromColor(
  //       Cesium.Color.RED
  //     )
  //   }
  // })
  // viewer.scene.primitives.add(
  //   new Cesium.Primitive({
  //     geometryInstances: instance,
  //     appearance: new Cesium.PerInstanceColorAppearance({
  //       translucent: true,
  //       flat: true
  //     }),
  //     asynchronous: false
  //   })
  // )
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(120.0, 30.0, 100),
  })
})

</script>

<style scoped lang="scss"></style>