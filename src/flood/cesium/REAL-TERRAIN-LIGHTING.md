# 真实地形中的洪水光照验证

入口：`/flood-dynamic-lab?environment=real`。也可从页面“验证环境”切换到瑞士真实地形与影像。合成河道保留用于无网络诊断。页面默认启用新的微表面光照、关闭泡沫；图层 API 默认仍是 legacy，已有调用保持原行为。

这轮完成了真实环境接入、灯光响应和资源所有权验证。没有把工程精度、湿干边界画质或地形接水误差视为已经解决。

## 数据与工况

- 地形：[swisstopo Terrain Service](https://docs.geo.admin.ch/visualize-data/terrain-service.html)，Quantized Mesh；影像为同一官方 SWISSIMAGE WMTS 服务。无需 Ion Token，不复制凭据。
- 区域：劳特布龙嫩谷底，西南角 `[7.907, 46.575, 0]`，64×64 单元、8 m 间距，约512×512 m。
- 通过现有 `sampleTerrainGrid(provider, layout, { level: 17 })` 固定采样单元中心；相机 LOD 不会重写计算 DEM。显示仍使用宿主 TerrainProvider；未关闭深度测试来掩盖穿插。
- 假设入流默认80 m³/s，60 s停流，最长600 s。依据两端较低谷底选择南/北出口，在相反一端第3行的低处选取4个有效源单元。南/北之一开放，其余边界封闭；不修改实际采样高程制造河道。
- 本例的 source placement 是自动构造的内部入流源，不是实测泄洪设施、水位边界或真实洪水事件。没有实测河床、建筑阻水、桥洞、流速和校准水位。Provider 高程按其 Cesium 显示坐标解释，没有与水文数据标定垂直基准，不应作为工程成果导出。

真实数据加载失败会显示原因并停止生成水面，不以合成水面冒充已接入真实地形。影像瓦片错误单独显示。采样过程中切换、重建 Viewer 或离开页面会取消旧结果接收；不保证终止 Cesium 已发出的网络请求。

## 静水与动态水面对照

“假设泄洪推演”使用真实 DEM 驱动现有求解器。“静水光照对照”用最低点以上2 m的人工水位生成连通静水面，只检查相机、反射和材质；切换光照、镜头或在这个模式中调整动画时间不会推进求解器。恢复推演模式时按当前时间重新同步计算帧。

两者共用渲染器和原始光照参数。固定近景/远景对准计算域中部实际谷底，不通过镜头朝向保证每个角度都有太阳高光。先关闭泡沫评审材质，再单独判断泡沫来源，避免把白色覆盖与反射混为一谈。

## 可复用 API

```ts
const layer = createCesiumFloodLayer({
  viewer, grid, surfaceBackend: 'gpu', showGround: false,
  visuals: { foam: false, flow: true, particles: false },
  lighting: {
    model: 'microfacet', roughness: 0.32,
    specularIntensity: 1, environmentIntensity: 1, skyEnvironment: true,
  },
})
layer.update(frame)
layer.setLightingOptions({ roughness: 0.5, specularIntensity: 0 })
console.log(layer.getLightingDiagnostics())
layer.destroy()
```

| 原始参数 | API默认值 | 范围/作用 |
| --- | --- | --- |
| model | legacy | legacy / microfacet |
| roughness | 0.32 | 0–1，感知粗糙度；alpha=max(roughness²,0.0025) |
| specularIntensity | 1 | 0–4，仅缩放直接光高光 |
| environmentIntensity | 1 | 0–4，缩放间接反射与水色代理 |
| skyEnvironment | true | 生成大气环境；关闭后采用常量环境降级，仍可用场景BRDF LUT |

设置先整体校验，再更新材质，不重建水面几何。模型切换会创建/释放该层的环境资源；其他数值更新复用几何与状态纹理。`getLightingDiagnostics()` 区分环境可用、LUT可用和环境失败原因。没有性能档位或插件框架。

## 光照原理与边界

复用 `src/water/lighting.ts` 的GGX、相关Smith、Schlick和split-sum环境反射，原理来源见 [Filament](https://google.github.io/filament/main/filament.html) 和 [基础水面说明](../../water/LIGHTING.md)。共享函数增加显式bodyColor参数，基础水面仍传入原来的waterColor，洪水传入由水深衰减得到的既有水色代理。

法线、视线与宿主光方向统一到East/Up/-North环境基，直接光读取`czm_lightColorHdr`，不再用固定亮度叠加假高光。水面不必在离开反射方向时保持明亮。线性合成后，LDR输出编码一次，HDR输出交由宿主处理。页面的时间、太阳、灯光强度及地形照明设置属于本例宿主；图层API不会设置宿主灯光、相机、地形、底图、时钟或HDR。

间接光为大气环境，不包括真实地形、建筑或树木倒影。水色和泡沫仍是视觉近似，没有完成折射、体积散射、阴影接收或水下颜色模型。8 m DEM和湿干重建仍可造成轮廓粗糙、局部孔洞和地形穿插；不能以光照修正代替网格/求解正确性评审。

## 私有适配与资源所有权

继续使用已有Cesium 1.132 `WaterEnvironment`适配器，其私有访问集中于`src/water/environment.ts`；新增的洪水API不暴露GPU对象。每层独立持有环境manager和cubemap，Scene的BRDF LUT只借用。

本轮修复了一个初始化顺序问题：环境Pass可能早于水面第一次材质更新；直接把共享LUT放入Fabric纹理槽，会被首次sampler2D更新视作旧图像并销毁。现在先初始化材质的默认sampler缓存，再借用LUT。材质销毁仍解除借用槽位，不销毁Scene LUT或默认cubemap。实景切换、多层并存、legacy/microfacet反复切换和宿主先销毁均有实际浏览器验证。

## 验证记录

2026-10-16，Chrome + WebGL2 + ANGLE RTX5070 D3D11：

- `pnpm smoke:flood-real-lighting`：实际成功的地形441次、影像136次响应；近远景和静水GPU/Primitive对照；30/60/120/300/600 s传播、停流与出流，水量误差<10⁻⁷ m³。
- 直接光检查隐藏测试宿主的地球，以免地形变暗冒充水面响应，并将测试灯放在已知静水平面的镜面方向。入射强度0→2有可测响应；`specularIntensity=0`与零入射光结果一致。实景截图仍用固定太阳，测试灯只用于能量检查。
- 静水模式不推进求解器；光照/镜头/后端变化不修改水动力帧；镜头LOD变化不修改采样高程。
- 共享LUT存活与正确绑定、销毁另一图层、模型反复切换、实景/合成切换、地形503失败、宿主先销毁均通过，无正常流程渲染错误。
- 110项水面/洪水单测、flood类型检查、生产构建通过。原动态洪水GPU验收、基础水面27个GGX数值探针和32个角度的光照回归通过。

截图与报告：`test-results/flood-dynamic/real-lighting/`（本地产物，不提交）。该验证不等于最终视觉质量、工程水动力精度、跨GPU性能或真实地形倒影验收。

后续浑水体色增加可选的直接日光 Lambert 代理（appearance.bodyScattering）和深度透光参数，见 [外观 API](APPEARANCE.md)。上面的纯镜面直接光验证会显式关闭体色日光项，再单独验证体色响应。它不等价于完整体积散射或地形阴影接收。
