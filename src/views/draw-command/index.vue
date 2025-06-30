<template>
  <div id="cesiumContainer" class="fullSize"></div>
</template>

<script setup lang="ts">
import * as Cesium from 'cesium'
import { onMounted } from 'vue';

class MyPrimitive {
  public modelMatrix: Cesium.Matrix4;
  public drawCommand: any;
  public show: boolean;
  private _destroyed: boolean;

  constructor(modelMatrix: Cesium.Matrix4) {
    this.modelMatrix = modelMatrix || Cesium.Matrix4.IDENTITY.clone()
    this.drawCommand = null;
    this.show = true;
    this._destroyed = false;
  }

  /**
   * 创建 DrawCommand
   */
  createCommand(context: any) {
    var modelMatrix = this.modelMatrix;

    var box = new Cesium.BoxGeometry({
      vertexFormat: Cesium.VertexFormat.POSITION_ONLY,
      maximum: new Cesium.Cartesian3(250000.0, 250000.0, 250000.0),
      minimum: new Cesium.Cartesian3(-250000.0, -250000.0, -250000.0)
    });
    var geometry = Cesium.BoxGeometry.createGeometry(box);

    if (!geometry) {
      throw new Error('Failed to create geometry');
    }

    var attributeLocations = Cesium.GeometryPipeline.createAttributeLocations(geometry)

    var va = (Cesium as any).VertexArray.fromGeometry({
      context: context,
      geometry: geometry,
      attributeLocations: attributeLocations
    });

    // 使用新版本Cesium的shader语法
    var vertexShaderSource = `
    #version 300 es
    in vec3 position;
    uniform mat4 u_modelViewProjection;
    
    void main() {
        gl_Position = u_modelViewProjection * vec4(position, 1.0);
    }
    `;
    
    var fragmentShaderSource = `
    #version 300 es
    precision highp float;
    uniform vec3 u_color;
    out vec4 fragColor;
    
    void main() {
        fragColor = vec4(u_color, 1.0);
    }
    `;

    var shaderProgram = (Cesium as any).ShaderProgram.fromCache({
      context: context,
      vertexShaderSource: vertexShaderSource,
      fragmentShaderSource: fragmentShaderSource,
      attributeLocations: attributeLocations
    })

    var uniformMap = {
      u_modelViewProjection: function() {
        return context.uniformState.modelViewProjection;
      },
      u_color: function() {
        return Cesium.Color.GRAY;
      }
    }

    var renderState = (Cesium as any).RenderState.fromCache({
      cull: {
        enabled: true,
        face: Cesium.CullFace.BACK
      },
      depthTest: {
        enabled: true
      }
    })

    this.drawCommand = new (Cesium as any).DrawCommand({
      modelMatrix: modelMatrix,
      vertexArray: va,
      shaderProgram: shaderProgram,
      uniformMap: uniformMap,
      renderState: renderState,
      pass: (Cesium as any).Pass.OPAQUE
    })
  }

  /**
   * 实现Primitive接口，供Cesium内部在每一帧中调用
   */
  update(frameState: any) {
    if (!this.show || this._destroyed) {
      return;
    }
    
    if (!this.drawCommand) {
      this.createCommand(frameState.context)
    }
    if (this.drawCommand) {
      frameState.commandList.push(this.drawCommand)
    }
  }

  /**
   * 检查是否已被销毁
   */
  isDestroyed(): boolean {
    return this._destroyed;
  }

  /**
   * 销毁primitive
   */
  destroy(): void {
    if (this.drawCommand && this.drawCommand.shaderProgram) {
      this.drawCommand.shaderProgram.destroy();
    }
    this._destroyed = true;
  }
}

onMounted(() => {
  var viewer = new Cesium.Viewer('cesiumContainer');
  viewer.scene.globe.depthTestAgainstTerrain = true;

  var origin = Cesium.Cartesian3.fromDegrees(106, 26, 250000 / 2)
  var modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(origin)

  var primitive = new MyPrimitive(modelMatrix);
  viewer.scene.primitives.add(primitive)
})
</script>

<style scoped>
.fullSize {
  width: 100%;
  height: 100vh;
}
</style>