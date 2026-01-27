# 天地图三维地形示例

本示例演示如何在 Cesium 中加载天地图的影像底图、注记图层以及尝试加载地形服务。

## 关于 Token
天地图服务需要申请 Token (Key) 才能使用。
请访问 [天地图官网](http://lbs.tianditu.gov.cn/) 注册账号并申请 Key。
申请类型请选择“浏览器端”。

获取 Key 后，请替换界面上的输入框中的 Token，或者修改代码中的默认 Token。

## 关于地形 (Terrain)
天地图提供的三维地形服务 (`elv_c`) 采用的是经纬度投影的瓦片服务，通常可以通过以下方式加载：

1. **自定义 TerrainProvider**: 编写代码解析天地图特有的地形切片格式。
2. **使用插件**: 社区中有一些插件如 `cesium-plugin-tianditu` 可能支持直接加载。
3. **标准加载**: 如果天地图提供了标准 Quantized-Mesh 格式或 Heightmap 格式的服务，可以直接使用 `Cesium.CesiumTerrainProvider`。

本示例代码中为了演示完整性，提供了加载逻辑的框架。如果标准加载方式无效，建议使用 Cesium 官方地形或寻找专门的天地图地形插件。

## 参考资料
- [天地图三维服务文档](http://lbs.tianditu.gov.cn/docs/#/sanwei/)
