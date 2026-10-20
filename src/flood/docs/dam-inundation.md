# 溃坝与淹没分析

先用坝后已有的库水验证溃坝，再看整个过程中哪些地方被淹、何时被淹。两项能力共用 `FloodGrid` 和 `FloodDataset`，计算在 `core` 中，Cesium 只负责显示。因此外部水动力模型的成果也能做同样的分析。

## 在 demo 中操作

当前默认入口 `/cesium-demo/flood-valley?scene=dam-breach` 已改为西藏真实地形，见 [真实地形与统一计算域](./real-terrain-domain.md)。以下合成原理对照可通过 `/cesium-demo/flood-valley?scene=synthetic-breach`，或点击“溃坝原理示例（合成山谷）”打开。假设工况：30 秒开始破坏，60 秒形成缺口，最终宽 72 米。坝后预置等水位库水，额外入流为零。

1. 点击“推进 10 秒”，到 30 秒时坝体仍完整，库水被保留。
2. 继续到 60 秒，缺口形成 50%，宽 36 米；水从逐渐降低的缺口流出。
3. 到 90 秒，缺口完全形成。继续推进可看到洪水向北侧传播、从开放出口排出。
4. 也可以点击“开始溃坝”连续播放。修改缺口参数会恢复初始库水；“重置”也会恢复库水。
5. 在“显示内容”选择最大水深、首次到达时间、累计淹没时间或指定水位连通淹没。切换分析会暂停推演；修改分析参数后点击“计算 / 更新淹没分析”。

指定水位分析也可在“加载真实山谷示例”之后使用。点击地形选一个水源单元；勾选连通限制时，只有从该单元能到达的低地才被淹。源单元本身高于给定水位时结果为空。

## 缺口为什么会改变出流

```text
初始地形 + 坝面墙顶 + 初始库水
              ↓
模拟时间 → 缺口宽度、降低进度 → 有效过流口
              ↓                     ↓
         坝体示意动画          水头差、堰流与水量限制
                                    ↓
                            水深更新、沿地形传播
```

`sampleDamBreach` 按时间计算 0–1 的线性进度。宽度从 0 增长到 `finalWidth`；相交坝段的墙顶同时降低到最终底高程。动画和求解器使用同一条规则，所以不会出现仅视觉上开口、计算仍按完整坝段挡水的情况。

一个缺口可能比单元宽还窄。求解器根据缺口与网格面的相交宽度，将完整坝段和降低后的堰流按宽度加权，然后使用原有的流出水量限制器。出流取决于库水和下游水面，不是固定输入一个“溃坝流量”。守恒关系为：

```text
初始水量 + 累计外部输入 = 当前存水 + 下游排出
```

这是预设缺口过程的可视化原型。底高程不会挖穿采样地形；内置局部惯性近似不是完整二维浅水方程。已增加墙顶越流水片与下游跌水显示，尚未计算坝体失稳、泥沙冲蚀、三维水花或碎块。真实缺口尺寸和形成时间需要外部资料或模型提供，不能从演示参数推断灾害后果。

## 两种淹没分析的区别

| 分析 | 输入与问题 | 结果与限制 |
| --- | --- | --- |
| 指定水位 | 地形、水位、可选水源和挡墙：“假如水保持在这个高度，能连通哪些地方？” | 等水位范围、面积、几何容积、最大水深；不计算传播时间或有限库水能否填满 |
| 推演成果 | 全部时间帧：“这段记录中，哪里曾经被淹、什么时候、多久？” | 逐单元最大水深、峰值时刻、首次到达、累计淹没时长、面积时间序列；精度受源成果限制 |

静态分析使用四邻域连通，地形或墙顶达到水位时阻断通路；水位严格高于墙顶才越过。当前溃口也可参与连通判断。静态平衡中，只要有正宽度的通路即可连通，不能因此预测水能多快通过。省略 `seedCells` 时显示所有低于水位的有效低地，包含孤立低洼地，挡墙不再限制范围。NoData 是不可穿过的分析区域边界，不能解释为实体建筑。

时间分析使用正水深阈值（demo 默认 0.1 m，API 默认 0.02 m）。未达到阈值和无效单元返回 `null`，不会被标成“0 秒到达”。相邻帧间线性插值水深，计算阈值交点；多次涨退水的淹没时长会累计。

统计仅覆盖 `fromTime` 到 `toTime`。首帧已淹没的单元，到达时间记为首帧时间，不能恢复更早历史。末帧仍有水时，累计时长只是当前窗口内的结果。“曾淹没面积”是所有达标单元的并集；`peakSampledArea` 是采样帧的最大同时淹没面积，二者不同。稀疏帧可能遗漏快速峰值，插值不能代替水动力计算。

## 公共 API

以下调用文件假设位于 `src`；`viewer` 由宿主提供。参数使用米、秒，所有高程为网格原点定义的局部 ENU z。

```ts
import {
  createValleyGrid, createCrossValleyWall, createFloodSimulation,
  analyzeInundation, analyzeFloodDataset, interpolateFrame, sampleDamBreach,
} from './flood/core'
import { createCesiumFloodLayer } from './flood/cesium'

const grid = createValleyGrid()
const row = Math.floor(grid.rows * 0.3)
const source = (row - 1) * grid.columns + Math.floor(grid.columns / 2)
const waterLevel = grid.elevation[source] + 12
const barriers = createCrossValleyWall(grid, 0, row)
for (let x = 0; x < grid.columns; x++) {
  const i = row * grid.columns + x
  barriers.north[i] = Math.max(waterLevel + 3, grid.elevation[i], grid.elevation[i - grid.columns])
}
const reservoir = analyzeInundation(grid, { waterLevel, seedCells: [source], barriers })
const damBreach = {
  row, center: (source % grid.columns + 0.5) * grid.cellSize,
  finalWidth: 72, finalBottomElevation: grid.elevation[source],
  startTime: 30, formationTime: 60,
}
const simulation = createFloodSimulation({
  grid, barriers, initialDepth: reservoir.depth, damBreach,
  inflow: { discharge: 0 },
})
const layer = createCesiumFloodLayer({ viewer, grid, barriers })
layer.focus({ padding: 1.6 })
const frames = [simulation.snapshot()]
// 宿主动画循环中分段推进并按需要记录成果；这里只演示一次更新。
const frame = simulation.advance(60)
frames.push(frame)
layer.updateDamBreach(simulation.breachState)
layer.update(frame)
console.log(simulation.balance)

const dataset = simulation.toDataset(frames)
const analysis = analyzeFloodDataset(dataset, { depthThreshold: 0.1 })
layer.updateAnalysis(analysis.maximumDepth)
layer.updateAnalysis(analysis.arrivalTime) // 秒，从事件起点算起
layer.updateAnalysis(analysis.inundationDuration) // 秒，窗口内累计

const extent = analyzeInundation(grid, {
  waterLevel, seedCells: [source], barriers, damBreach: simulation.breachState,
})
layer.updateInundation(extent)

// 只回放外部成果时，不创建内置求解器。先 parseFloodDataset 校验 JSON。
const replayFrame = interpolateFrame(dataset.frames, 45)
layer.updateDamBreach(sampleDamBreach(damBreach, replayFrame.time))
layer.update(replayFrame)
layer.destroy() // 宿主的 Viewer 继续存在
```

`DamBreachOptions.row` 是内部 north 网格面所在行，范围 `1..rows-1`；`center` 是 ENU 东向 x；`finalBottomElevation` 为绝对局部 z，不是水深。缺口必须覆盖已有坝段，最终宽度须在计算域内，形成时间必须大于零。多个破口、斜向破口和时变外部侵蚀曲线尚未实现。

分析数组按 `row * columns + column` 存储。`updateAnalysis(values, maximum?)` 绘制完整单元的地面色块，`null` 单元不绘制；`updateInundation(result)` 绘制等水位水面。动态图与静态水面由相邻单元中心构建，岸边和域边覆盖会略收缩。地面色块角点使用周围采样高程平均值；Cesium 原生地形 LOD 与固定网格仍有显示误差。

## 导出与外部模型

`FloodDataset` v1 新增可选 `structures: { barriers, damBreach? }`，不改变已有必填字段。旧 JSON 仍可读取；新导出保留坝段和预设缺口，首帧水深包含初始库水。导入回放按成果时间显示缺口，无需重新求解。

成果不保存全部入流、摩阻、初始面流量或地形服务配置，不能当作完整求解重启文件。外部成果可以省略结构信息，只要水深、时间、坐标和高程基准符合协议，就可以调用 `analyzeFloodDataset`。HEC-RAS、TELEMAC 原生格式转换仍需另写适配器。

“导出分析 JSON”保存逐单元结果、网格、高程基准与单位；面积为 m²、容积为 m³，页面将面积换算为 ha。输出是网格成果，尚未生成 GeoJSON 边界多边形。3D Tiles 提取也尚未实现；以后可把墙顶转换成 `FloodBarriers`，沿用同一连通与过流规则。

## 参考与验证

- [HEC-RAS：用户输入溃口参数](https://www.hec.usace.army.mil/confluence/rasdocs/rasum/6.6/performing-a-1d-unsteady-flow-analysis/performing-a-dam-or-levee-breach-analysis-with-hec-ras/user-enter-breach-data)：预设宽度、底高程、形成时间和发展曲线的思路。
- [HEC-HMS：Dam Break](https://www.hec.usace.army.mil/confluence/hmsdocs/hmstrm/reservoir-modeling/reservoir-modeling-concepts-and-equations/dam-break)：溃口几何与堰流的关系。本 demo 为矩形缺口近似，不是这些模型的等价实现。
- [HEC-RAS：成果图层](https://www.hec.usace.army.mil/confluence/rasdocs/r2dum/6.6/viewing-2d-or-1d-2d-output-using-hec-ras-mapper/adding-results-map-layers-for-visualization)：到达时间、淹没持续时间等成果概念；本项目明确使用窗口内累计时长。

测试覆盖保坝蓄水、破口传播、初始水量守恒、恢复初始条件、结构元数据校验、等墙顶阻断/漫顶/溃口连通、孤立洼地、NoData、阈值交点、反复淹没和单帧成果。

浏览器在合成示例中验证：30 s 前过坝流量为零；60 s 时缺口宽 36 m，过坝约 477.92 m³/s；90 s 时宽 72 m，过坝约 2758.98 m³/s。300 s 时初始 368,728 m³ 中下游排出约 240,968 m³，域内剩余约 127,760 m³，平衡误差约 5.24e-10 m³。0–300 s、0.1 m 阈值的曾淹没面积约 16.11 ha，采样帧最大同时面积约 12.89 ha。三种时间成果图层切换成功，未发现新的 shader 错误。这些是演示工况的运行证据，不是工程精度验证。

真实 Cesium 世界地形在线采样成功。劳特布龙嫩预设 6144 单元，给定局部 ENU 水位约 876.52 m，从南端水源做连通淹没：区域内面积约 50.60 ha，几何容积约 8,956,744 m³，最大水深约 50.46 m。淹没已触及计算域边界，这不是一个封闭水库容积或实际洪水预测。

35 项洪水模块测试、`tsconfig.flood.json` 严格类型检查与生产构建通过。纯 core 独立打包仅包含七个本地计算文件，不依赖 Vue、Cesium、DOM；31 帧溃坝成果的 JSON 往返、60 s 缺口回放、最大水深/到达/持续时间统计通过。整个旧 demo 的已有类型错误未在本次处理。
