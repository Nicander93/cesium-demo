# 水面反射演示

打开 `/cesium-demo/water`。水面立即初始化，影像和现有寺庙 3D Tiles 场景并行加载；无需等待模型即可调整水面高度。

页面提供：

- 水面高度调整，复用原有几何和材质。
- 流畅、均衡、精细三档反射画质。
- 实时反射开关，关闭后保留波纹、高光与基础环境色。
- 聚焦水面与聚焦模型。
- “加载与性能”显示首帧、模型元数据时间、几何/反射目标创建次数和当前 FPS。

水面实现已迁移至 `src/water/index.ts`，包含标准 Cesium Material 工厂和完整 WaterSurface API。详见 [API、取舍与验证说明](../../water/README.md)。

`WaterSurface.ts` 保留为旧路径的兼容导出；`demo.ts`、`water.ts` 是历史参考，不是当前路由的运行入口。

法线图片通过 `import.meta.env.BASE_URL` 解析，适用于当前 `/cesium-demo/` 子路径。公共模块不包含场景地址、Ion token 或 `window.Cesium` 依赖。

离开页面时清理 Viewer、模型、水面、监听与计时器。`/water?reflection=off` 可从启动起关闭反射，用于对照基础水面。
