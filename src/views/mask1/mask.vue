<template>
    <div id="cesiumContainer"></div>
</template>

<script setup lang="ts">
import * as Cesium from 'cesium';
import { onMounted, ref, onUnmounted } from 'vue';
import { PolygonMask } from './primitive-mask';

const viewer = ref<Cesium.Viewer | null>(null);
const polygonMask = ref<PolygonMask | null>(null);

function extractRingsFromGeoJSON(geojson: any): number[][][] {
    const rings: number[][][] = [];

    const pushRing = (ring: any) => {
        if (!Array.isArray(ring) || ring.length < 3) return;
        const r: number[][] = [];
        for (const p of ring) {
            if (Array.isArray(p) && p.length >= 2) r.push([Number(p[0]), Number(p[1])]);
        }
        if (r.length >= 3) rings.push(r);
    };

    const walkGeom = (geom: any) => {
        if (!geom) return;
        if (geom.type === 'Polygon') {
            pushRing(geom.coordinates?.[0]);
            return;
        }
        if (geom.type === 'MultiPolygon') {
            for (const poly of geom.coordinates || []) pushRing(poly?.[0]);
            return;
        }
        if (geom.type === 'LineString') {
            pushRing(geom.coordinates);
            return;
        }
        if (geom.type === 'MultiLineString') {
            for (const line of geom.coordinates || []) pushRing(line);
            return;
        }
        if (geom.type === 'GeometryCollection') {
            for (const g of geom.geometries || []) walkGeom(g);
        }
    };

    if (geojson?.type === 'FeatureCollection') {
        for (const f of geojson.features || []) walkGeom(f.geometry);
    } else if (geojson?.type === 'Feature') {
        walkGeom(geojson.geometry);
    } else {
        walkGeom(geojson);
    }

    return rings;
}

function calcCenterFromRings(rings: number[][][]): [number, number] {
    let sumLon = 0;
    let sumLat = 0;
    let n = 0;
    for (const ring of rings) {
        for (const [lon, lat] of ring) {
            sumLon += lon;
            sumLat += lat;
            n++;
        }
    }
    return n ? [sumLon / n, sumLat / n] : [116.5, 40];
}

const geojsonUrl = new URL('./polygon.geojson', import.meta.url).href;

onMounted(async () => {
    viewer.value = new Cesium.Viewer('cesiumContainer');
    viewer.value.scene.globe.depthTestAgainstTerrain = true;
   // 设置Cesium的分辨率缩放比例为设备像素比
    viewer.value.resolutionScale = Number(window.devicePixelRatio);
     // 开启Cesium抗锯齿（FXAA抗锯齿）
    viewer.value.scene.postProcessStages.fxaa.enabled = true;
    polygonMask.value = new PolygonMask(viewer.value);

    try {
        const resp = await fetch(geojsonUrl);
        const geojson = await resp.json();
        const rings = extractRingsFromGeoJSON(geojson);
        const [centerLon, centerLat] = calcCenterFromRings(rings);

        const polygons: Cesium.Cartesian3[][] = [];
        for (const ring of rings) {
            if (!Array.isArray(ring) || ring.length < 3) continue;
            const degrees: number[] = [];
            for (const p of ring) degrees.push(p[0], p[1]);
            const cart = Cesium.Cartesian3.fromDegreesArray(degrees);
            if (cart.length >= 3) polygons.push(cart);
        }

        polygonMask.value.setMask({
            polygons,
            maskColor: Cesium.Color.fromCssColorString("rgb(2,26,79)").withAlpha(0.7),
            clampToGround: true,
            outline: {
                show: true,
                color: Cesium.Color.fromCssColorString('#39E09B').withAlpha(0.9),
                width: 2,
                clampToGround: true
            }
        });

        viewer.value.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(centerLon, centerLat, 800000)
        });
    } catch (e) {
        console.error('加载 polygon.geojson 失败', e);
    }
});

onUnmounted(() => {
    polygonMask.value?.destroy();
});
</script>