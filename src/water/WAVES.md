# 分散波列与连续远近过渡

2026-10-16；基于 Cesium 1.132.0。范围仅为基础水面的法线和过滤，不改变水色、反射捕获、岸线、网格或洪水求解器。没有新增性能配置。

## 使用与兼容

```ts
water.setOptions({
  waveModel: 'spectrum',
  waveLength: 48, // 米
  waveDirection: 55, // 从北顺时针的传播方向，度
  waveSpread: 35, // 方向分散范围，度；0 保留单一方向
  waveIrregularity: 0.35,
  waveStrength: 0.8,
  detailStrength: 0.35,
  roughness: 0.18,
})

water.setOptions({ detailStrength: 0 }) // 跳过四个细节波列
water.setOptions({ waveStrength: 0 }) // 跳过全部波列，使用平面法线
water.setOptions({ waveModel: 'multiscale' }) // 切回上一版作同条件对照
```

`legacy`、`multiscale` 两条旧算法均保留。`createWaterMaterial()`/`WaterSurface` 不传模型仍默认 `legacy`；`createWaterPreset('calm-lake'/'windy-lake')` 改用 `spectrum`，其余水体参数保持原值。页面“波纹算法”可切换，近景、远景按钮与验收镜头一致。

`normalMapUrl` 仍服务于旧两条算法；新算法自行生成法线，不读取该贴图。米制模型独立使用材质时，需要 `origin` 和逐帧 `updateWaterMaterialView()`；WaterSurface 自动完成。改变原始参数不重建水面几何，不改宿主时钟或相机。

## 本轮针对的问题

原多尺度算法的每个主尺度都包含同方向的强分量；细节又叠加旧平铺贴图，容易形成整齐长纹。旧相位噪声的空间导数未计入坡度，难以把法线解释为同一个明确波高函数的梯度。此外，原过滤主要衰减细波振幅，未解析的坡度能量直接丢失。

本轮将新算法作为独立 `waveModel` 值，保留旧算法以便同场景、同参数、同时间比较。没有用地名、相机高度阈值或视角补亮调整画面。

## 有限波列的模型

四个主频带，每带四个分量，加上四个细节分量，共 20 个。方向、波长和相位通过固定整数种子分散；不随相机随机重排。波长以米解释，传播方向用 ENU 的 East/North 分量表示。所有系数在创建或相关参数改变时计算，作为五个 mat4 上传，不按帧生成随机数。

对每个分量：

```
k = 2π / wavelength
omega² = 9.81 k
h(p,t) = (a/k) sin(kVector·p - omega t + phase)
∇h = a normalize(kVector) cos(kVector·p - omega t + phase)
```

这里 a 为坡度振幅。主频带内每个分量的振幅为 `0.05 / 1.35^band`，四个分量的期望坡度能量约对应上一版每尺度三个权重的总量；细节振幅为 `0.025 × detailStrength`。这是可视化有限波列，**没有采用经过测量标定的 Phillips/JONSWAP 能量谱，也没有实现 FFT 海洋**。

法线由同一波高函数的梯度归一化得到。实现采用深水色散关系，近岸浅水、破碎波、流场平流和几何位移均不在此模型内。原有 `waveSpeed` 继续缩放视觉时间，不能当作洪水实测流速。

## 过滤与粗糙度

对每个波分量，把世界米制像素导数投影到波矢：`phaseX = kVector·dPdx`，`phaseY = kVector·dPdy`。使用像素盒的高斯近似，并在相位步进 π/2 到 π 之间作平滑 Nyquist 衰减：

```
f = exp(-(phaseX² + phaseY²)/24)
    × (1 - smoothstep(π/2, π, max(abs(phaseX), abs(phaseY))))
resolved slope = f × original slope
unresolved slope variance += 0.5 a² (1 - f²)
```

在独立均匀相位的统计模型下，已解析与未解析部分的期望坡度方差相加保持不变。整体波纹强度的平方也作用于方差；细节关闭时不会贡献隐含方差。低于过滤阈值的余项跳过 cos，省略能量低于相应分量的 1e-8。

将丢失的方向性坡度方差总量简化为每轴一半，采用：

```
roughnessEffective = clamp(roughness⁴ + 0.5 varianceUnresolved, 0, 1)^(1/4)
```

新模式的直接 GGX、环境 mip、BRDF LUT 和既有平面倒影模糊共用该有效粗糙度。它是**方向性坡度到各向同性 GGX 的实用近似**，不等同于原论文的各向异性高斯 BRDF 积分，也不能承诺精确 GGX 能量守恒。可见法线的方差还会因投影、反射和离散像素而有残余混叠。

整个过渡由渲染像素的实际足迹驱动，适配视距、俯仰、FOV 与分辨率变化。没有设“离相机多少米突然换材质”，没有把远处细波放大来维持纹理存在感。

参考来源与实际采用范围：

- [GPU Gems 1, Effective Water Simulation from Physical Models](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models)：采用有限方向波列、波高导数法线和参数单位的基础思路。实现自行编写，没有移植其完整几何和法线贴图管线。
- [Bruneton, Neyret, Holzschuch, Real-time Realistic Ocean Lighting using Seamless Transitions from Geometry to BRDF](https://anato-data.inrialpes.fr/Publications/2010/BNH10/article.pdf)：采用未解析坡度方差进入反射模型的过渡原则；当前为有限波列与各向同性 GGX 近似，未复现整套海洋算法。
- [Filament 材质文档](https://google.github.io/filament/main/materials.html#anti-aliasing:specularantialiasing)：法线细节造成镜面混叠，需要在反射模型层考虑过滤；不把单纯淡出细法线视为完整镜面抗锯齿。

## 验证与同条件画面

`pnpm smoke:water-waves` 在默认 5198 服务上运行，支持既有 Playwright 模块/浏览器环境变量；产物在忽略目录 `test-results/water-flow-lab/wave-transition/`。它包含：

- 15 个 GPU 法线探针，CPU 对波高函数独立作中心有限差分；最大 RGB8 误差 0.547/255。
- 15 个 GPU 粗糙度探针，覆盖像素足迹 0、0.3、2、10、100 m；最大误差 0.504/255。隔离探针的基准粗糙度 0.12，在这些足迹下依次得到约 0.120、0.124、0.190、0.266、0.296，验证远处不只是把细波抹平。
- 原始零强度参数的 GPU 检查；数学单测检查确定性、米制缩放、方位旋转、色散关系和零方向分散。参数更新保留几何、材质和视觉时间，非法配置不部分生效。
- 固定参照场景近/远两镜头 × 新旧模型；真实地形近/中/远/反向四镜头 × 新旧模型，共 12 张同条件外观截图及法线/粗糙度诊断图。视觉时间固定在 15 s，光照、颜色和反射参数相同。
- 从近到远连续经过 40 个相机位置，动画继续，几何仍只创建一次、反射目标没有按帧重建；路由退出无渲染错误。

真实地形同一水域中心为 7.895°E、46.694°N：近景 heading=4.7、pitch=-0.3、range=350 m；远景 heading=4.7、pitch=-0.7、range=6000 m。这些坐标仅用于示例镜头，模块不读取它们。

本轮实景观察：新波列削弱了旧模型长条纹的整齐重复，近景仍保留风向纹理及山体倒影；远景细纹更克制，粗糙度诊断显示未解析能量有保留。有限分量仍可能产生拍频和方向性，不承诺绝对无重复。既有示例裁剪直边、偏暗水色和单平面倒影限制仍在。截图和数值通过不替代用户最终观感验收。

没有新增渲染 Pass 或 GPU 纹理。20 个分析波分量与旧算法的噪声/贴图开销不同，未承诺固定帧率增幅。关闭细节或整体波纹会真实跳过对应波列求值；其他反射/泡沫/环境开关沿用现有原始参数。

基础水面这一轮完成后，下一项为洪水模块的“持续泄洪 → 沿河传播 → 停流退水”。将首先核对已有求解、时序网格数据和动态渲染接口，保持计算与渲染分离；基础水面的波列不能替代流速驱动的洪水形态。

构建与验证：水面／洪水共 102 项单测、water 与 flow-lab 类型检查、生产构建通过，保留既有大 chunk 提示。超出 GPU 浮点可表示范围的波系数会在更新任何材质状态前拒绝。自动外观对照采用 1440×900、DPR=1；没有据此宣称完成跨设备画质或 GPU 帧耗时验收。

最终回归：原始参数外观脚本与光照脚本通过。参数脚本保留原先 1400 m 的多边形投影 ROI 镜头，350 m 新近景由本轮波纹脚本直接点击页面按钮验收。HDR 切换后等待环境实际就绪，取代固定 500 ms 等待；仍有 30 s 超时保护。

后续代码核对：`src/flood/core/dataset.ts` 已有独立的深度/东西向和北向流速帧；`FloodRenderer.update()` 目前会创建网格并移除、替换 Primitive。下一轮优先验证持续更新水面数据的路线，保持求解与渲染分离。既有洪水草稿保留在 stash，不混入此轮提交。
