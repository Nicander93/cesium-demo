# @gis-animation/cesium（本地技术预览）

为已有 Cesium Viewer 添加飞线、流动箭头、ENU 喷泉、相机关键帧与演示时间轴。ESM + TypeScript 声明，`cesium` 为唯一运行时 peerDependency；不包含 Vue、lil-gui 或 Playground 代码。

当前仅以 Cesium **1.132.0** 为基线验证，peer 范围为 `~1.132.0`。包名仍是暂定名称，版本为 `0.0.1-alpha.0`，并设置 `private: true`；这是未发布的技术预览，不要将其视为已发布的 npm 包。尚未完成 Cesium 1.146.0 兼容验证或正式视觉验收。

## 使用

```ts
import { createFlyLine, createFountain, createTimeline } from '@gis-animation/cesium'

// viewer 由宿主创建；SDK 不接管其 Clock 和生命周期。
const line = createFlyLine(viewer, {
  positions: [
    { lon: 106.63, lat: 26.647, height: 100 },
    { lon: 106.64, lat: 26.65, height: 250 },
  ],
  speed: 0.35, // 图案相位循环次数/秒，不是米/秒
})
const fountain = createFountain(viewer, {
  position: { lon: 106.635, lat: 26.648, height: 0 },
  emissionRate: 90,
})
const timeline = createTimeline(viewer, { duration: 30, loop: 'repeat' })
timeline.add({ id: 'line', effect: line, at: 0, duration: 20 })
timeline.add({ id: 'water', effect: fountain, at: 8, duration: 18 })
timeline.play()
timeline.pause()
const report = timeline.seek(15) // exact=['line']; reset=['water']
timeline.resume()
timeline.setSpeed(2)
timeline.stop() // 回到0；不还原宿主原视角
timeline.destroy() // 默认只解除绑定，不销毁传入的效果
line.destroy()
fountain.destroy()
// 之后宿主自行销毁 viewer。
```

创建效果不自动播放。加入 Timeline 前必须为 idle/stopped；一个效果只能属于一个 Timeline；绑定期间独立 play/pause/resume/stop 会报错。默认 Timeline 不拥有外部效果，`disposeEffects: true` 才在删除/销毁轨道时销毁这些效果。destroy 幂等；之后其他操作报已销毁错误。调度失败通过句柄 `error` 报告并隔离失败任务。

轨道区间为 `[at, at+duration)`，默认结束隐藏；`fill: 'hold'` 保留终态。飞线/箭头/相机可以按时间精确求值。喷泉依赖模拟历史，seek/循环会重置；暂停会移除粒子、恢复重新发射；不能精确还原粒子。正常播放到喷泉 hold 边界时冻结现有粒子，seek 到该边界则清空粒子并报告 reset。

internal driver 以单调真实时间推进，不读写宿主 Clock；一个 Viewer 共用一个 SDK RAF，最后一个活动任务停下后取消。external driver 仅接受 `setTime(t)` 和查询，play/pause/resume/stop/seek/setSpeed 都拒绝；setTime 不开启内部 RAF，递增输入推进喷泉，倒退重置。播放速度必须为有限正数，不支持倒放。

非循环播放到末尾后 state=stopped、timeSeconds=duration；再次 play 从0开始。stop 总是回0。subscribe 返回取消函数，无永久 UI 轮询。SDK 不设置宿主相机输入开关；Playground 在播放含相机轨道时显式锁定交互，结束或暂停后恢复。

## 相机与坐标

GeoPoint 为 WGS84 lon/lat（度）、height（椭球绝对高程米，默认 0）。路径不自动贴地形或 3D Tiles。箭头 `spacing` 是整条路径的重复图案周期数；喷泉 `lifetime` 是单个粒子的寿命，`basic` 档实际发射率为请求值的一半。效果参数约束如下：

| 参数 | 约束 |
| --- | --- |
| `GeoPoint.lon` / `lat` | WGS84 经度 `[-180, 180]` 度、纬度 `[-90, 90]` 度；`height` 是椭球绝对高程米，默认 `0` |
| 路径 `positions` | 至少两个点，相邻点至少相距 1 毫米；创建后不可热更新 |
| `color` | Cesium 可解析的 CSS 颜色字符串 |
| 飞线/箭头 `widthPx` | `1..64` 像素 |
| 飞线/箭头 `speed` | `0..20` 次/秒，表示图案相位循环次数，不是米/秒；`0` 表示图案静止 |
| 飞线/箭头 `direction` | `forward` 或 `backward` |
| 飞线/箭头 `opacity` | `0..1` |
| 箭头 `spacing` | `1..200`，表示沿整条路径重复的图案周期数 |
| 喷泉 `emissionRate` | `0..2000` 个/秒；`basic` 档实际发射率减半 |
| 喷泉 `lifetime` | `0.05..30` 秒，表示单个粒子寿命 |
| 喷泉 `minSpeed` / `maxSpeed` | `0..300` 米/秒，且 `maxSpeed >= minSpeed` |
| 喷泉 `gravity` | `0..100` 米/秒²，沿局部 ENU 的负 Up 方向 |
| 喷泉 `particleSizePx` | `1..64` 像素 |
| 喷泉 `quality` | `basic` 或 `standard` |

飞线/箭头可动态更新颜色、宽度、速度、方向和透明度，箭头还可更新 `spacing`；喷泉可动态更新发射率、寿命、速度范围、重力、粒子尺寸、颜色和质量。位置、路径几何及相机关键帧不支持原地热更新；编辑这些数据时应校验后替换动画实例。

`createCameraTrack(viewer, { keyframes })` 的每个 keyframe 包含 `time, position, heading, pitch, roll, easing?`。时间为轨道局部秒，姿态统一用度；至少两帧，首帧必须在0，时间严格递增。地理位置按椭球测地线与高程插值，heading/roll 走最短角度，可选 linear/smoothstep。接近对跖点的两帧须添加中间帧。相机轨道不能在时间范围重叠；后续镜头开始后不会被较早的 hold 镜头抢回。销毁不恢复旧视角，不调用 camera.flyTo。

## 导出定义与独立集成

`AnimationDefinition` 只含 schemaVersion=1、duration、loop? 和 tracks。轨道 kind 为 fly-line / flow-arrow / fountain / camera，options 为相应效果参数。编辑器导出的 JSON 可直接复用：

```ts
import { createAnimation, parseAnimationDefinition } from '@gis-animation/cesium'

const definition = parseAnimationDefinition(JSON.parse(savedJson))
const animation = createAnimation(viewer, definition)
animation.timeline.play()
animation.destroy() // 此入口拥有并清理自己创建的全部效果
```

定义会在创建场景对象前完整校验并深复制。SDK 不读取 localStorage、不下载文件、不创建 UI；这些由试验场承担。几何/相机关键帧不支持原地热更新，编辑器在校验后替换实例，验证失败保留原动画。

## 本地构建与验证

在仓库根目录：

```powershell
node packages/cesium-animation/scripts/build.mjs
node scripts/test-animation-package.mjs
node scripts/smoke-animation.mjs
node node_modules/vue-tsc/bin/vue-tsc.js --noEmit -p tsconfig.animation.json
node node_modules/vitest/vitest.mjs run src/animation
```

包构建生成 `dist/index.js`、源码映射和 `.d.ts`；Cesium 保持外部依赖。独立包验证会 `npm pack`，再在隔离 consumer 中安装真实 tgz，使用 NodeNext 与 `skipLibCheck: false` 检查 TypeScript 声明，并验证 ESM 导入及公开导出。Cesium 1.132 的依赖范围会解析到不再导出其所引用深层路径的 zip.js 2.24，因此验证 consumer 单独固定 `@zip.js/zip.js@2.7.70`；这只是测试夹具，不修改项目全局依赖或锁文件。验证只生成本地包，不执行 `npm publish`。

喷泉仍使用版本敏感的 ParticleSystem.update 局部 frame-state 时间适配；_particles 仅供未公开的实验诊断读取。升级 Cesium 前必须回归。
