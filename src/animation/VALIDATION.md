# GIS Animation M1 原型验证记录（历史）

本页保留首轮原型的结果摘要。当前 Timeline 与独立包验收见 [TIMELINE-VALIDATION.md](./TIMELINE-VALIDATION.md)；本地 test-results/animation/report.json 已由最新一轮重跑覆盖。

日期：2026-10-23（Asia/Shanghai）。实验路径：`/cesium-demo/animation-lab`。

## 本轮结果

- 三个效果的独立 TypeScript 创建函数与生命周期已实现，Vue 页面只负责调用和调参。
- 25 项 Vitest 行为测试通过，覆盖非法参数、状态转换、帧率无关相位、参数更新、20 轮释放、ENU 与宿主先销毁。
- `tsconfig.animation.json` 严格类型检查通过；项目 Vite 生产构建通过。构建仍有大于 500 kB chunk 的提示。
- Playwright 真实 WebGL 行为 smoke 通过。完整本地报告：`test-results/animation/report.json`。

## 浏览器证据

环境为 Windows x64、Chrome 155.0.8059.85、WebGL 2、ANGLE / NVIDIA GeForce RTX 5070 / D3D11。Cesium 锁定版本为 1.132.0。

1. 通过页面按钮播放三种效果。宿主 `Clock.shouldAnimate=false`，其时间和倍率保持不变；喷泉仍实际产生粒子。
2. 路径暂停后时间保持；喷泉暂停后粒子资源被释放，恢复后重新产生粒子；全部停止后没有 SDK 待执行 RAF。
3. 贵阳、赤道和高纬度均产生粒子，重力方向与当地 Up 的点积为 -1；全景、侧视、喷泉近景均执行实际渲染，无 WebGL/Shader 错误。
4. 连续 20 轮创建、播放、暂停、恢复、停止、销毁后，Primitive、Entity 与调度器回到基线。
5. 在第二个独立 Viewer 中直接调用模块，验证反向跨日界线路径和 basic 喷泉。宿主原有 Primitive/Entity 均保留，preRender 监听数回到基线。
6. 验证宿主先销毁 Viewer、重新建立 Viewer，以及实际路由卸载后的画布和开发接口清理。
7. 动画页零外部网络请求、零浏览器错误；返回首页的可选 CDN 图标 CSS 在测试中使用空样式。

独立 Viewer 的短时样本：约 1.5 秒播放、191 个渲染帧，平均渲染间隔 7.72 ms、最大间隔 116.20 ms；JS heap 约 122.11 MB → 60.30 MB（期间可能发生 GC）。该样本用于证明运行和记录环境，不能据此宣称 FPS 保证、稳定性能门槛或无长期内存泄漏。

## 验收边界

这是当前项目中的技术原型，不代表 M1 正式发布。未做截图、录屏或主观视觉验收，也未完成密集粒子长期性能测试。空间路径当前为传入点间的三维折线，不自动生成曲线或贴合地形。喷泉为粒子抛射，没有地面碰撞或流体求解。

Cesium 1.146.0 兼容回归、独立 npm 工程安装集成、Timeline、相机轨道、OpenLayers 与包发布均未纳入本轮。喷泉时间适配涉及私有 `ParticleSystem.update`，必须在版本升级前重测。飞线/箭头虽声明可精确求值，当前 M1 原型没有公开 seek 方法。

可复现命令与完整 API 说明见 [README](./README.md)。
