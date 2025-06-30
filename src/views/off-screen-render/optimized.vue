<template>
  <div id="cesiumContainer" class="fullSize"></div>
  <canvas id="canvas" style="width:30%;position: absolute; z-index: 2; top: 50px; left: 50px;
  background-color: red;border:1px solid #000;"></canvas>
</template>

<script setup lang="ts">
import * as Cesium from 'cesium'
import { onMounted } from 'vue';

onMounted(() => {
  const viewer = new Cesium.Viewer("cesiumContainer");
  let framebuffer: any = null;
  let originalFramebuffer: any = null;

  function createFramebuffer(context: any) {
    const width = context.drawingBufferWidth;
    const height = context.drawingBufferHeight;

    framebuffer = new (Cesium as any).Framebuffer({
      context,
      colorTextures: [
        new (Cesium as any).Texture({
          context,
          width,
          height,
          pixelFormat: Cesium.PixelFormat.RGBA,
        }),
      ],
      depthStencilTexture: new (Cesium as any).Texture({
        context,
        width,
        height,
        pixelFormat: Cesium.PixelFormat.DEPTH_STENCIL,
        pixelDatatype: Cesium.PixelDatatype.UNSIGNED_INT_24_8,
      }),
    });
  }

  // 延迟执行，等待场景初始化完毕
  setTimeout(() => {
    const scene: any = viewer.scene;
    createFramebuffer(scene.context);

    // 1️⃣ preRender：切换到自定义 FBO
    scene.preRender.addEventListener(() => {
      const view = scene._defaultView;
      if (!view || !view.passState || !framebuffer) return;

      // 如窗口尺寸改变，重新创建 FBO
      const ctx = scene.context;
      const w = ctx.drawingBufferWidth;
      const h = ctx.drawingBufferHeight;
      const colorTexArr: any = framebuffer._colorTextures ?? framebuffer.colorTextures;
      if (colorTexArr && colorTexArr[0]) {
        const colorTex = colorTexArr[0];
        if (colorTex.width !== w || colorTex.height !== h) {
          if (framebuffer && typeof framebuffer.destroy === 'function' && !framebuffer.isDestroyed?.()) {
            framebuffer.destroy();
          }
          createFramebuffer(ctx);
        }
      }

      originalFramebuffer = view.passState.framebuffer; // 记录默认 FBO
      view.passState.framebuffer = framebuffer;          // 切换到离屏 FBO
    });

    // 2️⃣ postRender：读取像素并恢复默认 FBO
    scene.postRender.addEventListener(() => {
      const view = scene._defaultView;
      if (!view || !view.passState || !framebuffer) return;

      const ctx = scene.context;
      const width = ctx.drawingBufferWidth;
      const height = ctx.drawingBufferHeight;

      // readPixels 从自定义 FBO
      const pixels = ctx.readPixels({
        x: 0,
        y: 0,
        width,
        height,
        framebuffer,
      });

      // 绘制到 2D canvas
      const canvas = document.getElementById("canvas") as HTMLCanvasElement;
      if (canvas) {
        canvas.width = width;
        canvas.height = height;
        const ctx2d = canvas.getContext("2d");
        if (ctx2d) {
          const imgData = new ImageData(new Uint8ClampedArray(pixels), width, height);
          ctx2d.putImageData(imgData, 0, 0);
        }
      }

      // 恢复默认 FBO，保证正常显示
      view.passState.framebuffer = originalFramebuffer;
    });
  }, 2000);
});
</script>

<style scoped>
.fullSize {
  width: 100%;
  height: 100vh;
}
</style> 