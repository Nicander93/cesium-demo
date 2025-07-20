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
    // 前
    0, 0, -1, // E点
    1, -1, 1, //A点
    -1, -1, 1, //B点
    //右
    0, 0, -1, // E点
    1, 1, 1, //D点
    1, -1, 1, //A点
    // 后
    0, 0, -1, // E点
    -1, 1, 1, //C点
    1, 1, 1, //D点
    //左
    0, 0, -1, // E点
    -1, -1, 1, //B点
    -1, 1, 1, //C点
    //上
    1, -1, 1, //A点
    -1, -1, 1, //B点
    1, 1, 1, //D点
    // 上
    -1, -1, 1, // B点
    1, 1, 1, //D点
    -1, 1, 1 //C点
  ])
  let normals = []
  let c_0 = new Cesium.Cartesian3(0, 0, -1)
  let c_1 = new Cesium.Cartesian3(1, -1, 1)
  let c_2 = new Cesium.Cartesian3(-1, -1, 1)
  let d1 = Cesium.Cartesian3.subtract(c_1, c_0, new Cesium.Cartesian3())
  let d2 = Cesium.Cartesian3.subtract(c_2, c_0, new Cesium.Cartesian3())
  let normal = Cesium.Cartesian3.cross(d1, d2, new Cesium.Cartesian3())
  normal = Cesium.Cartesian3.normalize(normal, new Cesium.Cartesian3())
  normals.push(
    normal.x,
    normal.y,
    normal.z,
    normal.x,
    normal.y,
    normal.z,
    normal.x,
    normal.y,
    normal.z
  )

  c_1 = new Cesium.Cartesian3(1, -1, 1)
  c_2 = new Cesium.Cartesian3(1, 1, 1)
  d1 = Cesium.Cartesian3.subtract(c_1, c_0, new Cesium.Cartesian3())
  d2 = Cesium.Cartesian3.subtract(c_2, c_0, new Cesium.Cartesian3())
  normal = Cesium.Cartesian3.cross(d1, d2, new Cesium.Cartesian3())
  normal = Cesium.Cartesian3.normalize(normal, new Cesium.Cartesian3())
  normals.push(
    normal.x,
    normal.y,
    normal.z,
    normal.x,
    normal.y,
    normal.z,
    normal.x,
    normal.y,
    normal.z
  )
  c_1 = new Cesium.Cartesian3(1, 1, 1)
  c_2 = new Cesium.Cartesian3(-1, 1, 1)
  d1 = Cesium.Cartesian3.subtract(c_1, c_0, new Cesium.Cartesian3())
  d2 = Cesium.Cartesian3.subtract(c_2, c_0, new Cesium.Cartesian3())
  normal = Cesium.Cartesian3.cross(d1, d2, new Cesium.Cartesian3())
  normal = Cesium.Cartesian3.normalize(normal, new Cesium.Cartesian3())
  normals.push(
    normal.x,
    normal.y,
    normal.z,
    normal.x,
    normal.y,
    normal.z,
    normal.x,
    normal.y,
    normal.z
  )
  c_1 = new Cesium.Cartesian3(-1, 1, 1)
  c_2 = new Cesium.Cartesian3(-1, -1, 1)
  d1 = Cesium.Cartesian3.subtract(c_1, c_0, new Cesium.Cartesian3())
  d2 = Cesium.Cartesian3.subtract(c_2, c_0, new Cesium.Cartesian3())
  normal = Cesium.Cartesian3.cross(d1, d2, new Cesium.Cartesian3())
  normal = Cesium.Cartesian3.normalize(normal, new Cesium.Cartesian3())
  normals.push(
    normal.x,
    normal.y,
    normal.z,
    normal.x,
    normal.y,
    normal.z,
    normal.x,
    normal.y,
    normal.z
  )
  normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1)
  normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1)

  let m = Cesium.Transforms.eastNorthUpToFixedFrame(
    Cesium.Cartesian3.fromDegrees(120.0, 30.0, 10)
  )
  let geometry = new Cesium.Geometry({
    attributes: {
      position: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.DOUBLE,
        componentsPerAttribute: 3,
        values: positions
      }),
      normal: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 3,
        values: new Float64Array(normals)
      })
    },
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere: Cesium.BoundingSphere.fromVertices(positions)
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
        translucent: false
      }),
      asynchronous: false
    })
  )

  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(120.0, 30.0, 100),
  })
})

</script>

<style scoped lang="scss"></style>