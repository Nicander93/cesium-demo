import * as Cesium from 'cesium'

const fragmentShaderSource = `
// #version 300 es
precision highp float;
precision highp sampler3D;
#define epsilon 0.0001
uniform float slice_size;
uniform sampler3D volumnTexture;
uniform vec3 halfdim;

uniform float threshold;

uniform float steps; 

in vec3 vOrigin;
in vec3 vDirection;
in vec2 vst;

out vec4 fragColor;

float getData(vec3 apos){
    vec3 pos=apos/(halfdim*2.);
    
    return texture(volumnTexture,pos).a;
}
vec2 hitBox( vec3 orig, vec3 dir ) {
    vec3 box_min = vec3( -halfdim );
    vec3 box_max = vec3( halfdim );
    vec3 inv_dir = 1.0 / dir;
    vec3 tmin_tmp = ( box_min - orig ) * inv_dir;
    vec3 tmax_tmp = ( box_max - orig ) * inv_dir;
    vec3 tmin = min( tmin_tmp, tmax_tmp );
    vec3 tmax = max( tmin_tmp, tmax_tmp );
    float t0 = max( tmin.x, max( tmin.y, tmin.z ) );
    float t1 = min( tmax.x, min( tmax.y, tmax.z ) );
    return vec2( t0, t1 );
}
vec3 normal( vec3 coord ) {
    if ( coord.x < epsilon ) return vec3( 1.0, 0.0, 0.0 );
    if ( coord.y < epsilon ) return vec3( 0.0, 1.0, 0.0 );
    if ( coord.z < epsilon ) return vec3( 0.0, 0.0, 1.0 );
    if ( coord.x > 1.0 - epsilon ) return vec3( - 1.0, 0.0, 0.0 );
    if ( coord.y > 1.0 - epsilon ) return vec3( 0.0, - 1.0, 0.0 );
    if ( coord.z > 1.0 - epsilon ) return vec3( 0.0, 0.0, - 1.0 );

    float step = 0.01;
    float x = getData( coord + vec3( - step, 0.0, 0.0 ) ) - getData( coord + vec3( step, 0.0, 0.0 ) );
    float y = getData( coord + vec3( 0.0, - step, 0.0 ) ) - getData( coord + vec3( 0.0, step, 0.0 ) );
    float z = getData( coord + vec3( 0.0, 0.0, - step ) ) - getData( coord + vec3( 0.0, 0.0, step ) );

    return normalize( vec3( x, y, z ) );
}

void main()
{
    vec3 rayDir = normalize(vDirection);
    vec2 bounds = hitBox(vOrigin, rayDir);

    if(bounds.x > bounds.y) discard;
    bounds.x = max(bounds.x, 0.0);

    vec3 p = vOrigin + bounds.x * rayDir;
    vec3 inc = 1.0 / abs(rayDir);
    float delta = min(inc.x, min(inc.y, inc.z));
    delta /= steps;

    // 累积颜色和透明度
    vec4 accumulated = vec4(0.0);
    
    for (float t = bounds.x; t < bounds.y; t += delta) {
        float density = getData(p + halfdim);
        
        if(density > threshold) {
            // 计算透明度，基于密度
            float alpha = (density - threshold) / (1.0 - threshold);
            alpha = clamp(alpha * 0.1, 0.0, 1.0); // 调整透明度强度
            
            // 计算颜色
            vec3 color = normal(p + 0.5) * 0.5 + (p * 1.5 + 0.25);
            
            // 颜色混合
            accumulated.rgb += color * alpha * (1.0 - accumulated.a);
            accumulated.a += alpha * (1.0 - accumulated.a);
            
            // 如果透明度接近1.0，提前退出
            if(accumulated.a >= 0.95) break;
        }
        
        p += rayDir * delta;
    }

    if(accumulated.a < 0.01) discard;
    
    fragColor = accumulated;
}
`
const vertexShaderSource = `
// #version 300 es
in vec3 position;
in vec2 st;

out vec3 vOrigin;
out vec3 vDirection;
out vec2 vst;

void main()
{    
  vOrigin=czm_encodedCameraPositionMCHigh+czm_encodedCameraPositionMCLow;
  vDirection=position-vOrigin;
  vst=st;

  gl_Position = czm_modelViewProjection * vec4(position,1.0);
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
      blending: {
        enabled: true,
        functionSourceAlpha: Cesium.BlendFunction.SOURCE_ALPHA,
        functionDestinationAlpha: Cesium.BlendFunction.ONE_MINUS_SOURCE_ALPHA,
        functionSourceRgb: Cesium.BlendFunction.SOURCE_ALPHA,
        functionDestinationRgb: Cesium.BlendFunction.ONE_MINUS_SOURCE_ALPHA,
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
      pass: Cesium.Pass.TRANSLUCENT,
      shaderProgram: shaderProgram,
      renderState: renderstate,
      vertexArray: this.vertexarray,
      uniformMap: uniformmap,
    })
  }
  getTexture(context) {
    if (!this.texture) {
      const texture_size = Math.ceil(Math.sqrt(this.data.length))
      this.texture = new Cesium.Texture3D({
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
   * @param data 新的视图模型参数
   */
  change(data: any): void {
    this.viewModel = { ...this.viewModel, ...data }
  }
}

export default CustomPrimitive
