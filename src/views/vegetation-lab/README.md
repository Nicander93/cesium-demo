# 真实地形植被种植

入口 `/vegetation-lab`。默认加载 swisstopo 真实地形与 SWISSIMAGE 影像，在阿尔卑斯山坡种植五种程序化示范植被：松树、阔叶乔木、白桦、灌木、草丛。松树使用真实针叶和树皮纹理。准备完成后种植 1000 株并切到近看。`?surface=synthetic` 或“合成性能基准”保留离线对照。

## 操作和地形

- 在复选框中勾选种类；单株、笔刷、框选和批量种植都从已选种类中等概率随机。勾选一种就是单一植被，取消全部勾选后不新增任何植株。选择变化不修改已有记录。
- 随机种子控制位置、种类、朝向和缩放；滑动普通参数不重置种子。整笔撤销/重做保存实际随机结果，JSON也保留每株种类。旧pine/broadleaf记录继续可导入。
- 单株点选地面，笔刷连续拖动，框选拖出矩形后释放，擦除删除半径内植被。每次拖动或批量操作对应一次撤销，保留最近 20 次编辑。
- 浏览模式恢复 Cesium 相机，滚轮始终可缩放；全景与近看恢复预设视角。
- 最小间距、密度和坡度限制候选点；坡度是高程网格估算，树干保持局部竖直。
- 展开“地形服务和位置”可填自己的 quantized-mesh terrain URL、经纬度和 XYZ 影像模板。影像可留空；地形服务需允许跨域且提供 Cesium terrain availability。切换区域会重新开始，可先导出保存。
- 真实地形加载失败会明确报错，不把合成高度标成真实地形。

`terrain.ts` 按 7.5 m 间距预采样 65 × 65 个地形高程点，供笔刷预览和坡度过滤。落点使用 `scene.globe.pick`，避免拾取树冠。新增/导入后每批最多 512 点调用 `sampleTerrainMostDetailed` 保存源地形高程。镜头稳定且 `globe.tilesLoaded` 后，以 ENU 竖直射线调用 `Globe.pick` 命中本帧实际选中的 terrain mesh，只为屏幕内树根计算运行时渲染偏移。这里不能用 `Globe.getHeight`：它可能读取未被本帧选中的缓存 child tile。偏移不写回 `Plant.z`，因此撤销、JSON 导入/导出仍使用 most-detailed 源高程；镜头变化后可按新的 mesh LOD 重算。树根校正按 1000 株分批，并合并到所属 GLB 分块重建。检查器同时用屏幕根点和相机射线 `globe.pick` 过滤遮挡，比较树根与当前实际地形网格，不复用放置用的高精采样器。

`planting.ts` 注入地形高度函数，维护空间哈希、确定性散布和历史。异步高程只应用到仍存在的原始对象，不覆盖删除、撤销或导入替换后的同 ID 对象。精校属于原始编辑，撤销重做保留精校高度。

## 树木与性能

`instancing.ts` 按 48 m 分块生成 glTF 2.0 GLB，通过 `EXT_mesh_gpu_instancing` 共享树干和叶片网格。近处使用分层枝条、树皮 UV 和双面透明松针卡片；远处使用同材质的简化枝叶网格，180/220 m 迟滞切换。按种类分组共享网格：松树用分层枝条和松针卡片；阔叶树用展开枝干和多个叶簇；白桦有浅色带纹树皮及疏朗树冠；灌木有贴地基茎和低矮枝簇；草丛用交叉叶片。各物种近远LOD都校验实际GLB的接地bounds、三角形面积和外向法线，草丛跳过空树干primitive。GLB 顶点保持 Y-up，Cesium 模型显式指定 `upAxis: Y`、`forwardAxis: X`，实例平移仍使用 `[x, z, -y]`；这避免 Cesium 默认 Z-forward 再施加轴修正，把实例水平位置旋转到相邻方位。

松针材质用 `alphaMode: MASK`，树皮有基础色和 OpenGL 法线。GLB 引用固定本地贴图 URI，不按分块内嵌图像。纹理来自 [Poly Haven Pine Tree 01](https://polyhaven.com/a/pine_tree_01)，采用 [CC0](https://polyhaven.com/license)。原文件、哈希、RGBA atlas 和转换脚本见 `public/vegetation-lab/pine_tree_01/README.md`。这是实景纹理的程序树，没有引入原始 1700 万面的整树模型。照明复用 GGX IBL，漫反射SH调整为方向性较弱的室外天空补光，不改变地形影像曝光。

叶片受光由 foliage-lighting.ts 的 PBR MODIFY_MATERIAL shader 控制。每个GLB primitive有 Float32 SCALAR 自定义属性 _FOLIAGE：树干=0、顶点色叶片=1、松针atlas叶片=2。仅松针做材质级线性色阶/轻微色调校准，原始贴图与alpha保持不变；叶片再增加随入射光变化、幅度封顶的薄叶透光近似，树干仍按常规PBR受光。这是实时显示近似，不是物理次表面散射。界面可关闭“自然叶片受光”对比。关闭直射及IBL后，开关画面相同，避免无光自亮。

模型使用 incrementallyLoadTextures=false，几何与贴图完整就绪后替换旧模型。Model.ready 默认可能先于纹理完成，不能把尚无贴图的白色/稀疏卡片当作稳定画面。共享CustomShader由本runtime唯一拥有，所有Model销毁后再销毁一次。SH系数原位更新以保留Cesium生成shader时捕获的数组引用。

| 物种 | 近景三角形/株 | 远景三角形/株 |
| --- | ---: | ---: |
| 松树 | 3494 | 380 |
| 阔叶乔木 | 1106 | 224 |
| 白桦 | 1188 | 224 |
| 灌木 | 672 | 170 |
| 草丛 | 54 | 27 |

这些是共享网格三角数；GPU实例化不会为每株复制一套CPU网格。混入更多种类会增加每块的primitive数量，仍需结合实际视点、设备与种植密度评估性能。

每帧最多启动 2 个脏块重建、4 个并发加载，替换后释放旧 Model。笔刷拖动、批量种植、mesh 根校正和相机移动期间会合并分块/LOD更新；优先等待地形瓦片加载队列完成，最多等 1.5 秒，然后允许源高程模型显示，避免 imagery 队列阻塞新树。已有模型会保留到替代模型加载完成。安定后每个受影响分块生成一次 GLB，避免上传马上被下一次编辑作废的模型。批量每帧处理最多 250 个目标，最多 50000 株；坡度、间距和面积限制实际数量。

树木阴影默认关闭。真实地形同视角对比中，`ENABLED` 会使约 43,193 个画布像素变暗；`CAST_ONLY` 与关闭模式像素相同，可避免叶片互相接收密集阴影，但该视角没有测到明显的树木投地阴影。用户可显式开启投射模式；自阴影双面接收模式仅保留作诊断，不作为默认。

界面显示实例/分块数、滚动 180 帧 FPS 与 P95。分块数不是 GPU draw-call 测量。真实地形导出 version=2 JSON，包含 terrain URL、经纬度和 ENU 原点椭球高程；导入要求同一区域和地形，必要时换算局部 z 并精校。合成基准兼容 version=1。

## 验证

```sh
pnpm exec vitest run src/views/vegetation-lab src/views/first-person-lab
pnpm run typecheck:practice-labs
pnpm run build
pnpm run smoke:practice-labs
pnpm run smoke:vegetation-terrain
node scripts/smoke-vegetation-selection.mjs
node scripts/smoke-vegetation-lighting.mjs
```

真实地形报告位于 `test-results/vegetation-terrain/report.json`，合成基准报告位于 `test-results/practice-labs/report.json`。当前版定向验收使用 `node scripts/smoke-vegetation-rendered-ground.mjs`，记录真实 terrain mesh 根差、mesh 偏移、按填充/相机/笔刷分阶段的重建数和陈旧上传数到 `test-results/vegetation-rendered-ground/report.json`。开发模式的 `window.__vegetationLab` 提供编辑、坐标和 `checkGrounding()`；生产不暴露调试接口。浏览器行为和贴地检查不代替用户对植被观感的验收。

参考：[Cesium Model](https://cesium.com/learn/cesiumjs/ref-doc/Model.html)、[Globe.pick](https://cesium.com/learn/cesiumjs/ref-doc/Globe.html#pick)、[GPU instancing](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Vendor/EXT_mesh_gpu_instancing)。

### 多选与发黑回归

smoke-vegetation-selection.mjs 驱动真实复选框、鼠标单株/连续笔刷、整笔撤销重做、五种批量、下载/文件导入，报告在 test-results/vegetation-selection/report.json。

smoke-vegetation-lighting.mjs 在同相机、同24株松树、完整贴图下对照原材质、室外漫反射、自然叶片受光以及全部模型灯光关闭。报告受影响像素亮度、近黑比例、纹理变化和背景差异，保存在 test-results/vegetation-lighting/report.json。VEGETATION_CAPTURE=1 可额外保存对照PNG。该合成场景用于明确材料/受光的贡献，不能代替真实山坡的主观观感；真实地形另运行 rendered-ground smoke。
