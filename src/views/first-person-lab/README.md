# 室内浏览实验

默认 first-person-lab 使用 NewSee2l035 的 Modern Hall：约 28.9 × 10.0 m 轴对齐范围，包含长廊和相连区域，31,087 个静态碰撞三角形（包含玻璃阻挡）。原 Wig42 客厅保留在 ?scene=living-room，也可在“场景与画质”切换。两套资产均本地提供，并附作者及 CC BY 3.0 授权。

## 浏览方式

默认进入剖切总览：拖动旋转、滚轮缩放，调节水平剖切高度查看内部。选择视点进入“点击行走”：单击地面沿直线前往、拖动转向、遇障碍停止。没有自动绕障寻路。WASD + Shift 键鼠漫游保留为可选入口，Esc 暂停；鼠标锁定不可用时可拖动转向。

剖切按高度隐藏结构，不识别某一楼层或房间。智慧城市后续交互建议：选建筑 → 选楼层 → 房间定位/剖切/属性 → 可选人员视角。真正的单层抽离、楼层爆炸图需要 floorId、楼层高度与独立节点/要素；单一合并网格不能自动得到这些语义。

## 接入其他场景

createFirstPersonLab(host, onStatus, { manifestUrl, origin }) 接受独立清单地址与 [经度, 纬度, WGS84 椭球高]。model/collision 相对于清单 URL 解析；清单自带视点、范围、三角形数量。interior-source.ts 校验契约，mesh-walking.ts 提供静态胶囊碰撞；画面由 Cesium 渲染，Three 仅用于碰撞数学。

```ts
const lab = createFirstPersonLab(host, onStatus, {
  manifestUrl: '/models/building-a/manifest.json',
  origin: [119.0317, 33.5921, 30],
})
await lab.ready
lab.spawnAt('entry')
lab.navigate()
// 离开场景
lab.destroy()
```

这里的 createFirstPersonLab 仍创建并拥有独立 Viewer，适合替换示例资源。已有智慧城市场景可以复用 mesh-walking/navigation 的控制逻辑，但尚不能把整个示例一键挂到现有 Viewer；还需要适配主场景相机、输入和退出恢复。

准备流程：

1. 从静态 glTF 提取节点世界变换后的三角形。scripts/analyze-interior.mjs input.gltf output-dir config.json 可复用；输入要求 glTF2 三角形、一个外部 buffer、无压缩/稀疏 accessor，其他输入应先离线转换。
2. 确认米制尺度、Y-up 原点和真实地板 floorY。GLB 归一化后保留 Y-up；碰撞按 [x,-z,y] 转 ENU。Cesium 显式设置 upAxis=Y、forwardAxis=X，避免默认 Z-forward 的额外水平旋转。包围球中心/半径正确不能证明朝向正确。
3. 配置名称、作者/来源、出生点与玻璃碰撞。眼高 1.62 m、身体高 1.72 m、半径 0.23 m；确认视点可容纳人物。转换不保证任意模型自动可行走。
4. 用画面深度拾取与碰撞坐标对照，再检查门洞、楼梯与家具。离线网格检查不能替代渲染对齐。

当前支持静态墙体/家具碰撞、沿墙滑动、低台阶、重力与地面支撑。动态门、动画碰撞、NavMesh 寻路和任意 3D Tiles 自动碰撞尚未实现。大楼应准备简化碰撞网格，避免所有精细渲染三角形参与同步建树。

## 画质

显式配置绘制倍率，避免忽略高 DPI，也避免重复乘 devicePixelRatio。高档按 CSS 尺寸的 1.5–2 倍绘制，均衡最高 1.5 倍，性能为 1 倍。支持时使用 4x MSAA，性能档关闭；FXAA 保持开启。inspectScene 可读取真实 drawingBuffer/cssSize 与 MSAA 支持/采样数。

照明使用 SH 漫反射、预过滤 GGX IBL、PBR Neutral tone mapping、阴影、可调曝光和环境遮蔽。抗锯齿改善边缘，但不能代替高质量纹理、阴影分辨率或全局光照，当前无 UE Lumen 间接光照。

## 验证

navigation.spec.ts 检查目标合法性、到达、遇墙停止；interior-source.spec.ts 检查清单契约。scripts/smoke-interior-browsing.mjs 验证默认大厅、三个落脚点、真实鼠标点击与渲染地面坐标重合、高 DPI、剖切恢复、画质切换及两模型生命周期。仅 INTERIOR_CAPTURE=1 时生成截图。

scripts/smoke-interior.mjs 指向 ?scene=living-room，保留旧真实客厅的资产哈希、运动、阻挡及销毁检查。?fixture=procedural 仅供盒子运动回归。

```sh
pnpm exec vitest run src/views/first-person-lab src/views/vegetation-lab
pnpm run typecheck:practice-labs
pnpm run build
node scripts/smoke-interior-browsing.mjs
pnpm run smoke:interior
```

浏览器脚本可使用 PLAYWRIGHT_MODULE_PATH、PLAYWRIGHT_EXECUTABLE_PATH 与 PRACTICE_BASE_URL。功能/GPU 检查不代替用户对观感和体验的判断。
