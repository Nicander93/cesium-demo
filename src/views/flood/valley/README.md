# 小山谷泄洪：内置推演与外部成果共用一个接口

入口：主页的“小山谷泄洪”，或 `/cesium-demo/flood-valley`。

**当前默认加载西藏林芝真实地形溃坝。** `/cesium-demo/flood-valley?scene=dam-breach` 也进入该示例；此前的合成溃坝改为 `?scene=synthetic-breach` 原理对照。区域、TerrainProvider、统一模型输入和取舍见 [真实地形与统一计算域](../../../flood/docs/real-terrain-domain.md)。本文件后面的合成场景与历史验收记录保留作对照。

先点击“开始推演”。调节输入流量和泄洪持续时间；“停止泄洪”只关闭输入，水仍然继续流动。“暂停”冻结模拟时间。“重置”恢复初始水量（普通泄洪为干地，溃坝为预置库水）。持续泄洪与短时大流量是两种输入条件，不代表经过校准的真实水库或溃坝过程。

新增“溃坝原理示例（合成山谷）”和“显示内容”分析选择器；入口 `/cesium-demo/flood-valley?scene=dam-breach`。可以逐次“推进 10 秒”观察缺口发展，再切换最大水深、到达时间、累计淹没时间或指定水位淹没。原理、公共 API 和统计边界见 [溃坝与淹没分析](../../../flood/docs/dam-inundation.md)。

导出成果后，可直接在“导入成果”中选择该 JSON；场景会切换到时间轴播放。内置模型与外部结果使用同一个 FloodFrame 和同一个 CesiumFloodLayer。也可下载页面提供的示例 JSON 验证导入。

## 数据怎样流动

```text
地形 + 泄洪条件 → FloodSolver ───────────────┐
                                            ↓
HEC-RAS / TELEMAC / 自有模型 → 格式转换 → FloodDataset → 时间插值 → FloodRenderer → Cesium
```

`src/flood/core` 不依赖 Vue 或 Cesium。`hydraulics.ts` 提供独立的墙顶和过流规则，`terrain.ts` 将 Cesium 地形采样为固定计算网格。`renderer.ts` 和 `water-shader.ts` 负责 Cesium 几何和水面着色。`index.vue` 负责控制、导入、导出和播放。复用代码已经放在 `src/flood/core` 与 `src/flood/cesium` 两个公开入口，Vue 页面留在 demo。调用方法与资源所有权见 [API 文档](../../../flood/README.md)。尚未发布 npm 包；暂不承诺支持所有 Cesium 版本。

## cesium-flood-grid v1 协议

这是本项目定义的交换协议，不是既有行业标准或 HEC-RAS 原生格式。当前适用于一个局部规则网格，所有时间帧共用地形与位置。

```json
{
  "format": "cesium-flood-grid",
  "version": 1,
  "name": "外部水动力模型成果",
  "coordinates": "local-enu",
  "verticalDatum": "WGS84-ellipsoid",
  "units": { "length": "m", "time": "s", "velocity": "m/s" },
  "grid": {
    "columns": 2,
    "rows": 2,
    "cellSize": 10,
    "origin": [119, 33, 0],
    "elevation": [10, 10, 9, 9],
    "active": [true, true, true, true]
  },
  "frames": [
    { "time": 0, "depth": [0, 0, 0, 0] },
    { "time": 60, "depth": [1, 1, 0.5, 0.5] }
  ]
}
```

- `origin`：网格西南角的经度（度）、纬度（度）、WGS84 椭球高（米）。它定义局部东、北、上（ENU）坐标系。
- `elevation`：各单元中心的**局部 ENU 上方向坐标**，不是直接填入国家高程基准下的 DEM 数值。水面局部高度为 `elevation + depth`。
- 单元中心为 `((column + 0.5) * cellSize, (row + 0.5) * cellSize)`。数组按行存储：`index = row * columns + column`；列向东、行向北。常见 GeoTIFF 从北向南排，转换时需要翻转行。
- `active`：可选的有效区域布尔掩膜。无效单元深度必须为 0，几何不跨越无效单元；无效区不得解释为观测到的干地。`elevation` 仍须是有限数值，可用有限占位值。v1 使用相邻中心构造三角网格，因此边界与窄区域的覆盖范围会略有缩小。
- `time`：从事件起点算起的秒数，非负且严格递增；不是帧编号或 Unix 时间戳。
- `depth`：竖向水深（米），非负，每帧长度为 `columns * rows`。干地为 0。
- `velocityEast` / `velocityNorth`：可选的平均流速分量（m/s），同时提供或同时省略，并在所有帧保持一致。只给流速大小不够，必须转换方向；缺失时不显示流向，不把它当作真实零流速。
- 时间插值：在相邻帧间线性插值水深和已提供的流速。它是播放平滑手段，不会补算洪水传播或保证帧间动量守恒；快速过程需更密的时间采样。
- `structures`：可选的 `{ barriers, damBreach? }`，记录网格面墙顶及预设溃口时间、位置、最终尺寸；同一 ENU 米制。旧 v1 成果仍可读取。首帧水深记录初始库水；回放依据 `time` 重建缺口。该扩展不包含全部求解工况。
- 浏览器入口限制：20,000 单元、2,000,000 时间-单元样本、80 MB 文件、网格最长边 20 km。大区域应分块、流式读取或在服务端转换；v1 尚未实现这些能力。

## 接入别人的模型

转换层要完成以下步骤，然后输出上述协议：

1. 识别源 CRS、水平单位、高程基准、时间单位、NoData、单元位置以及变量含义。
2. 将源坐标转换到 WGS84；将正高按相应大地水准面模型转换为椭球高，之后转为目标局部 ENU。不能只改字段名称。
3. 非结构三角网格或不同分辨率栅格，重采样到同一目标规则网格。转换时保留有效区域、岸线和障碍物，避免插值穿过堤坝。
4. 若源结果提供的是水面高程，先在**同一高程基准**下计算 `depth = max(0, waterSurfaceElevation - groundElevation)`。然后再转换地形坐标。NoData 不得盲目替换成干地。
5. 将流速矢量旋转到当地东/北方向。源模型的 x/y 分量可能沿投影坐标轴或网格轴，不能直接更名。
6. 验证单元顺序、长度、时间和单位，再输出 JSON。

第一版实现了 JSON 协议验证与播放，没有实现 HEC-RAS HDF5、GeoTIFF、NetCDF 或 TELEMAC 原生文件解析。它们需要独立适配器或服务端预处理。只有静态最大水深图时，可以作为一帧展示，不能据此恢复传播时间。

## 内置模型能做什么

局部惯性浅水近似：单元保存水深，单元边界保存单位宽度流量。通过水面高程差更新流量，加入 Manning 摩阻，再用连续性方程更新水深。普通泄洪的入流为用户给定的 `Q(t)`；溃坝示例从初始库水开始，出流由缺口尺寸、两侧水面和可用水量决定。缺口形成过程为用户预设，不从坝体材料计算。

```text
单元水量变化 = 边界流入 - 边界流出 + 泄洪输入
水面高程 = 地面高程 + 水深
```

合成山谷为 48 × 88 单元，网格 12 m。上游约 48 m 宽的区域输入泄洪水量；侧边和上游封闭，北边自由排水。初始为干地。模型保留局部加速、重力及摩阻，省略对流动量项；它不是完整二维 SWE 求解器，也不模拟三维水花、泥沙、渗透、建筑物细节或真实溃口形成。

时间步长受重力波 CFL 约束；湿干交界使用流出限制避免负水深。守恒检查为“域内水量 + 下游排出 - 初始水量 - 累计输入”。守恒好不等于结果精确。测试覆盖干地、静水、停止入流、湿干传播、开放边界、渐进溃口、淹没统计以及协议往返；尚未与实测或工程基准对比校准。完整溃坝模拟需要更完整的方程、边界条件和验证。

当前计算运行在主线程，计算约 10 Hz，网格更新最多 4 Hz。水面 shader 每帧绘制动态明暗、浅深变化和流速驱动纹理，是第一版视觉效果；它没有真实场景反射、折射或可信的泡沫物理。后续可将求解器移到 Worker、改用 GPU 动态网格，并增加水面材质与独立性能档位。

## 验证与学习顺序

```powershell
pnpm install --frozen-lockfile
npm run test -- --run src/flood
npm exec vue-tsc -- --noEmit -p tsconfig.flood.json
npm run build
npm run dev -- --host 127.0.0.1
```

`tsconfig.flood.json` 单独检查本功能的严格类型。整个旧 demo 仍有已有的类型错误，生产构建本身不执行类型检查。部分新版 pnpm 的本机脚本审批策略会阻止安装后的自动检查，需按本机策略批准 esbuild / protobufjs 的构建脚本；不要为此关闭全局安全检查。

先读 `FloodDataset` 明白数据表示，再读 `FloodSolver.step` 理解水量流动，最后看 renderer 的 shader。需要补的知识是规则网格、通量与守恒、CFL 与湿干边界，以及法线、光照和纹理；不必先学完整 UE 渲染体系。

参考：[HEC-RAS 溃坝案例与方程选择](https://www.hec.usace.army.mil/confluence/rasdocs/hgt/latest/tutorials/2d-unsteady-flow/dam-breach-analysis-with-2d-areas)、[GeoClaw 浅水方程](https://www.clawpack.org/geoclaw.html)、[Cesium Material](https://cesium.com/learn/cesiumjs/ref-doc/Material.html)。
## Cesium 地形与挡墙补充

页面的“Cesium 地形与泄洪点”入口可以加载 `createWorldTerrainAsync()` 或自定义 `CesiumTerrainProvider.fromUrl()` 地形服务。原点是计算区域西南角，区域向东、向北延伸约 576 × 1056 m。世界地形沿用项目现有 ion 凭据；自定义服务需要支持浏览器跨域访问。

`terrain.ts` 在计算前批量采样单元中心。有 availability 时使用 `sampleTerrainMostDetailed`，否则必须明确选择 `sampleTerrain` 层级。返回的 WGS84 椭球高通过 ECEF 转换成计算网格的 ENU 高程，不能直接把海拔或椭球高写入局部 z。缺失高程会终止加载并保留原场景，不能填成 0。取消操作会忽略后续响应，但不保证中止已经发出的 Cesium 网络请求。

采样完成后冻结计算地形；相机 LOD 不参与后续求解。真实地形由 Cesium 原生地形显示，水面使用固定计算网格；两者存在采样和 LOD 差异，12 m 网格不能还原微小沟渠。默认泄洪点取南端低点，可以点击地形后将选中单元设为泄洪点。北侧保持开放出口，真实区域的其他边界暂为封闭边界；任意地点不一定具有南高北低的山谷条件。

`hydraulics.ts` 的 `FloodBarriers` 定义网格面上的墙顶高程：east 长度为 `(columns + 1) * rows`，north 长度为 `columns * (rows + 1)`；null 是普通网格面。坐标与 `grid.elevation` 同为局部 ENU 米制，墙顶不能与水深直接比较。正确条件是 `地面高程 + 水深 > 墙顶高程`。

内置横谷挡墙位于网格约 45% 处，各段墙顶为两侧较高地面加墙高。低于或等于墙顶不流动，超过后使用理想宽顶堰的单位宽流量近似，乘单元宽度得到 m³/s。支持反向流动和简化尾水抑制，流量经过原有水量限制器保证不抽走超过单元存水的水量。尾水修正、局部损失及堰流系数尚未校准，不能视作 HEC-RAS 等模型的等价实现。

挡墙以一个单元厚的示意堤体显示。水面不会跨墙插值，但目前没有漫顶瀑布、飞溅或墙面贴水动画。求解器支持 east/north 两个方向的障碍；当前页面仅提供横谷 north 挡墙的显示和过墙流量统计。

改变地形、挡墙或泄洪点会重置推演。导出的是水深/流速成果及计算地面，可选 `structures` 保留挡墙和预设溃口。导入可还原这些示意结构并回放，但不包含地形服务、全部入流和摩阻配置，不能直接恢复相同工况重新求解。后续 npm 包应分别定义计算域/工况与成果协议。

Cesium TerrainProvider 是基础地面输入；3D Tiles 建筑、挡墙、桥梁仍需要单独识别成实体占据、网格面墙顶或有孔结构，不能统一用模型最高点替代地面。真实 3D Tiles 的提取尚未实现，详见 [3D Tiles 计算域设计](./3dtiles-hydraulics-design.md)。

验证：`node node_modules/vitest/vitest.mjs run src/flood`，涵盖漫顶阈值、反向流、尾水抑制、过墙后的扩散与质量守恒，以及 Cesium 地形采样路径、ENU 转换、缺失值和取消响应。采样适配单元测试使用 mock 服务，在线服务需要另行检查。


## 水面改进与 ShaderToy 原理

页面默认开启细节水面，可以关闭对比基础材质；两者使用同一份计算水深和流速。当前支持程序波浪法线、流速平流、浅水透明过渡、岸边泡沫与近似天空反射，尚未实现真实场景反射、折射和漫顶瀑布。查阅 [水面效果、洪水推演与 ShaderToy](./water-rendering-research.md)，了解 GPU 数据纹理与推演层的关系、参考案例及后续验收标准。

## 本轮验收记录（2026-10-11）

22 项测试、新功能严格类型检查和生产构建通过。浏览器中启用 3 m 横谷挡墙，在 354 s 工况检查到过墙流量约 113.58 m³/s，累计输入 84,000 m³，平衡误差约 -7.28e-11 m³；切换基础/细节材质后时间、水深、面积和水量指标保持一致。在线 Cesium 世界地形在 119°E、33°N 的测试区采样成功，447 s 推演时域内水量 84,000 m³，误差约 -5.82e-11 m³。未出现新 shader 错误。该在线测试区较平坦，验证的是原生地形接入，不是实测洪水精度。真实 3D Tiles 提取、外部模型原生格式适配、ShaderToy/GPU 求解器与真实场景反射尚未实现。

## 真实山谷示例与 API（2026-10-12）

点击“加载真实山谷示例”，或打开 `/cesium-demo/flood-valley?scene=real-valley`。预设为劳特布龙嫩山谷的一段，西南角 7.903°E、46.570°N，64 × 96 单元，单元宽 12 m，区域 768 × 1152 m。沿用项目的 Cesium ion 凭据，在线采样 Cesium 世界地形最详细可用层级。该谷地有 White Lütschine 河流经过，可参见 [瑞士旅游局的谷地路线说明](https://www.myswitzerland.com/en-in/experiences/route/lauterbrunnen-loipe/)。演示没有校准实际河槽、初始河水或水库。

默认假设流量 350 m³/s、持续 240 s，挡墙关闭，展示南端低点入流后沿地形传播；可以启用假设挡墙比较蓄水与漫顶。泄洪量、挡墙和灾害过程均为演示设置。其他地点应检查出口是否与真实下游方向相符。

页面直接调用 `createFloodSimulation` 和 `createCesiumFloodLayer`，不再把可复用计算和渲染代码放在 Vue 页面目录。外部成果通过 `parseFloodDataset` 校验、`interpolateFrame` 插值后进入同一图层，详见 [API 文档与代码示例](../../../flood/README.md)。


本轮验证：25 项测试通过，洪水模块严格类型检查和生产构建通过。core 入口单独打包只包含 dataset、hydraulics、solver、simulation 与 index，没有 Vue、Cesium 或其他运行依赖。

真实山谷在线采样与卫星底图载入成功，6144 单元的局部 ENU 高程约 826.1–1600.2 m。350 m³/s、240 s 无墙工况推进至 1800 s：输入与域内存水均为 84,000 m³，淹没 2.59 ha，北侧 55% 区域淹没 1.66 ha，平衡误差约 4.37e-11 m³。水进入采样地形中的低洼处积聚，北侧边界排水为 0；这不是已验证贯通河道的工况，不应人为压平采样地形来获得预期动画。需要对照更精细河槽 DEM、检查原生地形与水面网格差异，再验证任意边界配置。

启用 3 m 假设横谷挡墙：1800 s 时过墙流量约 1.89 m³/s，北侧区域淹没 1.21 ha，水量误差约 -5.82e-11 m³。阈值、反向流、湿干传播和守恒由单元测试验证；浏览器检查覆盖真实地形接入、图层重建和水面显示。另一个范围略偏西的实际导出 JSON（32 帧）已通过纯 core 解析、123 s 时间插值和有限水深检查。

整个旧 demo 的既有类型错误尚未处理；本次类型结论仅针对洪水功能。未实现 npm 发布、Worker 消息协议、工程精度校准或真实 3D Tiles 障碍提取。
