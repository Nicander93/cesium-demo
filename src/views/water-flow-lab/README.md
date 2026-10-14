# 水流渲染对照：P0 基线

入口：`/cesium-demo/water-flow-lab`，首页“特效”分类也能进入。

该实验先让现有结果可比较、可诊断、可重复验收，再开展 P1 自然流动实验。此页展示现有基础/细节两种水面，不代表新算法已经达到目标画质。

## 运行与复现

`pnpm dev -- --host 127.0.0.1 --port 5198 --strictPort` 启动 HTTP 服务。也可直接使用 `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5198 --strictPort`。

`pnpm exec vitest run src/water src/flood`；`pnpm run typecheck:flow-lab`；`pnpm build`。

浏览器验收运行 `node scripts/smoke-water-flow.mjs`。需要可用的 Playwright 模块与 Chromium。默认从本项目解析 `playwright`；未安装时可以通过 `PLAYWRIGHT_MODULE_PATH` 指向已有安装的 `playwright/index.mjs`，通过 `PLAYWRIGHT_EXECUTABLE_PATH` 指定本机 Chromium/Chrome。没有引入额外 npm 依赖或修改锁文件。

本机验收所用 PowerShell 配置：

```powershell
$env:PLAYWRIGHT_MODULE_PATH = 'C:\Users\PC\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright\index.mjs'
$env:PLAYWRIGHT_EXECUTABLE_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node scripts/smoke-water-flow.mjs
```

默认验收地址是 `http://127.0.0.1:5198/cesium-demo/`，可用 `WATER_FLOW_BASE_URL` 覆盖。脚本仅用于 Vite 开发环境；自动化控制接口在生产构建中不可用。

先选择工况，点击“暂停”“固定 15 秒”，选择“近景”或“俯瞰”。切换算法和诊断不改变相机或输入。两种算法共用同一份水深和速度；基础模式不显示细节模式的泡沫粒子，这是旧实现的固有差异。不要把这个基线对照当作新算法的 A/B 结果。

## 数据与工程边界

- `src/flood/experiments/flow-fixtures.ts`：框架无关的四类合成输入，沿用 FloodGrid/FloodFrame。40 × 64 格网，单元 2 米，原点 [119°, 33°, 100 m]；origin 高度采用 WGS84 椭球高，地面网格是相对局部 ENU 的合成高度。没有实际 DEM、影像或水域配准依据。
- 河湾为给定曲线的切向速度；障碍物工况为给定解析近似绕流场和干区，未求解绕流、湍流或守恒的真实水动力。
- `src/flood/cesium/foam.ts`：沿用浅水/Froude 源项，提取同一份计算结果供诊断；不更改水动力方程，不反写输入帧。源项存为 Float32，可能引入微小视觉示踪数值舍入差异。
- `src/flood/cesium/renderer.ts`：增加 water/velocity/foam-source/foam 诊断及最终 Cesium 组装 Shader 的读取。调用 `setDiagnosticMode()` 后用当前帧 `update()`；粒子在非水面视图隐藏。未引入私有 API。
- `index.vue`：仅负责 Viewer、输入选择、时钟、相机和诊断箭头。模块不创建 Viewer 或设置 Ion token，宿主明确拥有相机和场景。
- App 原有 Font Awesome CDN 改为在非实验路由按需加载，保证直接进入实验页不发出外网请求；其他示例仍使用原地址。若从其他页面进入实验页，之前的可选资源请求可能仍在进行。

泡沫生成源以覆盖率/秒显示，色带上限 0.42；泡沫覆盖以 0–1 显示。速度色带为 0–4 m/s，箭头只表达输入方向，不编码箭头长度。取消速度输入后关闭速度与泡沫输运，基础程序波纹仍可存在，不能解释为真实流向。

归零和固定时间会重置视觉状态，并以 0.5 秒步长暖启动到目标时间；这是可复现的截图路径，和播放时约 10 Hz 输入更新的数值采样不同，不能宣称所有播放路径逐像素等价。演示的水深和速度不随时间变化，仅用于稳定输入下的着色与输运检查。

## 验收材料和限制

`test-results/water-flow-lab/` 保存四种工况的基础/细节截图、速度/生成源/覆盖截图、冻结对照、最终组装 GLSL、动态 WebM 和 GPU 报告。该目录被 Git 忽略，不能当作 PR 中已经上传的证据。

2026-10-14 本机单测 73 项通过；专项类型检查和生产构建通过，构建保留现有大于 500 kB 的 chunk 提示。真实浏览器报告以 `gpu-smoke.json` 为准，包含浏览器版本、实际 WebGL renderer、分辨率、错误和动态时间。

验收脚本覆盖全部工况、无速度降级、冻结像素、重复 Viewer 创建/销毁、Vue 路由卸载返回、连续相机拖动、超过 15 秒动画。读取 `Appearance.getFragmentShaderSource()` 的最终 Material/Appearance 组合源，检查 uniform 唯一性，并通过真实帧验证 GPU 编译。它没有用独立 GLSL 编译冒充 Cesium 验证。

Workers/Assets URL 检查返回内容和 HTTP 状态；此页使用同步 Primitive，尚未验证异步几何 Worker 执行。未完成实际地形、3D Tiles、桥梁遮挡、复杂后处理或 WebGL context 丢失恢复验收；没有 GPU 时间/显存统计，资源数量稳定不能证明不存在 GPU 内部泄漏。

## 下一项技术实验

近景基线显示：现有急流水面仍偏平静，粒子分布比局部白浪更显眼。先保持几何路径和输入协议，比较沿流场平流的法线细节、速度梯度/跌水的局部泡沫源与现有算法；以相同时间、输入、相机截图及动态片段判断流向、相位接缝与局部白浪。通过后再单独量化 Primitive 重建成本和 GPU 状态纹理路线。

当前洪水是天空反射近似。静态 WaterSurface 的平面反射、折射和多 Pass 仍需独立实验，不将整个动态河谷当作同一平面反射。稳定公共 API、插件和包结构在技术实验之后确定；本轮没有新建 Monorepo、插件宿主、发布包或 fork Cesium。
