# 云与大气对照实验室

> 用户已否定前轮观感。最新的固定对照与未验收边界见 [SAMPLING-AUDIT.md](./SAMPLING-AUDIT.md)。

> 最新视觉与性能记录见 [VISUAL-RECONSTRUCTION.md](./VISUAL-RECONSTRUCTION.md)。下文包含前轮的历史测量；当前分级重建与启动停顿以新记录为准。

当前性能策略与复测见 [PERFORMANCE.md](./PERFORMANCE.md)（2026-10-26）：默认固定1/4边长云采样、96/128步预算、1600×900场景像素上限；运动与静止保持同一策略。下文关于全分辨率与静止128样本的内容为历史实验记录，不能代表当前默认行为。本机首云已由约4.5秒降至1.3–1.4秒；默认采用BSM遮光与云空气透视近似，并后台预热GPU程序。初始化仍有约0.3–0.4秒波动，真实触屏和最终观感尚需复核。

## 2026-10-24：积云云形、间接光与像素足迹采样

当前实验室默认 `cloudForm=cumulus&cloudSampling=filtered&cloudLighting=diffuse`。仍为研发候选，未宣称达到用户提供的 Mind3D 视频关键帧质量，也未替换生产城市页。`view=cloudscape` 从主积云层上方 1.5km 斜看云顶；`view=above` 继续用于最高活动层之上的检查。设置中可切回“原云形对照”。

晴天默认云量为 0.32。`sunHour` 为测试地点 UTC+8 的日照时间，可独立调整；夕照链接缺省为 18.5，其余为 14。太阳时钟与固定天气 epoch 分离，比较侧光时不会同时换一套云。调整日照会重建候选以清除已锁定的静态采样历史；后续可通过显式失效接口优化。

积云配置关闭原来的 7.5–8km 卷云层；“原云形对照”保留它。最高活动云顶和高度渐隐按真实活动层重新派生，默认积云最高层为 3120m，渐隐区为 4–10km。`cloudPresentation=full` 始终保留完整云场。精细档保留全分辨率密度/细节采样，额外光束和逐样本 LUT 查询关闭，薄介质阈值与均衡档一致；它仍比半分辨率档消耗更多 GPU。

性能路径：确定无云的层间区间解析跳过；清空区以 `emptyStepScale=3` 搜索，发现介质后回到细单元并重新采样，再按光学厚度收缩。最大工作量仍有上限，极薄的小云可能受粗搜/过滤影响，不能把它称作无损加速。风场改变时云影缓存会失效，实验室以 100ms 云影更新预算限制开销，避免静止矩阵使运动云影永久停在旧位置。

- 积云的天气图控制大尺度分布，三维形状纹理形成实体云团，低频噪声和天气共同改变局部云顶高度，细节纹理做减法侵蚀。低云形态与原层状模式共用球壳、ECEF、太阳、大气、BSM 和生命周期；没有另造背景图片或独立局部场景。
- 间接光包含有界的地面漫射传输和天光多次散射近似。天光去饱和保持光度亮度；没有增加曝光或无光时的自发光。它是近似闭合模型，不是完整空间多次散射求解。积云配置停用旧的云内白化、亮度地板和人为 alpha 软化。
- `sampleFootprintScale=1` 从屏幕射线锥推导三维纹理 LOD，按实际细节体纹素大小连续滤波，不再用随机开关关闭细节。积分单元长度和射线前进距离保持一致；完整高空云场测试关闭高度淡出及静止预览锁定。
- `maxOpticalDepthPerStep=0.5` 约束浓云单元的光学厚度，最多二次收缩并重新采样密度。纹理过滤范围同时覆盖像素射线锥和积分单元长度；近处细步保留细节，远处按像素范围预滤波。最小单元为 1m，尾段可更短；这是受预算约束的数值近似，不是误差严格有界的解析积分。
- 修正云内判断：march 的 `rayOrigin` 是球壳交点，不能作为相机位置。现在使用实际相机椭球高度，避免云外机位误启云内雾化。
- 参数及其 URL 均可复现：`cloudForm=layered|cumulus`、`cloudSampling=legacy|filtered`、`cloudLighting=legacy|diffuse`。库新增参数保持可选，默认保留旧语义；实验室在适配层选择新配置，方便后续 API/SDK 提取。

思路对照：[Guerrilla 云形、光照与区域创作](https://www.guerrilla-games.com/read/nubis-authoring-real-time-volumetric-cloudscapes-with-the-decima-engine)、[Skybolt 的覆盖度调制](https://github.com/Prograda/Skybolt/blob/master/Assets/Core/Shaders/Clouds.h)、[Takram 上游云参数](https://github.com/takram-design-engineering/three-geospatial/tree/main/packages/clouds)。用户提供的两张视频关键帧作为美术目标；仅凭视频不能确认其具体算法。

本轮实际 GPU 证据分目录保留在 `test-results/cloud-cumulus-*`。`cloud-quality` 检查六个固定机位/天气；`cloud-noise` 保留两种采样、两个高空高度各 16 帧；`cloud-dynamic` 检查拖动和风场；`cloud-perf` 记录浏览器 RAF 帧间隔，不能当作 GPU timestamp。后续以本轮 REVIEW 的最终目录和结果为准，早期试验截图不代表当前默认效果。

## 2026-10-23：地面优先的云层展示

社区管线默认使用 `cloudPresentation=adaptive`：完整保留地面和云内云体，按实际相机椭球高度连续淡出高空云层。这是面向城市/地图可见性的展示策略，不是物理天气变化，也没有修复完整高空云场的马赛克缺陷。

- 渐隐开始：主云层的 `base + thickness + 1000m`；结束：`max(最高活动云顶 + 4000m, 开始 + 6000m)`。默认参数为 4–12km；自定义云高会同步调整。
- 复用库的 `heightFadeStart/End` 与平滑合成，不改变密度、云量、光照或 TAA 历史。到零时启用 `pauseWhenHidden`，暂停 march、resolve 和 BSM 更新，不销毁纹理/primitive。下降后刷新云影并丢弃旧历史，恢复当前样本。
- 相机连续缩放和视角按钮均不重建管线；参数、质量和尺寸变化仍按原有路径重建。不可见期保留 GPU 内存，只有计算暂停；大气继续渲染。
- 设置中“完整云层（诊断）”或 URL `cloudPresentation=full` 关闭高度渐隐；`cloudDebug` 也保留完整诊断。完整高空云场仍可能有噪点/马赛克。云底偏灰继续独立研究，本轮没有调整云底亮度。
- 库保持原 50–300km 渐隐默认和 `pauseWhenHidden=false`，由实验室适配层选择城市展示策略；生产城市页尚未接入新管线。

运行证据：`test-results/atmosphere-height-presentation/`。数值与生命周期检查不等同于所有视角的最终画质验收。

## 2026-10-22：大气合成与云底间接光

社区管线仍是研发主线。本轮修正如下，旧管线和城市页尚未替换。

- LUT 大气接管时关闭 Cesium `globe.showGroundAtmosphere` 和 `fog.renderable`，保留雾的瓦片裁剪。退出时恢复原值，避免重复的地表大气和雾。
- 天空和云统一采用场景辐亮度标定 3，再进入同一个 ACES。它是针对当前 Cesium 灯光单位的显示标定，不改变光学厚度，也不是通用物理常数。
- 地面深度使用 Cesium 1.132 的 `czm_windowToEyeCoordinates(vec2, depth)`，保留对数深度精度；距离在眼坐标计算。远处仍保留 20–40km 过渡至球面近似。全距离采用真实端点的试验在轨道视角出现格状伪影，已经撤回，不能宣称任意远景地形均物理正确。
- 修复太阳盘、前景过渡的反向 `smoothstep`，以及调试模式 8 以上被错误除以 5 的显示问题。开发 API 的大气探针 8/9/10/14 分别观察分类、透射率、散射、场景/球面距离。
- 晴天云底补上可选的半球地面反照光 `parameters.groundAmbientAlbedo`。库默认 0 保留原行为，实验页设为 0.2。纯 GLSL 函数复用当前太阳/天空光，使用 Lambert 半球积分和局部竖向 Beer 衰减，不增加纹理采样、次级光线或渲染通道。它是有效地表反照率与均匀局部云柱近似，不包含地表材质、真实地面遮挡和完整多次散射。天空光使用原始 LUT 值，夜间艺术底光不会被这项再次反弹。
- 天气时钟固定从独立的 `2024-06-21T06:00:00Z` 开始；太阳仍消费 Cesium 时钟。冻结风场、覆盖率相同时，晴天切夕照只改光照。`ATMOSPHERE_PHASE=lighting` 的透明度对照区域逐通道差异为 0，避免原来改太阳时刻同时跳换云形的干扰；动画时仅天气时钟累加运行秒数。这个固定日期属于实验页，不属于通用算法。

测试：`pnpm exec vitest run src/views/cloud-atmosphere-lab src/vendor/cesium-geospatial/clouds/temporalMath.spec.ts src/vendor/cesium-geospatial/clouds/weatherTextures.spec.ts`；`pnpm run typecheck:atmosphere`；`node scripts/test-atmosphere-gpu.mjs`；`ATMOSPHERE_PHASE=atmosphere` 运行 `scripts/smoke-atmosphere.mjs`。数值 GPU 检查实际 Cesium 深度函数、实际色调映射和云底反照光函数，不用字符串存在性代替执行。

证据目录：`test-results/atmosphere-scattering-baseline`（调整前），`atmosphere-scattering-final`（大气修正后、云底补光前），`atmosphere-ground-fill-trial`（补光试验），`atmosphere-and-ground-fill-final-clock`（最终组合与独立天气时钟），`atmosphere-lighting-clock-final`（光照/云形解耦）。试验目录保留一次本地服务退出时的旧失败截图，判断结果应读取最终目录报告。静态画面与连续运行证据分别记录。

剩余问题：夕照时影像地球仍保留照片本身的白天照明，不能靠增加散射或给整帧再次乘太阳光解决，否则近处模型会被重复照明。云底应保留自然明暗，当前反照光只是首轮补充；移动和动画的时域质量、远景地形端点及整颗地球光照仍需单独验收。

后续 API/SDK 边界：算法参数、LUT/噪声资产、Cesium 场景接入和诊断分别维护；保留显式创建/销毁、状态恢复和质量档位。先在实验页与城市页验证效果和开销，再提取面向第三方的稳定接口，不把天气、镜头或页面状态写进算法。新增参数目前是实验性的，不承诺 SDK 兼容性。

截至 2026-10-22，本页没有通过视觉验收的最终云实现。默认打开 `community` 研发主线；`current` 保留旧自然云形作为对照；`basic` 是无云基线；`local` 只作局部造型实验。运行状态 `ready` 只表示活动渲染 stage 已首帧就绪，不表示视觉质量通过。选择机位后再拖动相机，URL 的 `view` 仍代表最后选中的预设，实际相机高度另外报告。

## 2026-10-22 采样与重投影调查

本轮算法调查与修改由主 agent 完成；辅助 agent 只整理相同 ROI 的图像统计。固定原始 `shapeScale=1`、太阳、曝光、天气和机位进行单变量对照，未以改变云形代替降噪。下文较早的“全分辨率关闭 TAA”是历史记录；当前精细档已改为全分辨率重投影，冻结风场且相机静止时积累128个样本后保持结果。动画风场只走普通重投影，不复用固定场景的积累；移动、改变视野、切换天气/质量或重建会使静止积累重新开始。这是固定场景预览能力，不能当作动画云的降噪已经完成。

| 假设或缺陷 | 实验与处理 | 结果边界 |
| --- | --- | --- |
| 云内步长过大 | `cloudDebug=opticalStep` 根据相机处消光约束首段 | 六组对照没有显著改善；默认不启用 |
| 随机采样颗粒 | 分别固定视线相位 `fixedViewJitter` 与光照相位 `fixedLightJitter` | 地面云噪声明显受光照相位影响；云内主要受视线相位影响；固定相位会产生条纹，不能直接作最终效果 |
| 次级积分无采样时输出未定义 | 初始化 `marchOpticalDepth` 的 `out rayDistance` | 修正GLSL未定义值；不等于所有黑点已解决 |
| 邻居深度筛选逻辑永不成立 | 深度比守卫恢复为0.5–2倍并钳制纹理边界 | 实际GLSL最小GPU测试在修复前失败、修复后通过 |
| 不透明首段被当成无云 | 用该段消光贡献及条件平均距离计算云深度 | 保留有限深度，覆盖指数下溢、薄介质和分段一致性GPU测试 |
| 近云ECEF重投影精度损失 | 云命中分支使用相机空间，与无云分支同系 | 单独修改后仍残留颗粒，不能宣称已修复闪烁 |
| 固定场景历史反复被拒绝 | 全分辨率静止多样本积累；相机矩阵容差容纳实测约5e-10m的重算噪声 | 固定画面黑点减少；运动与风场仍须单独评估 |

原始单帧对照使用 `cloudDebug=raw`；上述诊断模式也保持原始采样，避免TAA混淆单变量实验。`cloudDebug=fullTemporal` 保留为旧实验链接别名，正常URL无需它。精细档与均衡档仍是同一条社区管线，不增加新的实现路径。精细档默认全分辨率，均衡档为半分辨率重投影。

最终运行复查见 `test-results/atmosphere-static-128-final-verified/static-report.json`：RTX5070、独立Chromium、WebGL2下，六组固定天气/机位达到128样本；云内连续拖动会重置，松手后重新达到128；动画风场保持普通重投影；resize后全分辨率目标尺寸正确。六组 `static` 与 `static-plus60` 在云区ROI（x=200:1240、y=110:440）均逐像素相同。这只证明固定128样本预览不会继续抖动，不证明运动/动画噪声已解决。32项单测、实验室类型检查、11项实际GLSL GPU数值检查及生产构建通过。IAB实机也检查了云内拖动及地面预设；静止黑色针点显著减少，但云内仍偏灰雾，运动期间的噪声和云体光照仍未视觉验收。城市页仍未替换为该管线。

证据目录：`test-results/atmosphere-optical-step-ab`、`atmosphere-jitter-source-ab`、`atmosphere-full-temporal-ab`、`atmosphere-absorption-depth-ab`、`atmosphere-viewspace-reprojection-ab`、`atmosphere-static-accumulation-ab`。其中积累容差修正前的静止对照仍发生历史重置，不能当作最终收敛成绩。新增 `scripts/test-cloud-resolve-gpu.mjs` 在WebGL2执行实际GLSL函数，使用32位浮点回读验证深度数学，避免把半浮点回读伪像当成NaN；脚本使用支持原生TypeScript类型擦除的Node24测试运行时。

参考依据：GLSL `out` 参数采用copy-out而不copy-in，见 [Khronos/Vulkan GLSL函数调用规范](https://docs.vulkan.org/glsl/latest/chapters/statements.html)；粗步长随机偏移的强噪声也存在于 [Takram上游作者的问题记录](https://github.com/takram-design-engineering/three-geospatial/issues/40)。[NVIDIA的STBN论文](https://research.nvidia.com/publication/2021-12_scalar-spatiotemporal-blue-noise-masks)提供时域采样依据，但不会自动保证本项目的深度、重投影和历史拒绝正确。

以下保留早期实验记录，不能替代上述当前策略或最终视觉验收。

实机 IAB 对照在固定 1440×900、夕照、实际 2400m、冻结动画下，旧管线仍出现大片亮雾；社区原始采样与时域档都有深灰雾和黑色针点，因此均未通过云内验收。`shapeScale=0.5` 会改变密度阈值与云形，暗像素减少不能证明消噪；默认已恢复原值 1，0.5 保留为显式造型实验。后续先定位数值/采样来源，再验证晴天/夕照、地面/云内/云上及拖动过程，最后才接入城市页。调试 URL `cloudDebug=classify` 复用上游 overlay 原始 RGB 分类：蓝色为 NaN、红色为负分量、黑色为近零、绿色为非负非零；只用于诊断，不是效果模式。

同轮 IAB 诊断在恢复 `shapeScale=1` 后，`cloudDebug=classify` 未显示 NaN/负值标记，`cloudDebug=alpha` 也未显示明显遮挡率针孔；这只排除了该固定机位下的对应异常。`cloudDebug=fixedJitter` 保持天气与云形不变，只把主积分相位固定到0.5：云内颗粒变弱，但灰雾和地面视角的结构性条纹仍在，因此仍为诊断开关，默认关闭。由此优先检查随机积分与时域重建，不能宣布全部黑点来源已定位。旧管线尺寸诊断已实机验证会随视口从1080×675更新至900×570。运行检查27项单测与实验室类型检查通过；证据见 `test-results/atmosphere-cua-review-20261022`。

实验页另有“局部积云参考”路径：它在固定地点的局部 ENU 中绘制同一片约 20 km 云体，使用 shape/detail 噪声、Beer–Lambert 单太阳光照和全分辨率固定步 raymarch。它用于地面、云内、云上形态验证，不代表全地球云层。实现边界、参考来源和许可说明见 [REFERENCES.md](./REFERENCES.md)。

访问 `/cloud-atmosphere-lab`，在一个 Cesium 1.132 Viewer 中对照基础天空、仓库当前 ThreeGeospatialPipeline 与固定版本的 cesium-geospatial 社区候选。天气、相机和光照时间共享，初始为冻结风场；设置写入 URL，方便复现实验。

晴天按测试点 119.0317°E、33.5921°N 的本地 14:00（UTC 06:00）设置太阳，夕照使用本地 18:30（UTC 10:30）。四个视角会随当前云底和厚度计算云内及云上位置。地球影像复用城市页的 ArcGIS World Imagery 地址；可用 `VITE_CITY_IMAGERY_URL` 覆盖。服务或瓦片失败时会隐藏失败影像、显示椭球底色，并在页面报告错误。

质量诊断显示实际云 march 尺寸、候选时域重投影状态、world-anchor 云影以及已成功挂载次数和最近的历史重建原因。窗口或面板改变 canvas drawing buffer 后，候选会在尺寸稳定后串行重建，清空旧 temporal history；连续调整时使用去抖检测。当前 ThreeGeospatialPipeline 的 Cesium 1.132 `textureScale` 是只读 0.75，因此它不提供全分辨率参考，两个质量档均保持 TAA 关闭；参考/均衡选择只影响旧管线的步数档位。基础天空不含云 march，质量档位不可用。社区候选的“参考”为全分辨率且关闭 temporal，“均衡”为半分辨率 march 加真实 temporal resolve。云 overlay 曝光独立于大气曝光按 3×缩放；其余 provider 画质仍需目标GPU的静止参考和时域收敛对照。候选阶段不包含 moon、lens flare 或 depth-temporal 大气效果；这些需要的额外本地资产/历史通道未启用。初始化、首帧 renderError 和瓦片加载失败均会进入诊断。

运行和检查：

- `pnpm dev` 后打开 `/cloud-atmosphere-lab`
- `pnpm exec vitest run src/views/cloud-atmosphere-lab`
- `pnpm typecheck:atmosphere`
- `pnpm typecheck:city`
- `pnpm build`

当前管线 provider 在独立实验 Viewer 内实例化仓库已有 `ThreeGeospatialPipeline` 并复用城市页大气、云噪声和 shader 资产；它不复用城市页的场景控制器，也不改写现有城市渲染配置。社区候选同样只通过此页的隔离 provider 接口挂载。将任一 provider 接入城市页前，必须先在目标 GPU 上验收首帧与 shader、opaque 遮挡、resize 后尺寸/历史、镜头拖动稳定性、资源销毁和性能，再决定共享边界。候选源码固定在 `577d5a2ad6731e97a91318ed20bcd14dd9cb2036`；上游来源、局部兼容补丁及许可证记录见 [`src/vendor/cesium-geospatial/UPSTREAM.md`](../../vendor/cesium-geospatial/UPSTREAM.md)。实验复用仓库已有大气/云噪声资源；MIT 源码声明不覆盖第三方资源许可。自动化检查不替代 GPU 首帧、遮挡、resize、相机拖动稳定性和视觉质量验收。

2026-10-21 的 GPU 记录使用独立 headless Chromium、WebGL 2 和 NVIDIA GeForce RTX 5070。`views` 与 `effects` phase 中 basic/current/community 的相机预设及 post-process stage 均就绪，未报告 shader/runtime 错误；截图和 JSON 记录保存在 `test-results/atmosphere-fix*`。这只证明该测试机与当前浏览器路径可运行，不代表其他 GPU、驱动或桌面浏览器。视觉仍未验收：inside 视角残留明显 STBN 颗粒，ground/above 的云仍偏白。orbit 预设位于地表上方约 18,000 km；上游 overlay 默认在相机高度 50 km 开始淡出、300 km 全隐，因此该候选在 orbit 不显示云，不能据此称为全球云层。连续拖动/帧耗时属于单独的 GPU 验证结果；自动化录制中的 RAF 间隔会包含浏览器调度与视频录制开销，不能当作纯 GPU 时间或用户实际 FPS。开发态 `getState()` 会报告 Cesium `globe.tilesLoaded`、最近的 tile load queue 长度及影像层数。后续独立直达 URL 的同机位影像就绪对照中，basic/current/community 分别在约 15/5/4 秒达到 `tilesLoaded=true` 且队列连续三次为 0；影像就绪后仍可观察天空下缘的灰蓝/粉紫色带，因此不能把此前所有灰紫区域都归因于瓦片未加载。固定天气、相机、云密度和大气曝光的运行时 A/B 将 overlay 曝光从 12×降为 3×后云形更清楚，1×偏暗，6×与12×出现明显亮部饱和；当前默认采用3×，这只缓解过曝，不能证明云照明或视觉质量已验收。质量对照固定在云内2400m，各渲染120 RAF：balanced启用了真实 temporal resolve，reference关闭；balanced仍有明显颗粒/雾化，不能视作噪点验收通过。记录见 `test-results/atmosphere-tile-isolation-rerun/tile-isolation-report.json`、`test-results/atmosphere-overlay-exposure/overlay-exposure-report.json` 和 `test-results/atmosphere-temporal-120f/quality-temporal-report.json`。


本轮补充验收：修复 `CloudsPass` 的 MRT 阴影长度纹理重复销毁后，GPU `rebuild` 阶段连续晴天/夕照/阴天天气重建通过，未再出现 cleanup failed 或 overlay 重名。均衡档在启用逐帧 STBN 时改为持续累积 history，避免 Bayer 命中像素每四帧直接覆盖历史；固定云内镜头的 60→120 帧 ROI 均值绝对差由 5.46 降至 2.00，超过8级的像素变化比例由19.13%降至2.55%。这是固定测试区域的对照指标，不代表整体渲染误差或消除了闪烁。独立看图确认颗粒明显减少，但顶部仍有可见暗点，整体云内画质仅部分改善。记录位于 `test-results/atmosphere-convergence*`。

最新均衡档地面隔离在同一 Viewer、影像就绪后先渲染120帧，再仅关闭云 overlay；无运行错误。关云后仍有平滑的蓝灰雾色过渡，独立看图未确认不自然的硬接缝；这不能证明所有相机、参考档和移动状态下均无接缝。截图与状态位于 `test-results/atmosphere-horizon-isolation`。候选仍保持在实验页，未替换城市页实现。

GPU 脚本入口为 `pnpm smoke:atmosphere`，需测试环境提供 Playwright 和 Chromium；可用 `PLAYWRIGHT_MODULE_PATH`、`PLAYWRIGHT_EXECUTABLE_PATH` 指定已有运行时。`ATMOSPHERE_PHASE` 支持 `effects`、`views`、`motion`、`continuous`、`rebuild`；`ATMOSPHERE_OUTPUT` 指定证据目录，`ATMOSPHERE_MOTION_PROVIDER` 为连续拖动选择 `community` 或 `current`。连续阶段保留视频、240个RAF状态样本和帧间隔，运行状态通过不等同于视觉验收。最终18项单测、实验室/城市类型检查及生产构建通过；构建仍有已有的大包体积提示。

## 2026-10-25 云与大气传输改进

参考 cesium-extract 的分层云侵蚀、独立云影与大气合成思路，在现有 community 管线内独立实现：

- 积云 detail 侵蚀随局部归一化高度改变：云底保留丝状细节，上部侵蚀边缘，并保护高密度云核；原 layered 对照不变。没有引入新噪声资产或增加每步纹理采样。
- 接通已有 world-anchor BSM 与 AtmosphereStage。新增 groundShadowOnly 选项（默认 false），按 LUT 的太阳/天空辐照比例衰减已照明场景的直射部分，保留天光，不重新给 Cesium 模型完整打光。实验页默认云影强度 0.7；cloudShadows=0 可比较同一云场。
- 云影仍是后处理近似：影像自带的烘焙光照无法恢复，天空与太阳比例采用现有球面近似，并非逐材质法线重照明。大气散射仍使用现有 Bruneton LUT，没有复制提取仓库的 shader 或替换为 Babylon。
- 沿用单次最终 tone mapping、stage 所有权、资源销毁和 provider 切换恢复。技术/GPU通过不代表云顶真实感已获用户视觉认可。

验证：运行 scripts/test-atmosphere-gpu.mjs 检查实际 GLSL 的云核保护、上下层侵蚀、直射/天光分离、零强度、无光源响应；配合实验页行为与资源切换检查。具体本轮结果记录在 test-results/render-transport-20261025/。
