<template>
  <div id="CesiumContainer" class="fullSize">
    <div class="control-panel">
      <div class="section">
        <h3>材质选择</h3>
        <div class="material-checkbox" v-for="material in materials" :key="material.value">
          <input type="checkbox" :id="material.value" :value="material.value" v-model="material.checked"
            @change="updateMaterial" />
          <label :for="material.value">{{ material.name }}</label>
        </div>
      </div>

      <div class="section" v-if="materials.find(m => m.value === 'contour')?.checked">
        <h3>等高线设置</h3>
        <div class="control-item">
          <label>间距: {{ contourSpacing }}m</label>
          <input type="range" min="10" max="500" step="10" v-model="contourSpacing" @input="updateContourSpacing" />
        </div>
        <div class="control-item">
          <label>宽度: {{ contourWidth }}px</label>
          <input type="range" min="1" max="10" step="1" v-model="contourWidth" @input="updateContourWidth" />
        </div>
        <div class="control-item">
          <button @click="changeContourColor">更换等高线颜色</button>
        </div>
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
    name: '等高线（局部）',
    checked: true,
    value: 'contour'
  },
  {
    name: '高程渲染',
    checked: true,
    value: 'elevation'
  }
])

// 等高线参数
const contourSpacing = ref(50)
const contourWidth = ref(2)
const contourColor = ref(Cesium.Color.YELLOW.clone())

let viewer: Cesium.Viewer
let currentMaterial: Cesium.Material | undefined
let rect: Cesium.Cartesian4
let inverse: Cesium.Matrix4

// 高程渲染参数
const minHeight = -414.0
const maxHeight = 8777.0

onMounted(() => {
  // 初始化Cesium查看器
  viewer = new Cesium.Viewer("CesiumContainer", {
    terrain: Cesium.Terrain.fromWorldTerrain({
      requestVertexNormals: true,
    }),
  })

  // 设置相机位置到指定坐标
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(108.65965453922512, 33.95476339380693, 10000),
  })

  // 计算局部区域
  setupLocalRegion()

  // 初始化材质
  updateMaterial()
})

// 设置局部区域
const setupLocalRegion = () => {
  // 定义区域边界点坐标（经纬度）
  const positions = Cesium.Cartesian3.fromDegreesArray([
    108.65965453922512, 33.95476339380693,
    108.65595162347408, 33.94407796652331,
    108.67528801889657, 33.9386867822117,
    108.67875288821011, 33.952295612409095
  ])

  // 建立局部坐标系
  const m = Cesium.Transforms.eastNorthUpToFixedFrame(positions[0])
  inverse = Cesium.Matrix4.inverse(m, new Cesium.Matrix4())

  const localPositions: Cesium.Cartesian3[] = []
  positions.forEach((position) => {
    localPositions.push(
      Cesium.Matrix4.multiplyByPoint(
        inverse,
        position,
        new Cesium.Cartesian3()
      )
    )
  })

  // 计算矩形范围
  const boundingRectangle = Cesium.BoundingRectangle.fromPoints(
    localPositions,
    new Cesium.BoundingRectangle()
  )

  rect = new Cesium.Cartesian4(
    boundingRectangle.x,
    boundingRectangle.y,
    boundingRectangle.x + boundingRectangle.width,
    boundingRectangle.y + boundingRectangle.height
  )
}

// 创建颜色渐变
const getColorRamp = () => {
  const ramp = document.createElement("canvas")
  ramp.width = 100
  ramp.height = 1
  const ctx = ramp.getContext("2d") as CanvasRenderingContext2D

  const elevationRamp = [0.0, 0.045, 0.1, 0.15, 0.37, 0.54, 1.0]
  const grd = ctx.createLinearGradient(0, 0, 100, 0)
  grd.addColorStop(elevationRamp[0], "#000000") // black
  grd.addColorStop(elevationRamp[1], "#2747E0") // blue
  grd.addColorStop(elevationRamp[2], "#D33B7D") // pink
  grd.addColorStop(elevationRamp[3], "#D33038") // red
  grd.addColorStop(elevationRamp[4], "#FF9742") // orange
  grd.addColorStop(elevationRamp[5], "#ffd700") // yellow
  grd.addColorStop(elevationRamp[6], "#ffffff") // white

  ctx.fillStyle = grd
  ctx.fillRect(0, 0, 100, 1)

  return ramp
}

// 创建局部等高线材质
const createLocalContourMaterial = () => {
  // 自定义等高线材质，添加区域限制
  const contourMaterial = new Cesium.Material({
    fabric: {
      type: 'LocalElevationContour',
      uniforms: {
        color: contourColor.value,
        spacing: contourSpacing.value,
        width: contourWidth.value,
        rect: rect,
        m_0: new Cesium.Cartesian4(inverse[0], inverse[1], inverse[2], inverse[3]),
        m_1: new Cesium.Cartesian4(inverse[4], inverse[5], inverse[6], inverse[7]),
        m_2: new Cesium.Cartesian4(inverse[8], inverse[9], inverse[10], inverse[11]),
        m_3: new Cesium.Cartesian4(inverse[12], inverse[13], inverse[14], inverse[15])
      },
      source: `
uniform vec4 color;
uniform float spacing;
uniform float width;
uniform vec4 rect;
uniform vec4 m_0;
uniform vec4 m_1;
uniform vec4 m_2;
uniform vec4 m_3;

czm_material czm_getMaterial(czm_materialInput materialInput)
{
    czm_material material = czm_getDefaultMaterial(materialInput);
    
    float distanceToContour = mod(materialInput.height, spacing);

    #if (__VERSION__ == 300 || defined(GL_OES_standard_derivatives))
        float dxc = abs(dFdx(materialInput.height));
        float dyc = abs(dFdy(materialInput.height));
        float dF = max(dxc, dyc) * czm_pixelRatio * width;
        float alpha = (distanceToContour < dF) ? 1.0 : 0.0;
    #else
        float alpha = (distanceToContour < (czm_pixelRatio * width)) ? 1.0 : 0.0;
    #endif

    vec4 outColor = czm_gammaCorrect(vec4(color.rgb, alpha * color.a));
    material.diffuse = outColor.rgb;

    mat4 m = mat4(m_0[0],m_0[1],m_0[2],m_0[3],
                   m_1[0],m_1[1],m_1[2],m_1[3],
                   m_2[0],m_2[1],m_2[2],m_2[3],
                   m_3[0],m_3[1],m_3[2],m_3[3]);

    vec4 eyeCoordinate = vec4(-materialInput.positionToEyeEC, 1.0);
    vec4 worldCoordinate4 = czm_inverseView * eyeCoordinate;
    vec3 worldCoordinate = worldCoordinate4.xyz;
    
    vec4 local = m * vec4(worldCoordinate, 1.);
    
    material.alpha = 0.;
    
    if(local.x > rect.x && local.x < rect.z && local.y < rect.w && local.y > rect.y){
        material.alpha = outColor.a;
    }
    
    return material;
}
`
    }
  })

  return contourMaterial
}

// 创建组合材质（等高线+高程）
const createCombinedMaterial = () => {
  const hasContour = materials.value.find(m => m.value === 'contour')?.checked
  const hasElevation = materials.value.find(m => m.value === 'elevation')?.checked

  if (hasContour && hasElevation) {
    // 创建组合材质
    return new Cesium.Material({
      fabric: {
        type: "LocalElevationContourRamp",
        materials: {
          contourMaterial: {
            type: 'LocalElevationContour',
            uniforms: {
              color: contourColor.value,
              spacing: contourSpacing.value,
              width: contourWidth.value,
              rect: rect,
              m_0: new Cesium.Cartesian4(inverse[0], inverse[1], inverse[2], inverse[3]),
              m_1: new Cesium.Cartesian4(inverse[4], inverse[5], inverse[6], inverse[7]),
              m_2: new Cesium.Cartesian4(inverse[8], inverse[9], inverse[10], inverse[11]),
              m_3: new Cesium.Cartesian4(inverse[12], inverse[13], inverse[14], inverse[15])
            },
            source: `
                uniform vec4 color;
                uniform float spacing;
                uniform float width;
                uniform vec4 rect;
                uniform vec4 m_0;
                uniform vec4 m_1;
                uniform vec4 m_2;
                uniform vec4 m_3;

                czm_material czm_getMaterial(czm_materialInput materialInput)
                {
                    czm_material material = czm_getDefaultMaterial(materialInput);
                    
                    float distanceToContour = mod(materialInput.height, spacing);

                    #if (__VERSION__ == 300 || defined(GL_OES_standard_derivatives))
                        float dxc = abs(dFdx(materialInput.height));
                        float dyc = abs(dFdy(materialInput.height));
                        float dF = max(dxc, dyc) * czm_pixelRatio * width;
                        float alpha = (distanceToContour < dF) ? 1.0 : 0.0;
                    #else
                        float alpha = (distanceToContour < (czm_pixelRatio * width)) ? 1.0 : 0.0;
                    #endif

                    vec4 outColor = czm_gammaCorrect(vec4(color.rgb, alpha * color.a));
                    material.diffuse = outColor.rgb;

                    mat4 m = mat4(m_0[0],m_0[1],m_0[2],m_0[3],
                                  m_1[0],m_1[1],m_1[2],m_1[3],
                                  m_2[0],m_2[1],m_2[2],m_2[3],
                                  m_3[0],m_3[1],m_3[2],m_3[3]);

                    vec4 eyeCoordinate = vec4(-materialInput.positionToEyeEC, 1.0);
                    vec4 worldCoordinate4 = czm_inverseView * eyeCoordinate;
                    vec3 worldCoordinate = worldCoordinate4.xyz;
                    
                    vec4 local = m * vec4(worldCoordinate, 1.);
                    
                    material.alpha = 0.;
                    
                    if(local.x > rect.x && local.x < rect.z && local.y < rect.w && local.y > rect.y){
                        material.alpha = outColor.a;
                    }
                    
                    return material;
                }
                `
          },
          elevationRampMaterial: {
            type: "ElevationRamp",
          },
        },
        components: {
          diffuse: "contourMaterial.alpha == 0.0 ? elevationRampMaterial.diffuse : contourMaterial.diffuse",
          alpha: "max(contourMaterial.alpha, elevationRampMaterial.alpha)",
        },
      },
      translucent: false,
    })
  } else if (hasContour) {
    return createLocalContourMaterial()
  } else if (hasElevation) {
    return Cesium.Material.fromType("ElevationRamp")
  }

  return undefined
}

// 更新材质
const updateMaterial = () => {
  const material = createCombinedMaterial()

  if (material) {
    // 如果有高程渲染，设置相关参数
    const hasElevation = materials.value.find(m => m.value === 'elevation')?.checked
    if (hasElevation) {
      if ((material as any).materials?.elevationRampMaterial) {
        // 组合材质
        const elevationUniforms = (material as any).materials.elevationRampMaterial.uniforms
        elevationUniforms.minimumHeight = minHeight
        elevationUniforms.maximumHeight = maxHeight
        elevationUniforms.image = getColorRamp()
      } else if (material.uniforms) {
        // 单独的高程材质
        (material.uniforms as any).minimumHeight = minHeight;
        (material.uniforms as any).maximumHeight = maxHeight;
        (material.uniforms as any).image = getColorRamp()
      }
    }

    currentMaterial = material
    viewer.scene.globe.material = material
  } else {
    viewer.scene.globe.material = undefined
  }
}

// 更新等高线间距
const updateContourSpacing = () => {
  if (currentMaterial) {
    if ((currentMaterial as any).materials?.contourMaterial) {
      (currentMaterial as any).materials.contourMaterial.uniforms.spacing = contourSpacing.value
    } else if (currentMaterial.uniforms) {
      (currentMaterial.uniforms as any).spacing = contourSpacing.value
    }
  }
}

// 更新等高线宽度
const updateContourWidth = () => {
  if (currentMaterial) {
    if ((currentMaterial as any).materials?.contourMaterial) {
      (currentMaterial as any).materials.contourMaterial.uniforms.width = contourWidth.value
    } else if (currentMaterial.uniforms) {
      (currentMaterial.uniforms as any).width = contourWidth.value
    }
  }
}

// 更换等高线颜色
const changeContourColor = () => {
  contourColor.value = Cesium.Color.fromRandom({ alpha: 1.0 }, contourColor.value)
  if (currentMaterial) {
    if ((currentMaterial as any).materials?.contourMaterial) {
      (currentMaterial as any).materials.contourMaterial.uniforms.color = contourColor.value
    } else if (currentMaterial.uniforms) {
      (currentMaterial.uniforms as any).color = contourColor.value
    }
  }
}

</script>

<style scoped>
.fullSize {
  width: 100%;
  height: 100vh;
  position: relative;
}

.control-panel {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 280px;
  background-color: rgba(42, 42, 42, 0.8);
  color: white;
  padding: 15px;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  font-family: Arial, sans-serif;
}

.section {
  margin-bottom: 20px;
}

.section h3 {
  margin: 0 0 10px 0;
  font-size: 16px;
  color: #fff;
  border-bottom: 1px solid #555;
  padding-bottom: 5px;
}

.material-checkbox {
  margin-bottom: 8px;
  display: flex;
  align-items: center;
}

.material-checkbox input[type="checkbox"] {
  margin-right: 8px;
  width: 16px;
  height: 16px;
}

.material-checkbox label {
  font-size: 14px;
  cursor: pointer;
}

.control-item {
  margin-bottom: 15px;
}

.control-item label {
  display: block;
  margin-bottom: 5px;
  font-size: 14px;
  color: #ccc;
}

.control-item input[type="range"] {
  width: 100%;
  margin-bottom: 5px;
}

.control-item button {
  background-color: #48b;
  color: white;
  border: none;
  padding: 8px 15px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: background-color 0.3s;
}

.control-item button:hover {
  background-color: #369;
}
</style>