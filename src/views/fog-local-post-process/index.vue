<template>
  <div id="CesiumContainer" />
</template>

<script setup lang="ts">
import * as Cesium from 'cesium'
import { onMounted } from 'vue'

onMounted(async () => {
  const viewer = new Cesium.Viewer("CesiumContainer", {
    scene3DOnly: true
  });

  // 加载Cesium官方的全球地形数据
  viewer.terrainProvider = await Cesium.createWorldTerrainAsync();
  const fragmentShaderSource = `
    uniform sampler2D colorTexture;
    uniform sampler2D depthTexture;
    uniform vec4 fogByHeight;
    uniform vec4 fogColor;
    in vec2 v_textureCoordinates;
    uniform float earthRadius;
    float getHeight(sampler2D depthTexture, vec2 texCoords)
    {
        float depth = czm_unpackDepth(texture(depthTexture, texCoords));
        if (depth == 0.0) {
            return czm_infinity;
        }
        vec4 eyeCoordinate4 = czm_windowToEyeCoordinates(gl_FragCoord.xy, depth);
        vec3 eyeCoordinate3 = eyeCoordinate4.xyz/eyeCoordinate4.w;
        vec4 worldCoordinate4 = czm_inverseView * vec4(eyeCoordinate3,1.) ;
        vec3 worldCoordinate = worldCoordinate4.xyz / worldCoordinate4.w;
        float altitude = length(worldCoordinate.xyz) - earthRadius; //当前高度
        return altitude;
    }
    float interpolateByDistance(vec4 nearFarScalar, float distance)
    {
        float startDistance = nearFarScalar.x;
        float startValue = nearFarScalar.y;
        float endDistance = nearFarScalar.z;
        float endValue = nearFarScalar.w;
        float t = clamp((distance - startDistance) / (endDistance - startDistance), 0.0, 1.0);
        return mix(startValue, endValue, t);
    }
    vec4 alphaBlend(vec4 sourceColor, vec4 destinationColor)
    {
        return sourceColor * vec4(sourceColor.aaa, 1.0) + destinationColor * (1.0 - sourceColor.a);
    }
    void main(void)
    {
        float height = getHeight(depthTexture, v_textureCoordinates); //获取当前像素到相机的距离
        vec4 sceneColor = texture(colorTexture, v_textureCoordinates); //场景原有的颜色
        float blendAmount = interpolateByDistance(fogByHeight, height); //根据距离计算雾化
        vec4 finalFogColor = vec4(fogColor.rgb, fogColor.a * blendAmount); //计算颜色
        out_FragColor = alphaBlend(finalFogColor, sceneColor); //混合场景原有的颜色和雾化颜色
    }
  `
  const camera = viewer.camera
  const postProcessStage = new Cesium.PostProcessStage({
    fragmentShader: fragmentShaderSource,
    uniforms: {
      fogByHeight: new Cesium.Cartesian4(100, 0.6, 5000, 0.0), //雾化参数 500米的时候为0.7  1000米的时候为0
      fogColor: Cesium.Color.WHITE, //雾化颜色 设置为白色
      earthRadius: () => {
        console.log(Cesium.Cartesian3.magnitude(camera.positionWC) -
          camera.positionCartographic.height)
        return (
          Cesium.Cartesian3.magnitude(camera.positionWC) -
          camera.positionCartographic.height
        )
      }
    }
  })
  viewer.scene.postProcessStages.add(postProcessStage)
  // 新增：相机高度高于 10 000 m 时关闭雾效
  viewer.scene.postRender.addEventListener(() => {
    const height = camera.positionCartographic.height
    postProcessStage.enabled = height <= 150000
  })
  // viewer.camera.setView({
  //   destination: Cesium.Cartesian3.fromDegrees(120, 30, 0),
  // })
})
</script>

<style scoped></style>