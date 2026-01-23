<template>
    <div id="cesiumContainer"></div>
</template>

<script setup lang="ts">
import * as Cesium from 'cesium';
import postProcessStage from './postProcess-mask';
import { onMounted, onUnmounted, ref } from 'vue';

const viewer = ref<Cesium.Viewer | null>(null);

onMounted(async () => {
    viewer.value = new Cesium.Viewer('cesiumContainer');
    viewer.value.scene.globe.depthTestAgainstTerrain = true;

    // 添加后处理阶段
    viewer.value.scene.postProcessStages.add(postProcessStage);

    // 飞到遮罩区域查看效果
    // postProcess-mask.ts 中定义的区域是 [120,30] 到 [120.5,30.5]
    viewer.value.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(120.25, 30.25, 50000)
    });
});

onUnmounted(() => {
    if (viewer.value) {
        viewer.value.scene.postProcessStages.remove(postProcessStage);
        viewer.value.destroy();
    }
});
</script>

<style scoped>
#cesiumContainer {
    width: 100%;
    height: 100%;
}
</style>
