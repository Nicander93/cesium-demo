# 表面光照候选：GGX 与大气环境

状态：可切换实验，默认仍为 `legacy`。本轮解决太阳高光与倒影颜色耦合、常量环境缺少方向变化的问题；没有把“画面更暗”或“数值正确”当作高质量水面的验收结论。

## 使用与边界

```ts
const water = new WaterSurface({
  scene: viewer.scene,
  positions,
  height,
  lightingModel: 'microfacet',
  skyEnvironment: true,
  indexOfRefraction: 1.333,
  environmentIntensity: 1,
  roughness: 0.25,
  reflection: true,
})
water.setOptions({ roughness: 0.4, environmentIntensity: 0.8 })
water.setOptions({ lightingModel: 'legacy' })
water.destroy()
```

参数均属于 `src/water`，不读取 Vue、地名、固定相机、页面路径或截图亮度。`setOptions()` 不重建水面几何。四类水体预设以后可以共享这个光照候选，但洪水的非平面几何和计算数据不能只靠换预设实现。

| 参数                   | 默认值            | 含义                                                                  |
| ---------------------- | ----------------- | --------------------------------------------------------------------- |
| `lightingModel`        | `legacy`          | `microfacet` 启用本候选，仍使用既有波纹与岸线                         |
| `indexOfRefraction`    | 1.333             | 空气侧介电界面折射率，范围 [1, 2.5]，候选用它推导 F0                  |
| `skyEnvironment`       | true              | `WaterSurface` 是否生成大气环境；关闭后用 `environmentColor` 常量近似 |
| `environmentIntensity` | 1                 | 间接反射及水色代理的艺术强度，范围 [0, 4]，不改变太阳光强             |
| `roughness`            | 沿用当前参数/预设 | 感知粗糙度；微表面参数 alpha = max(roughness², 0.0025)，下限用于数值稳定                             |
| `specularIntensity`    | 沿用当前参数/预设 | 太阳高光强度；0 可单独检查环境反射                                    |
| `reflectionStrength`   | 沿用当前参数/预设 | 间接反射强度；0 不关闭太阳高光                                        |

候选忽略旧 `reflectivity`、`sunShiny`、`lightDirection` 和 `shadingMode` 的光照分支：F0 来自折射率、光方向来自宿主 `scene.light`、输出走一次预合成路径。旧模式保留原行为。`waterColor`、`environmentColor` 作为显示 sRGB 颜色输入，由候选解码后合成。

`createWaterMaterial()` 也接受候选参数，但单独的材质不持有 Scene，不会自动生成大气环境或采集场景反射，采用常量环境降级。无 ENU origin 的材质以几何法线构造局部基，视线与宿主光保持同一坐标系；`WaterSurface` 使用以水域中心建立的 ENU 基。

示例入口：`/water-real-terrain?lighting=microfacet`；页面“光照模型”可随时切回原效果。`/water?scene=calibration` 是无网络资产的算法校准场景。示例主动设置大气跟随 `SCENE_LIGHT`；模块不修改宿主的大气模式、相机、光源、HDR、底图或 Ion Token。

## 算法与来源

直接光使用 Trowbridge–Reitz / GGX 法线分布、Smith 高度相关遮蔽函数和 Schlick 菲涅耳近似：

```
F0 = ((ior - 1) / (ior + 1))²
F = F0 + (1 - F0) (1 - V·H)^5
Ldirect = Lhost × D_GGX × V_SmithCorrelated × F × max(N·L, 0)
```

空气到水的 IOR=1.333 时 F0≈0.02037。IOR=1 表示没有折射率界面，直接及间接反射都置零，避免 Schlick 的掠射近似仍产生反射。太阳光使用 `czm_lightColorHdr`，不会再乘上地形/建筑倒影颜色。太阳位置、相机位置和微表面法线共同决定高光；**不保证所有视角一样亮**。

间接光复用安装版 Cesium 的大气环境生成器、预滤波 cubemap、9 项球谐和 Scene BRDF LUT。环境采样按 `reflect(-V,N)`；cubemap 与水面都使用 East, Up, -North 基。安装版 `ConvolveSpecularMapFS` 的 mip 参数是 alpha，因此 LOD 使用 roughness² × maxLOD；BRDF LUT 的 y 坐标则使用感知 roughness。平面反射投影有效时替换 cubemap 样本，边缘平滑退回环境，不把两者重复相加。

具体参考：

- [Filament 实时材质模型](https://google.github.io/filament/main/filament.html)：GGX、相关 Smith、线性合成及 IBL。公式按标准模型实现，没有移植场景脚本。
- [PBRT 介电界面与折射率](https://pbr-book.org/4ed/Reflection_Models/Specular_Reflection_and_Transmission)；[微表面理论](https://pbr-book.org/4ed/Reflection_Models/Roughness_Using_Microfacet_Theory)。
- [UE Single Layer Water](https://dev.epicgames.com/documentation/en-us/unreal-engine/single-layer-water-shading-model-in-unreal-engine)：反射、折射和水体散射是不同环节；本轮没有声称实现它的体积水模型。
- 安装版 Cesium 1.132.0 / @cesium/engine 19.0.0：`DynamicEnvironmentMapManager`、`ConvolveSpecularMapFS`、`BrdfLutGeneratorFS`、Model 的 ENU 环境基转换，以及 Material sampler 的更新/销毁流程。代码行为以安装版为准。

## 颜色与物理近似

候选将显示色输入和 LDR 倒影解码到线性域，合成后在普通 LDR 目标上做一次 sRGB 编码；HDR 目标保留线性输出，交给宿主后处理。Cesium Material 的 emission 仅作为预合成颜色载体，避免再叠一遍 Phong。

以下限制仍然存在：

- 当前环境与平面倒影使用 LDR 纹理，不能恢复已截断的高亮辐射。通过 HDR 开关兼容测试不等于建立了完整 HDR 辐射标定。
- 水色项是受环境照亮的染色代理，采用 `(1 - envWeight)` 避免直接叠满颜色；它**不是**体积散射、Beer–Lambert 吸收或真实水下折射。仍缺少可信水深及水下颜色。
- 平面倒影的五点模糊是近似，不是严格 GGX 预积分；它仍受单平面投影、已加载瓦片和反射分辨率限制。
- 使用 Schlick 和 split-sum IBL 近似，不是精确介电 Fresnel 积分。艺术强度可以改变能量尺度，不承诺全模型能量守恒。
- 透明混合沿用 Cesium 当前通道。LDR 下的透明混合并非全程在线性域完成，不能据此声称完整颜色管线正确。
- 没有修改波谱或动态网格，重复波纹、距离尺度变化、地形数据接水误差、示例裁剪直边仍会影响视觉。

## 私有适配与资源所有权

高级环境只对 Cesium VERSION 1.132 系列开放，并检查浮点渲染支持。私有访问集中在 `environment.ts`，继承原有 `capture.ts` 的隔离边界：

| 访问                                                                     | 用途/所有权                                                      |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| manager 的 `update/reset`、dirty flags、compute command arrays           | 驱动并等待完整环境生成；相机变化不重置环境，宿主光变化才使其失效 |
| `radianceCubeMap`、`maximumMipmapLevel`、`sphericalHarmonicCoefficients` | 由每个水面自己的 manager 持有；本水面销毁时释放                  |
| FrameState camera/passes/mode/context uniformState                       | 只在主相机的 3D render pass 更新，跳过水面辅助反射相机           |
| `frameState.brdfLutGenerator`                                            | 初始化并借用 Scene 共享 LUT；水面绝不销毁此纹理                  |
| `material._textures`                                                     | 借用纹理绑定，销毁前解除；Fabric input 保持默认图像/cubemap ID   |

最后一项不可随意改成反复给 Fabric samplerCube 赋同一个 GPU 对象：Cesium 1.132 的 samplerCube updater 会销毁旧对象，造成跨帧使用已销毁纹理。LUT 也必须避免所有权转移。另一个已复现的边界是：`Material.destroy()` 只豁免默认二维纹理，却会销毁 `context.defaultCubeMap`。因此材质工厂对每个返回实例的销毁方法加保护，先解除这两个借用 sampler 槽位，再运行原销毁流程；即使从未开启候选环境的旧模式、独立 `createWaterMaterial()` 也受保护。不修改 Cesium 全局 prototype，普通自有法线纹理仍按原流程释放。浏览器检查包含第二个水面创建/销毁后第一个水面继续渲染。

环境不支持或生成失败时，记录 `environmentError` 并退回常量环境，不让异常中断 Viewer。错误锁定在该实例，重建实例后才重试；不自动高频重试。切回 legacy 或隐藏水面停止更新但保留缓存，`destroy()` 最终释放自己的资源。`getDiagnostics()` 提供 `environmentAvailable`、`brdfAvailable`、`environmentUpdates`、`environmentGenerations`、`environmentError`；updates 是调用数，不是生成次数或 GPU 用时。

多个水面目前各自生成环境，没有做共享环境池或插件调度。库不会创建 Viewer，也不会决定宿主的灯光设计。任意升级 Cesium、夜景、复杂后处理、不同硬件均需重新检查。

## 验证与实景结论

命令：`pnpm smoke:water-lighting`，需要本地开发服务，默认端口 5198。可用 `PLAYWRIGHT_MODULE_PATH` 与 `PLAYWRIGHT_EXECUTABLE_PATH` 指定 Playwright 和浏览器。报告、截图、视频写入忽略目录 `test-results/water-flow-lab/lighting`。

2026-10-16 的检查包括：

1. 27 个独立 CPU/GPU 直接光探针：3 个相机方向 × 3 个粗糙度 × 3 个折射率。CPU 用 lambda 形式的 Smith 公式独立计算，再经 sRGB 编码与浏览器像素比较。上一次完整运行最大误差 0.390/255 以内。只验证隔离后的直接光和 LDR 输出，不涵盖所有法线、光照、IBL 或水体物理。
2. 固定世界光源绕水面一周，32 个角度；31 个中心水面样本检查反射投影覆盖，1 个中心被参考盒遮挡，明确记录并跳过该像素。相机旋转不重建环境；不是要求像素亮度不变。
3. 主场景 HDR 开/关编译及状态恢复；环境开关与宿主光变化后的重新生成；两个水面共存并销毁其中一个；退出路由后无浏览器渲染异常。
4. 真实地形近景、反向、低角度的旧/新光照六张同参数截图；禁用直接高光和平面反射后单独检查大气环境；继续动画与相机移动。反射目标未按帧重新分配，几何仍为一次创建。

实景上，候选低角度保留了环境反射，太阳高光不会随倒影颜色消失；较陡角度比旧默认明显更暗，细节仍呈方向性重复纹理。不能据此判定所有角度优于旧模式，所以保持可选，等待用户视觉评审。下一项应围绕可见的重复波纹和尺度过渡建立固定远/近视角对照；水体深浅颜色需要真实深度资料，不能通过给某个角度补亮冒充。

报告记录实际浏览器及 WebGL renderer；本轮为 Chrome 的 WebGL2 / ANGLE D3D11，使用 NVIDIA GeForce RTX 5070。自动浏览器证据与用户电脑上的交互观感、GPU 性能验收分开，未完成湖面/水库/河道/洪水四种标准案例的统一视觉验收。

代码验证：水面与洪水 97 项单测通过（含独立材质借用纹理销毁回归）；water 与 flow-lab 类型检查通过；生产构建通过，保留现有大 chunk 提示。旧光照实验的 18 个数值探针和路由退出也单独回归，避免只验证候选路径。
