# 环境观感实验室

入口 `/environment-lab`。它验证一套可复用的天空、光照、雾、水面与多场景搭配；页面使用自己的 Viewer，环境模块本身不拥有场景模型、相机或模拟时钟。

## 场景数据

| 场景 | 展示内容                                                   | 数据边界                                                                                     |
| ---- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 城市 | 本地 Riverside site GLB 与 Kenney 城市 GLB 街区            | 本地演示布景，不是实测城市模型                                                               |
| 水库 | 瑞士官方地形、SWISSIMAGE 航片与 Lac de la Gruyère 官方湖岸 | Rossens 大坝调节的真实水库；湖岸含 3 个孔洞。42 个水域内 DEM 样点估得显示水面基准 674.73 m   |
| 洪水 | Mars3D 在线大雁塔周边倾斜摄影示例                          | 默认示例下移 28 m 做可视贴地，演示水位基准 393.1 m；非测绘高程转换或真实洪水；数据仅在线引用 |

城市阴影使用裁去大范围背景地块的 `riverside-site.glb` 作为接收面；程序地形不参与城市阴影接收，批量树木只投射阴影。这样可避免远距离细节扩大接收范围并降低阴影级联的有效精度。阴影贴图尺寸设为 2048，接收器偏移为 `normalOffsetScale=0.5`、`depthBias=0.00015`。

Gruyère 水库边界来自 geo.admin.ch 的 `ch.bafu.vec25-seen` 图层。图层说明其边界基于 swisstopo VECTOR25，属性由 BAFU 与 BFE 补充。具体接口、属性、来源和使用约束见 `public/environment-lab/lac-de-la-gruyere.sources.json`。

默认洪水场景展示 Mars3D 大雁塔周边倾斜摄影示例，入口为 `https://data.mars3d.cn/3dtiles/qx-dyt/tileset.json`，周边高程地形来自 `https://data.mars3d.cn/terrain/`，不是零高程椭球背景。它只是公开示例数据，不代表真实洪水事件或水动力结果。Mars3D 数据服务说明见 `https://mars3d.cn/docs/data/server/`；来源、抽样验证边界、旧样本替换原因和署名记录在 `public/environment-lab/oblique.sources.json`。旧 `qx-shequ` 示例有多个被引用分块返回 HTTP 404，已由抽样验证可用的 `qx-dyt` 替换。公开示例仅在线引用；本项目未确认其可再分发许可，不随项目打包瓦片。也可在界面填写自有 `tileset.json` URL。

默认 qx-dyt 的原始 OBB 最低角点为 403.91 m，但其 47 个可信可见网格深度样本最低为 421.084 m，而九个周边 DEM 样本为 387.47–395.65 m。低角度画面确认其可见地面悬空，因此仅对该默认公开示例施加沿当地竖直方向 -28 m 的显示平移，并以 421.1 - 28 = 393.1 m 作为演示水位基准。这是依据当前模型与地形进行的可视标定，不是实测地面或高程基准转换；模型若更新需重新核验。源模型在低角度仍可见边缘拉伸和重建破洞，这项平移无法修复源网格；当前只能作为公开数据演示。用户自定义 URL 不套用这项平移：有 OBB 的自有模型仍取变换后包围盒底部作为显示基准，无 OBB 时尝试安全表面采样，采样无效时停用水面。

## 环境和水位

晴日 HDRI 的 `radianceScale=2`，落日和雨天为 `0.5`。每个预设的全景、SH 和 GGX 镜面图按各自同一缩放值重烘焙，避免只调背景而让水面/模型 IBL 不一致。全景是原生 4096×2048；镜面图为 128×128、6 面、8 mip。

默认晴日雾量为 `0.16`。空气感使用 Cesium 原生雾，以避免后处理跨多视锥时出现深度断层；后处理 stage 仅在雨天启用。当前水面是同一环境天空下的单次绘制材质，没有额外重渲染场景生成建筑倒影；材质将水体基色从 sRGB 用 `pow(color, 2.2)` 转入线性 HDR，避免水面发亮、偏青。法线扰动幅度由晴天 0.014 / 雨量增益 0.009 降为 0.004 / 0.003，减少云倒影被扭成白色花纹；仍是同一次全景采样。

水位控件表达相对显示基准的 0–20 m 偏移：Gruyère 水库使用 42 个水域内 DEM 样点得到的 `674.73 m` 基准；默认 qx-dyt 使用贴地后的 `393.1 m` 演示基准。用户自有且无 OBB 的模型使用可信表面采样，失败时不显示水面。模型基准仅用于可视化，不是实测水位或水动力计算。旧链接中的裸 `water=13` 或 `water=18` 不按米数迁移；新链接使用 `waterReference=offset` 和 `envVersion=2`。

## 分场景配置

环境设置面板使用同一份经过校验的配置，参数直接应用于宿主、环境 SDK 和水材质：

- 天空与天气：天气预设、曝光、全景亮度/旋转、雾量/亮度、雨量/速度/倾角/长度、HDR、色调映射。
- 光照：太阳强度/颜色、自动跟随 HDRI 或手动方位/高度角；城市模型的漫反射和镜面 IBL 强度。
- 阴影：总开关、1024/2048/4096 贴图、距离、亮度、柔化、深度/法线偏移（阴影亮度越小越深）；城市背景/树木、水面、真实地形和倾斜模型分别设置接收或投射方式。
- 水面：显示、水位、颜色、波浪幅度/尺度/速度、天空反射、流动纹理。真实场景仍遵守可信基准及洪水零偏移隐藏规则。
- 数据与画质：真实场景的影像亮度/饱和度/对比度、地形光照、模型 URL/额外高度；像素预算、绘制比例、FXAA、地形/3D Tiles 误差和模型缓存。细节误差越小，所需数据和绘制成本越高。
- 构图：大屏遮罩、暗角、场景标签、三个预置机位。

城市、水库、倾斜模型各自保存完整配置到本地版本 1 profiles。切换场景恢复该场景配置，重置只作用于当前场景；切换天气会使用该天气的天空与光照默认值，其他参数组保留。JSON 导入先校验整包，模型地址只允许 HTTP(S)，再整体替换；导出包含三个场景。完整链接使用 UTF-8 base64url 编码的 config，同时保留旧 exposure/fog/rotation/rain/water 参数以便兼容读取。envVersion=3；没有显式配置参数时恢复本地保存值。链接只携带当前场景，其他场景仍使用该设备保存的配置。

真实影像和倾斜纹理已有烘焙光影，默认不再叠加实时地形/模型光照；城市仍使用实时太阳和 IBL。可手动开启阴影或提高质量，实际成本取决于场景与设备。额外模型高度基于加载后的矩阵重新计算，不累加平移，水面基准同步偏移；它依然只用于显示。

## 性能预算

- 默认场景绘制预算为 1920×1080 像素；可以选择 720p/1080p/1440p，并乘以 0.5–1 绘制比例。窗口更大时通过 Cesium `resolutionScale` 控制像素总量。
- 3D Tiles 缓存 128 MiB，额外溢出上限 64 MiB；相机移动时裁剪非必要请求。
- 页面 Viewer 的 GPU 资源创建预算目标为每帧 4 ms，纹理、程序、缓冲分别分配 1/1/2 ms。该预算是排队目标，单个不可拆分任务仍可能超过 4 ms。
- Mars3D origin 最多 3 个并发请求；swisstopo 地形、影像与 ArcGIS origin 最多 4 个。页面退出时恢复原有请求并发配置。
- Globe 地形细节使用 `loadingDescendantLimit=4`、`preloadSiblings=false` 和 `maximumScreenSpaceError=3`，限制同时细化的后代与兄弟瓦片预载。
- 固定 Cesium 1.132 的实例级适配器限制 3D Tiles 每帧最多处理 1 个内容项，并轮转保留其余队列项；瓦片的原生状态、计数、内容处理和错误路径仍由 Cesium 执行。单个同步内容处理不可拆分，仍可能超过帧预算；升级 Cesium 后需重新验证该私有队列适配。

导航关闭 Cesium 深度拾取（`useDepthPicking=false`），鼠标中键与触摸导航改用地形或椭球射线求交，减少导航期间对场景深度缓冲的依赖。默认 OBB 模型不进行逐帧深度读回。其他无 OBB 用户模型的水位采样通过 `acquireDepthPicking(scene)` 申请按 Scene 共享的计数 lease：首个 lease 记录原值并启用深度拾取，最后一个 lease 释放时恢复基准值；重复释放安全。

默认倾斜摄影模型用 Cesium `CustomShader` 的 `UNLIT` 光照模型显示，保留模型已烘焙的纹理光照，不再叠加一层 PBR/IBL。相应场景关闭 `globe.enableLighting` 与 globe 阴影，地形不请求顶点法线；影像按天气做轻量调色：day 为亮度/饱和度 `1/1`，sunset 为 `0.78/0.82`，rain 为 `0.7/0.82`，退出时恢复 globe 原值。航片自身已有烘焙光影，不表示建筑阴影会随实时太阳变化。城市 GLB 仍使用环境 IBL 和太阳光。场景销毁时释放倾斜摄影 `CustomShader`。界面会分别提示环境资源已就绪、实景数据仍在加载或公开瓦片缺失；首帧只代表页面已开始显示，不代表最终细节和全部公开分块都已加载。真实数据默认机位已降低俯角，让天空进入画面。

这些限制由实验页宿主配置，不属于可复用环境 SDK 的全局 Viewer 政策。实景页还关闭地下背面着色（`globe.undergroundColor.alpha=0`），退出时恢复原有颜色。这只针对地上可视化，天空、地表大气和地形细节设置不变。

## 真实数据接入阶段验证（2026-10-28）

环境专项类型检查、17 项单元测试及生产构建通过；真实场景回归 7/7、参数链接回归、环境 SDK 生命周期 26 项检查通过。实景宿主地下色检查覆盖自定义颜色、活动期透明地下色、取消加载后恢复及重复释放。

最终标准矩阵 `environment-placement-final-matrix/report.json` 的 11 个组合全部通过：城市、水库、倾斜模型的晴天/落日/雨天，以及 4K 窗口鼠标拖动和 600×900 模拟触摸。帧间隔 P95 为 7.1–14.1 ms，最长 21.0 ms，所有组合均未记录超过 50 ms 的帧。相机确实响应输入，4K 窗口仍保持 1920×1080 绘制预算，快速切场和离开页面的资源释放检查通过。此前着色器修正后，带 CPU/WebGL 诊断的独立复核矩阵 `environment-ground-shader-profile/report.json` 也通过。

旧矩阵 `environment-water-final-matrix/report.json` 曾在倾斜模型持续细化时，晴天鼠标拖动出现 100.1 ms 帧（111 ms long task），并保留失败记录。`environment-shader-profile/gl-slow-calls.json` 定位到地形 TEXTURE_UNITS 2/3/4 的三个首次链接检查，分别阻塞约 26/31/37 ms，均含 UNDERGROUND_COLOR。移除当前场景用不到的地下分支后通过上述复核；这项原因来自本次 profile，不应泛化为所有 Cesium 卡顿的根因。

测量使用独立 headless Chrome、NVIDIA RTX 5070/ANGLE；帧间隔包含浏览器调度，不是纯 GPU 耗时，也不代替用户内嵌浏览器、实体触屏或所有设备的长期验收。公开数据持续细化时间与网络相关；页面/环境 ready 不表示地形、影像和模型已全部加载。画面核验与性能测试分别记录，技术通过不代表主观观感已获认可。

## 验证入口

```sh
pnpm exec vue-tsc -p tsconfig.environment.json --noEmit
pnpm exec vitest run src/environment/presets.spec.ts src/views/environment-lab/configuration.spec.ts src/views/environment-lab/useSceneConfiguration.spec.ts src/views/environment-lab/model-ground.spec.ts src/views/environment-lab/reservoir-data.spec.ts src/views/environment-lab/depth-picking.spec.ts src/views/environment-lab/tileset-processing.spec.ts
node scripts/test-environment-model-lighting.mjs
node scripts/test-environment-interaction.mjs
node scripts/test-environment-shadows.mjs
node scripts/test-environment-configuration.mjs
node scripts/test-environment-real-scenes.mjs
node scripts/test-environment-lifecycle.mjs
node scripts/test-environment-links.mjs
```

浏览器脚本可用 `PLAYWRIGHT_MODULE_PATH`、`PLAYWRIGHT_EXECUTABLE_PATH`、`ENVIRONMENT_BASE_URL` 和 `ENVIRONMENT_OUTPUT` 指定运行环境和产物目录。性能报告应与运行设备、浏览器、视口及场景组合一并记录；帧间隔数据不等同于纯 GPU 耗时或实体触屏验收。

## 分场景配置验证（2026-10-28）

环境专项类型检查、27 项单元测试和生产构建通过。配置浏览器回归 23 项、SDK 生命周期 26 项、真实场景回归 7 项及旧链接/生产页面检查通过。检查读取原生 ShadowMap、模型 IBL、水面 uniforms、真实模型矩阵、SSE、缓存与绘制缓冲，同时验证配置独立保存、完整链接重载、JSON 导入导出、非法整包拒绝、当前场景重置和快速切换。

默认配置性能矩阵 11 组通过，包含三场景三天气、4K 窗口鼠标拖动和 600×900 模拟触摸；帧间隔 P95 7.1–20.5 ms，最长 34.7 ms，没有超过 50 ms 的帧。GPU 为 ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 (0x00002F04) Direct3D11 vs_5_0 ps_5_0, D3D11)，使用独立 headless Chrome；这是本机默认配置下的浏览器测量，不代表实体触屏或所有自定义高画质参数的帧率。相机响应、像素预算、调整参数不重新请求环境资源、离开页面释放 Viewer 均有断言。

报告位于本次工作产物目录的 environment-configuration-final、environment-configuration-interaction、environment-configuration-lifecycle、environment-configuration-real-scenes、environment-configuration-links 下。

## 城市模型质感对照（2026-10-28）

建筑与 city-rendering 使用相同 Kenney GLB。参考页采用 studio SH/GGX、0.8/0.8 IBL、Neutral 色调映射、晴天太阳强度 1.8，以及默认关闭建筑自阴影；实验室此前为天气 HDRI、1/1 IBL、ACES、2.5 太阳强度并让建筑接收自阴影。现在可切换“天空环境光 / 城市展示补光”，建筑投射保留，接收自阴影独立配置。新城市配置和重置采用展示补光；已有配置的曝光等参数保留，可通过“采用城市展示光照”按钮主动应用参考组合。天空与水面继续使用当前天气 HDRI，不增加体积效果、反射捕获或后处理通道。

专项类型、27 项单元测试和构建通过；原生模型补光回归 12 项、完整配置回归 23 项、SDK 生命周期回归 30 项通过。25 个模型实际加载同一份 studio SH/GGX，24 栋建筑只投射阴影，site 接收阴影；可恢复户外光照、切换自阴影并在释放后恢复宿主状态。默认配置的 11 组交互矩阵通过，本机本次帧间隔 P95 约 18.1 ms，最长 18.6 ms，未记录超过 50 ms 的帧。该结果来自独立 headless Chrome / RTX 5070，属于帧间隔而非 GPU 耗时或实体触屏验收；画面偏好仍应在同天气、同机位比较。产物目录为 environment-model-lighting、environment-model-configuration、environment-model-lifecycle、environment-model-interaction。
