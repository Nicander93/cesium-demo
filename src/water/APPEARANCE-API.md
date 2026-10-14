# 可调水面 API

本轮先验证真实湖岸的基础水面。参数属于渲染配置，不修改洪水求解器、水深、流速或宿主时钟。默认预设可继续编辑；现有调用不传 `waveModel` 时仍使用 `legacy`。

```ts
import * as Cesium from 'cesium'
import { WaterSurface, createWaterPreset } from './water'

const water = new WaterSurface({
  scene: viewer.scene,
  positions,
  height: ellipsoidHeight,
  ...createWaterPreset('calm-lake'),
  // 资源路径由宿主提供；省略时使用程序波纹。
  normalMapUrl: '/assets/waterNormals.jpg',
  onError: error => console.warn('水面反射已降级', error),
})

water.setOptions({
  waveLength: 36,
  waveDirection: 90,
  waveStrength: 1.2,
  roughness: 0.3,
  waterColor: Cesium.Color.fromCssColorString('#238da1'),
})
const current = water.getOptions() // 独立快照；修改它不会直接修改水面
water.setOptions(createWaterPreset('windy-lake'))
water.setOptions({ waveSpeed: 0 }) // 冻结视觉动画
water.setVisualTime(15) // 定位视觉相位；不调整宿主时间或水位
water.destroy()
```

## 参数、单位与作用

以下新参数通过 `createWaterMaterial()`、`updateWaterMaterial()` 和 `WaterSurface.setOptions()` 暴露；`waveSpeed`、反射资源预算属于 WaterSurface。

| 参数 | 范围/单位 | 作用 |
| --- | --- | --- |
| `waveModel` | `legacy` / `multiscale` | 旧 UV 波纹 / 局部 ENU 米制多尺度法线 |
| `waveLength` | 大于 0，米 | 主波长；其余三个尺度按 0.48 倍递减。面板限制 4–160 m |
| `waveDirection` | 有限数，度 | 主波传播朝向：北 0°，东 90°；其余尺度采用不同方向 |
| `waveStrength` | 非负，无量纲 | 整体法线斜率强度；0 为平整法线。不是波高（米） |
| `waveIrregularity` | 0–1 | 程序噪声调制相位，减少规则条带 |
| `detailStrength` | 0–4 | 细波法线强度，0 关闭细波；远景按像素足迹衰减 |
| `waveSpeed` | 非负，倍数 | 视觉时间推进速度；0 暂停。不表示水动力流速 |
| `waterColor` / `waterAlpha` | Cesium.Color / 0–1 | 水色与不透明度；颜色参数会克隆 |
| `reflectivity` | 0–1 | 菲涅耳基础反射率 F0，视角变化仍由着色器计算 |
| `reflectionStrength` | 0–1 | 反射混合总强度；0 仅关闭混合，不停止额外反射 Pass |
| `reflection` | 布尔 | 开关场景反射采集；关闭后继续显示基础水面 |
| `reflectGlobe` | 布尔 | 是否在倒影中采集地形/影像；会增加渲染和瓦片请求成本 |
| `roughness` | 0–1 | 多尺度模式的高光宽度与倒影采样模糊；是近似效果，不是完整 PBR |
| `specularIntensity` | 0–4 | 高光强度；0 关闭 |
| `distortionScale` | 非负 | 倒影 UV 扰动强度 |
| `environmentColor` | Cesium.Color | 反射缺失/越界时的环境近似色，不是 IBL 环境贴图 |
| `quality` | `low` / `balanced` / `high` | 反射资源预算预设；显式分辨率/帧率参数优先 |
| `reflectionMaxSize` / `reflectionMaxFps` | 32–4096 像素整数 / (0,120] FPS | 最长边上限、静止相机反射更新频率；移动相机优先更新 |
| `edgeFadeWidth` | 0–0.5，归一化 UV | 矩形裁剪边过渡；不等价于按真实岸线距离渐隐 |

`roughness` 控制多尺度模式；旧模式继续使用 `sunShiny`。`rippleSize` 是旧模式的 UV 尺度，不能当作米制波长。当前波纹改变法线和着色，尚不产生波峰几何位移、折射或水下深度吸收。

## 预设与坐标

`createWaterPreset('calm-lake')` 和 `createWaterPreset('windy-lake')` 每次返回独立对象和独立颜色。平静湖面采用 48 m 主波长、0.8 整体强度、0.35 细节强度、0.18 粗糙度；有风湖面采用 28 m、1.5、0.7、0.32。两个预设都启用包括地形的反射，默认预算 1024 像素、15 FPS；这些是实验默认值，调用方可覆盖。

`WaterSurface` 自动更新局部 ENU 波纹坐标。只使用原始 Material 时，宿主需要每帧调用公开辅助函数：

```ts
import { createWaterMaterial, updateWaterMaterial, updateWaterMaterialView } from './water'

const origin = Cesium.Cartesian3.fromDegrees(longitude, latitude, height)
const material = createWaterMaterial({ waveModel: 'multiscale', origin })
const remove = viewer.scene.preRender.addEventListener(() => {
  updateWaterMaterialView(material, viewer.camera, origin)
  updateWaterMaterial(material, { time: visualSeconds })
})
// 宿主先停止监听并移除使用该材质的 Primitive，再销毁材质。
remove()
material.destroy()
```

辅助函数在 CPU 双精度矩阵中合成相机到局部坐标的变换，避免在 Fragment Shader 中直接减去大数值 ECEF 原点。它使用 Cesium 公开 Camera/Matrix API。原始 Material 不负责反射 Pass；完整场景倒影由 WaterSurface 提供。

包括地形的反射复用主视角已经选中的地形瓦片，避免镜像相机再次推进主视角的 LOD 队列和高度回调。倒影中的地形细度和覆盖范围因此受主视角加载范围限制；不会为离屏倒影独立加载完整地形。`capture.ts` 中新增的私有兼容点是 Cesium 1.132 的 `globe._surface._debug.suspendLodUpdate`，在 Pass 结束（包括异常）时恢复；缺少此能力时报告反射不可用并保留基础水面。尚未验证其他 Cesium 版本。

## 实验和下一步

真实页面提供「仅影像 / 当前水面（旧）/ 可调多尺度水面」、固定近景/俯瞰/远景、参数编辑和恢复预设。旧模式用于与前一阶段配置比较，并非前一提交的逐像素历史复现。

运行 `npm run smoke:water-appearance`；Playwright 环境设置参见水流实验说明。输出到 `test-results/water-flow-lab/tunable-water/`，包含三视角 × 三模式截图、WebM、GPU 报告及实际组合后的 Shader。

验收先冻结视觉时间并等待图像稳定，再比较波纹相位变化；主视角瓦片就绪检查暂时关闭反射，以避免镜像相机的 LOD 请求影响加载判据。报告记录冻结噪声，不能把外部瓦片更新当作水波动画。像素差异只证明可见响应，效果好坏仍需视觉评审。FPS 是开发浏览器录制期间的主画面观测值；反射诊断耗时是 CPU 提交时间，不是 GPU 测量。

本轮没有修改洪水渲染 API，也没有创建插件框架或调整包结构。下一轮先评审这三个固定视角，再确定洪水专用控制项：水色/透明度、流速到纹理运动的映射、局部泡沫阈值/强度、粒子密度/速度/寿命。基础水面与洪水共享合适的参数语义，不强制共用平面反射实现。


## 本轮验证记录（2026-10-14）

Cesium 1.132.0 / Chrome 155.0.8059.40 / 1440 × 900。水面与洪水 90 项单测、flow-lab 与 water 专项类型检查、生产构建均通过；构建仍有原有的 500 kB chunk 提示。浏览器实际编译了组合 Shader（38 个 uniform，无重复声明），没有控制台/渲染错误。

| 固定视角 | 新旧效果 RGB 平均差 | 两个水波相位 RGB 平均差 | 同相位冻结噪声 |
| --- | --- | --- | --- |
| near | 6.5255 | 3.8051 | 0.000000 |
| overview | 3.5236 | 1.0665 | 0.000012 |
| far | 2.7991 | 0.4163 | 0.000000 |

RGB 差的量纲为 8 位颜色值（0–255），测量区域是排除面板后的水域投影包围盒，也可能包含岸边背景。这些差值只作为回归证据，不能当作画质评分。

键盘 End 操作主波长滑块、切换有风/平静预设并恢复、512/1536 像素反射预算切换均通过；调节强度实际改变像素。16 秒连续视觉动画包含三种视角与真实鼠标相机拖动；反射失败 0 次，水面几何创建始终 1 份。反射目标因质量切换按需重建。输出目录有九张对比图、WebM、JSON 报告和实际 Shader。

已完成：可复用调参入口、默认值/预设、米制多尺度波纹、反射/高光控制、地形反射 LOD 隔离和浏览器稳定性回归。尚待视觉评审：规则波纹是否足够自然、远景水面辨识度、局部裁剪边与原始湖面影像的接缝。尚未实现：波峰几何位移、真实折射/吸收、洪水专用参数集，以及其他 Cesium 版本兼容验收。
