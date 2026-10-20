# GPU 动态洪水水面实验

入口：`/flood-dynamic-lab`。固定合成河道中持续入流 → 沿河传播 → 停流退水，用同一份 FloodFrame 对比 GPU 与默认 Primitive 路径。此轮验证动态更新方式，继续使用既有水面着色和局部惯性求解器；还不是工程级水动力模型或最终洪水画质。

后续光照与真实环境实验已接入同一页面，可选GGX与大气环境，详见 [真实地形中的洪水光照](./REAL-TERRAIN-LIGHTING.md)。本文描述的默认Primitive/GPU拓扑及降级行为仍然保留。

## 使用

```ts
import { createCesiumFloodLayer } from './flood/cesium'

const layer = createCesiumFloodLayer({
  viewer, grid, showGround: false, surfaceBackend: 'gpu',
  visuals: { flow: true, foam: true, particles: false, foamIntensity: 0.75, foamLifetime: 6, surfaceStyle: 'flow' },
})
layer.update(frame) // time: s, depth: m, velocityEast/North: m/s
layer.animate(visualSeconds)
layer.setVisualOptions({ foam: false })
layer.setSurfaceBackend('primitive') // 不重置计算或泡沫历史
console.log(layer.getDiagnostics())
layer.destroy() // 可重复调用，Viewer 仍归宿主所有
```

不依赖内置求解器，也可只提供水深而省略两个流速分量。输入先验证再更新，缺少速度会清零 GPU 速度通道。输入数据不会被渲染器修改。构造后网格拓扑固定，计算域变化时重建图层。基础、水深和详细材质沿用 `update(frame, depthMode?, detail?)`。仍提供原始选项，没有新增性能档位。

## 数据和算法

规则网格每个四边形两组三角形，剔除包含 inactive 样本的三角形。坐标与旧路径相同：样本中心 `((x+.5)*cellSize,(y+.5)*cellSize)`。静态 VBO 在首次绘制时创建一次；顶点携带单元编号和所属三角形三个编号。顶点重复占用更多静态内存，换取所有顶点一致的湿干裁剪决定。

两张 RGBA32F 纹理均为 nearest、无 mipmap、flipY=false；纹理第一行对应南侧，单元编号用 texel 中心寻址：

| 纹理 | R | G | B | A |
| --- | --- | --- | --- | --- |
| surface | ENU 水面高程 | 有符号视觉水深 | 向东速度 | 向北速度 |
| foam | 泡沫覆盖 | 泡沫生成源 | 原始精度的 wet 标志 | 保留 |

水面高程为 bed+depth+0.035 m，最后一项是沿用的显示偏移。CPU 继续调用 `createFloodSurfaceState` 做相邻干样本的视觉高程延拓；不改变实际水深或体积。wet 标志按输入 depth≥0.02 m 计算，避免 Float32 在阈值附近把干单元误判为湿单元。一个三角形的三个标志全为 0 时，三个顶点一致移出裁剪空间，不留下旧水面或零面积干地条带。其余三角形用同一片元水深覆盖规则裁剪。

顶点着色器采样高程并生成三维位置，邻域有限差分计算 `normalize(-dz/dx,-dz/dy,1)`；边界使用单边差分，内部使用中心差分，分母均为实际样本间距。CPU 对照也修正了边缘原先减半的坡度，以及 Primitive 烘焙 modelMatrix 后波纹/天空反射误把世界 XYZ 当 ENU 轴的问题。旧路径现在显式将该图层 ENU 世界方向用 czm_viewRotation 变到眼空间；GPU 使用保留的 modelMatrix，二者采用同一局部坐标基。ENU modelMatrix 由宿主场景自动统一到眼空间，着色器不写死地理坐标或特定相机。

数据填入复用的 staging 数组，绘制时才 copyFrom；同一绘制前多次 update 合并为最新一帧。CPU 仍做求解、泡沫输运、岸边延拓、验证与数组复制；GPU 负责水面位移、法线和着色。本实验不声称 GPU 求解，也未做相邻水动力帧的 GPU 时间插值。

## 兼容与生命周期

默认依然为 Primitive。GPU 目前只验证 Cesium 1.132 / WebGL2 / 浮点纹理 / 至少两个顶点纹理单元 / 三维模式；超过纹理尺寸或缺少适配能力会降级。只要提供 barriers（包括溃口），当前便走旧路径，避免跨墙顶水位不连续面错误连面。运行中上传或编译失败也会在渲染遍历结束后释放 GPU 资源并切回旧路径，`fallbackReason` 可查询原因；显式再次设置 gpu 可尝试重新启用。

私有访问集中在 `dynamic-surface.ts`：Scene.context、Context._gl / 能力标志、Buffer、VertexArray、Texture、Sampler、ShaderProgram、DrawCommand、Pass、RenderState，FrameState.commandList / passes / mode，以及借用 Material.update / _uniforms。`_fragmentShaderText` 仅用于开发诊断。公开 API 不返回这些对象。Cesium 升级需要重新验证；不是跨版本兼容承诺。

适配器拥有 VBO、VAO、两张状态纹理和着色程序引用；不拥有传入的 Material、Viewer、地形、灯光或相机，不创建额外 framebuffer。图层负责其 Material、点集合和地面等现有资源。切换后端或进入分析视图会移除动态水面；多个图层独立，先销毁宿主也可随后安全销毁图层。拾取沿用旧路径的禁用行为。

计数中 `textureUploads` 表示成对状态上传次数，`bytesUploaded` 是这两张纹理的数据量，不是 GPU 时间；GPU 资源计数以当前后端实例为单位，切换会重新开始。`legacyMeshBuilds` 是图层累计值。24×48 案例每次状态上传 36 KiB，重复顶点静态数据约 101 KiB。尚无跨设备 FPS 或 GPU 时间基准，因此只确认消除了逐帧几何创建，不宣称固定帧率提升。

## 原理依据与验证

2026-10-16：107项相关单测、flood类型检查、生产构建、GPU动态实验浏览器验收和原water-flow-lab浏览器回归通过。

顶点纹理采样驱动网格位移采用成熟的 VTF 思路，参考 [GPU Gems 2 第 18 章](https://developer.nvidia.com/gpugems/gpugems2/part-ii-shading-lighting-and-shadows/chapter-18-using-vertex-texture-displacement)；此处高度来自成果而非该章的海浪模型，未复制其源码。Cesium 的 [Primitive 文档](https://cesium.com/learn/cesiumjs/ref-doc/Primitive.html) 明确已绘制后替换 geometryInstances 不生效，因此动态路径使用局部版本适配器而不是修改公开属性冒充动态几何。

本机 Chrome / WebGL2 / ANGLE RTX 5070 D3D11 的验收包括：

- 0、10、35、60、120、180 s，传播、停流、出流与质量守恒；约注入420 m³，180 s 剩余14.6 m³，水量误差小于10⁻⁸ m³。
- 近景、远景各10/35/60/120 s 的水深配色几何对照，平均RGB差异最大0.143/255；全干帧差异0；详细材质35 s近远景平均RGB差异分别约0.019和0.0013。该比较验证位置和边界一致性，不等于最终画质验收。
- 120次持续更新不增加几何/纹理数、不重复编译；缺少流速、开关视觉参数不改变计算成果。
- inactive洞、湿干阈值的浮点舍入、输入拒绝、持久staging缓冲由单测覆盖。
- 多图层销毁、分析视图切换、宿主先销毁、挡墙/能力不足/注入上传故障/二维场景自动降级由浏览器覆盖。

浏览器报告与近远景截图输出到 `test-results/flood-dynamic`（不提交）；`pnpm smoke:flood-dynamic`，按现有脚本约定支持 PLAYWRIGHT_MODULE_PATH、PLAYWRIGHT_EXECUTABLE_PATH、WATER_FLOW_BASE_URL。单测 `pnpm exec vitest run src/flood src/water`，类型 `pnpm exec vue-tsc -p tsconfig.flood.json --noEmit`，构建 `pnpm build`。
