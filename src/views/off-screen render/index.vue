<template>
  <div id="cesiumContainer" class="fullSize"></div>
  <canvas id="canvas" style="width:30%;position: absolute; z-index: 2; top: 50px; left: 50px;
  background-color: red;border:1px solid #000;"></canvas>
</template>

<script setup lang="ts">
import * as Cesium from 'cesium'
import { onMounted } from 'vue';
// 引入 Cesium 与 Vue 的生命周期钩子，在组件挂载后初始化三维场景

onMounted(() => {
  var viewer = new Cesium.Viewer("cesiumContainer")
  // 创建 Cesium Viewer 实例，渲染容器为模板中的 #cesiumContainer
  var framebuffer: any;
  function createResources(context: any) {
    var width = context.drawingBufferWidth;
    var height = context.drawingBufferHeight;
    // 获取绘制缓冲区尺寸，用于创建纹理大小
    // 创建离屏渲染所需的 Framebuffer，并配置颜色纹理与深度纹理
    framebuffer = new Cesium.Framebuffer({
      context: context,
      colorTextures: [
        new Cesium.Texture({
          context: context,
          width: width,
          height: height,
          pixelFormat: Cesium.PixelFormat.RGBA,
        }),
      ],
      depthTexture: new Cesium.Texture({
        context: context,
        width: width,
        height: height,
        pixelFormat: Cesium.PixelFormat.DEPTH_COMPONENT,
        pixelDatatype: Cesium.PixelDatatype.UNSIGNED_SHORT,
      }),
    });
  }

  /**
   * ================= 离屏渲染整体流程 =================
   * 1. createResources()  —— 申请 Framebuffer（颜色纹理 + 深度纹理）。
   * 2. update()           —— 手动执行 Scene 的渲染流程，交换若干内部私有字段，
   *                          并把 passState.framebuffer 指向自定义 FBO。
   * 3. preRender 回调    —— 每帧触发 update(); 之后用 readPixels 把 RGBA 数据
   *                          读回 CPU，绘制到 2D Canvas 实现预览。
   * ----------------------------------------------------
   * ⚠️ 注意：代码大量使用 _xxx 私有字段，仅供研究 Demo，
   *          生产环境需谨慎使用或自行实现 PostProcess 扩展。
   */
  function update(frameState: any) {
    // 手动驱动 Cesium Scene 的渲染流程，将结果写入自定义 framebuffer，实现离屏渲染
    let scene = viewer.scene;

    var frameState = scene._frameState;
    // _frameState 是 Cesium 内部的"本帧状态"聚合对象，包含相机、光照、Command 列表等

    var context = scene.context;
    // context 是对原生 WebGL 上下文的封装，提供 createTexture、readPixels 等高阶 API
    var us = context.uniformState;
    // uniformState 负责把常用矩阵、时间、光照等 uniform 推送到着色器

    var view = scene._defaultView;
    // _defaultView 保存当前相机视图相关的 viewport / passState 信息
    scene._view = view; // 覆盖 Scene 当前 view

    scene.updateFrameState(); // 重新计算相机矩阵、裁剪面等本帧数据

    frameState.passes.render = true; // 标记本帧需要执行普通渲染
    frameState.passes.postProcess = scene.postProcessStages.hasSelected; // 是否开启后处理

    scene.fog.update(frameState); // 雾效根据相机高度等参数更新

    us.update(frameState); // 将新的 frameState 统一写入 uniform

    scene._computeCommandList.length = 0; // 复位上一帧遗留的命令列表
    scene._overlayCommandList.length = 0;

    var viewport = view.viewport; // 当前视口矩形

    var passState = view.passState;
    // 将渲染目标重定向到自定义 framebuffer（核心）
    passState.framebuffer = framebuffer;
    passState.blendingEnabled = undefined;
    passState.scissorTest = undefined;

    passState.viewport = Cesium.BoundingRectangle.clone(viewport, passState.viewport); // 更新视口

    if (Cesium.defined(scene.globe)) {
      scene.globe.beginFrame(frameState); // 地形瓦片等开始帧准备
    }

    scene.updateEnvironment(); // 更新环境光 / 天空盒等全局渲染状态
    scene.updateAndExecuteCommands(passState, scene.backgroundColor); // 生成并执行 DrawCommands
    var commands = frameState.commandList;
    var length = commands.length;

    scene.resolveFramebuffers(passState); // 将多重渲染目标（MRT）resolve 到最终 FBO

    if (Cesium.defined(scene.globe)) {
      scene.globe.endFrame(frameState); // 地形瓦片收尾

      if (!scene.globe.tilesLoaded) {
        scene._renderRequested = true;
      }
    }
    context.endFrame(); // 通知 Cesium：本帧渲染完毕
  }

  setTimeout(() => {
    createResources(viewer.scene.context);
    viewer.scene.preRender.addEventListener((scene, time) => {
      // 每帧渲染前触发：调用 update 并将像素写入 2D Canvas。
      // readPixels 会得到自下而上的像素，需要在 putImageData 之前做方向翻转
      update(viewer.scene.frameState);
      var cavs = document.getElementById("canvas");
      let width = viewer.scene.context.drawingBufferWidth;
      let height = viewer.scene.context.drawingBufferHeight;
      cavs.width = width;
      cavs.height = height;
      var pixels = viewer.scene.context.readPixels({
        // 从自定义 framebuffer 读取指定矩形的像素
        x: 0,
        y: 0,
        width: width,
        height: height,
        framebuffer: framebuffer,
      });
      var ctx = cavs.getContext("2d");
      let imgData = new ImageData(new Uint8ClampedArray(pixels), width, height);
      ctx.putImageData(imgData, 0, 0, 0, 0, width, height)

    });
  }, 2000)
})


</script>

<style scoped></style>