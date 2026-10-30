# Timeline 编辑与独立包验证

日期：2026-10-23（Asia/Shanghai）。页面：`/cesium-demo/animation-lab`。这是本轮实际验证结果，M1 首轮记录保留在 [VALIDATION.md](./VALIDATION.md)。

## 实现范围

- 试验场采用现有 lil-gui 编辑参数，底部提供轨道列表、时间范围和播放头。
- 可创建多个飞线、箭头、喷泉及相机轨道；修改时间范围、fill、效果参数、路径节点、发射点和相机关键帧。
- 相机关键帧使用 WGS84 坐标与度制 HPR，可精确 seek；播放时显式锁定场景交互，暂停、停止和释放后恢复。
- JSON 是独立于 UI 的 AnimationDefinition；支持文件导入/导出、本地草稿恢复，非法输入保留当前可运行版本。
- SDK 源码位于 `packages/cesium-animation/src`，`src/animation` 是原页面兼容入口和测试目录。
- 公开新增 createTimeline、createCameraTrack、parseAnimationDefinition、createAnimation；Viewer 与 Clock 仍归宿主，调度按 Viewer 共享。

## 自动检查

- Vitest：**51 / 51**，其中原效果 25 项、Timeline/相机/定义/失败隔离 26 项。
- 严格 vue-tsc 检查通过。
- 项目 Vite 生产构建通过；保留原有大于 500 kB chunk 的构建提示。
- SDK ESM 和声明构建通过：JavaScript 38,426 bytes，未压缩；Cesium 为外部 peer，无 Vue/lil-gui 等 UI 导入。
- 真实 npm pack、独立 consumer 安装 tgz、NodeNext 且 skipLibCheck=false 的 TypeScript 检查及 Node ESM 导入均通过。
- 本地预览包：`test-results/animation-package/gis-animation-cesium-0.0.1-alpha.0.tgz`；未执行 npm publish。

Consumer 使用 Cesium 1.132.0。该旧版 Cesium 的宽范围依赖会解析到不再开放其深层导入路径的 zip.js，因此 fixture 显式安装 `@zip.js/zip.js@2.7.70`。只固定独立测试工程，不改宿主全局依赖。原始包报告：`test-results/animation-package/report.json`。

## 真实浏览器

Windows x64、Chrome 155.0.8059.85、WebGL 2、ANGLE / NVIDIA RTX 5070 / D3D11。完整报告：`test-results/animation/report.json`，零浏览器错误，动画页和独立宿主均零外部请求；返回示例首页的可选 CDN 图标样式使用测试空样式。

通过的九组行为：

1. 实际点击 lil-gui 控件创建轨道、编辑开始时间、相位速度与地理路径节点。
2. Timeline 播放/暂停/恢复、重复 seek 的确定性、喷泉 reset 报告；宿主 Clock 保持冻结。暂停且地形完成后，继续观察渲染帧计数保持不变，证明 UI 没有留下 postRender/requestRender 反馈循环。
3. 记录相机关键帧并重复 seek，位置/朝向一致；播放锁定鼠标控制，暂停和停止恢复。
4. 通过真实文件 input 导入 JSON，下载导出文件并比较内容；刷新后恢复本地定义。非法定义、非法 JSON 保留原动画；省略可选参数的定义也能显示可编辑默认控件。
5. 贵阳、赤道、高纬度的 Timeline 喷泉实际产生粒子，三个视角均运行，ENU 重力方向正确。
6. 连续 20 轮创建/播放/seek/暂停/恢复/停止/销毁，资源和调度恢复基线。
7. 连续 20 个 repeat 边界，不积累 Primitive 或 Timeline。
8. 独立本地 HTTP 宿主直接加载 consumer 安装的 **tgz 产物**，无 Vue 或源码别名；宿主提供同目录安装的 Cesium 预构建引擎，SDK 通过标准 import map 复用该运行时。播放、相机 seek、external setTime、宿主实体/Primitive/监听数与冻结 Clock 均正常。
9. Viewer 先销毁、Viewer 重建和实际路由卸载，画布、轨道、GUI 与订阅均清理。

## 边界

这是可独立安装的本地 alpha 预览，包名仍暂定且 private。尚未对 Cesium 1.146、OpenLayers、npm 发布、长期密集粒子性能或主观视觉质量签收。没有截图/录屏验收，不把短期资源计数视为长期内存泄漏证明。

喷泉 seek 会重置，暂停后恢复重新发射，不还原历史粒子。正常播放到 hold 边界可冻结现有粒子，跳转到边界不能重建历史终态。ParticleSystem.update 的局部 frame-state 适配仍依赖 Cesium 内部实现。

相机近对跖点关键帧需增加中间点；同时间范围的相机轨道会拒绝。路径是传入节点间的空间折线，没有默认贴地形、地表碰撞或流体模拟。

复现方式与 API 见 [包 README](../../packages/cesium-animation/README.md)。浏览器脚本需要 PLAYWRIGHT_MODULE_PATH、PLAYWRIGHT_EXECUTABLE_PATH；先完成 SDK build 和包 consumer 验证，再运行 smoke。
