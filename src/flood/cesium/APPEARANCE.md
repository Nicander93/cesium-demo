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
| waveStrength | 0–3，细波法线强度 | 1 / 0.65 |
| flowStrength | 0–3，随流速平流的法线细节强度 | 1 / 0.7 |

库默认 clear，保持原来的蓝绿色体色与深度衰减关系；实验页默认 muddy。预设是普通参数组合，不限制后续局部修改。恢复页面外观不会归零推演或改变泡沫开关、光照和入流工况。

colorDepth 控制原有颜色插值代理的衰减距离：各通道权重为 exp(-[3.5, 1.5, 1] * depth / colorDepth)。它没有标定光学意义，不能据此反推含沙量、浊度或实际能见度。黄褐色仅是浑水示例；洪水可因泥沙、河床和照明呈现不同颜色。GGX 分支会将这些 sRGB 体色与泡沫色转换到线性空间；反射颜色仍随视角与宿主照明变化。

waveStrength 和 flowStrength 仅改变法线，不改变水位、传播速度或供给的速度场。设为 0 可以移除对应法线影响，但不保证着色器执行成本下降；停用特效仍使用原有 visuals.flow / foam / particles 和 lighting 接口。粒子与泡沫独立开关，泡沫强度不再影响粒子透明度。

setAppearanceOptions 先完整校验再写入，非法输入抛错并保留旧值；未指定字段保留原值。opacity=0 隐藏水面及泡沫，粒子仍由 visuals.particles 单独控制；诊断视图保持不透明。

验证：appearance.spec.ts 检查参数边界、局部更新与副本；scripts/smoke-flood-appearance.mjs 使用真实地形，在固定近/远景中检查颜色切换、透明度、两种后端、诊断独立性、粒子独立性、资源计数与水动力帧不变，并保存图像供人工审阅。

页面同时开放已有 visuals.foamIntensity（0–1）和 visuals.foamLifetime（1–120 s）；泡沫颜色属于 appearance，泡沫的生成、消散与启停仍属于 visuals。运行浏览器验证使用 pnpm smoke:flood-appearance，可通过 PLAYWRIGHT_MODULE_PATH 与 PLAYWRIGHT_EXECUTABLE_PATH 指定已有运行时。

本轮本机验证：112 项水面与洪水测试、洪水类型检查、生产构建通过；Chrome / RTX 5070 WebGL2 上的外观验证、动态后端回归及真实地形光照回归通过。外观验证在模拟 120 s 的相同水动力帧上比较近/远景，切换外观前后水动力数组与水量统计完全一致，外观 setter 不增加几何创建、纹理上传或 shader 切换计数。截图记录效果变化，不替代人工视觉评价，也不代表水动力模型已标定。
