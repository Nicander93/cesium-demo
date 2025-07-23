<template>
  <div id="cesiumContainer">
    <div class="control-panel">
      <label for="visibilitySlider">显示数量: <span id="visibilityCount">10000</span></label>
      <input id="visibilitySlider" type="range" min="0" max="10000" value="10000" step="100"
        @input="handleSliderChange" />
    </div>
  </div>
</template>

<script setup lang="ts">
import * as Cesium from 'cesium'
import { onMounted, ref } from 'vue';

const currentVisibilityCount = ref(10000);
const updateVisibilityFunction = ref<((count: number) => void) | null>(null);
let debounceTimer: number | null = null;

// 滑动条变化处理函数
const handleSliderChange = (event: Event) => {
  console.log('handleSliderChange called');

  const target = event.target as HTMLInputElement;
  const count = parseInt(target.value);
  currentVisibilityCount.value = count;

  console.log('Slider value:', count);

  // 更新显示的数量文本
  const countElement = document.getElementById('visibilityCount');
  if (countElement) {
    countElement.textContent = count.toString();
  }

  // 使用防抖来避免频繁更新
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    console.log('Debounced update triggered, count:', count);
    console.log('updateVisibilityFunction available:', !!updateVisibilityFunction.value);

    // 控制primitive的显示隐藏
    if (updateVisibilityFunction.value) {
      updateVisibilityFunction.value(count);
    } else {
      console.log('updateVisibilityFunction is null!');
    }
  }, 16); // 约60fps的更新频率
};

onMounted(async () => {
  const viewer = new Cesium.Viewer('cesiumContainer');
  // 打开FXAA抗锯齿
  viewer.scene.postProcessStages.fxaa.enabled = true;
  viewer.scene.globe.depthTestAgainstTerrain = true;
  let p = [110.0, 30.0];
  let fillInstances = [];
  let outlineInstances = [];

  for (let i = 0; i < 10000; i++) {
    // 计算网格位置：从左到右，从上到下
    const gridSize = 100; // 100x100的网格
    const row = Math.floor(i / gridSize); // 行号 (0-99)
    const col = i % gridSize; // 列号 (0-99)

    // 计算经纬度偏移，形成网格
    const centerLon = p[0] - 0.05 + (col * 0.001); // 从左到右
    const centerLat = p[1] + 0.05 - (row * 0.001); // 从上到下

    // 创建填充多边形几何体
    const polygonGeometry = Cesium.PolygonGeometry.fromPositions({
      positions: [
        Cesium.Cartesian3.fromDegrees(centerLon - 0.0005, centerLat - 0.0005, 0),
        Cesium.Cartesian3.fromDegrees(centerLon + 0.0005, centerLat - 0.0005, 0),
        Cesium.Cartesian3.fromDegrees(centerLon + 0.0005, centerLat + 0.0005, 0),
        Cesium.Cartesian3.fromDegrees(centerLon - 0.0005, centerLat + 0.0005, 0)
      ],
      height: 0,
      // extrudedHeight: 50 + Math.random() * 100
    });

    // 填充多边形实例
    const fillInstance = new Cesium.GeometryInstance({
      geometry: polygonGeometry,
      id: "PolygonFillGeometry" + i,
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromRandom({ alpha: 0.8 })),
        show: new Cesium.ShowGeometryInstanceAttribute(true),
      }
    });
    fillInstances.push(fillInstance);

    // 创建边框几何体
    const outlineGeometry = Cesium.PolygonOutlineGeometry.fromPositions({
      positions: [
        Cesium.Cartesian3.fromDegrees(centerLon - 0.0005, centerLat - 0.0005, 0),
        Cesium.Cartesian3.fromDegrees(centerLon + 0.0005, centerLat - 0.0005, 0),
        Cesium.Cartesian3.fromDegrees(centerLon + 0.0005, centerLat + 0.0005, 0),
        Cesium.Cartesian3.fromDegrees(centerLon - 0.0005, centerLat + 0.0005, 0)
      ],
      height: 0
    });

    // 边框几何体实例（白色）
    const outlineInstance = new Cesium.GeometryInstance({
      geometry: outlineGeometry,
      id: "PolygonOutlineGeometry" + i,
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.WHITE.withAlpha(0.9)),
        show: new Cesium.ShowGeometryInstanceAttribute(true)
      }
    });
    outlineInstances.push(outlineInstance);
  }

  // 使用普通Primitive渲染填充面（为了支持hover效果）
  // 修改GroundPrimitive配置
  const fillPrimitive = new Cesium.GroundPrimitive({
    geometryInstances: fillInstances,
    appearance: new Cesium.PerInstanceColorAppearance({
      flat: true,
    }),
    allowPicking: true,
    releaseGeometryInstances: false,
  });
  const supportsFragmentCulling = Cesium.GroundPrimitive.supportsMaterials(viewer.scene);
  console.log('Supports fragment culling:', supportsFragmentCulling);

  // 在GeometryInstance中添加pickColor属性
  fillInstances.forEach((instance, i) => {
    instance.attributes.pickColor = Cesium.ColorGeometryInstanceAttribute.fromColor(
      Cesium.Color.fromHsl(i / 10000, 1.0, 0.5)
    );
  });

  // 修改拾取逻辑
  const setupHoverEffect = () => {
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((event) => {
      const picked = viewer.scene.pick(event.endPosition);
      if (picked && picked.primitive === fillPrimitive) {
        const color = picked.color;
        const instanceId = Math.round(
          Cesium.Color.hue(color) * 10000
        );
        console.log('Found instance ID:', instanceId);
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  };

  // 使用普通Primitive渲染边框
  const outlinePrimitive = new Cesium.Primitive({
    geometryInstances: outlineInstances,
    appearance: new Cesium.PerInstanceColorAppearance({
      flat: true,
      translucent: true  // 启用透明度支持
    })
  });

  viewer.scene.primitives.add(fillPrimitive);
  viewer.scene.primitives.add(outlinePrimitive);

  // 等待Primitive准备完成后再添加hover效果
  let highlightedInstanceId: string | null = null;
  let originalColor: any = null;

  // 等待primitive ready
  const waitForPrimitive = () => {
    if (fillPrimitive.ready) {
      console.log('Fill primitive is ready, setting up hover effect');
      setupHoverEffect();
    } else {
      setTimeout(waitForPrimitive, 100);
    }
  };

  const setupHoverEffect = () => {
    // 鼠标移动事件处理
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    handler.setInputAction((event: Cesium.ScreenSpaceEventHandler.MotionEvent) => {

      const pickedObject = viewer.scene.pick(event.endPosition);

      let pickedInstanceId = null;
      let pickedPrimitive = null;

      if (pickedObject && pickedObject.primitive && pickedObject.id) {
        // 修改鼠标指针为pointer样式
        viewer.scene.canvas.style.cursor = 'pointer';
        pickedInstanceId = pickedObject.id;
        pickedPrimitive = pickedObject.primitive;
      }

      // 恢复之前高亮的实例
      if (highlightedInstanceId && originalColor && fillPrimitive.ready) {
        const attributes = fillPrimitive.getGeometryInstanceAttributes(highlightedInstanceId);
        if (attributes && attributes.color) {
          attributes.color = originalColor;
        }
        highlightedInstanceId = null;
        originalColor = null;
      }

      // 高亮当前悬停的实例
      if (pickedInstanceId && pickedPrimitive === fillPrimitive && fillPrimitive.ready) {
        highlightedInstanceId = pickedInstanceId;

        const attributes = fillPrimitive.getGeometryInstanceAttributes(pickedInstanceId);
        if (attributes && attributes.color) {
          // 保存原始颜色
          originalColor = [...attributes.color];

          // 设置高亮颜色（黄色）
          attributes.color = [255, 255, 0, 230]; // RGBA: 黄色，透明度0.9
        }
      } else {
        viewer.scene.canvas.style.cursor = 'default';
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  };

  // 启动hover效果设置
  waitForPrimitive();

  // 添加调试信息
  console.log('Hover effect initialized');
  console.log('Fill primitive:', fillPrimitive);
  console.log('Outline primitive:', outlinePrimitive);

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(110.0, 30.0, 50000),
    duration: 0
  });

  // 更新primitive可见性的函数
  const updatePrimitiveVisibility = (visibleCount: number) => {
    console.log('updatePrimitiveVisibility called with count:', visibleCount);

    if (!fillPrimitive.ready || !outlinePrimitive.ready) {
      console.log('Primitives not ready yet');
      return;
    }

    console.log('Starting visibility update...');

    // 使用更高效的方式：批量更新
    const totalInstances = 10000;

    // 预先获取所有属性，避免重复调用API
    const fillAttributesMap = new Map();
    const outlineAttributesMap = new Map();

    // 一次性获取所有属性
    for (let i = 0; i < totalInstances; i++) {
      const fillInstanceId = "PolygonFillGeometry" + i;
      const outlineInstanceId = "PolygonOutlineGeometry" + i;

      const fillAttributes = fillPrimitive.getGeometryInstanceAttributes(fillInstanceId);
      const outlineAttributes = outlinePrimitive.getGeometryInstanceAttributes(outlineInstanceId);

      if (fillAttributes && outlineAttributes) {
        fillAttributesMap.set(i, fillAttributes);
        outlineAttributesMap.set(i, outlineAttributes);
      }
    }

    console.log('Attributes collected, updating visibility...');

    // 批量更新show属性
    for (let i = 0; i < totalInstances; i++) {
      const fillAttributes = fillAttributesMap.get(i);
      const outlineAttributes = outlineAttributesMap.get(i);

      if (fillAttributes && outlineAttributes) {
        if (i < visibleCount) {
          // 显示
          fillAttributes.show = Cesium.ShowGeometryInstanceAttribute.toValue(true);
          outlineAttributes.show = Cesium.ShowGeometryInstanceAttribute.toValue(true);
        } else {
          // 隐藏
          fillAttributes.show = Cesium.ShowGeometryInstanceAttribute.toValue(false);
          outlineAttributes.show = Cesium.ShowGeometryInstanceAttribute.toValue(false);
        }
      }
    }

    console.log('Visibility update completed');
  };

  // 将updatePrimitiveVisibility函数存储到ref中
  updateVisibilityFunction.value = updatePrimitiveVisibility;

  // 添加调试信息确认函数已设置
  console.log('updateVisibilityFunction set:', !!updateVisibilityFunction.value);
})
</script>

<style scoped>
.control-panel {
  position: absolute;
  top: 20px;
  left: 20px;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 15px;
  border-radius: 8px;
  z-index: 1000;
  min-width: 250px;
}

.control-panel label {
  display: block;
  margin-bottom: 10px;
  font-size: 14px;
}

.control-panel input[type="range"] {
  width: 100%;
  margin-top: 5px;
}

#visibilityCount {
  font-weight: bold;
  color: #4CAF50;
}
</style>