# Animation 实验模块与兼容入口

动画 SDK 源码现位于 `packages/cesium-animation`，包名 `@gis-animation/cesium` 仍是未发布的技术预览。此目录保留兼容入口，供仓库内现有调用继续使用；新集成优先从包入口导入。当前仍以项目的 Cesium **1.132.0** 为验证基线，不升级或替换全局 Cesium 依赖。

M2 已提供三种效果（空间飞线、沿路径重复的流向箭头、局部 ENU 喷泉粒子）、`createTimeline` 时间轴、`createCameraTrack` 相机关键帧和 `createAnimation` / `parseAnimationDefinition` JSON 定义接口。SDK 不包含 Vue、lil-gui 或 Playground UI，也不负责浏览器本地文件和 localStorage。

## 坐标与参数

`GeoPoint` 使用 WGS84 经度、纬度和可选椭球高：经度范围 `[-180, 180]` 度，纬度范围 `[-90, 90]` 度；未提供 `height` 时按 `0` 米处理；显式提供时必须是有限数值。路径至少需要两个点，相邻点至少相距 1 毫米。这里的高度是相对 WGS84 椭球的绝对高程，不是相对地面的高度。

| 参数                         | 约束                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `color`                      | CSS 颜色字符串，必须能被 Cesium 解析                                                           |
| 飞线/箭头 `widthPx`          | `1..64` 像素                                                                                   |
| 飞线/箭头 `speed`            | `0..20` 次/秒；表示图案相位每秒循环次数，每次循环移动一个图案间隔，不是米/秒；`0` 表示图案静止 |
| 飞线/箭头 `direction`        | `forward` 或 `backward`                                                                        |
| 飞线/箭头 `opacity`          | `0..1`                                                                                         |
| 箭头 `spacing`               | `1..200`，表示沿整条路径重复的箭头图案周期数                                                   |
| 喷泉 `emissionRate`          | `0..2000` 个/秒；`basic` 质量实际使用请求发射率的一半                                          |
| 喷泉 `lifetime`              | `0.05..30` 秒，表示**单个粒子**寿命，不是发射器总时长                                          |
| 喷泉 `minSpeed` / `maxSpeed` | `0..300` 米/秒，且 `maxSpeed >= minSpeed`                                                      |
| 喷泉 `gravity`               | `0..100` 米/秒²，沿局部 ENU 的负 Up 方向                                                       |
| 喷泉 `particleSizePx`        | `1..64` 像素                                                                                   |
| 喷泉 `quality`               | `basic` 或 `standard`                                                                          |

飞线和箭头几何在创建时固定。它们可动态更新颜色、宽度、速度、方向、透明度；箭头还可更新 `spacing`。喷泉可动态更新发射率、寿命、速度范围、重力、粒子尺寸、颜色和质量。`positions` 与喷泉 `position` 不支持热更新；变更位置时销毁旧句柄并重新创建。未声明为动态的字段会被拒绝，更新前会校验整组新值。

实现默认值如下：飞线为 `#49b7ff`、6 px、0.35 次/秒、正向、透明度 1；箭头为 `#ffca70`、20 px、0.35 次/秒、正向、透明度 1、整条路径 10 个周期；喷泉为 90 个/秒、单粒寿命 5 秒、速度 22–28 米/秒、重力 9.8 米/秒²、7 px、`#bcecff`、`standard`。

## 状态与生命周期

创建句柄后状态为 `idle`，不会自动播放。状态含义如下：

- `idle`：已创建，尚未播放。
- `playing`：正在按该句柄自己的实验时间推进。
- `paused`：暂停；飞线和箭头保留当前相位，恢复后从该相位继续。喷泉会销毁当前粒子系统并清空粒子，恢复时重建系统、重新发射，因此不能保证暂停前粒子的精确续播。
- `stopped`：停止并把逻辑时间归零；路径图案回到初始相位，喷泉粒子被移除。可再次 `play()`。
- `destroyed`：终态；所属资源已释放，句柄不能再使用。

`play()` 只从 `idle` 或 `stopped` 开始并把时间归零；`pause()` 只影响 `playing` 状态；`resume()` 只从 `paused` 恢复；其他状态下这些调用不改变状态。`stop()` 可从任一可用状态调用并进入 `stopped`；`destroy()` 可重复调用，进入终态后其他操作会抛错。Viewer 已先销毁时，对句柄执行操作会先清理句柄，再抛出宿主已销毁错误。飞线/箭头的暂停能力为 `exact`；喷泉的暂停能力为 `restart`。单效果句柄没有公开的 `seek` API；通过 `createTimeline` 创建的时间轴支持 `seek(t)`，并报告精确定位与需要重置的效果。喷泉依赖模拟历史，时间轴 seek 或循环时会重置粒子，不能将暂停/恢复表述为粒子的精确续播。

## M2 时间轴与 JSON 定义

`createTimeline` 可把已创建的效果句柄编排到同一条时间线上，并提供播放、暂停、恢复、停止、seek 和速度控制。若要统一创建和管理多个效果，可使用 `createAnimation(viewer, definition)`；`parseAnimationDefinition(input)` 会验证并复制导入的 JSON 定义。定义支持 `fly-line`、`flow-arrow`、`fountain` 和 `camera` 轨道。相机关键帧以 WGS84 位置和度为单位的 heading/pitch/roll 表示；时间轴播放相机轨道期间，宿主应用应明确管理 Cesium 相机输入的启用与恢复。

完整参数、轨道边界和独立包用法见 [`packages/cesium-animation/README.md`](../../packages/cesium-animation/README.md)。

每个 Viewer 共享一个运行时和一条 `requestAnimationFrame` 调度循环；只有存在 `playing` 句柄时才持续调度，最后一个活动效果暂停、停止或销毁后会取消待执行帧。路径 `speed: 0` 时图案不移动，但句柄仍是 `playing`，仍会占用该调度循环。效果使用自己的时间，不读写宿主 Viewer 的 `Clock`，也不拥有或销毁 Viewer。应用退出或替换场景时，应先销毁每个效果句柄，再销毁 Viewer。

## 使用示例

```ts
import * as Cesium from 'cesium'
import { createFlyLine, createFlowArrow, createFountain } from './index'

const viewer = new Cesium.Viewer(container, {
  baseLayer: false,
  terrainProvider: new Cesium.EllipsoidTerrainProvider(),
  animation: false,
  timeline: false,
  requestRenderMode: true,
  maximumRenderTimeChange: Number.POSITIVE_INFINITY,
  shouldAnimate: false,
})

const path = [
  { lon: 106.63, lat: 26.647, height: 80 },
  { lon: 106.64, lat: 26.65, height: 220 },
]
const fly = createFlyLine(viewer, { positions: path, speed: 0.35 })
const arrow = createFlowArrow(viewer, {
  positions: path,
  spacing: 12,
  speed: 0.2,
})
const fountain = createFountain(viewer, {
  position: { lon: 106.63, lat: 26.647, height: 0 },
  maxSpeed: 46,
  gravity: 9.8,
})

fly.play()
arrow.play()
fountain.play()
fly.update({ speed: 0.6, color: '#8be4ff' })
fountain.pause() // 清空粒子
fountain.resume() // 从头发射新粒子，不恢复原粒子轨迹
arrow.stop()

fly.destroy()
arrow.destroy()
fountain.destroy()
viewer.destroy()
```

示例容器需由调用方提供。所有三个创建函数都要求传入一个仍存活的 Cesium Viewer。

## 已知版本风险与验证

喷泉需要自行推进 Cesium `ParticleSystem`。当前适配会调用 Cesium 1.132 中未公开的 `ParticleSystem.update`，并向其传入仅覆盖 `time` 的局部 frame state；粒子计数诊断读取私有字段 `_particles`。这些接入点依赖 Cesium 内部实现，升级版本前必须重新验证；Cesium 1.146 尚未完成验证。

浏览器 smoke 脚本用于验证交互与运行状态，不生成截图。短时性能观察仅用于记录测试环境，不构成性能承诺或验收门槛；视觉质量由用户验收。

在仓库根目录运行：

```powershell
node node_modules/vitest/vitest.mjs run src/animation
node node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p tsconfig.animation.json
node scripts/smoke-animation.mjs
node node_modules/vite/bin/vite.js build
```

浏览器脚本通过 `PLAYWRIGHT_MODULE_PATH` 和 `PLAYWRIGHT_EXECUTABLE_PATH` 接收本机 Playwright 模块与浏览器路径；默认开发地址为 `http://127.0.0.1:5174/cesium-demo/`，可用 `ANIMATION_BASE_URL` 覆盖。报告位于 `test-results/animation/report.json`。返回首页的可选图标 CSS 在测试中用空样式替代，动画页本身要求零外部网络请求。

实现参考：[Material](https://cesium.com/learn/cesiumjs/ref-doc/Material.html)、[ParticleSystem](https://cesium.com/learn/cesiumjs/ref-doc/ParticleSystem.html)、[Scene requestRender](https://cesium.com/learn/cesiumjs/ref-doc/Scene.html)、[ENU Transforms](https://cesium.com/learn/cesiumjs/ref-doc/Transforms.html)。版本相关行为同时核对了本地 1.132.0 安装源码。


本轮实际验收见 [Timeline 与独立包验证记录](./TIMELINE-VALIDATION.md)。
