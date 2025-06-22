# Cesium 水面反射效果

这是一个修复后的 Cesium 水面反射效果实现，基于原始的反混淆代码进行了清理和优化。

## 修复内容

1. **代码结构优化**
   - 清理了混淆后的无用代码
   - 添加了完整的 TypeScript 类型声明
   - 规范化了函数和变量命名

2. **类型安全**
   - 添加了 `WaterSurfaceOptions` 接口
   - 为所有函数参数添加了类型注解
   - 使用 `declare global` 声明 Cesium 全局类型

3. **功能改进**
   - 保持了原有的水面反射功能
   - 优化了着色器代码格式
   - 改进了错误处理

## 主要文件

- `water.ts` - 主要的水面反射实现（包含原始混淆代码的修复版本）
- `WaterSurface.ts` - 独立的干净水面反射类实现
- `demo.ts` - 使用示例
- `README.md` - 此说明文件

## 使用方法

### 1. 基础使用

```typescript
// 引入 Cesium 和水面反射类
declare global {
  interface Window {
    Cesium: any;
  }
}

// 创建 Cesium viewer
const viewer = new window.Cesium.Viewer("cesiumContainer");

// 定义水面区域的位置点
const waterPositions = [
  window.Cesium.Cartographic.fromDegrees(-75.599, 40.040, 81),
  window.Cesium.Cartographic.fromDegrees(-75.599, 40.036, 81),
  window.Cesium.Cartographic.fromDegrees(-75.593, 40.036, 81),
  window.Cesium.Cartographic.fromDegrees(-75.593, 40.039, 81),
];

// 配置水面参数
const waterOptions = {
  scene: viewer.scene,
  positions: waterPositions,
  height: 81,
  rippleSize: 50,
  waterColor: window.Cesium.Color.fromCssColorString("#001e0f"),
  waterAlpha: 0.9,
  reflectivity: 0.3,
  sunShiny: 100,
  distortionScale: 3.7,
  normalMapUrl: "/img/waterNormals.jpg"
};

// 创建水面
const waterSurface = new WaterSurface(waterOptions);
```

### 2. 参数配置

```typescript
interface WaterSurfaceOptions {
  scene: any;                 // Cesium 场景对象
  positions: any[];           // 水面多边形顶点位置数组
  height: number;             // 水面高度
  flowDegrees?: number;       // 水流方向（度）
  normalMapUrl?: string;      // 法线贴图URL
  rippleSize?: number;        // 波纹大小
  waterColor?: any;           // 水面颜色
  waterAlpha?: number;        // 水面透明度
  reflectivity?: number;      // 反射率
  lightDirection?: any;       // 光照方向
  sunShiny?: number;          // 光照强度
  distortionScale?: number;   // 扭曲程度
}
```

### 3. 动态调整参数

```typescript
// 调整波纹大小
waterSurface.rippleSize = 100;

// 调整透明度
waterSurface.waterAlpha = 0.7;

// 调整反射率
waterSurface.reflectivity = 0.5;

// 调整扭曲程度
waterSurface.distortionScale = 5.0;

// 调整水面高度
waterSurface.height = 85;
```

## 注意事项

1. **Cesium 版本**
   - 确保 Cesium 已正确加载到全局 window 对象
   - 代码兼容 Cesium 1.95+ 版本

2. **纹理资源**
   - 需要提供水面法线贴图 (`waterNormals.jpg`)
   - 确保纹理文件路径正确

3. **性能考虑**
   - 水面反射会增加渲染负担
   - 在移动设备上可能需要降低参数设置

4. **地形兼容**
   - 开启地形深度测试：`viewer.scene.globe.depthTestAgainstTerrain = true`
   - 确保水面高度设置合理

## 常见问题

### Q: 水面不显示或显示异常
A: 检查以下项目：
- Cesium 是否正确加载
- 水面位置坐标是否正确
- 纹理文件是否可访问
- 控制台是否有错误信息

### Q: 反射效果不明显
A: 尝试调整以下参数：
- 增加 `reflectivity` 值
- 调整 `distortionScale` 值
- 检查光照设置

### Q: 性能问题
A: 可以尝试：
- 降低 `rippleSize` 值
- 减少水面多边形复杂度
- 在移动设备上降低纹理质量

## 技术原理

1. **反射渲染**
   - 使用虚拟相机渲染场景到纹理
   - 计算反射矩阵和裁剪平面

2. **着色器实现**
   - 片段着色器处理水面材质
   - 顶点着色器处理几何变换

3. **实时更新**
   - 每帧更新反射纹理
   - 动画化水面波纹效果

## 许可证

此代码基于原始反混淆代码修改，保持原有功能的同时提高了代码质量和可维护性。 