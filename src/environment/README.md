# 可复用场景环境

入口：`src/environment/index.ts`。模块不依赖 Vue、页面、全局 Ion token 或模拟数据。宿主继续管理 Viewer、地形、模型、水动力、相机和渲染循环；环境模块不会修改 `Viewer.clock`。

## 接入

```ts
import { createEnvironment } from './environment'

const environment = createEnvironment(viewer, {
  anchor: Cesium.Cartesian3.fromDegrees(longitude, latitude, height),
  assetBaseUrl: `${baseUrl}environment-lab/`,
})
await environment.setPreset('sunset')
const detach = environment.attachModel(model)
environment.setOptions({ exposure: 1, skyRotation: 30, fog: 0.35 })

// 模型离开环境时恢复原 IBL；环境退出时恢复宿主场景设置。
detach()
environment.destroy()
```

`setPreset('day'|'sunset'|'rain')` 为异步操作，最后一次请求生效。图片加载失败时保留上一套可用环境并报告状态；销毁后的异步结果不会再写入场景。`setOptions` 更新已有状态和 uniform，不重新下载天空、SH 或镜面资源。`setAnchor` 将天空、太阳和模型光照对齐到宿主局部 ENU。`subscribe` 提供加载状态、错误和当前参数。

## 渲染路径

- **天空**：固定 Cesium 1.132 的 `skyBox.update` 适配器绘制单张经纬全景。它不写场景深度，也不参与拾取。
- **IBL 和主光**：本地 HDRI 烘焙 9 项漫反射 SH、6 面 GGX KTX2 镜面图和太阳方向。绑定到 `Cesium.Model` 的资源使用同一 ENU 坐标。
- **雾和雨**：晴天默认雾量 `0.16`。远景空气感走 Cesium 原生雾，避免自定义全屏深度后处理在多视锥下产生分段。后处理 stage 只在雨天启用。
- **水面**：`createEnvironmentWater` 是可选单次绘制材质，采样同一 HDRI，并提供波纹、菲涅尔和高光。水体基色在材质 body 中通过 `pow(sRGB, 2.2)` 转为线性 HDR，避免水面过亮、发青。它不重绘场景；近处建筑倒影需要宿主另接项目自己的 `WaterSurface`。

全景使用可逆 Reinhard-sRGB 编码并在着色器恢复线性辐射。三组资产均使用原生 4096×2048 背景源，SH/GGX 使用同一预设的 2K HDR 照明源；镜面图固定为 128×128、6 面、8 mip。晴日 `radianceScale=2`，落日和雨天各为 `0.5`；每个预设的全景、SH、太阳、horizon color 与 GGX 都使用该预设同一归一化倍率。定义和哈希记录在 `public/environment-lab/sources.json` 与 `manifest.json`。

## 模型补光对照

EnvironmentOptions.modelLighting 可选 weather 或 studio。weather 使用当前天气的 SH/GGX，并将模型环境光与天空对齐到同一 ENU；studio 使用 manifest.studio 声明的模型补光资源和宿主模型原有 referenceMatrix。当前资产包复用 city-rendering 已有的 model-rendering/studio-sh.json 与 studio-specular.ktx2，并记录其 SHA256，不重新生成或拷贝纹理。manifest 未提供 studio 时回退到当前天气照明。切换仅更新模型 IBL，天空、太阳、雨雾和水面继续使用当前环境选项；没有附加场景捕获或后处理 pass。detach/destroy 恢复模型原有 IBL 和 referenceMatrix。

城市宿主的新配置默认 studio、IBL 系数 0.8/0.8、Neutral 色调映射，晴日太阳强度 1.8。建筑默认只投射阴影，可独立开启接收自阴影；这是针对 Kenney 演示模型的观感选择。模型质感不是物理真实性验证。

## 资源、生命周期与约束

`destroy` 恢复原天空、大气显示、主光、HDR、雾、曝光、色调映射、阴影以及仍存活模型的 IBL；宿主负责销毁模型、Viewer 和地形。`attachModel` 面向 `Cesium.Model`，不假设 3D Tiles 已绑定模型 IBL；天空、主光和雨幕后处理仍可独立工作。

`PanoramaSky` 与 Model 的 `referenceMatrix` 是固定 Cesium 1.132 的适配边界。升级 Cesium 后先运行环境类型检查和独立消费者生命周期测试。预设是离散 HDRI，不模拟连续的物理天气。

资源重建命令为 `node scripts/prepare-environment-hdri.mjs`；源 HDR 缓存不随页面发布。资源当前来自 Poly Haven CC0；地址、哈希和烘焙配置见 `sources.json`。运行时只请求本地烘焙资源。

场景缓冲、GPU 资源创建预算、服务器并发限制以及固定 Cesium 1.132 的 3D Tiles 实例队列逐帧限制都属于页面宿主策略，不由 SDK 修改全局 Cesium 调度器。逐帧限制最多处理一个内容项，但单个同步内容处理仍可能超过帧预算。实验页数据来源、性能边界和场景验证入口见 `src/views/environment-lab/README.md`。

实景实验页会按数据类型选择稳定的显示水位基准：Gruyère 水库用水域 DEM 采样，默认 qx-dyt 倾斜摄影采用示例贴地后的 393.1 m 显示基准；后者只是水位显示参考，不是测量地面。一般用户模型仍由宿主执行表面采样，失败时停用水面。倾斜摄影纹理保留数据自带的烘焙光影；城市 GLB 则继续使用环境 IBL 与太阳光，具体开关和天气影像调色见实验页说明。
