<template>
  <div id="CesiumContainer">
    <div class="globe-material">
      <div class="material-checkbox" v-for="material in materials" :key="material.value">
        <input type="checkbox" :name="material.name" :value="material.value" :checked="material.checked"
          @change="handleMaterialChange" />
        <label :for="material.value">{{ material.name }}</label>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import * as Cesium from 'cesium'
import { onMounted, ref } from 'vue'

// 材质类型配置
const materials = ref([
  {
    name: '等高线',
    checked: true,
    value: 'contour'
  },
  {
    name: '坡度',
    checked: true,
    value: 'slope'
  },
  {
    name: '坡向',
    checked: true,
    value: 'aspect'
  }
])
// 处理材质类型切换事件
const handleMaterialChange = (event: Event) => {
  const target = event.target as HTMLInputElement
  const value = target.value
  const checked = target.checked
  console.log(value, checked)
}
let viewer: Cesium.Viewer
onMounted(() => {
  // 初始化Cesium查看器
  viewer = new Cesium.Viewer("CesiumContainer");
  
  // 加载世界地形
  Cesium.createWorldTerrainAsync().then(terrain => {
    viewer.terrainProvider = terrain
  })
  
  // 设置相机位置到指定坐标
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(108.65965453922512, 33.95476339380693, 10000),
  })

  // 定义区域边界点坐标（经纬度）
  let positions = Cesium.Cartesian3.fromDegreesArray(
    [].concat.apply([], [
      108.65965453922512, 33.95476339380693, 108.65595162347408,
      33.94407796652331, 108.67528801889657, 33.9386867822117,
      108.67875288821011, 33.952295612409095
    ] as any)
  )
  //建立局部坐标系 将所有点转到该坐标系下
  let m = Cesium.Transforms.eastNorthUpToFixedFrame(positions[0])
  let inverse = Cesium.Matrix4.inverse(m, new Cesium.Matrix4())
  let localPositions: Cesium.Cartesian3[] = []
  positions.forEach((position) => {
    localPositions.push(
      Cesium.Matrix4.multiplyByPoint(
        inverse,
        position,
        new Cesium.Cartesian3()
      )
    )
  })
  //计算矩形范围
  let boundingRectangle = Cesium.BoundingRectangle.fromPoints(
    localPositions,
    new Cesium.BoundingRectangle()
  )
  let rect = new Cesium.Cartesian4(
    boundingRectangle.x,
    boundingRectangle.y,
    boundingRectangle.x + boundingRectangle.width,
    boundingRectangle.y + boundingRectangle.height
  )
  // 修改ElevationContour材质的shader源码，添加区域限制功能
  Cesium.Material._materialCache._materials.ElevationContour.fabric.source = `
// 材质参数定义
uniform vec4 color;        // 等高线颜色
uniform float spacing;      // 等高线间距
uniform float width;        // 等高线宽度
uniform vec4 rect;          // 限制区域矩形 (x, y, width, height)
uniform vec4 m_0;          // 变换矩阵第一行
uniform vec4 m_1;          // 变换矩阵第二行
uniform vec4 m_2;          // 变换矩阵第三行
uniform vec4 m_3;          // 变换矩阵第四行

czm_material czm_getMaterial(czm_materialInput materialInput)
{
    // 获取默认材质
    czm_material material = czm_getDefaultMaterial(materialInput);
    
    // 计算到等高线的距离（使用模运算）
    float distanceToContour = mod(materialInput.height, spacing);

    // 根据WebGL版本选择不同的抗锯齿方法
    #if (__VERSION__ == 300 || defined(GL_OES_standard_derivatives))
        // 使用导数计算屏幕空间梯度，实现抗锯齿效果
        float dxc = abs(dFdx(materialInput.height));
        float dyc = abs(dFdy(materialInput.height));
        float dF = max(dxc, dyc) * czm_pixelRatio * width;
        float alpha = (distanceToContour < dF) ? 1.0 : 0.0;
    #else
        // 对于不支持导数的浏览器，使用像素比例进行简单抗锯齿
        float alpha = (distanceToContour < (czm_pixelRatio * width)) ? 1.0 : 0.0;
    #endif

    // 应用伽马校正并设置漫反射颜色
    vec4 outColor = czm_gammaCorrect(vec4(color.rgb, alpha * color.a));
    material.diffuse = outColor.rgb;

    // 构建4x4变换矩阵，用于坐标转换
    mat4 m = mat4(m_0[0],m_0[1],m_0[2],m_0[3],
                   m_1[0],m_1[1],m_1[2],m_1[3],
                   m_2[0],m_2[1],m_2[2],m_2[3],
                   m_3[0],m_3[1],m_3[2],m_3[3]);

    // 将眼坐标转换为世界坐标
    vec4 eyeCoordinate = vec4(-materialInput.positionToEyeEC, 1.0);
    vec4 worldCoordinate4 = czm_inverseView * eyeCoordinate;
    vec3 worldCoordinate = worldCoordinate4.xyz;
    
    // 将世界坐标转换到局部坐标系
    vec4 local = m * vec4(worldCoordinate, 1.);
    
    // 默认透明度为0（不显示）
    material.alpha = 0.;
    
    // 检查点是否在指定矩形区域内，如果是则显示等高线
    if(local.x > rect.x && local.x < rect.z && local.y < rect.w && local.y > rect.y){
        material.alpha = outColor.a;
    }
    
    return material;
}
`

  // 创建自定义等高线材质
  let material = new Cesium.Material({
    fabric: {
      type: 'ElevationContour',
      uniforms: {
        width: 1,                    // 等高线宽度
        spacing: 20,                 // 等高线间距（米）
        color: Cesium.Color.YELLOW,  // 等高线颜色
        rect: rect,                  // 限制区域矩形
        m_0: new Cesium.Cartesian4(  // 变换矩阵第一行
          inverse[0],
          inverse[1],
          inverse[2],
          inverse[3]
        ),
        m_1: new Cesium.Cartesian4(  // 变换矩阵第二行
          inverse[4],
          inverse[5],
          inverse[6],
          inverse[7]
        ),
        m_2: new Cesium.Cartesian4(  // 变换矩阵第三行
          inverse[8],
          inverse[9],
          inverse[10],
          inverse[11]
        ),
        m_3: new Cesium.Cartesian4(  // 变换矩阵第四行
          inverse[12],
          inverse[13],
          inverse[14],
          inverse[15]
        )
      }
    }
  })
  
  // 将材质应用到地球表面
  viewer.scene.globe.material = material
})

</script>

<style scoped>
/* 材质控制面板样式 */
.globe-material {
  position: absolute;
  top: 0;
  right: 0;
  width: 200px;
  color: #000;
  border-radius: 5px;
  box-shadow: 0 0 10px 0 rgba(0, 0, 0, 0.5);
  padding: 10px;
  background-color: #fff;
  z-index: 1000;
}
</style>