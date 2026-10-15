# 单次水面颜色合成实验

日期：2026-10-15。基线：0014ff0，Cesium 1.132.0。状态：工程验证通过；保留实验入口，未替换默认效果。

## 问题与实现依据

既有材质先计算光照、菲涅耳、倒影与高光，再把合成颜色赋给 material.diffuse。安装版本 Cesium 的 TexturedMaterialAppearanceFS.glsl 默认继续调用 czm_phong。因此，合成的倒影还会被通用光照改变。该问题同时存在于 legacy 与 multiscale 波纹，不能解释所有视觉差异。

参照 [Three.js r180 Water 源码](https://github.com/mrdoob/three.js/blob/r180/examples/jsm/objects/Water.js)：其水面合成结果直接作为片元颜色，再经过引擎的色调映射、颜色空间与雾处理。此次只借鉴这个职责边界，既有波纹和颜色公式不变。Three.js 为 [MIT 许可](https://github.com/mrdoob/three.js/blob/r180/LICENSE)，参考版本与仓库已安装版本一致。

Cesium 对照源码位于已安装 @cesium/engine 的 Source/Shaders/Appearances/TexturedMaterialAppearanceFS.glsl 与 Source/Shaders/Builtin/Functions/phong.js。前者选择 FLAT 或 Phong；后者将 diffuse 参与额外光照，再加 emission。候选将已经合成的水面颜色放入 emission，并将 diffuse、specular 归零。这里 emission 是预先着色颜色的输出载体，不是再叠加一份发光。

这不等同于完成物理水体着色。现有常量、漫反射与高光组合仍是艺术近似；F0=0.3 是原始场景参数，不因 Three.js 也采用类似参数就成为真实水体常数。尚未验证端到端线性颜色、HDR、场景深度、吸收、散射与折射。Epic 的 [Single Layer Water](https://dev.epicgames.com/documentation/en-us/unreal-engine/single-layer-water-shading-model-in-unreal-engine) 是后续职责划分参考，不能宣称本实验已实现该模型。

## API 与查看入口

WaterSurface 与 createWaterMaterial() 增加可选 shadingMode：

```ts
water.setOptions({ shadingMode: 'water-composite' }) // 实验：直接输出合成颜色
water.setOptions({ shadingMode: 'legacy-phong' }) // 默认：原始光照路径
```

切换只改变材质 uniform，保留 Primitive、材质和反射目标。无新增 Cesium 私有 API，不修改宿主光照、HDR、相机或后处理。额外输出路径仍经过宿主的后续渲染处理，不能直接等同 Three.js 的颜色空间结果。

- 固定参照：[water?scene=calibration](http://127.0.0.1:5198/cesium-demo/water?scene=calibration)，使用本地地面与三个倒影参照物，无网络地形/模型；提供近景、俯视、远景及颜色输出切换。
- 原始场景：[water](http://127.0.0.1:5198/cesium-demo/water)，也提供相同切换，原始默认参数保留。
- 固定参照场景主动关闭 HDR、雾、大气并固定相机/场景时间，这是示例宿主的实验条件，不是特效库对宿主的要求。参照物由页面创建并在退出时移除。

## 数值验证

通过真实 Chrome WebGL 渲染水面并读取截图像素；探针首先确认拾取对象是水面。平面法线、黑色水体色、关闭高光和实时反射，环境输入 E=(0.2,0.4,0.6)，光方向朝上。此时既有公式可化简为：

```text
B = (0.15, 0.15, 0.15)
R = 0.1 + 0.9 * E
F = [F0 + (1-F0)*(1-cos(theta))^5] * reflectionStrength
C = (1-F)*B + F*R
```

独立 CPU 参考由相机射线与局部法线计算 cos(theta)，不从 Shader 抄取最终像素。比较 C\*255 与 5×5 像素块中位数。F0=0 在斜视时仍有菲涅耳反射，不应错误地断言颜色一定等于 B。

近景 cos(theta)=0.276741：

| F0   | 反射强度 | 参考 RGB，0–255       | GPU RGB      |
| ---- | -------- | --------------------- | ------------ |
| 0    | 1        | 44.81, 53.89, 62.98   | 45, 54, 63   |
| 0.04 | 1        | 45.87, 56.43, 66.99   | 46, 56, 67   |
| 0.3  | 1        | 52.79, 72.92, 93.05   | 53, 73, 93   |
| 1    | 1        | 71.40, 117.30, 163.20 | 71, 117, 163 |
| 0.3  | 0        | 38.25, 38.25, 38.25   | 38, 38, 38   |
| 0.3  | 0.5      | 45.52, 55.58, 65.65   | 46, 56, 66   |

近景、俯视、远景共 18 组探针，最大误差 0.494，阈值为 2 个色阶。关闭反射的同一灰度探针，直接输出为 (38,38,38)，原始 Phong 路径为 (43,43,43)，证实额外光照的实际影响。

验证仅涵盖上述解析条件和分量输出，不是完整光学模型、HDR 或色彩管理正确性的证明。

## 运行与视觉结果

浏览器：155.0.8059.79。实际 WebGL 渲染器：ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 (0x00002F04) Direct3D11 vs_5_0 ps_5_0, D3D11)。

- 三组相机、两条路径共六张冻结截图；相机、波纹、颜色、反射预算、视觉时间完全一致，冻结帧像素差为零。
- 通过实际下拉框切换输出；持续播放并切换/拖动相机至少 16 秒，无浏览器错误，水面几何和反射目标创建数均为 1。退出 Vue 路由后开发接口移除，无渲染错误。资源恢复与销毁另由既有水面测试覆盖。
- 已人工查看近景、俯视、远景截图：候选主要改变明暗，倒影仍可读；密集细纹和远景观感并未因此解决。固定场景没有用于代表真实岸坡的几何，不能据此验收岸线融合。
- 原始模型场景补充对照：模型元数据已加载，但细节在等待窗口内未稳定。保存了加载状态和截图；未将该路径算作完成的视觉对照。
- 当前判断：输出实验成立，但尚不足以批准替换默认效果，也没有将四种水体案例标为完成。人工视觉验收仍待用户确认。

证据目录：test-results/water-flow-lab/optics/，包含 gpu-smoke.json、assembled-fragment.glsl、六张对照图及连续录像；该目录被 Git 忽略。original-scene.json 单独记录外部模型对照，不混入固定场景的通过结论。

```powershell
# 先在一个终端运行 pnpm dev --host 127.0.0.1 --port 5198
# 需可用 Playwright；非项目安装时通过 PLAYWRIGHT_MODULE_PATH 指定模块路径。
# 可通过 PLAYWRIGHT_EXECUTABLE_PATH 指定 Chrome 路径。
pnpm smoke:water-optics
```

本轮 91 项水面/洪水测试、water 与 flow-lab 类型检查、生产构建通过。构建保留既有大于 500 kB 的 chunk 提示。固定参照场景的帧率不能代表村落模型或真实地形性能。

## 下一项待讨论的实验

优先验证近远景波纹与反射的连续关系，避免继续仅增加波浪分量或对远景放大波纹。

参考 [Bruneton、Neyret、Holzschuch 的原始论文与实现入口](https://www-evasion.imag.fr/Publications/2010/BNH10/) 和 [NVIDIA GPU Gems 的水面模型章节](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models)。前者将无法解析的波浪细节转入法线/BRDF 的统计表示；这是研究方向，尚未移植实现，也不能把海洋的全部模型直接作为有限湖泊、河流或洪水的统一模型。

下一项预期产物应是一个可解释的湖面近远景案例：保留当前原始基线，明确波浪尺度与法线空间，先验证采样足迹、坡度统计及反射响应，再调默认配色。是否推进场景颜色/深度的吸收折射 Pass，应在该实验结果和 Cesium 输入可用性核实后决定。
