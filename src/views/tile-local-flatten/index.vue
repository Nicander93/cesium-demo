<template>
  <div id="CesiumContainer"></div>
</template>

<script setup lang="ts">
import * as Cesium from "cesium";
import { onMounted } from "vue";

onMounted(() => {
  const viewer = new Cesium.Viewer("CesiumContainer");

  Cesium.Cesium3DTileset.fromUrl(
    `https://data.mars3d.cn/3dtiles/qx-dyt/tileset.json`,
    {
      maximumScreenSpaceError: 2,
      cullRequestsWhileMovingMultiplier: 100,
      dynamicScreenSpaceError: true,
      preferLeaves: true,
      debugShowBoundingVolume: false,
      debugShowContentBoundingVolume: false,
    }
  ).then((tileset) => {
    viewer.scene.primitives.add(tileset);
    viewer.zoomTo(tileset);
    const positions = Cesium.Cartesian3.fromDegreesArrayHeights([
      108.95959, 34.220223, 105,
      108.95922, 34.220054, 105,
      108.95914, 34.219439, 105,
      108.95975, 34.219573, 105,
      108.95957, 34.219781, 105,
    ]);
    // 使用shaerSource的方式实现
    // const customShader = new Cesium.CustomShader({
    //   vertexShaderText: `
    //    void vertexMain(VertexInput vsInput, inout czm_modelVertexOutput vsOutput) {
    //        vec3 points[4];
    //        points[0] = vec3(${positions[0].x}, ${positions[0].y}, ${positions[0].z});
    //        points[1] = vec3(${positions[1].x}, ${positions[1].y}, ${positions[1].z});
    //        points[2] = vec3(${positions[2].x}, ${positions[2].y}, ${positions[2].z});
    //        points[3] = vec3(${positions[3].x}, ${positions[3].y}, ${positions[3].z});

    //        // 转到模型坐标系
    //        points[0] = (czm_inverseModel * vec4(points[0], 1.0)).xyz;
    //        points[1] = (czm_inverseModel * vec4(points[1], 1.0)).xyz;
    //        points[2] = (czm_inverseModel * vec4(points[2], 1.0)).xyz;
    //        points[3] = (czm_inverseModel * vec4(points[3], 1.0)).xyz;

    //        const int nCount = ${positions.length};
    //        vec2 p = vsOutput.positionMC.xy;

    //        // 射线法判断点是否在多边形内
    //        int nCross = 0;
    //        for (int i = 0; i < nCount; i++) {
    //            vec2 p1 = points[i].xy;
    //            vec2 p2;
    //            if (i < nCount - 1) {
    //                p2 = points[(i + 1)].xy;
    //            } else {
    //                p2 = points[0].xy;
    //            }

    //            if (p1.y == p2.y) continue;
    //            if (p.y < min(p1.y, p2.y)) continue;
    //            if (p.y >= max(p1.y, p2.y)) continue;

    //            float x = (p.y - p1.y) * (p2.x - p1.x) / (p2.y - p1.y) + p1.x;
    //            if (x > p.x) nCross++;
    //        }

    //        if (nCross % 2 == 1) {
    //            vsOutput.positionMC.z = 450.0;
    //        }
    //    }`,
    // });
    // tileset.customShader = customShader;

    // 使用Texture方式实现
    let transform = Cesium.Transforms.eastNorthUpToFixedFrame(tileset.boundingSphere.center);
    let inverse = Cesium.Matrix4.inverse(transform, new Cesium.Matrix4);
    const localPositions = [] as any;
    positions.forEach(p => {
      localPositions.push(Cesium.Matrix4.multiplyByPoint(inverse, p, new Cesium.Cartesian3()));
    })
    let rect1 = Cesium.BoundingRectangle.fromPoints(localPositions, new Cesium.BoundingRectangle());
    //长和宽
    let w = rect1.width;
    let h = rect1.height;
    let rect = new Cesium.Cartesian4(rect1.x, rect1.y, rect1.x + rect1.width, rect1.y + rect1.height);
    //定义用于画布的宽高
    let canvasWidth = w * 5;
    let canvasHeight = h * 5;
    //将经纬度数据坐标转换到画布的坐标系上 
    const canvasPoints = [] as any;
    localPositions.forEach(point => {
      canvasPoints.push({
        x: (point.x - rect.x) / w * canvasWidth,
        y: -(point.y - rect.w) / h * canvasHeight
      })
    })
    // 创建canvas进行图形绘制
    let canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;left:0px;top:0px;z-index:1000;transform: translateY(0px);"
    canvas.height = canvasHeight;
    canvas.width = canvasWidth;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    //第一个点开始
    let point = canvasPoints[0];
    ctx.moveTo(point.x, point.y);
    for (let i = 1; i < canvasPoints.length; i++) {
      point = canvasPoints[i];
      ctx.lineTo(point.x, point.y);
    }
    ctx.closePath();
    ctx.fillStyle = "#000";
    ctx.fill();
    document.body.appendChild(canvas);

    const customShader = new Cesium.CustomShader({
        vertexShaderText: ` 
       void vertexMain(VertexInput vsInput, inout czm_modelVertexOutput vsOutput) { 
           vec2 p= vsOutput.positionMC.xy;   
           if (p.x >= rect.x && p.x <= rect.z && p.y >= rect.y && p.y <= rect.w) {
             float w = rect.z - rect.x;
             float h = rect.w - rect.y;
             float s = (p.x - rect.x) / w;
             float t = (p.y - rect.y) / h; 
             vec4 color = texture(image, vec2(s,t));
             if(color.r<0.5){
                 vsOutput.positionMC.z=405.;  
             }
           }
       }`,
        uniforms: {
          rect: {
            type: Cesium.UniformType.VEC4,
            value: rect,
          },
          image: {
            type: Cesium.UniformType.SAMPLER_2D,
            value: new Cesium.TextureUniform({
              url: canvas.toDataURL(),
            }),
            minificationFilter: Cesium.TextureMinificationFilter.LINEAR,
            magnificationFilter: Cesium.TextureMagnificationFilter.LINEAR,
          },
        },
      });
      tileset.customShader = customShader;
  });
});
</script>

<style scoped></style>
