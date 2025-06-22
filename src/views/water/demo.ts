// 水面反射效果演示
import { WaterSurface } from './WaterSurface';
// 由于原始文件结构复杂，直接从原文件导入
// import WaterSurface from './water';

// 声明Cesium全局类型
declare global {
  interface Window {
    Cesium: any;
  }
}

// 初始化Cesium场景
async function initWaterDemo() {
  const Cesium = (window as any).Cesium;
  
  // 创建Cesium viewer
  const viewer = new Cesium.Viewer("cesiumContainer", {
    infoBox: false,
    fullscreenButton: false,
    vrButton: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    navigationHelpButton: false,
    navigationInstructionsInitiallyVisible: false,
    animation: false,
    baseLayerPicker: false,
    terrainProvider: await Cesium.createWorldTerrainAsync(),
  });

  // 隐藏版权信息
  viewer._cesiumWidget._creditContainer.style.display = "none";
  viewer.scene.globe.depthTestAgainstTerrain = true;
  viewer.scene.debugShowFramesPerSecond = true;

  // 定义水面多边形位置
  const waterPositions = [
    Cesium.Cartographic.fromDegrees(-75.59967741159785, 40.04091766662355, 76.37856662343563),
    Cesium.Cartographic.fromDegrees(-75.59955207631664, 40.036827420667116, 71.6963743893841),
    Cesium.Cartographic.fromDegrees(-75.59376378325359, 40.0367060679407, 83.98039248519758),
    Cesium.Cartographic.fromDegrees(-75.5936186712503, 40.03959922674249, 82.13316846253008),
    Cesium.Cartographic.fromDegrees(-75.59550520685805, 40.04082628776817, 84.00794582002823),
  ];

  // 加载3D瓦片集
  try {
    const tileset = await Cesium.Cesium3DTileset.fromUrl("/tiles/40866/tileset.json");
    viewer.scene.primitives.add(tileset);
    viewer.zoomTo(tileset);
  } catch (error) {
    console.warn("无法加载3D瓦片集:", error);
  }

  // 水面配置选项
  const waterSurfaceOptions = {
    scene: viewer.scene,
    positions: waterPositions,
    height: 81,
    rippleSize: 100,
    waterColor: Cesium.Color.fromCssColorString("#001e0f"),
    waterAlpha: 0.9,
    reflectivity: 0.3,
    sunShiny: 100,
    distortionScale: 3.7,
    normalMapUrl: "/img/waterNormals.jpg"
  };

  // 创建水面反射效果
  const waterSurface = new WaterSurface(waterSurfaceOptions);

  // 控制参数
  const waterControls = {
    波纹大小: 50,
    透明度: 0.9,
    反射率: 0.3,
    扭曲: 3.7,
    高度: 81,
  };

  // 更新水面属性的函数
  function updateWaterProperties(): void {
    waterSurface.rippleSize = waterControls.波纹大小;
    waterSurface.waterAlpha = waterControls.透明度;
    waterSurface.reflectivity = waterControls.反射率;
    waterSurface.distortionScale = waterControls.扭曲;
    waterSurface.height = waterControls.高度;
  }

  // 初始化水面属性
  updateWaterProperties();

  // 如果需要GUI控制，可以添加lil-gui
  // const gui = new GUI();
  // gui.add(waterControls, "波纹大小").min(0).max(300).onChange(updateWaterProperties);
  // gui.add(waterControls, "透明度").min(0).max(1).onChange(updateWaterProperties);
  // gui.add(waterControls, "反射率").min(0).max(1).onChange(updateWaterProperties);
  // gui.add(waterControls, "扭曲").min(0).max(8).onChange(updateWaterProperties);
  // gui.add(waterControls, "高度").min(70).max(100).onChange(updateWaterProperties);

  return {
    viewer,
    waterSurface,
    updateWaterProperties,
    waterControls
  };
}

export { initWaterDemo }; 