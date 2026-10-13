# 洪水推演 API

模块位于 `src/flood`，Vue 页面只是一个调用方。现在可以在其他页面、普通 TypeScript 程序或 Worker 中复用；还没有发布 npm 包。

| 入口 | 用途 | 运行环境 |
| --- | --- | --- |
| `src/flood/core/index.ts` | 内置推演、渐进溃坝、淹没分析、网格成果协议与时间插值 | 不依赖 Vue、Cesium、DOM |
| `src/flood/cesium/index.ts` | TerrainProvider 采样、水面图层 | 调用方提供已有的 Cesium Viewer |

当前入口采用相对路径；以下代码假设调用文件位于 `src`。未来 npm 包可以把这两个入口映射为 `包名/core` 和 `包名/cesium`，把 Cesium 作为 peer dependency。模块内部没有全局 Viewer、ion 凭据、页面控件或自动播放时钟。

## 自己推演

```ts
import { createFloodSimulation, createValleyGrid, createCrossValleyWall } from './flood/core'
import { createCesiumFloodLayer } from './flood/cesium'

const grid = createValleyGrid()
const barriers = createCrossValleyWall(grid, 3)
const simulation = createFloodSimulation({
  grid, barriers, roughness: 0.035,
  inflow: { discharge: 350, until: 240 },
})
// viewer 是宿主创建的 Cesium.Viewer。
const layer = createCesiumFloodLayer({ viewer, grid, barriers })
layer.focus()
const frames = [simulation.snapshot()]
for (let i = 0; i < 60; i++) {
  const frame = simulation.advance(5)
  frames.push(frame)
  layer.update(frame)
}
const result = simulation.toDataset(frames, '假设泄洪工况')
console.log(simulation.balance)
// 下载/保存由宿主负责：JSON.stringify(result)。
layer.destroy()
```

这个循环展示离线计算；交互页面应由宿主在自己的动画循环里按小段推进，避免一次计算阻塞界面。渲染几何可按约 4 Hz 更新；每个绘制帧调用 `layer.animate(visualSeconds)` 更新材质与可见泡沫，时间必须非负且有限。`visualSeconds` 是独立、单调递增的视觉时钟，推荐按真实秒推进，避免 20×、60× 加速推演把波纹变成闪烁。`update(frame)` 提供当前水深和流速，不改动视觉时钟。完全冻结时保持 `visualSeconds` 不变；暂停推演时继续推进它，可预览冻结成果中的当前流场，水深和模拟时间不变。

## 流动波纹与随流泡沫

```ts
const layer = createCesiumFloodLayer({ viewer, grid, barriers,
  visuals: { flow: true, foam: true, foamIntensity: 0.75, foamLifetime: 18 },
})
layer.update(frame) // depth: m，velocityEast / velocityNorth: m/s，time: s
layer.setVisualOptions({ foamIntensity: 0.5 }) // 无需重建图层
// 重置推演或拖动回放时间轴时清除旧泡沫轨迹。
layer.resetVisuals()
```

`flow` 控制流场驱动的细节纹理和泡沫碎点移动；关闭后仍保留背景波纹。`foam` 控制泡沫状态更新与显示；可见碎点同时要求 flow、foam 和细节水面开启。`foamIntensity` 范围 0–1，`foamLifetime` 为网格覆盖率的 1–120 模拟秒衰减时间（默认 18，经过该时长剩余约 37%）。非法设置整体拒绝。关闭细节水面或显示水深配色时不显示这些效果。

背景波纹在固定 ENU 坐标上计算，避免按变化的流向旋转大尺度位置造成三角面折线条纹。弱细节纹理仍以流速平移，两相交替重置限制拉伸，纹理漂移最大 6 m/s；可见碎点使用未修改的输入流速。天空仅采用渐变色近似，不绘制不存在于主场景的假云倒影。网格泡沫覆盖率继续按成果时间生成、输送、衰减，但表面只轻微着色，减少静止白斑。

图层复用一组 384 个屏幕尺度的泡沫碎点，按当前水面三角形插值速度和高程，逐帧移动、渐入、渐出。碎点不会改变任何成果数据，不是 SPH 或三维飞溅求解。点集合采用 Cesium 默认的双通道模式，避免单通道优化把碎点提前画在水面下面。预览粒子随真实时间移动；窗口长时间挂起不会快进轨迹，单次推进最多 0.25 秒。它们会在干地、无效单元、封闭挡墙和计算区边界消失；极端流速单步超过 0.4 个格子也会消失，防止穿墙。

泡沫不穿过干地、无效单元或未漫顶的挡墙；溃口按当前有效墙顶处理。部分打开的单元仅近似通道连通，不解析单元内部的精细水流。覆盖率受 0–1 限制，不做物质守恒分析；它不属于导出的水动力成果，依赖播放经过的历史。缺少流速时不生成随流泡沫。首次载入、倒退、跨越超过 30 秒的成果跳转从空泡沫开始；主动 seek 无论前后方向都应调用 `resetVisuals()`。相同时间不会重复生成；干地立即清空。极端流速需要超过 512 个输送子步时清空效果，避免阻塞界面。

此版本保留 CPU 浅水求解器、约 4 Hz 网格重建和已有溢流水幕；未增加 GPU 水动力求解或三维飞溅粒子。细节仅用于动态水面，淹没分析仍基于原始水深数据。Demo 提供“流场驱动细节”“随流泡沫”和强度滑块作同场景对比。“暂停时预览水流”默认开启；关闭该选项后，暂停推演也冻结全部水面动画。时间倍率只控制水动力推演进度。

| API | 行为 |
| --- | --- |
| `createFloodSimulation(options)` | 创建独立状态；复制网格、挡墙、泄洪点、初始水深和溃口配置 |
| `setInflow({ discharge, until? })` | 修改总入流 m³/s；多个源单元均分总量；until 是从事件起点算起的停止时刻 s |
| `advance(seconds)` | 推进指定模拟秒数，内部选择稳定时间步，返回一份水深/流速快照 |
| `snapshot()` / `time` | 读取快照 / 当前模拟秒数 |
| `balance` | 初始水量、累计输入、域内存水、北边排水、平衡误差与所有内部 north 挡墙的有符号过流总和 |
| `breachState` | 当前缺口进度、宽度与位置；未配置溃坝时为 undefined |
| `reset()` | 恢复初始水深、时间归零；保留网格、墙、源单元、溃口和已配置入流 |
| `toDataset(frames, name?)` | 校验并复制输出成果；调用方负责记录帧，不自动无限保存历史 |

停止泄洪用 `setInflow({ discharge: 0 })`，再继续 `advance`；停止推进就是暂停。修改计算域或挡墙需要创建新实例。`sourceCells` 是 `row * columns + column` 的单元索引；省略时选取南端第 4 行最低点附近单元。

`outlet: 'north' | 'south'` 选择下游开放边界，默认 north；south 时默认输入点改为北端第 4 行附近。其他三条边界封闭，出口只排水、不提供外部回流。西藏真实地形示例采用 south。地形与模型统一适配、跌水显示和取舍说明见 [真实地形与统一计算域](./real-terrain-domain.md)。

## 使用 Cesium 原生地形

```ts
import { sampleTerrainGrid, createCesiumFloodLayer } from './flood/cesium'
import { createFloodSimulation, type FloodGrid } from './flood/core'

const layout: FloodGrid = {
  columns: 64, rows: 96, cellSize: 12,
  origin: [7.903, 46.57, 0], elevation: [],
}
const grid = await sampleTerrainGrid(viewer.terrainProvider, layout, {
  ...(viewer.terrainProvider.availability ? {} : { level: 14 }),
  onProgress: (completed, total) => console.log(completed, total),
})
const simulation = createFloodSimulation({ grid, inflow: { discharge: 350, until: 240 } })
const layer = createCesiumFloodLayer({ viewer, grid, showGround: false })
layer.update(simulation.advance(1))
```

宿主负责准备 TerrainProvider 与凭据。`layout.elevation` 不参与采样，可为空；`origin` 是西南角，网格向东、向北延伸。地形采样返回固定的 ENU 高程，不会随着相机 LOD 改变。`signal?: AbortSignal` 可取消结果接收，但不能保证中止已经发出的 Cesium 网络请求。无 availability 的服务必须传 level；缺失高程会报错。

`showGround: false` 用宿主的原生地形显示；`true` 绘制成果网格地面。原生地形 LOD 与固定水面网格会有差异。图层不会替换宿主地形、底图、灯光或相机，只有显式调用 `focus()` 才调整相机。

## 只显示别人的成果

```ts
import { parseFloodDataset, interpolateFrame } from './flood/core'
import { createCesiumFloodLayer } from './flood/cesium'

const dataset = parseFloodDataset(JSON.parse(jsonText))
const layer = createCesiumFloodLayer({ viewer, grid: dataset.grid, barriers: dataset.structures?.barriers })
const frame = interpolateFrame(dataset.frames, 30)
layer.update(frame, true) // 第二个参数：水深配色；第三个参数：是否显示细节材质。
```

这条路径不创建内置求解器。转换器只要输出 `FloodDataset`，就能沿用同一个图层；只有水深也可以回放。CRS、高程基准、单元顺序、NoData 和速度方向需要在转换器中处理。协议与转换步骤见 [demo 说明](../views/flood-valley/README.md)。这是一份项目交换协议，不是已有行业标准，也还没有 HEC-RAS / TELEMAC 原生文件解析器。

## 图层与资源所有权

`CesiumFloodLayer` 提供 `update(frame, depthMode?, detail?)`、`updateDamBreach(state?)`、`updateAnalysis(values, maximum?)`、`updateInundation(result)`、`animate(seconds)`、`focus({ padding? })`、`focusBreach(state, outlet?)` 和 `destroy()`。更新帧必须与构造时网格一致；外部 JSON 先经过 `parseFloodDataset`。图层持有传入网格和墙的引用，创建后按只读数据使用，变更计算域则重建图层。

`analyzeFloodDataset` 可分析内置模型或外部模型的完整成果；`analyzeInundation` 可在给定水位下计算连通淹没范围。溃坝配置、两种分析的含义、回放与 API 示例见 [溃坝与淹没分析](./dam-inundation.md)。

宿主拥有 Viewer、定时器、播放进度和文件操作。`destroy()` 可重复调用，只释放该图层创建的 primitive、墙实体和材质，不销毁 Viewer；销毁后不要再使用。两个推演实例没有共享计算状态。core 可以迁入 Worker，但当前 demo 的求解仍在主线程；Worker 消息协议、GPU 求解和 npm 发布配置尚未实现。

## 当前模型边界

内置模型是局部惯性浅水近似，默认干地，也支持 `initialDepth` 初始水深。可选择北边或南边开放，其他边界封闭；尚无任意水位边界与完整热启动（初始面流量不支持）。计算要求完整有效地形，不支持把 NoData 当作实体。挡墙面采用同一 ENU 基准的绝对墙顶高程，水面超过墙顶才漫流；仅内部网格面参与障碍计算。求解器与显示支持 east/north 墙，预设溃口目前仅作用于 north 墙。

水面材质与计算水量独立。当前材质是程序波浪、流速细节和近似天空反射；已增加由墙顶和已知流速控制的越顶水片与跌水示意，尚无真实场景反射、折射或三维水花。网格不能表达小沟渠和复杂桥洞；工程预测需要更完整模型及基准校准。`composeFloodDomain` 可合并显式实心轮廓及墙线，3D Tiles 自动几何提取仍是 [后续设计](../views/flood-valley/3dtiles-hydraulics-design.md)。

验证命令：`node node_modules/vitest/vitest.mjs run src/flood`、`node node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p tsconfig.flood.json`、`npm run build`。
