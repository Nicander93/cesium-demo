# 云层视觉重建记录（2026-10-26）

> 用户已否定前轮观感。最新的固定对照与未验收边界见 [SAMPLING-AUDIT.md](./SAMPLING-AUDIT.md)。

本轮承接用户对截图的反馈：在固定性能预算内改善云形与光影。没有改水效，没有复制参考项目的着色器或资源。

## 已定位与修正

1. **采样相位不一致**：静止时主云使用递增的 marchFrame，但 jitter 曾读取冻结的 frame。现在主云、resolve 和 jitter 使用同一相位。
2. **坐标偏移放大**：Cesium RenderState 会把 czm_viewport 更新为低分 MRT 的 viewport。射线重建使用归一化 vUv+jitter，再乘实际 viewport；深度使用同一 UV，不乘为 ceil 尺寸准备的旧 targetUvScale，避免奇数尺寸产生静止漂移。
3. **整块融合**：一个低分样本只观察一个 Bayer 子像素，旧混合把它更新到整块。现在仅更新本相位实际观察的像素；其他像素保留重投影历史，失效或快速运动时才使用当前空间重建。
4. **噪声相位相关**：固定 Bayer 像素原来只访问 64 层 STBN 中的少数层。主云的噪声层增加 frame / phaseCount，打散空间相位与噪声周期的相关性。

## 借鉴参考实现的预算分配

参考目录中的 readable/city-builder.index.js:_updateResolution 把 cloudReprojectionResolution 设为 traceResolution 的两倍；035-cloud-upsample-reprojection.glsl 使用 2×2 相位。这里借鉴分级重建的思路，保留本项目的 Cesium、BSM 和生命周期。

~~~text
场景 1600×900
  → 主云 400×225（96 / 128 步上限，运动和静止相同）
  → 时序中间图 800×450（4 相位）
  → 原 overlay 线性采样到 1600×900
~~~

主射线数没有增加；每个重建像素的观察周期从 16 帧降为 4 帧，resolve 像素数降为原来的四分之一。布局函数同时供渲染端和预热源码使用。对于 1281×801，实际主云为 321×201，中间图为 642×402，保持严格的两倍采样格。

## 云形与明暗

- 先按 coverage 选择并归一化水平云体，再用高度包络收缩顶部，避免稀疏积云失去高度，或把整个云体的上部变为透明雾片。
- 局部云顶高度使用投影到云底球面的低频形状场，减少随高度游移的包络。
- 快速光照仅增加一个近处 shapeTexture 查询；复用当前天气覆盖率和层参数估计短段消光，余下太阳路径继续使用 BSM。它省略了近光细节侵蚀和新的天气查询，属于视觉近似。
- 用到局部云顶的估计光深调节环境遮蔽，并降低漫射填充，增强凹处与受光面的区别。原完整光照诊断路径保留。
- 时序平均不增加静止帧的渲染成本，也没有锁定某张静止云图。太阳、曝光等仍可更新；运动时依据屏幕速度保护当前观察。

## 当前证据与限制

证据目录：test-results/cloud-visual-20261026/。截图位于本次任务产物 cloud-final-20261026/，包括地面、云内和云海；相同视角的旧截图在 cloud-preview-20261026/。

- 13 个单元测试文件，69 项通过；覆盖生命周期、设置、预热、尺寸预算以及采样格对齐。
- 实际 WebGL2 的重建回归使用生产 resolve GLSL，输入已知高频颜色、alpha 边界和独立噪声。2× / 4× 重建 RMSE 约 0.00049 / 0.00100，输出有限且无 GL 错误。
- 五组完整云场交互测量均通过：地面静止、云海鼠标、云内模拟触摸、4K 浏览器视口细节档拖动、阴天云内触摸。当前机器 Chrome/ANGLE/RTX 5070 上 P95 RAF 间隔约 8.1ms，测量期间无超过 50ms 的间隔。4K 是浏览器视口，渲染仍封顶 1600×900；这不是原生 4K 渲染性能。
- 三次独立浏览器的云链路 ready 为 1531、1481、1439ms；源码指纹与实际五个程序一致。未屏蔽外部请求的正常生产包复查 ready 为 1947ms，诊断 API 未暴露，本地资源无 404。**启动最大 RAF 间隔仍约 398–415ms**，不能据稳定期结果宣称任意时刻都保持高帧率。额外追踪也发现首次初始化仍有长帧。保留 Worker 上下文、拆分提交两项实验均未改善，已撤回。
- 当前 GLSL 的 54 项大气/云形检查、11 项 resolve 边界检查、10 项快速大气近似检查通过；六项既有渲染浏览器集成和三项取消/卸载回归通过，Worker 最终活跃数为零。奇数尺寸浏览器实测也确认 321×201 → 642×402 的两级纹理。
- CDP 触摸是模拟输入，尚未验证真实触屏设备。RAF 是调度与渲染的综合间隔，不是独立 GPU 时间。
- 截图里块状边缘减轻，云顶和凹处更清楚；细颗粒、偏软的云边以及远处地平线细条仍然存在，尚未达到参考观感，不标记视觉验收通过。

## 复测入口

- pnpm run typecheck:atmosphere / pnpm run build
- pnpm exec vitest run src/views/cloud-atmosphere-lab src/vendor/cesium-geospatial/clouds/temporalMath.spec.ts src/vendor/cesium-geospatial/clouds/cloudResolveLayout.spec.ts
- scripts/test-cloud-reconstruction-gpu.mjs、test-atmosphere-gpu.mjs、test-cloud-resolve-gpu.mjs、test-cloud-fast-lighting-gpu.mjs
- scripts/test-cloud-performance.mjs（CLOUD_PERF_EXTENDED=1）、test-cloud-startup.mjs、test-cloud-startup-lifecycle.mjs

浏览器诊断需要独立构建时设置 VITE_CLOUD_LAB_DIAGNOSTICS=1。正常生产构建不暴露诊断 API。

