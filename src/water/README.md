# 可复用水面

入口是 `src/water/index.ts`，不依赖 Vue、页面、`window.Cesium`、Ion token 或场景模型。Viewer、影像、地形、3D Tiles 和相机由宿主创建和管理。

## 两种接入方式

### 使用标准 Cesium 材质

`createWaterMaterial()` 返回 `Cesium.Material`，可用于宿主自己的 `MaterialAppearance` 和带有法线、UV 的几何。没有法线图片时使用程序波纹，不需要下载任何默认图片。图片 URL 可按部署位置传入。

```ts
import * as Cesium from 'cesium'
import { createWaterMaterial, updateWaterMaterial } from './water'

const material = createWaterMaterial({
  waterColor: Cesium.Color.fromCssColorString('#001e0f'),
  waterAlpha: 0.9,
  rippleSize: 50,
  // 地理坐标下可指定局部 ENU 原点；省略时使用表面法线建立光照基。
  origin: Cesium.Cartesian3.fromDegrees(119.0317, 33.5921, 44),
})
const appearance = new Cesium.MaterialAppearance({ material, translucent: true })
// 使用 appearance 创建宿主自己的 Primitive。材质本身不创建镜像相机。
updateWaterMaterial(material, { time: 10, waterAlpha: 0.8 })
// 宿主负责驱动 time、在需要时 requestRender，并在移除所有使用者后销毁 material。
material.destroy()
```

波纹、高光、菲涅尔、水色和透明度属于材质；场景倒影需要下面的水面组件提供额外渲染过程。材质模式的默认环境色只是视觉近似，并不包含场景倒影。尚未提供 Entity 的 `MaterialProperty` 包装。

### 使用完整反射水面

```ts
import * as Cesium from 'cesium'
import { WaterSurface } from './water'

const viewer = new Cesium.Viewer('map')
const water = new WaterSurface({
  scene: viewer.scene,
  positions: [
    Cesium.Cartographic.fromDegrees(119.031533, 33.593063),
    Cesium.Cartographic.fromDegrees(119.030249, 33.592114),
    Cesium.Cartographic.fromDegrees(119.032524, 33.591157),
    Cesium.Cartographic.fromDegrees(119.033232, 33.592346),
  ],
  height: 44,
  quality: 'balanced',
  normalMapUrl: '/your-deployment/waterNormals.jpg', // 可省略，使用程序波纹
  onError: error => console.warn('Water reflection unavailable', error),
})

const rendered = await water.ready // 首个几何渲染帧；未等到首帧就销毁则返回 false
if (rendered) {
  water.height = 60
  water.setOptions({ rippleSize: 80, reflectivity: 0.4 })
  water.setOptions({ quality: 'low' })
  water.setOptions({ reflection: false })
}
console.log(water.getDiagnostics())
water.destroy() // 幂等，仅清理本实例拥有的资源
viewer.destroy() // 宿主最后销毁 Viewer
```

`ready` 不表示法线贴图、影像或模型全部加载完成。组件可以在这些资源就绪前显示水面。

## 配置与生命周期

| 配置 | 含义 |
| --- | --- |
| `positions` | 3–10000 个 Cartographic 点，角度单位为弧度；按边界顺序提供简单、无洞多边形 |
| `height` | 椭球高度，单位米；小范围内按局部平面处理 |
| `flowDegrees` | 初始 UV 旋转角，单位度；不是水动力流速 |
| `normalMapUrl` | 可选法线图 URL，由宿主决定路径；Cesium Material 负责异步图片加载 |
| `rippleSize` | 波纹 UV 尺度，不控制反射分辨率或网格密度 |
| `waterColor` / `waterAlpha` | 水色与透明度，透明度范围 0–1 |
| `reflectivity` | 菲涅尔基础反射率，范围 0–1 |
| `sunShiny` / `distortionScale` | 高光指数（大于 0）与反射扰动强度（非负） |
| `lightDirection` | 非零光照方向，水面着色使用 Y 为竖直轴的局部坐标 |
| `reflection` | 默认 true；关闭时保留基础水面并停止反射更新 |
| `reflectGlobe` | 默认 false，保留原示例仅反射模型与天空的表现；true 时也渲染 globe，成本更高 |
| `reflectionResolutionScale` | 相对画布的反射边长比例，范围 (0, 1] |
| `reflectionMaxSize` | 反射最长边限制，整数 32–4096 |
| `reflectionMaxFps` | 反射更新频率上限，范围 (0, 120]；与水面波纹动画帧率分开 |

| 画质 | 边长比例 | 最长边上限 | 反射更新上限 |
| --- | --- | --- | --- |
| low / 流畅 | 0.35 | 512 | 15 FPS |
| balanced / 均衡 | 0.75 | 1536 | 30 FPS |
| high / 精细 | 1 | 2048 | 60 FPS |

同一次配置中的显式反射参数覆盖画质预设。只改变材质属性时保留当前反射参数；切换 quality 时恢复该预设，然后应用本次显式覆盖。

`height` 通过模型平移和反射平面更新实现，保持同一份几何与材质；小区域的平面近似不适用于跨越大片地球曲面的水体。`positions` 和 `flowDegrees` 是构造参数，改变边界需要销毁后重建。

公开属性包含 `height`、`rippleSize`、`waterAlpha`、`reflectivity`、`distortionScale`、`show` 和只读 `material`。组件拥有 material，调用方应通过组件销毁，不能提前销毁其 material。手动创建的标准材质由调用方拥有。

`show = false` 停止本实例的水面与反射更新。同一场景中支持多个实例，反射时会隐藏所有已注册的水面，避免反射纹理读写反馈；每个平面仍有独立渲染成本，尚未合并同高度水面的反射 pass。

`getDiagnostics()` 提供首帧毫秒数、几何创建数、反射目标创建数、尺寸、更新数、最近一次反射的 CPU 提交时间和错误。CPU 时间不是 GPU 计时。正常运行应只有一份几何，固定画质/尺寸时反射目标创建数不随帧数增长。

## 实现取舍

- 基础材质使用标准 Material / MaterialAppearance 输入，不再要求原示例的定制顶点 varying。
- 反射投影在 CPU 双精度下组合为从主相机坐标到反射裁剪坐标的矩阵，fragment shader 不重建 ECEF 大坐标，避免近景倒影出现方块量化。即使反射更新被 FPS 限制，相机移动时也更新采样矩阵，维持倒影位置。
- 保留四层法线采样、菲涅尔、高光和反射扰动的主要效果。
- Fabric 图片纹理默认夹紧边缘，法线图在 shader 中循环 UV，避免动画运行一段时间后一直采样边缘而变平。反射图仍夹紧边缘，并在视图边缘平滑过渡，避免扰动越界产生拉伸与硬切。
- 直接复用 framebuffer 的颜色附件，取消逐帧 `Texture.fromFramebuffer` 分配与复制。
- 独立 View 管理反射的相机和 framebuffer；异常时在 finally 中恢复主视图、globe、HDR、深度模式和 UniformState 方法。
- 首帧反射主动提供大气状态，避免缓存模型早于主场景首帧到达时，环境贴图计算报错并永久关闭反射。
- 反射所需的私有 Cesium 访问集中在 `reflection.ts`，没有修改全局 prototype。
- 反射通道按 LDR 处理，主场景的 HDR 和对数深度配置保留。独立 View 的 globeDepth 通道沿用宿主 `scene.msaaSamples`，WebGL2 支持时由 Cesium 做 MSAA；组件不改写宿主的抗锯齿设置。复杂后处理和升级 Cesium 后仍需专项验收。
- 当前运行验收基于 Cesium 1.132.0。私有反射通道不能承诺任意 Cesium 版本兼容；不支持反射时组件报告错误并退回基础水面。标准材质不依赖该反射通道。
- 平面水面适合湖泊、水库和景观池；起伏洪水网格可复用基础材质，但不能把整个河谷当成同一张反射平面。水动力计算与本模块分离。

## Demo 加载流程

`/water` 创建 Viewer 后立即创建水面并定位相机，同时发起影像与 3D Tiles 加载。模型失败不会阻塞水面。模型加入后不自动打断用户相机，使用“聚焦模型”查看完整场景。

页面卸载先移除监听与计时器、销毁水面，再销毁 Viewer；迟到的模型会立即销毁，迟到的影像不会加入已销毁场景。

开发对照入口 `/water?reflection=off` 从启动起禁用反射。正常入口默认精细画质，反射使用画布全分辨率（最长边上限 2048），画布按设备像素比渲染。模块本身仍默认均衡，调用方可用 `quality` 选择取舍；精细画质会增加 GPU 和显存开销，帧率不足时可切换均衡或流畅。

Demo 同时按画质调整模型 `maximumScreenSpaceError`：精细 4、均衡 8、流畅 16。精细档请求更细的模型瓦片，会增加网络与显存开销；水面模块不修改宿主模型的 LOD 设置。

页面默认不透明度为 100%，对应旧示例实际走不透明渲染通道的外观。拖动“不透明度”可查看透明水面，但低精度水下模型的三角面、缺口也会更明显，增加反射分辨率不能修复模型几何。模块的 `waterAlpha` 默认值仍为 0.9，透明/不透明通道随该值切换。

展开“加载与性能”查看计数与首帧记录。影像和模型为外部服务，模型元数据就绪时间不代表所有瓦片/纹理就绪。

## 验证

```sh
pnpm exec vitest run src/water
pnpm exec vue-tsc --noEmit -p tsconfig.water.json
pnpm build
```

10 项单元测试覆盖材质创建与更新、透明通道切换、连续高度调整保留资源、非法配置不部分生效、实例独立清理、首帧就绪、分辨率限制、异常恢复、缓存模型的首帧环境与限制反射频率时的相机投影更新。真实 WebGL 编译、模型反射与画质切换需要浏览器验收。

尚未发布 npm 包；公共入口、宿主边界和生命周期已经明确，后续提包无需携带 Vue demo 或模型 URL。
