<template>
  <div id="CesiumContainer" />
</template>

<script setup lang="ts">
import * as Cesium from 'cesium'
import { onMounted } from 'vue'

onMounted(async () => {
  const viewer = new Cesium.Viewer("CesiumContainer", {
    scene3DOnly: true,
  });
  viewer.resolutionScale = window.devicePixelRatio;
  viewer.scene.postProcessStages.fxaa.enabled = true;
  viewer.scene.globe.enableLighting = true;


  // 加载Cesium官方的全球地形数据
  viewer.terrainProvider = await Cesium.createWorldTerrainAsync();
  let positions = [
    108.95681886162193, 34.216442742106366, 108.9626721365546,
    34.216442742106366, 108.9626721365546, 34.221996199323584,
    108.95681886162193, 34.221996199323584
  ]
  positions = Cesium.Cartesian3.fromDegreesArray(positions)
  //建立局部坐标系 将所有点转到该坐标系下
  let m = Cesium.Transforms.eastNorthUpToFixedFrame(positions[0])
  let inverse = Cesium.Matrix4.inverse(m, new Cesium.Matrix4())
  let localPositions = []
  positions.forEach((position) => {
    localPositions.push(
      Cesium.Matrix4.multiplyByPoint(
        inverse,
        position,
        new Cesium.Cartesian3()
      )
    )
  })
  //计算局部坐标的矩形范围
  let rect = Cesium.BoundingRectangle.fromPoints(
    localPositions,
    new Cesium.BoundingRectangle()
  )
  rect = new Cesium.Cartesian4(
    rect.x,
    rect.y,
    rect.x + rect.width,
    rect.y + rect.height
  )
  const fragmentShaderSource = `
    uniform sampler2D colorTexture;
    uniform sampler2D depthTexture;
    in vec2 v_textureCoordinates;
    uniform vec3 snowColor;
    uniform vec4 rect;
uniform mat4 inverse;
    void main() {
       vec4 color = texture(colorTexture, v_textureCoordinates);
       out_FragColor =color;
       float depth =czm_unpackDepth(texture(depthTexture, v_textureCoordinates));
       if(depth>=1.)return;
       vec4 eyeCoordinate4 = czm_windowToEyeCoordinates(gl_FragCoord.xy, depth);
          vec3 eyeCoordinate3 = eyeCoordinate4.xyz/eyeCoordinate4.w;
      vec4 worldCoordinate4 = czm_inverseView * vec4(eyeCoordinate3,1.) ;
      vec3 worldCoordinate = worldCoordinate4.xyz / worldCoordinate4.w;
      vec4 local=inverse * vec4(worldCoordinate,1.);
       vec4 positionEC =eyeCoordinate4/eyeCoordinate4.w;
       vec3 dx = dFdx(positionEC.xyz);
       vec3 dy = dFdy(positionEC.xyz);
       vec3 nor = normalize(cross(dx, dy));
       vec4 positionWC = normalize(czm_inverseView * positionEC);
       vec3 normalWC = normalize(czm_inverseViewRotation * nor);
       float dotNumWC = dot(positionWC.xyz, normalWC);
         //判断是否在rect中
      if(local.x>rect.x&&local.x<rect.z&&local.y<rect.w&&local.y>rect.y){

       out_FragColor = mix(color, vec4(snowColor,1.0), dotNumWC);
      }
    }
`
  const postProcessStage = new Cesium.PostProcessStage({
    fragmentShader: fragmentShaderSource,
    uniforms: {
      snowColor: Cesium.Color.WHITE,
      inverse: inverse,
      rect: rect
    }
  })
  viewer.scene.postProcessStages.add(postProcessStage)
  Cesium.Cesium3DTileset.fromUrl(
    `https://data.mars3d.cn/3dtiles/qx-dyt/tileset.json`,
    {
      maximumScreenSpaceError: 2,
      cullRequestsWhileMovingMultiplier: 100,
      dynamicScreenSpaceError: true,
      preferLeaves: true,
      debugShowBoundingVolume: false,
      debugShowContentBoundingVolume: false,
    }
  ).then((tile) => {
    viewer.scene.primitives.add(tile);
    viewer.zoomTo(tile);
  })
})
</script>

<style scoped></style>