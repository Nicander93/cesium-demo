# 真实岸线距离融合

日期：2026-10-15。Cesium 1.132.0，基线提交 2eab04c。

## 选择与边界

当前 swisstopo 地形的已制图湖面近似平坦，sampleLakeDisplayHeight 只生成展示高程。不能由此推断湖底水深，再把颜色渐变称为真实浅水或吸收。

本轮采用官方 FOEN/BAFU 水域面外环，计算到真实岸线的水平距离，再降低交界处水面不透明度。目标与 Epic [DepthFade](https://dev.epicgames.com/documentation/unreal-engine/depth-material-expressions-in-unreal-engine) 所处理的透明物与不透明物交界接缝相近，但输入与度量不同：这里是制图边界的局部 ENU 水平距离，不是 UE 的屏幕深度差，没有移植 UE Shader。

仍使用原有配色、波纹与光照路径。真实地形页默认渐变宽度 8 m，局部泡沫默认关闭。静态岸线不随展示水位迁移；该能力不能作为洪水湿干演进或真实浅水模拟。

## 可复用入口

```ts
const water = new WaterSurface({
  scene: viewer.scene,
  positions: croppedWaterPositions,
  height: displayHeight,
  shoreline: fullMappedOuterRing, // Cartographic[]；裁剪之前的完整真实外环
  shoreFadeDistance: 8, // 水域内侧水平过渡宽度，米；0 关闭，最大 64
  foam: false,
})
water.setOptions({ shoreFadeDistance: 12 })
water.setOptions({
  foam: true,
  foamWidth: 8,
  foamIntensity: 0.35,
  foamSpeed: 0.3,
})
water.destroy()
```

shoreline 是构造输入，要求小范围、简单、无洞外环，可闭合或不重复末点；变更边界需重建实例。positions 可以是宿主裁剪后的显示域。不能将包含人为闭合边的裁剪环冒充真实岸线。未提供 shoreline 的既有调用保持原有路径，shoreFadeDistance 默认 0；mapped 模式 foamWidth 最大 64 m。

createWaterMaterial 也暴露 shoreFadeDistance，但单独材质不负责生成/管理边界遮罩；完整组合由 WaterSurface 完成。此轮没有新增 Viewer、Token、底图或相机要求，也没有增加 Cesium 私有 API 访问。

## 算法与正确性

1. 将完整边界投影到与水面相同的局部 ENU 平面，单位米。对每个像素中心 P 和线段 AB，计算 t=clamp(dot(P-A,B-A)/dot(B-A,B-A),0,1)，距离为 length(P-A-t\*(B-A))，取所有线段最小值；零长度边跳过。
2. 通过扫描线交点的偶奇规则判断内外，内部为正。交点采用半开 Y 区间，避免顶点双计数；相关边界约定参考 [Franklin 对点在多边形内测试的说明](https://wrfranklin.org/Research/Short_Notes/pnpoly.html)。此实现为扫描线距离场，没有复制该页面 C 程序。
3. 距离截断至 ±64 m，编码为 RG 两通道的 16 位无符号数。1024 最长边，像素中心采样；片元解码后线性插值。真实案例遮罩为 919×1024，约 1.50 m/像素，亚像素宽度的过渡无法保证准确。
4. alpha \*= smoothstep(0,shoreFadeDistance,signedDistance)。Canvas 第零行对应 ENU 南侧；显式处理 Fabric 的 flipY，GPU 测试覆盖两个方向。
5. 可选泡沫使用同一距离带与世界坐标噪声形成局部斑块。它是美术近似，不含浪涌、风向、流场或破碎判据。

只对完整真实外环求距离，因此人为裁剪边不会加入新的岸线。距离场使用裁剪水面包围盒外扩 64 m，但该包围盒仅决定纹理覆盖范围，不作为距离源。几何仍负责显示域裁剪；原先的通用 UV 裁剪渐隐保持原状，不等同本次岸线渐变。

## 资源与验证

- 遮罩在创建实例时生成一次，以标准 Fabric Canvas uniform 上传；安装版本 Material.js 按对象身份缓存 Canvas，参数与相机变化不重建遮罩。无需逐帧地形深度 Capture。
- 销毁时 Material 释放自有 GPU 纹理，并缩小 Canvas 以释放 CPU 位图；页面销毁已有 Viewer 与监听器。
- 95 项水面/洪水测试通过：包含解析矩形正负距离、反向环、凹多边形、饱和、裁剪边排除、参数原子校验及既有生命周期测试；water/flow-lab 类型检查、生产构建通过，保留已有大 chunk 提示。
- 真实 Chrome WebGL 中六组岸线探针，用实际不透明水面像素和背景像素独立计算 alpha 混合，最大误差 0.439 个色阶；阈值 4。
- 真实地形的固定湖岸镜头保存 0/8/16 m 对照，测试原生滑块、泡沫开关、持续相机切换和反射组合；几何一份，shoreFrames=0，没有浏览器错误。路由退出后开发接口移除。
- 已查看真实截图：8 m 过渡软化接缝，泡沫保持较弱且默认关闭。影像与地形在岸坡的拉伸、官方水域边界与地形的配准差异仍存在；本轮不宣称修复源数据误差或获得真实浅水。

运行 pnpm smoke:water-shoreline（先在 5198 启动 Vite；Playwright 和 Chrome 路径配置与其他 smoke 脚本一致）。证据位于被 Git 忽略的 test-results/water-flow-lab/shoreline/，含 gpu-smoke.json、真实 0/8/16 m 截图、泡沫截图及连续录像。

查看 water-real-terrain → 湖岸按钮 → 向下滚动到“真实岸线过渡”。渐变设为 0 可对照；8 为当前页面默认值。旧水面对照模式显式关闭新渐变与泡沫。最终视觉认可仍由用户判断。
