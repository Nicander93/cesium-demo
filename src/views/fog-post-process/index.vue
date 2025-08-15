<template>
  <div id="CesiumContainer">

  </div>
</template>

<script setup lang="ts">
import * as Cesium from 'cesium'
import { onMounted } from 'vue'

onMounted(async () => {
  const viewer = new Cesium.Viewer("CesiumContainer");

  if (!viewer.scene.globe.enableLighting) {
    // 检查是否支持深度纹理的替代方法
    console.log("Checking depth texture support...");
  }

  const fragmentShaderSource = `
  float getDistance(sampler2D depthTexture, vec2 texCoords)
  {
      // 从深度纹理中获取深度值
      float depth = czm_unpackDepth(texture(depthTexture, texCoords));
      // 如果深度值为0，表示没有有效的深度信息，返回无穷大
      if (depth == 0.0) {
          return czm_infinity;
      }
      // 将窗口坐标转换为观察者坐标
      vec4 eyeCoordinate = czm_windowToEyeCoordinates(gl_FragCoord.xy, depth);
      // 返回从观察者视角到某个点的深度值，注意这里取负值
      return -eyeCoordinate.z / eyeCoordinate.w;
  }

  float interpolateByDistance(vec4 nearFarScalar, float distance)
  {
      // 提取起始距离和起始值
      float startDistance = nearFarScalar.x;
      float startValue = nearFarScalar.y;
      // 提取结束距离和结束值
      float endDistance = nearFarScalar.z;
      float endValue = nearFarScalar.w;
      // 计算距离的插值因子t，限制在0到1之间
      float t = clamp((distance - startDistance) / (endDistance - startDistance), 0.0, 1.0);
      // 根据插值因子t在起始值和结束值之间进行线性插值
      return mix(startValue, endValue, t);
  }

  vec4 alphaBlend(vec4 sourceColor, vec4 destinationColor)
  {
      // 进行alpha混合，计算最终颜色
      return sourceColor * vec4(sourceColor.aaa, 1.0) + destinationColor * (1.0 - sourceColor.a);
  }

  uniform sampler2D colorTexture; // 场景颜色纹理
  uniform sampler2D depthTexture; // 深度纹理
  uniform vec4 fogByDistance; // 雾效的距离参数
  uniform vec4 fogColor; // 雾效的颜色
  in vec2 v_textureCoordinates; // 纹理坐标

  void main(void)
  {
      // 计算当前像素的深度值
      float distance = getDistance(depthTexture, v_textureCoordinates);
      // 获取当前像素的场景颜色
      vec4 sceneColor = texture(colorTexture, v_textureCoordinates);
      // 根据深度值计算雾效的混合比例
      float blendAmount = interpolateByDistance(fogByDistance, distance);
      // 计算最终的雾效颜色
      vec4 finalFogColor = vec4(fogColor.rgb, fogColor.a * blendAmount);
      // 将雾效颜色与场景颜色进行alpha混合，得到最终的输出颜色
      out_FragColor = alphaBlend(finalFogColor, sceneColor);
  }
  `;

  const ellipsoid = viewer.scene.globe.ellipsoid;
  const postProcessStage = viewer.scene.postProcessStages.add(
    new Cesium.PostProcessStage({
      fragmentShader: fragmentShaderSource,
      uniforms: {
        fogByDistance: new Cesium.Cartesian4(10, 0.0, 500, 1.0),
        fogColor: Cesium.Color.WHITE,
      },
    }),
  );

  try {
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
  } catch (error) {
    console.log(`Error loading tileset: ${error}`);
  }

})
</script>

<style scoped></style>