# 真实地形湖岸与远景锯齿修正

入口：`/cesium-demo/water-real-terrain`。水流对照页提供“查看真实地形与湖岸”；首页也有对应入口。此阶段接入真实地形、影像和官方水域边界，不把 DEM 最低点推断为真实河道。没有实测水动力速度，当前是静态湖面。

## 数据来源与高度限制

- 地形：swisstopo 公开 Quantized Mesh 服务 `https://3d.geo.admin.ch/ch.swisstopo.terrain.3d/v1/`，实际当前元数据解析到版本 20250101。说明：[Terrain Service](https://docs.geo.admin.ch/visualize-data/terrain-service.html)。无需 Ion token。地图可视地形和湖面展示采样使用同一 provider。
- 水域：瑞士 FOEN/BAFU 图层 `ch.bafu.vec25-seen`，Brienzer See，feature 66，官方 MultiPolygon 保存在 `public/water/brienz-water.geojson`，包含原属性、来源、日期和归属。来源：[官方 Feature](https://api3.geo.admin.ch/rest/services/api/MapServer/ch.bafu.vec25-seen/66?sr=4326&geometryFormat=geojson)，查询接口：[Identify Features](https://docs.geo.admin.ch/access-data/identify-features.html)。经纬度为 WGS84 度。
- 影像：swisstopo SWISSIMAGE WMTS，EPSG:3857，`https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg`。限制瑞士覆盖矩形及最小层级，避免请求无覆盖的全球祖先瓦片。
- 裁剪：经纬度 [7.884,46.688,7.901,46.701]，在官方边界内裁剪局部展示区，并检查原水域孔洞不进入这个范围。直线裁剪边不是真实岸线，使用 UV 边缘渐隐与底图过渡。此预设并非通用任意 MultiPolygon/洞几何导入器。

该湖原属性 `hoehenlage_muem=564` 不是已转换 WGS84 椭球高，不能直接混用。实际 Cesium TerrainProvider 湖面采样为 563.74–565.89 米；源垂直基准没有通过官方转换核定，UI 称为“地形服务场景高程”。这不是实测水文水位或工程配准证明。

展示高度取水域内部 26 个 level-14 地形湖面样本的上包络 + 0.25 米，此次为 566.14 米，用于避免与 DEM 湖面三角面互穿。中位数方案会在局部地形三角面下方露出破碎网格，已否决。若高程缺失或采样散布超过 3 米，则停止生成水面；不会用零高程补洞。可手动调整展示高度，但仍须独立核定高程基准、边界年代和水文水位后才能用于真实洪水。没有湖底 DEM，不能从这个模型输出真实湖深。

## 渲染改动与复用边界

`src/flood/cesium/surface-state.ts` 在非挡墙路径中，仅对水面邻接干点延拓显示水位并提供负有符号深度，让 Shader 在地面/水位交点裁切。原计算地形、水深、速度数组不改写；挡墙路径保留原几何，避免穿过阶段差。

岸线透明覆盖使用屏幕导数；高光按法线屏幕方差降低未解析锐度。Viewer 启用 4 样本 MSAA、FXAA 和原生设备像素比。修复的是边缘覆盖、干点抬边和细高光混叠，不是用滤镜补造网格缺失的真实岸线。合成场景仍保留粗格网岸坡台阶；真实湖岸使用官方矢量边界，不走这个河床格网。

`src/water/terrain-water.ts` 包含独立的边界裁剪、点内判定、预设解析和地形湖面展示采样；没有 Vue 依赖。真实页面只创建宿主 Viewer、安排资源请求并调用 WaterSurface。水域、DEM、影像各自有状态；地形/水域失败不阻塞另外的输入，缺可信水域或有效展示高程时不生成水面。异步完成时检查请求序号，页面卸载后不创建水面或移动相机。

WaterMaterial 的可选 `edgeFadeWidth` 为归一化 UV 宽度 0–0.5，默认 0；保留其他宿主外观。真实页配置 0.08，并使用宿主传入的本地 Cesium waterNormals 资源。默认不启用私有反射 Pass，场景反射仅为可选实验，本轮未验收反射模式。未引入新的 Cesium 私有 API 或插件宿主。

## 复现与实际结果（2026-10-14）

在仓库启动 `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5198 --strictPort`。Playwright 配置沿用 [水流实验说明](../water-flow-lab/README.md)。

- `node scripts/smoke-water-distance.mjs`：900 × 600 视口，DPR 1/2，俯瞰/更远视角共四种组合；画布分别 900/1800 像素宽，无横向溢出或 GPU 错误。截图与报告在 `test-results/water-flow-lab/distance/`。
- `node scripts/smoke-water-flow.mjs`：既有四种流场、相位边界、冻结像素、资源重建和连续相机运动回归通过；输出仍在 `p1-flow/`。这些固定样本不能证明任意距离、相机或全部输入都没有闪烁。
- `node scripts/smoke-real-water.mjs`：Chromium 155.0.8059.40 的真实 GPU 渲染通过。实网请求地形瓦片 147 次，影像瓦片 78 次；实际水面边界 143 点，地形瓦片就绪，渲染错误为 0。保存俯瞰/近岸截图及 WebM 在 `test-results/water-flow-lab/real-terrain/`。
- 实际模拟水域文件 404 后没有水面，地形仍接入，UI 明确停止生成。该 404 是故障注入；不代表正常加载错误。
- 水面/洪水 84 项测试通过；专项类型检查通过；生产构建按实际执行日志记录。验收目录被 Git 忽略，尚未上传到 PR。

后续真实河流/动态洪水需要明确水域面或洪水格网、经过转换的水位/高程基准以及流速结果。这个静态湖岸入口只证明当前地形/水域/影像接入和独立资源状态，不宣称真实流向、真实湖深或 P2 完整工程配准验收通过。
