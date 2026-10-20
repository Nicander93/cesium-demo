# 洪水外观 API

外观与 FloodFrame 分离。颜色、透明度和波纹参数只写材质 uniform，不修改水深、流速、模拟时间、源项或地形；不上传新的状态纹理、不重建几何。Primitive 与 GPU 后端共用同一材质参数，水深/速度/泡沫诊断色标独立于外观。

```ts
import { createCesiumFloodLayer, getFloodAppearancePreset } from './flood/cesium'

const layer = createCesiumFloodLayer({
  viewer, grid,
  appearance: getFloodAppearancePreset('muddy'),
  lighting: { model: 'microfacet', roughness: 0.4 },
  visuals: { flow: true, foam: false, particles: true },
})
layer.update(frame)
layer.setAppearanceOptions({ shallowColor: '#a18758', deepColor: '#5c5038', opacity: 0.9 })
layer.setAppearanceOptions({ waveStrength: 0, flowStrength: 0 })
const appearance = layer.getAppearanceOptions() // 返回副本
layer.setAppearanceOptions(getFloodAppearancePreset('muddy'))
layer.destroy()
```

| 参数 | 范围 / 含义 | clear / muddy |
| --- | --- | --- |
| shallowColor | 浅水体色，sRGB #RRGGBB | #3d6b5c / #a18758 |
| deepColor | 深水体色，sRGB #RRGGBB | #092931 / #5c5038 |
| foamColor | 泡沫反照率颜色，sRGB #RRGGBB | #d1e0d4 / #d9d4bf |
| colorDepth | 0.01–100 m，色深过渡尺度 | 8.3333 / 0.7 |
| opacity | 0–1，乘到最终水面与泡沫透明度上 | 1 / 1 |
| opacityDepth | 0.001–100 m，达到约 63% 遮蔽的垂直水深 | 0.5 / 0.04 |
| bodyScattering | 0–1，直接日光体色近似权重，仅 GGX 分支 | 0 / 1 |
| waveStrength | 0–3，细波法线强度 | 1 / 0.65 |
| flowStrength | 0–3，随流速平流的法线细节强度 | 1 / 0.7 |

库默认 clear，保留蓝绿色体色；实验页默认 muddy。预设是普通参数组合，不限制后续局部修改。恢复页面外观不会归零推演或改变泡沫开关、光照和入流工况。

colorDepth 控制深浅水体色在线性空间中的统一权重 exp(-depth / colorDepth)。旧实现把清水 RGB 消光比例套在任意颜色预设上，会导致褐色在中间水深偏绿；现在不再对用户颜色施加固定波长比例。它没有标定光学意义，不能据此反推含沙量、浊度或实际能见度。黄褐色仅是浑水示例；洪水可因泥沙、河床和照明呈现不同颜色。GGX 分支会将这些 sRGB 体色与泡沫色转换到线性空间；反射颜色仍随视角与宿主照明变化。

waveStrength 和 flowStrength 仅改变法线，不改变水位、传播速度或供给的速度场。设为 0 可以移除对应法线影响，但不保证着色器执行成本下降；停用特效仍使用原有 visuals.flow / foam / particles 和 lighting 接口。粒子与泡沫独立开关，泡沫强度不再影响粒子透明度。

setAppearanceOptions 先完整校验再写入，非法输入抛错并保留旧值；未指定字段保留原值。opacity=0 隐藏水面及泡沫，粒子仍由 visuals.particles 单独控制；诊断视图保持不透明。

验证：appearance.spec.ts 检查参数边界、局部更新与副本；scripts/smoke-flood-appearance.mjs 使用真实地形，在固定近/远景中检查颜色切换、透明度、两种后端、诊断独立性、粒子独立性、资源计数与水动力帧不变，并保存图像供人工审阅。

页面同时开放已有 visuals.foamIntensity（0–1）和 visuals.foamLifetime（1–120 s）；泡沫颜色属于 appearance，泡沫的生成、消散与启停仍属于 visuals。运行浏览器验证使用 pnpm smoke:flood-appearance，可通过 PLAYWRIGHT_MODULE_PATH 与 PLAYWRIGHT_EXECUTABLE_PATH 指定已有运行时。

本轮本机验证：112 项水面与洪水测试、洪水类型检查、生产构建通过；Chrome / RTX 5070 WebGL2 上的外观验证、动态后端回归及真实地形光照回归通过。外观验证在模拟 120 s 的相同水动力帧上比较近/远景，切换外观前后水动力数组与水量统计完全一致，外观 setter 不增加几何创建、纹理上传或 shader 切换计数。截图记录效果变化，不替代人工视觉评价，也不代表水动力模型已标定。

## 浑水呈色修正

旧材质的浅水 alpha 固定约 0.4，即使 opacity=1 也大量透出绿色影像；直接日光又只产生镜面高光，体色仅接收天空光，离开高光方向后容易偏灰绿。现在用 1-exp(-depth/opacityDepth) 控制深度遮蔽，muddy 在约 0.16 m 已遮蔽 98%，退水薄层依旧平滑变透明。岸线覆盖仍独立处理，未提高或改写水深。

bodyScattering 给浑水的直接日光增加有界 Lambert 体色代理：linear(bodyColor) * lightColor * max(NdotL,0) / pi * (1-Fview) * bodyScattering。它与原天空体色、GGX 镜面项分开，specularIntensity=0 不会关闭体色日光；零入射光时不会自发光。clear 默认关闭该项。保留原 Fresnel 反射，不把倒影强制染褐。

这是对浑水体色的简化近似，不是体积散射积分或泥沙浓度模型；透光使用网格垂直水深，没有折射光路、视角光程、地形阴影接收或水下场景取样。主机制参考 [UE Single Layer Water](https://dev.epicgames.com/documentation/unreal-engine/single-layer-water-shading-model-in-unreal-engine) 对表面反射、介质透光与散射的区分；本实现没有移植 UE 多 Pass 管线。

实际验收增加 120 s 与 600 s 退水工况的固定近/远景：从隐藏水面前后的差异区域统计默认浑水的暖色像素，并保留截图人工检查；不要求所有视角的水都保持褐色，高光和掠射反射仍可呈天空色。另有独立直接日光探针验证镜面关闭后体色仍随日光变化，且零入射光时该项为零。

2026-10-18 实机复验：120 s 近/远景的可见水面差异区域中，暖色像素占比约 95% / 95%；600 s 退水近/远景约 93% / 93%。这是固定工况下的回归信号，不是任意照明和视角的呈色保证。新增直接日光探针通过，零入射日光时体色项差异为零；112 项测试、洪水类型检查、生产构建及动态后端回归通过。
