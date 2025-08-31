import * as Cesium from 'cesium'
import { Texture3D } from './Texture3D'

const fragmentShaderSource = `
// 设置高精度浮点数和3D采样器
precision highp float;
precision highp sampler3D;
#define epsilon 0.0001  // 定义很小的数值，用于边界检测

// 统一变量声明
uniform float slice_size;        // 切片大小
uniform sampler3D volumnTexture; // 3D体积纹理
uniform vec3 halfdim;            // 体积的一半尺寸
uniform float threshold;         // 密度阈值，用于确定表面位置
uniform float steps;             // 光线步进次数，控制采样精度

// 输出颜色
out vec4 color;

// 从顶点着色器接收的变量
in vec3 vOrigin;    // 光线起点（相机位置）
in vec3 vDirection; // 光线方向
in vec2 vst;        // 纹理坐标

/**
 * 从3D纹理中获取密度数据
 * @param apos 世界坐标位置
 * @returns 该位置的密度值（alpha通道）
 */
float getData(vec3 apos) {
    // 将世界坐标转换为纹理坐标（0-1范围）
    vec3 pos = apos / (halfdim * 2.0);
    return texture(volumnTexture, pos).a;
}

/**
 * 计算光线与包围盒的交点
 * 使用轴对齐包围盒（AABB）算法
 * @param orig 光线起点
 * @param dir 光线方向
 * @returns vec2(t0, t1) 其中t0是进入点，t1是离开点
 */
vec2 hitBox(vec3 orig, vec3 dir) {
    vec3 box_min = vec3(-halfdim);  // 包围盒最小点
    vec3 box_max = vec3(halfdim);   // 包围盒最大点
    vec3 inv_dir = 1.0 / dir;       // 光线方向的倒数，用于优化计算
    
    // 计算每个轴上的交点参数
    vec3 tmin_tmp = (box_min - orig) * inv_dir;
    vec3 tmax_tmp = (box_max - orig) * inv_dir;
    
    // 确保tmin <= tmax
    vec3 tmin = min(tmin_tmp, tmax_tmp);
    vec3 tmax = max(tmin_tmp, tmax_tmp);
    
    // 计算光线进入和离开包围盒的参数
    float t0 = max(tmin.x, max(tmin.y, tmin.z));  // 进入点
    float t1 = min(tmax.x, min(tmax.y, tmax.z));  // 离开点
    
    return vec2(t0, t1);
}

/**
 * 计算法线向量
 * 使用中心差分法计算梯度，或者处理边界情况
 * @param coord 纹理坐标
 * @returns 归一化的法线向量
 */
vec3 normal(vec3 coord) {
    // 处理边界情况，返回指向内部的法线
    if (coord.x < epsilon) return vec3(1.0, 0.0, 0.0);
    if (coord.y < epsilon) return vec3(0.0, 1.0, 0.0);
    if (coord.z < epsilon) return vec3(0.0, 0.0, 1.0);
    if (coord.x > 1.0 - epsilon) return vec3(-1.0, 0.0, 0.0);
    if (coord.y > 1.0 - epsilon) return vec3(0.0, -1.0, 0.0);
    if (coord.z > 1.0 - epsilon) return vec3(0.0, 0.0, -1.0);

    // 使用中心差分法计算梯度（法线）
    float step = 0.01;  // 差分步长
    float x = getData(coord + vec3(-step, 0.0, 0.0)) - getData(coord + vec3(step, 0.0, 0.0));
    float y = getData(coord + vec3(0.0, -step, 0.0)) - getData(coord + vec3(0.0, step, 0.0));
    float z = getData(coord + vec3(0.0, 0.0, -step)) - getData(coord + vec3(0.0, 0.0, step));

    return normalize(vec3(x, y, z));
}

void main() {
    // 光线追踪主函数
    
    // 1. 光线设置
    vec3 rayDir = normalize(vDirection);           // 归一化光线方向
    vec2 bounds = hitBox(vOrigin, rayDir);        // 计算光线与包围盒的交点
    
    // 2. 早期退出：如果光线不与包围盒相交，丢弃片段
    if (bounds.x > bounds.y) discard;
    bounds.x = max(bounds.x, 0.0);                // 确保起点在相机前方
    
    // 3. 初始化光线起点和步进参数
    vec3 p = vOrigin + bounds.x * rayDir;         // 光线起点
    vec3 inc = 1.0 / abs(rayDir);                // 各轴上的步进增量
    float delta = min(inc.x, min(inc.y, inc.z)); // 选择最小的步进值
    delta /= steps;                               // 根据steps参数调整步进大小
    
    // 4. 光线步进循环 - 核心算法
    for (float t = bounds.x; t < bounds.y; t += delta) {
        // 获取当前采样点的密度值
        float d = getData(p + halfdim);
        
        // 如果密度超过阈值，找到表面
        if (d > threshold) {
            // 计算颜色：法线信息 + 位置信息
            color.rgb = normal(p + 0.5) * 0.5 + (p * 1.5 + 0.25);
            // color = vec4(d);  // 可选：直接显示密度值
            color.a = 1.0;                         // 设置不透明度
            break;                                 // 找到表面后退出循环
        }
        
        // 沿光线方向步进到下一个采样点
        p += rayDir * delta;
    }
    
    // 5. 如果没有找到表面，丢弃片段
    if (color.a == 0.0) discard;
}
`

const vertexShaderSource = `
// 顶点着色器：处理顶点数据和相机信息

// 输入变量
in vec3 position;  // 顶点位置
in vec2 st;        // 纹理坐标

// 输出到片段着色器的变量
out vec3 vOrigin;     // 光线起点（相机位置）
out vec3 vDirection;  // 光线方向
out vec2 vst;         // 纹理坐标

void main() {
    // 获取相机位置（高精度）
    // Cesium使用双精度编码，需要组合高低位
    vOrigin = czm_encodedCameraPositionMCHigh + czm_encodedCameraPositionMCLow;
    
    // 计算从相机到顶点的方向向量
    vDirection = position - vOrigin;
    
    // 传递纹理坐标
    vst = st;

    // 计算最终的裁剪空间位置
    gl_Position = czm_modelViewProjection * vec4(position, 1.0);
}
`
class CustomPrimitive {
  drawCommand: any
  modelMatrix: any
  geometry: any
  data: any
  halfdim: any
  viewModel: any
  vertexarray: any
  texture: any
  size: number

  constructor(options) {
    this.drawCommand = undefined
    if (Cesium.defined(options)) {
      this.modelMatrix = options.modelMatrix
      this.geometry = options.geometry
      this.data = options.data
      this.halfdim = new Cesium.Cartesian3()
      Cesium.Cartesian3.divideByScalar(options.dim, 2, this.halfdim)
      this.viewModel = {
        steps: options.steps || 200,
        threshold: options.threshold || 0.6,
        size: options.size || 128,
      }
    }
  }
  createCommand(context) {
    if (!Cesium.defined(this.geometry)) return
    const geometry = Cesium.BoxGeometry.createGeometry(this.geometry)
    const attributelocations =
      Cesium.GeometryPipeline.createAttributeLocations(geometry)
    this.vertexarray = Cesium.VertexArray.fromGeometry({
      context: context,
      geometry: geometry,
      attributes: attributelocations,
    })
    const renderstate = Cesium.RenderState.fromCache({
      depthTest: {
        enabled: true,
      },
      cull: {
        enabled: false,
      },
    })
    const shaderProgram = Cesium.ShaderProgram.fromCache({
      context: context,
      vertexShaderSource: vertexShaderSource,
      fragmentShaderSource: fragmentShaderSource,
      attributeLocations: attributelocations,
    })
    const that = this
    const uniformmap = {
      slice_size() {
        console.log(that.viewModel.size)
        return that.viewModel.size
      },
      volumnTexture() {
        return that.getTexture(context)
      },
      halfdim() {
        return that.halfdim
      },

      threshold: function () {
        return that.viewModel.threshold
      },

      steps: function () {
        return that.viewModel.steps
      },
    }

    this.drawCommand = new Cesium.DrawCommand({
      boundingVolume: this.geometry.boundingSphere,
      modelMatrix: this.modelMatrix,
      pass: Cesium.Pass.OPAQUE,
      shaderProgram: shaderProgram,
      renderState: renderstate,
      vertexArray: this.vertexarray,
      uniformMap: uniformmap,
    })
  }
  getTexture(context) {
    if (!this.texture) {
      const texture_size = Math.ceil(Math.sqrt(this.data.length))
      this.texture = new Texture3D({
        width: this.viewModel.size,
        height: this.viewModel.size,
        depth: this.viewModel.size,
        context: context,
        flipY: false,
        pixelFormat: Cesium.PixelFormat.ALPHA,
        pixelDataType: Cesium.ComponentDatatype.fromTypedArray(this.data),
        source: {
          width: texture_size,
          height: texture_size,
          arrayBufferView: this.data,
        },
        sampler: new Cesium.Sampler({
          minificationFilter: Cesium.TextureMinificationFilter.LINEAR,
          magnificationFilter: Cesium.TextureMagnificationFilter.LINEAR,
        }),
      })
    }

    return this.texture
  }

  update(frameState) {
    if (!this.drawCommand) {
      this.createCommand(frameState.context)
    }
    frameState.commandList.push(this.drawCommand)
  }

  isDestroyed() {
    return false
  }
  /**
   * 更改视图模型参数
   * @param data 新的视图模型参数
   */
  change(data: any): void {
    this.viewModel = { ...this.viewModel, ...data }
  }
}

export default CustomPrimitive
