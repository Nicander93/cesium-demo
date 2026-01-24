<template>
    <div id="cesiumContainer"></div>
</template>

<script setup lang="ts">
import * as Cesium from 'cesium';
import { TextureMask } from './texture-mask';
import { onMounted, onUnmounted, ref } from 'vue';

const viewer = ref<Cesium.Viewer | null>(null);
const textureMask = ref<TextureMask | null>(null);



/**
 * 从GeoJSON中提取坐标点
 * 返回：
 * - positions: 合并后的所有点（用于遮罩区域计算）
 * - lines: 原始的多线段数据（用于边界线绘制）
 */
function extractPositionsFromGeoJSON(geojson: any): { positions: number[][], lines: number[][][] } {
    const lines: number[][][] = []; // 存储所有线段（保持原始结构）
    
    for (const feature of geojson.features) {
        const geometry = feature.geometry;
        
        if (geometry.type === 'MultiLineString') {
            for (const lineString of geometry.coordinates) {
                lines.push(lineString);
            }
        } else if (geometry.type === 'LineString') {
            lines.push(geometry.coordinates);
        } else if (geometry.type === 'Polygon') {
            lines.push(geometry.coordinates[0]);
        } else if (geometry.type === 'MultiPolygon') {
            for (const polygon of geometry.coordinates) {
                lines.push(polygon[0]);
            }
        }
    }
    
    // 合并所有点用于遮罩区域计算
    const positions: number[][] = [];
    for (const line of lines) {
        for (const coord of line) {
            positions.push([coord[0], coord[1]]);
        }
    }
    
    return { positions, lines };
}

/**
 * 计算边界中心点
 */
function calculateCenter(positions: number[][]): [number, number] {
    let sumLon = 0, sumLat = 0;
    for (const [lon, lat] of positions) {
        sumLon += lon;
        sumLat += lat;
    }
    return [sumLon / positions.length, sumLat / positions.length];
}

// 使用import.meta.url获取geojson路径
const geojsonUrl = new URL('./polygon.geojson', import.meta.url).href;

onMounted(async () => {
    viewer.value = new Cesium.Viewer('cesiumContainer');
    viewer.value.scene.globe.depthTestAgainstTerrain = true;
    // 开启Cesium抗锯齿（FXAA抗锯齿）
    viewer.value.scene.postProcessStages.fxaa.enabled = true;
    textureMask.value = new TextureMask(viewer.value);

    try {
        // 加载GeoJSON文件
        const response = await fetch(geojsonUrl);
        const polygonData = await response.json();
        
        // 从GeoJSON提取坐标
        const { positions, lines } = extractPositionsFromGeoJSON(polygonData);
        console.log(`加载了 ${positions.length} 个坐标点，${lines.length} 条线段`);

        // 计算中心点用于相机定位
        const [centerLon, centerLat] = calculateCenter(positions);

        textureMask.value.setMask({
            positions: positions,
            outlinePositions: lines, // 使用原始线段数据绘制边界线
            maxTextureSize:8192,
            metersPerPixel:3,
            color: 'rgb(2,26,79)',
            opacity: 0.9,
            textureSize: 2048,
            invert: true,
            outlineMode: 'primitive',
            outlineSwitchHeight: 200000,
            outlineHysteresis: 30000,
            outline: {
                show: true,
                color: '#39E09B',
                width: 4,
                opacity: 1.0
            },
            arcType: Cesium.ArcType.GEODESIC,
            clampToGround: true
        });

        viewer.value.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(centerLon, centerLat, 500000)
        });
    } catch (error) {
        console.error('加载GeoJSON失败:', error);
    }
});

onUnmounted(() => {
    if (textureMask.value) {
        textureMask.value.destroy();
    }
    if (viewer.value) {
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
