<template>
  <div id="CesiumContainer" />
</template>

<script setup lang="ts">
import * as Cesium from 'cesium';
import { onMounted } from 'vue';
import * as dat from 'lil-gui';

onMounted(() => {
  const viewer = new Cesium.Viewer('CesiumContainer', {
    shouldAnimate: true,
    contextOptions: {
      requestWebgl2: true
    }
  });

  // 云噪声纹理
  let detailMap: any;

  const pro = Cesium.Resource.fetchArrayBuffer({
    url: "textures/体积云demo/texture.bin" // 64*64*64, 存储的是3d噪声纹理
  }).then((data: ArrayBuffer) => {
    const uintData = new Float32Array(data);
    const size = 64;
    
    if (viewer.scene.context) {
      detailMap = new (Cesium as any).Texture3D({
        width: size,
        height: size,
        depth: size,
        context: viewer.scene.context,
        pixelFormat: Cesium.PixelFormat.RGBA,
        pixelDataType: Cesium.ComponentDatatype.FLOAT,
        source: {
          width: size,
          height: size,
          arrayBufferView: uintData,
        },
        sampler: new (Cesium as any).Sampler({
          minificationFilter: Cesium.TextureMinificationFilter.LINEAR,
          magnificationFilter: Cesium.TextureMagnificationFilter.LINEAR,
        }),
      });
      console.log(data, detailMap);
    }
  });

  const arr = [pro];
  const dim = new Cesium.Cartesian3(1, 1, 1);

  const geometry = Cesium.BoxGeometry.fromDimensions({
    vertexFormat: Cesium.VertexFormat.POSITION_AND_ST,
    dimensions: dim,
  });

  const primitiveModelMatrix = Cesium.Matrix4.multiplyByTranslation(
    Cesium.Transforms.eastNorthUpToFixedFrame(
      Cesium.Cartesian3.fromDegrees(
        124.21936679679918,
        45.85136872098397
      )
    ),
    new Cesium.Cartesian3(0.0, 0.0, 80.0),
    new Cesium.Matrix4()
  );

  Promise.all(arr).then(() => {
    const fragmentShaderSource = `
      // #version 300 es
      precision mediump sampler3D;
      #define epsilon 0.0001
      uniform sampler3D map;
      in vec3 vOrigin;
      in vec3 vDirection;
      out vec4 color;
      uniform float threshold;
      uniform float steps;

      vec2 hitBox(vec3 orig, vec3 dir) {
        const vec3 box_min = vec3(-0.5);
        const vec3 box_max = vec3(0.5);
        vec3 inv_dir = 1.0 / dir;
        vec3 tmin_tmp = (box_min - orig) * inv_dir;
        vec3 tmax_tmp = (box_max - orig) * inv_dir;
        vec3 tmin = min(tmin_tmp, tmax_tmp);
        vec3 tmax = max(tmin_tmp, tmax_tmp);
        float t0 = max(tmin.x, max(tmin.y, tmin.z));
        float t1 = min(tmax.x, min(tmax.y, tmax.z));
        return vec2(t0, t1);
      }

      float sample1(vec3 p) {
        return texture(map, p).r;
      }

      vec3 normal(vec3 coord) {
        if (coord.x < epsilon) return vec3(1.0, 0.0, 0.0);
        if (coord.y < epsilon) return vec3(0.0, 1.0, 0.0);
        if (coord.z < epsilon) return vec3(0.0, 0.0, 1.0);
        if (coord.x > 1.0 - epsilon) return vec3(-1.0, 0.0, 0.0);
        if (coord.y > 1.0 - epsilon) return vec3(0.0, -1.0, 0.0);
        if (coord.z > 1.0 - epsilon) return vec3(0.0, 0.0, -1.0);
        
        float step = 0.01;
        float x = sample1(coord + vec3(-step, 0.0, 0.0)) - sample1(coord + vec3(step, 0.0, 0.0));
        float y = sample1(coord + vec3(0.0, -step, 0.0)) - sample1(coord + vec3(0.0, step, 0.0));
        float z = sample1(coord + vec3(0.0, 0.0, -step)) - sample1(coord + vec3(0.0, 0.0, step));
        return normalize(vec3(x, y, z));
      }

      void main() {
        vec3 rayDir = normalize(vDirection);
        vec2 bounds = hitBox(vOrigin, rayDir);
        if (bounds.x > bounds.y) discard;
        bounds.x = max(bounds.x, 0.0);
        vec3 p = vOrigin + bounds.x * rayDir;
        vec3 inc = 1.0 / abs(rayDir);
        float delta = min(inc.x, min(inc.y, inc.z));
        delta /= steps;
        
        for (float t = bounds.x; t < bounds.y; t += delta) {
          float d = sample1(p + 0.5);
          if (d > threshold) {
            color.rgb = normal(p + 0.5) * 0.5 + (p * 1.5 + 0.25);
            color.a = 1.0;
            break;
          }
          p += rayDir * delta;
        }
        if (color.a == 0.0) discard;
      }
    `;

    const vertexShaderSource = `
      in vec3 position;
      in vec2 st;
      out vec3 vOrigin;
      out vec3 vDirection;
      void main() {
        vOrigin = czm_encodedCameraPositionMCHigh + czm_encodedCameraPositionMCLow;
        vDirection = position - vOrigin;
        gl_Position = czm_modelViewProjection * vec4(position, 1.0);
      }
    `;

    const viewModel = {
      steps: 200,
      threshold: 0.6
    };

    function updatePostProcess() {
      // 更新后处理效果
    }

    // 创建 dat.GUI 控制器
    const gui = new dat.GUI();
    gui.add(viewModel, 'threshold', 0, 1, 0.01).onChange(updatePostProcess);
    gui.add(viewModel, 'steps', 0, 300, 1).onChange(updatePostProcess);

    class VoxelPrimitive {
      private drawCommand: any;
      private modelMatrix!: Cesium.Matrix4;
      private geometry!: Cesium.BoxGeometry;
      private data: any;
      private halfdim!: Cesium.Cartesian3;
      private vertexarray: any;

      constructor(options: any) {
        if (Cesium.defined(options)) {
          this.modelMatrix = options.modelMatrix;
          this.geometry = options.geometry;
          this.data = options.data;
          this.halfdim = new Cesium.Cartesian3();
          Cesium.Cartesian3.divideByScalar(options.dim, 2, this.halfdim);
        }
      }

      createCommand(context: any) {
        if (!Cesium.defined(this.geometry)) return;
        
        const geometry = Cesium.BoxGeometry.createGeometry(this.geometry);
        if (!geometry) return;
        
        const attributeLocations = Cesium.GeometryPipeline.createAttributeLocations(geometry);
        
        this.vertexarray = (Cesium as any).VertexArray.fromGeometry({
          context: context,
          geometry: geometry,
          attributes: attributeLocations
        });

        const renderState = (Cesium as any).RenderState.fromCache({
          depthTest: {
            enabled: true,
          }
        });

        const shaderProgram = (Cesium as any).ShaderProgram.fromCache({
          context: context,
          vertexShaderSource: vertexShaderSource,
          fragmentShaderSource: fragmentShaderSource,
          attributeLocations: attributeLocations
        });

        const uniformMap = {
          threshold: () => viewModel.threshold,
          steps: () => viewModel.steps,
          map: () => detailMap
        };

        this.drawCommand = new (Cesium as any).DrawCommand({
          boundingVolume: (this.geometry as any).boundingSphere,
          modelMatrix: this.modelMatrix,
          pass: (Cesium as any).Pass.OPAQUE,
          shaderProgram: shaderProgram,
          renderState: renderState,
          vertexArray: this.vertexarray,
          uniformMap: uniformMap
        });
      }

      update(frameState: any) {
        if (!this.drawCommand) {
          this.createCommand(frameState.context);
        }
        frameState.commandList.push(this.drawCommand);
      }
    }

    const options = {
      modelMatrix: primitiveModelMatrix,
      geometry: geometry,
      dim: dim
    };

    viewer.scene.primitives.add(new VoxelPrimitive(options));
  });

  viewer.trackedEntity = viewer.entities.add({
    name: "Yellow box outline",
    position: Cesium.Cartesian3.fromDegrees(124.21936679679918, 45.85136872098397, 80.0),
    box: {
      dimensions: dim,
      fill: false,
      outline: true,
      outlineColor: Cesium.Color.YELLOW,
    },
  });
});
</script>

<style scoped></style>