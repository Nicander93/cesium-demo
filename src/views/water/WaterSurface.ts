import * as Cesium from 'cesium';
/**
 * 水面反射效果实现
 * 该文件实现了一个完整的水面反射系统，包括：
 * 1. 实时反射贴图生成
 * 2. 水面材质与法线贴图
 * 3. 光照计算（镜面反射、漫反射）
 * 4. 波浪动画效果
 */
declare global {
  interface Window {
    Cesium: typeof Cesium;
  }
}

/**
 * 水面材质着色器（Fragment Shader）
 * 这个着色器负责计算水面的最终颜色，包括：
 * - 反射效果：将场景渲染到纹理中作为反射
 * - 波浪动画：通过法线贴图和时间参数创建波浪效果
 * - 光照计算：计算太阳光的镜面反射和漫反射
 * - 菲涅尔效果：根据视角调整反射强度
 */
const waterMaterial = `
// 纹理采样器
uniform sampler2D reflexTexture;     // 反射贴图（场景的反射图像）
uniform sampler2D normalTexture;     // 法线贴图（用于生成波浪效果）
uniform float time;                  // 时间参数（用于动画）
uniform mat4 fixedFrameToEastNorthUpTransform; // 坐标变换矩阵

// 顶点着色器传入的变量
in vec4 v_worldPosition;             // 世界坐标位置
in vec4 v_uv;                        // UV坐标（用于反射贴图采样）

// 水面属性参数
uniform float size;                  // 波纹大小
uniform vec4 waterColor;             // 水的基础颜色
uniform float waterAlpha;            // 水的透明度
uniform float rf0;                   // 基础反射率（菲涅尔效果参数）
uniform vec3 lightDirection;         // 光照方向（太阳光方向）
uniform float sunShiny;              // 镜面反射强度
uniform float distortionScale;       // 反射扭曲程度

// 太阳光颜色（白光）
const vec3 sunColor = vec3(1.0);

/**
 * 生成波浪噪声函数
 * 通过对法线贴图进行多次不同参数的采样，并结合时间变化，
 * 创建复杂的波浪运动效果
 * @param normalMap 法线贴图
 * @param uv UV坐标
 * @return 合成的法线向量
 */
vec4 getNoise(sampler2D normalMap, vec2 uv) {
    // 四个不同的UV坐标采样，每个都有不同的缩放和时间偏移
    // 这样可以创建多层次的波浪效果
    vec2 uv0 = (uv / 103.0) + vec2(time / 17.0, time / 29.0);     // 大波浪
    vec2 uv1 = uv / 107.0 - vec2(time / -19.0, time / 31.0);      // 中等波浪
    vec2 uv2 = uv / vec2(8907.0, 9803.0) + vec2(time / 101.0, time / 97.0);  // 小波浪
    vec2 uv3 = uv / vec2(1091.0, 1027.0) - vec2(time / 109.0, time / -113.0); // 细节波浪
    
    // 叠加所有采样结果，创建复杂的波浪模式
    vec4 noise = texture(normalMap, uv0) +
        texture(normalMap, uv1) +
        texture(normalMap, uv2) +
        texture(normalMap, uv3);
    
    // 将结果映射到[-1, 1]范围（因为法线向量需要这个范围）
    return noise * 0.5 - 1.0;
}

/**
 * 太阳光照计算函数
 * 计算太阳光在水面上的镜面反射和漫反射效果
 * @param surfaceNormal 水面法线向量
 * @param eyeDirection 观察方向向量
 * @param shiny 镜面反射强度（光泽度）
 * @param spec 镜面反射系数
 * @param diffuse 漫反射系数
 * @param diffuseColor 漫反射颜色（输出参数）
 * @param specularColor 镜面反射颜色（输出参数）
 */
void sunLight(const vec3 surfaceNormal, const vec3 eyeDirection, float shiny, float spec, float diffuse, inout vec3 diffuseColor, inout vec3 specularColor) {
    vec3 sunDirection = normalize(lightDirection);  // 标准化太阳光方向
    
    // 计算反射向量：光线在表面的反射方向
    vec3 reflection = normalize(reflect(-sunDirection, surfaceNormal));
    
    // 计算视线方向与反射方向的夹角余弦值
    float direction = max(0.0, dot(eyeDirection, reflection));
    
    // 镜面反射：使用Phong光照模型，pow函数控制高光的锐利程度
    specularColor += pow(direction, shiny) * sunColor * spec;
    
    // 漫反射：兰伯特光照模型，光照强度与法线和光线方向夹角余弦成正比
    diffuseColor += max(dot(sunDirection, surfaceNormal), 0.0) * sunColor * diffuse;
}

/**
 * 材质主函数 - Cesium材质系统的入口点
 * 这是着色器的核心函数，计算水面的最终外观
 */
czm_material czm_getMaterial(czm_materialInput materialInput) {
    // 获取默认材质作为基础
    czm_material material = czm_getDefaultMaterial(materialInput);

    // 将UV坐标从[0,1]范围转换到[-1,1]范围，便于后续计算
    vec2 transformedSt = materialInput.st * 2.0 - 1.0;
    
    // 获取波浪法线噪声，size参数控制波浪的大小
    vec4 noise = getNoise(normalTexture, transformedSt * size);
    
    // 重新排列坐标轴并标准化，得到水面法线向量
    vec3 surfaceNormal = normalize(noise.xzy);

    // 初始化光照颜色
    vec3 diffuseLight = vec3(0.0);   // 漫反射光
    vec3 specularLight = vec3(0.0);  // 镜面反射光

    // === 坐标系变换 ===
    // 获取相机在世界坐标系中的位置
    vec3 eye = (czm_inverseView * vec4(vec3(0.0), 1.0)).xyz;
    eye = (fixedFrameToEastNorthUpTransform * vec4(eye, 1.0)).xyz;
    
    // 获取当前像素在世界坐标系中的位置
    vec3 world = (fixedFrameToEastNorthUpTransform * vec4(v_worldPosition.xyz, 1.0)).xyz;

    // 计算从世界坐标到视点的向量
    vec3 worldToEye = eye - world;
    // 调整坐标轴（Y和Z轴交换，Z轴取反）
    worldToEye = vec3(worldToEye.x, worldToEye.z, -worldToEye.y);
    // 标准化得到视线方向
    vec3 eyeDirection = normalize(worldToEye);

    // === 光照计算 ===
    float shiny = sunShiny;  // 镜面反射强度
    float spec = 2.0;        // 镜面反射系数
    float diffuse = 0.5;     // 漫反射系数
    sunLight(surfaceNormal, eyeDirection, shiny, spec, diffuse, diffuseLight, specularLight);

    // === 反射贴图采样 ===
    // 计算到观察点的距离
    float distance = length(worldToEye);
    
    // 根据法线和距离计算反射扭曲偏移
    // 距离越近扭曲越明显，模拟真实的水面反射效果
    vec2 distortion = surfaceNormal.xz * (0.001 + 1.0 / distance) * distortionScale;
    
    // 采样反射贴图，加上扭曲偏移
    vec3 reflectionSample = vec3(texture(reflexTexture, (v_uv.xy / v_uv.w) * 0.5 + 0.5 + distortion));

    // === 菲涅尔效果计算 ===
    // 计算视线与法线的夹角
    float theta = max(dot(eyeDirection, surfaceNormal), 0.0);
    
    // 菲涅尔反射率：视角越接近平行，反射越强
    // 使用Schlick近似公式：R = R0 + (1-R0)(1-cosθ)^5
    float reflectance = mix(rf0, 1.0, pow(1.0 - theta, 5.0));

    // === 最终颜色合成 ===
    // 计算散射光（水的本身颜色）
    vec3 scatter = max(0.0, dot(surfaceNormal, eyeDirection)) * waterColor.rgb;
    
    // 混合所有效果：
    // 1. 基础色：太阳光漫反射 + 散射光
    // 2. 反射色：环境反射 + 镜面高光
    // 3. 使用菲涅尔系数在两者间插值
    vec3 albedo = mix(
        sunColor * diffuseLight * 0.3 + scatter,  // 基础水色
        vec3(0.1) + reflectionSample * 0.9 + reflectionSample * specularLight,  // 反射效果
        reflectance  // 菲涅尔插值系数
    );
    
    // 设置材质属性
    material.diffuse = albedo.rgb;  // 最终颜色
    material.alpha = waterAlpha;    // 透明度

    return material;
}
`;

/**
 * 水面顶点着色器（Vertex Shader）
 * 负责顶点变换和准备传递给片段着色器的数据
 * 主要功能：
 * 1. 计算反射贴图的UV坐标
 * 2. 传递世界坐标位置给片段着色器
 * 3. 处理Cesium的高精度坐标系统
 */
const waterVertexShader = `
// 输入属性：顶点数据
in vec3 position3DHigh;    // 高精度位置坐标的高位部分
in vec3 position3DLow;     // 高精度位置坐标的低位部分
in vec3 normal;            // 顶点法线
in vec2 st;                // 纹理坐标
in float batchId;          // 批次ID（用于实例渲染）

// 输出到片段着色器的变量
out vec3 v_positionEC;     // 眼坐标系中的位置
out vec3 v_normalEC;       // 眼坐标系中的法线
out vec2 v_st;             // 纹理坐标

// 反射相关的变换矩阵
uniform mat4 reflectorProjectionMatrix;  // 反射投影矩阵
uniform mat4 reflectorViewMatrix;        // 反射视图矩阵
uniform mat4 reflectMatrix;              // 反射变换矩阵

// 输出给片段着色器的额外变量
out vec4 v_worldPosition;  // 世界坐标位置
out vec4 v_uv;             // 反射贴图的UV坐标

void main() {
    // 使用Cesium的高精度位置计算系统
    vec4 p = czm_computePosition();
    
    // 计算眼坐标系中的位置和法线（用于标准光照计算）
    v_positionEC = (czm_modelViewRelativeToEye * p).xyz;
    v_normalEC = czm_normal * normal;
    v_st = st;
    
    // 计算反射贴图的UV坐标
    // 这是关键步骤：通过反射变换矩阵计算从反射相机看到的位置
    mat4 modelView = reflectorViewMatrix * reflectMatrix * czm_model;
    
    // 清除平移分量，只保留旋转和缩放
    // 这样可以避免反射计算中的位置偏移问题
    modelView[3][0] = 0.0;
    modelView[3][1] = 0.0;
    modelView[3][2] = 0.0;
    
    // 计算反射贴图的投影坐标
    v_uv = reflectorProjectionMatrix * modelView * p;
    
    // 计算世界坐标位置（用于片段着色器中的进一步计算）
    vec4 positionMC = vec4(position3DHigh + position3DLow, 1.0);
    v_worldPosition = czm_model * positionMC;
    
    // 计算最终的屏幕位置
    gl_Position = czm_modelViewProjectionRelativeToEye * p;
}
`;

/**
 * 水面配置选项接口
 * 定义创建水面反射效果所需的所有参数
 */
interface WaterSurfaceOptions {
  scene: any;              // Cesium场景对象
  positions: any[];        // 水面的边界点坐标数组
  height: number;          // 水面高度（米）
  flowDegrees?: number;    // 水流方向角度（度），可选，默认0
  normalMapUrl?: string;   // 法线贴图URL，用于生成波浪效果，可选
  rippleSize?: number;     // 波纹大小，控制波浪的尺度，可选
  waterColor?: any;        // 水的基础颜色，Cesium.Color对象，可选
  waterAlpha?: number;     // 水的透明度（0-1），可选
  reflectivity?: number;   // 基础反射率，菲涅尔效果参数，可选
  lightDirection?: any;    // 光照方向向量，Cesium.Cartesian3对象，可选
  sunShiny?: number;       // 太阳光镜面反射强度，可选
  distortionScale?: number; // 反射扭曲程度，可选
}

/**
 * 创建默认颜色纹理
 * 当法线贴图未加载完成时使用的占位纹理
 * @param context WebGL渲染上下文
 * @returns 创建的纹理对象
 */
function createColorTexture(context: any): any {
  // 创建一个1x1像素的红色纹理作为默认纹理
  const whitePixel = new (window as any).Cesium.Texture({
    context: context,
    source: {
      width: 1,
      height: 1,
      // RGBA格式：红色不透明像素
      arrayBufferView: new Uint8Array([255, 0, 0, 255]),
    },
    // 设置纹理采样器参数
    sampler: new (window as any).Cesium.Sampler({
      wrapS: (window as any).Cesium.TextureWrap.REPEAT,        // S方向重复
      wrapT: (window as any).Cesium.TextureWrap.REPEAT,        // T方向重复
      minificationFilter: (window as any).Cesium.TextureMinificationFilter.LINEAR,  // 缩小时线性过滤
      magnificationFilter: (window as any).Cesium.TextureMinificationFilter.LINEAR, // 放大时线性过滤
    }),
  });
  whitePixel.type = "sampler2D";  // 标记为2D采样器类型
  return whitePixel;
}

/**
 * 计算向量反射
 * 根据入射向量和法线向量计算反射向量
 * 使用公式：R = I - 2 * (I·N) * N
 * @param incident 入射向量
 * @param normal 法线向量
 * @returns 反射向量
 */
function reflect(incident: any, normal: any): any {
  const reflected = normal.clone();        // 复制法线向量
  const cloneTexture = incident.clone();   // 复制入射向量
  
  // 计算入射向量与法线的点积，乘以2
  const dotProduct = (window as any).Cesium.Cartesian3.dot(incident, normal) * 2;
  
  // 计算 2 * (I·N) * N
  (window as any).Cesium.Cartesian3.multiplyByScalar(normal, dotProduct, reflected);
  
  // 计算反射向量：R = I - 2 * (I·N) * N
  return (window as any).Cesium.Cartesian3.subtract(incident, reflected, cloneTexture);
}

/**
 * 检查数值是否为2的幂
 * 用于判断纹理尺寸是否适合生成mipmap
 * @param value 要检查的数值
 * @returns 如果是2的幂返回true，否则返回false
 */
function isPowerOfTwo(value: number): boolean {
  // 使用位运算检查：如果是2的幂，value & (value-1) 必定为0
  return (value & (value - 1)) === 0 && value !== 0;
}

/**
 * 异步加载纹理图片
 * 从URL加载图片并创建Cesium纹理对象
 * @param options 加载选项
 * @param options.context WebGL渲染上下文
 * @param options.material 要设置纹理的材质对象
 * @param options.uniformName 材质中的uniform变量名
 * @param options.imgSrc 图片URL
 */
function loadTextureImage(options: {
  context: any;
  material: any;
  uniformName: string;
  imgSrc: string;
}): void {
  const { context, material, uniformName, imgSrc } = options;
  
  // 创建HTML Image对象
  const image = new Image();
  image.src = imgSrc;
  
  // 图片加载完成后的回调
  image.addEventListener("load", () => {
    // 创建Cesium纹理对象
    const texture = new (window as any).Cesium.Texture({
      context: context,
      source: image,  // 使用加载的图片作为纹理源
      sampler: new (window as any).Cesium.Sampler({
        wrapS: (window as any).Cesium.TextureWrap.REPEAT,     // S方向重复
        wrapT: (window as any).Cesium.TextureWrap.REPEAT,     // T方向重复
        minificationFilter: (window as any).Cesium.TextureMinificationFilter.LINEAR,    // 缩小过滤
        magnificationFilter: (window as any).Cesium.TextureMagnificationFilter.LINEAR,  // 放大过滤
      }),
    });
    
    texture.type = "sampler2D";  // 设置纹理类型
    
    // 如果图片尺寸是2的幂，生成mipmap以提高渲染质量
    if (isPowerOfTwo(image.width) && isPowerOfTwo(image.height)) {
      texture.generateMipmap((window as any).Cesium.MipmapHint.NICEST);
    }
    
    // 将纹理赋值给材质的uniform变量
    material.uniforms[uniformName] = texture;
  });
}

function renderSceneToFramebuffer(scene: any, framebuffer: any): void {
  const frameState = scene._frameState;
  const context = scene.context;
  const uniformState = context.uniformState;
  const originalView = scene._defaultView;
  
  scene._view = originalView;
  scene.updateFrameState();
  frameState.passes.render = true;
  frameState.passes.postProcess = scene.postProcessStages.hasSelected;
  
  let backgroundColor = scene.backgroundColor ?? (window as any).Cesium.Color.BLACK;
  if (scene._hdr) {
    backgroundColor = (window as any).Cesium.Color.clone(backgroundColor, new (window as any).Cesium.Color());
    backgroundColor.red = Math.pow(backgroundColor.red, scene.gamma);
    backgroundColor.green = Math.pow(backgroundColor.green, scene.gamma);
    backgroundColor.blue = Math.pow(backgroundColor.blue, scene.gamma);
  }
  frameState.backgroundColor = backgroundColor;
  
  scene.fog.update(frameState);
  uniformState.update(frameState);
  
  const shadowMap = scene.shadowMap;
  if ((window as any).Cesium.defined(shadowMap) && shadowMap.enabled) {
    if (!(window as any).Cesium.defined(scene.light) || scene.light instanceof (window as any).Cesium.SunLight) {
      (window as any).Cesium.Cartesian3.negate(uniformState.sunDirectionWC, scene._shadowMapCamera.direction);
    } else {
      (window as any).Cesium.Cartesian3.clone(scene.light.direction, scene._shadowMapCamera.direction);
    }
    frameState.shadowMaps.push(shadowMap);
  }
  
  scene._computeCommandList.length = 0;
  scene._overlayCommandList.length = 0;
  
  const viewport = originalView.viewport;
  viewport.x = 0;
  viewport.y = 0;
  viewport.width = context.drawingBufferWidth;
  viewport.height = context.drawingBufferHeight;
  
  const passState = originalView.passState;
  
  // === 兼容 Cesium 1.120+ 的 3D Tiles 渲染 ===
  // • 新版在 Cesium3DTileset.updateForPass 中会从 frameState.tilesetPassState 读取状态对象
  // • 如果缺失则抛出 “Expected tilesetPassState to be typeof object” 错误
  // 这里动态创建并挂到 frameState 上，确保流程完整。
  if ((frameState as any).tilesetPassState === undefined) {
    // Cesium 官方提供的封装类
    const CesiumNS = (window as any).Cesium;
    const tilesetPassState = new CesiumNS.Cesium3DTilePassState({
      pass: CesiumNS.Cesium3DTilePass?.RENDER ?? 0,
    });
    (frameState as any).tilesetPassState = tilesetPassState;
  }

  // 同时给 passState 补充，虽然目前用不上，但以防内部还会读取
  if ((passState as any).tilesetPassState === undefined) {
    (passState as any).tilesetPassState = (frameState as any).tilesetPassState;
  }
  
  passState.framebuffer = framebuffer;
  passState.blendingEnabled = undefined;
  passState.scissorTest = undefined;
  passState.viewport = (window as any).Cesium.BoundingRectangle.clone(viewport, passState.viewport);
  
  if ((window as any).Cesium.defined(scene.globe)) {
    scene.globe.beginFrame(frameState);
  }
  
  scene.updateEnvironment();
      scene.updateAndExecuteCommands(passState, backgroundColor);
    scene.resolveFramebuffers(passState);
    
    if ((window as any).Cesium.defined(scene.globe)) {
      scene.globe.endFrame(frameState);
      if (!scene.globe.tilesLoaded) {
        scene._renderRequested = true;
      }
    }
    
    context.endFrame();
}

// 水面反射类
class WaterSurface {
  private _scene: any;
  private _height: number;
  private _flowDegrees: number;
  private _positions: any[];
  private _originalPositions: any[]; // 保存原始坐标信息
  private _reflectorWorldPosition: any;
  private _originalReflectorWorldPosition: any;
  private _normal: any;
  private _waterPlane: any;
  private _reflectMatrix: any;
  private _reflectorViewMatrix: any;
  private _reflectorProjectionMatrix: any;
  private _initUniforms: any;
  private _primitive: any;
  private _material: any;
  private _virtualCamera: any;
  private _colorTexture: any;
  private _depthStencilTexture: any;
  private _colorFramebuffer: any;
  private _hdr: boolean = false;

  constructor(options: WaterSurfaceOptions) {
    this._scene = options.scene;
    this._height = options.height;
    this._flowDegrees = options.flowDegrees ?? 0;
    
    const positions3D = options.positions;
    // 保存原始坐标信息
    this._originalPositions = positions3D.map((pos: any) => ({
      longitude: pos.longitude,
      latitude: pos.latitude
    }));
    const positionsLength = positions3D.length;
    let centerX = 0;
    let centerY = 0;
    let centerZ = 0;
    
    this._positions = [];
    positions3D.forEach((coordinate: any) => {
      const latitude = coordinate.latitude;
      const longitude = coordinate.longitude;
      centerX += Math.cos(latitude) * Math.cos(longitude);
      centerY += Math.cos(latitude) * Math.sin(longitude);
      centerZ += Math.sin(latitude);
      
      // 使用传入的height参数，忽略coordinate中的高度值
      this._positions.push(
        (window as any).Cesium.Cartesian3.fromRadians(
          coordinate.longitude,
          coordinate.latitude,
          this._height  // 统一使用传入的height参数
        ),
      );
    });
    
    centerX /= positionsLength;
    centerY /= positionsLength;
    centerZ /= positionsLength;
    
    const longitude = Math.atan2(centerY, centerX);
    const latitude = Math.atan2(centerZ, Math.sqrt(centerX * centerX + centerY * centerY));
    
    this._reflectorWorldPosition = (window as any).Cesium.Cartesian3.fromRadians(longitude, latitude, this._height);
    this._originalReflectorWorldPosition = this._reflectorWorldPosition.clone();
    
    this._normal = (window as any).Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(this._reflectorWorldPosition);
    this._waterPlane = (window as any).Cesium.Plane.fromPointNormal(this._reflectorWorldPosition, this._normal);
    
    this._reflectMatrix = new (window as any).Cesium.Matrix4(
      this._waterPlane.normal.x * -2 * this._waterPlane.normal.x + 1,
      this._waterPlane.normal.x * -2 * this._waterPlane.normal.y,
      this._waterPlane.normal.x * -2 * this._waterPlane.normal.z,
      this._waterPlane.normal.x * -2 * this._waterPlane.distance,
      this._waterPlane.normal.y * -2 * this._waterPlane.normal.x,
      this._waterPlane.normal.y * -2 * this._waterPlane.normal.y + 1,
      this._waterPlane.normal.y * -2 * this._waterPlane.normal.z,
      this._waterPlane.normal.y * -2 * this._waterPlane.distance,
      this._waterPlane.normal.z * -2 * this._waterPlane.normal.x,
      this._waterPlane.normal.z * -2 * this._waterPlane.normal.y,
      this._waterPlane.normal.z * -2 * this._waterPlane.normal.z + 1,
      this._waterPlane.normal.z * -2 * this._waterPlane.distance,
      0, 0, 0, 1,
    );
    
    this._reflectorViewMatrix = (window as any).Cesium.Matrix4.IDENTITY.clone();
    this._reflectorProjectionMatrix = (window as any).Cesium.Matrix4.IDENTITY.clone();
    
    this._initUniforms = {
      normalMapUrl: options.normalMapUrl ?? "/img/waterNormals.jpg",
      size: options.rippleSize ?? 50,
      waterColor: options.waterColor ?? (window as any).Cesium.Color.fromCssColorString("#001e0f"),
      waterAlpha: options.waterAlpha ?? 0.9,
      rf0: options.reflectivity ?? 0.3,
      lightDirection: options.lightDirection ?? new (window as any).Cesium.Cartesian3(0, 0, 1),
      sunShiny: options.sunShiny ?? 100,
      distortionScale: options.distortionScale ?? 3.7,
    };
    
    const context = this._scene.context;
    this._createFramebuffer(context, context.drawingBufferWidth, context.drawingBufferHeight, this._scene.highDynamicRange);
    
    this._primitive = this._createPrimitive(this._positions, this._flowDegrees);
    this._scene.primitives.add(this._primitive);
    
    this.preRender = this.preRender.bind(this);
    this._scene.preRender.addEventListener(this.preRender);
  }

  get rippleSize(): number {
    return this._material.uniforms.size;
  }

  set rippleSize(value: number) {
    this._material.uniforms.size = value;
  }

  get waterAlpha(): number {
    return this._material.uniforms.waterAlpha;
  }

  set waterAlpha(value: number) {
    this._material.uniforms.waterAlpha = value;
  }

  get reflectivity(): number {
    return this._material.uniforms.rf0;
  }

  set reflectivity(value: number) {
    this._material.uniforms.rf0 = value;
  }

  get distortionScale(): number {
    return this._material.uniforms.distortionScale;
  }

  set distortionScale(value: number) {
    this._material.uniforms.distortionScale = value;
  }

  get height(): number {
    return this._height;
  }

  set height(newHeight: number) {
    this._height = newHeight;
    
    // 重新计算所有位置的高度
    this._positions = [];
    this._originalPositions.forEach((coordinate: any) => {
      this._positions.push(
        (window as any).Cesium.Cartesian3.fromRadians(
          coordinate.longitude,
          coordinate.latitude,
          this._height
        ),
      );
    });
    
    // 重新计算反射器位置
    const cartographic = (window as any).Cesium.Cartographic.fromCartesian(this._originalReflectorWorldPosition);
    const newPosition = (window as any).Cesium.Cartesian3.fromRadians(
      cartographic.longitude,
      cartographic.latitude,
      this._height,
    );
    
    this._reflectorWorldPosition = newPosition;
    this._normal = (window as any).Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(this._reflectorWorldPosition);
    this._waterPlane = (window as any).Cesium.Plane.fromPointNormal(this._reflectorWorldPosition, this._normal);
    
    // 重新创建primitive
    this._scene.primitives.remove(this._primitive);
    this._primitive = this._createPrimitive(this._positions, this._flowDegrees);
    this._scene.primitives.add(this._primitive);
    
    this._reflectMatrix = new (window as any).Cesium.Matrix4(
      this._waterPlane.normal.x * -2 * this._waterPlane.normal.x + 1,
      this._waterPlane.normal.x * -2 * this._waterPlane.normal.y,
      this._waterPlane.normal.x * -2 * this._waterPlane.normal.z,
      this._waterPlane.normal.x * -2 * this._waterPlane.distance,
      this._waterPlane.normal.y * -2 * this._waterPlane.normal.x,
      this._waterPlane.normal.y * -2 * this._waterPlane.normal.y + 1,
      this._waterPlane.normal.y * -2 * this._waterPlane.normal.z,
      this._waterPlane.normal.y * -2 * this._waterPlane.distance,
      this._waterPlane.normal.z * -2 * this._waterPlane.normal.x,
      this._waterPlane.normal.z * -2 * this._waterPlane.normal.y,
      this._waterPlane.normal.z * -2 * this._waterPlane.normal.z + 1,
      this._waterPlane.normal.z * -2 * this._waterPlane.distance,
      0, 0, 0, 1,
    );
  }

  private _createReflectionWaterMaterial(): any {
    const context = this._scene.context;
    const defaultTexture = createColorTexture(context);
    
    const {
      normalMapUrl,
      size,
      waterColor,
      waterAlpha,
      rf0,
      lightDirection,
      sunShiny,
      distortionScale,
    } = this._initUniforms;
    
    const frameBufferTexture = (window as any).Cesium.Texture.fromFramebuffer({
      context: context,
      framebuffer: this._colorFramebuffer,
    });
    frameBufferTexture.type = "sampler2D";
    
    const uniforms = {
      size: size,
      waterColor: waterColor,
      waterAlpha: waterAlpha,
      rf0: rf0,
      lightDirection: lightDirection,
      sunShiny: sunShiny,
      distortionScale: distortionScale,
      normalTexture: defaultTexture,
      reflexTexture: frameBufferTexture,
      time: 0,
      fixedFrameToEastNorthUpTransform: (window as any).Cesium.Matrix4.toArray(
        this._getFixedFrameToEastNorthUpTransformFromWorldMatrix(),
      ),
    };
    
    const material = new (window as any).Cesium.Material({
      fabric: {
        type: "ReflectionWater",
        uniforms: uniforms,
        source: waterMaterial,
      },
      translucent: false,
    });
    
    loadTextureImage({
      context: context,
      material: material,
      uniformName: "normalTexture",
      imgSrc: normalMapUrl,
    });
    
    return material;
  }

  private _updateVirtualCamera(camera: any): boolean {
    let negativeZAxis = new (window as any).Cesium.Cartesian3(0, 0, -1);
    let cameraVector = new (window as any).Cesium.Cartesian3();
    
    this._virtualCamera = (window as any).Cesium.Camera.clone(camera, this._virtualCamera);
    
    const cameraPosition = camera.positionWC.clone();
    let reflectedPosition = (window as any).Cesium.Cartesian3.subtract(
      this._reflectorWorldPosition,
      cameraPosition,
      new (window as any).Cesium.Cartesian3(),
    );
    
    if ((window as any).Cesium.Cartesian3.dot(reflectedPosition, this._normal) > 0) {
      return false;
    }
    
    reflectedPosition = reflect(reflectedPosition, this._normal);
    (window as any).Cesium.Cartesian3.negate(reflectedPosition, reflectedPosition);
    (window as any).Cesium.Cartesian3.add(reflectedPosition, this._reflectorWorldPosition, reflectedPosition);
    this._virtualCamera.position = reflectedPosition.clone();
    
    (window as any).Cesium.Cartesian3.add(camera.directionWC, cameraPosition, negativeZAxis);
    (window as any).Cesium.Cartesian3.subtract(this._reflectorWorldPosition, negativeZAxis, cameraVector);
    cameraVector = reflect(cameraVector, this._normal);
    (window as any).Cesium.Cartesian3.negate(cameraVector, cameraVector);
    (window as any).Cesium.Cartesian3.add(cameraVector, this._reflectorWorldPosition, cameraVector);
    
    this._virtualCamera.direction = (window as any).Cesium.Cartesian3.subtract(
      cameraVector,
      this._virtualCamera.position,
      new (window as any).Cesium.Cartesian3(),
    );
    (window as any).Cesium.Cartesian3.normalize(this._virtualCamera.direction, this._virtualCamera.direction);
    
    (window as any).Cesium.Cartesian3.add(camera.upWC, cameraPosition, negativeZAxis);
    (window as any).Cesium.Cartesian3.subtract(this._reflectorWorldPosition, negativeZAxis, cameraVector);
    cameraVector = reflect(cameraVector, this._normal);
    (window as any).Cesium.Cartesian3.negate(cameraVector, cameraVector);
    (window as any).Cesium.Cartesian3.add(cameraVector, this._reflectorWorldPosition, cameraVector);
    
    this._virtualCamera.up = (window as any).Cesium.Cartesian3.subtract(
      cameraVector,
      this._virtualCamera.position,
      new (window as any).Cesium.Cartesian3(),
    );
    (window as any).Cesium.Cartesian3.normalize(this._virtualCamera.up, this._virtualCamera.up);
    
    this._reflectorProjectionMatrix = this._virtualCamera.frustum.projectionMatrix;
    this._reflectorViewMatrix = this._virtualCamera.viewMatrix;
    
    const clipPlane = (window as any).Cesium.Plane.fromPointNormal(this._reflectorWorldPosition, this._normal);
    (window as any).Cesium.Plane.transform(clipPlane, this._virtualCamera.viewMatrix, clipPlane);
    
    const clipPlaneVector = new (window as any).Cesium.Cartesian4(
      clipPlane.normal.x,
      clipPlane.normal.y,
      clipPlane.normal.z,
      clipPlane.distance,
    );
    
    const projectionMatrix = (window as any).Cesium.Matrix4.clone(this._virtualCamera.frustum.projectionMatrix);
    const q = new (window as any).Cesium.Cartesian4(
      (Math.sign(clipPlaneVector.x) + projectionMatrix[8]) / projectionMatrix[0],
      (Math.sign(clipPlaneVector.y) + projectionMatrix[9]) / projectionMatrix[5],
      -1,
      (1 + projectionMatrix[10]) / projectionMatrix[14],
    );
    
    (window as any).Cesium.Cartesian4.multiplyByScalar(
      clipPlaneVector,
      2 / (window as any).Cesium.Cartesian4.dot(clipPlaneVector, q),
      clipPlaneVector,
    );
    
    projectionMatrix[2] = clipPlaneVector.x;
    projectionMatrix[6] = clipPlaneVector.y;
    projectionMatrix[10] = clipPlaneVector.z + 1;
    projectionMatrix[14] = clipPlaneVector.w;
    
    this._virtualCamera.frustum.customProjectionMatrix = (window as any).Cesium.Matrix4.clone(projectionMatrix);
    
    return true;
  }

  preRender(scene: any): void {
    const originalCamera = scene._defaultView.camera;
    const originalShadowMap = scene.shadowMap;
    const originalGlobeShow = scene.globe.show;
    const originalGlobeShowSkirts = scene.globe.showSkirts;
    
    if (!this._updateVirtualCamera(scene._defaultView.camera)) {
      this._primitive.show = false;
      return;
    }
    
    this._primitive.show = false;
    scene._defaultView.camera = this._virtualCamera;
    scene.shadowMap = undefined;
    scene.globe.show = false;
    scene.globe.showSkirts = false;
    
    const context = scene.context;
    const width = context.drawingBufferWidth;
    const height = context.drawingBufferHeight;
    const hdr = scene.highDynamicRange;
    
    this._createFramebuffer(context, width, height, hdr);
    renderSceneToFramebuffer(scene, this._colorFramebuffer);
    
    const appearance = this._primitive.appearance;
    const reflectionTexture = (window as any).Cesium.Texture.fromFramebuffer({
      context: context,
      framebuffer: this._colorFramebuffer,
    });
    reflectionTexture.type = "sampler2D";
    
    this._material.uniforms.reflexTexture = reflectionTexture;
    this._material.uniforms.time = performance.now() / 1000;
    this._material.uniforms.fixedFrameToEastNorthUpTransform = (window as any).Cesium.Matrix4.toArray(
      this._getFixedFrameToEastNorthUpTransformFromWorldMatrix(),
    );
    
    appearance.uniforms.reflectMatrix = (window as any).Cesium.Matrix4.toArray(this._reflectMatrix);
    appearance.uniforms.reflectorProjectionMatrix = (window as any).Cesium.Matrix4.toArray(this._reflectorProjectionMatrix);
    appearance.uniforms.reflectorViewMatrix = (window as any).Cesium.Matrix4.toArray(this._reflectorViewMatrix);
    
    this._primitive.show = true;
    scene._defaultView.camera = originalCamera;
    scene.shadowMap = originalShadowMap;
    scene.globe.show = originalGlobeShow;
    scene.globe.showSkirts = originalGlobeShowSkirts;
  }

  private _createPrimitive(positions: any[], flowDegrees: number): any {
    const material = this._createReflectionWaterMaterial();
    this._material = material;
    
    const appearance = new (window as any).Cesium.MaterialAppearance({
      material: material,
      vertexShaderSource: waterVertexShader,
      translucent: true,
    });
    
    appearance.uniforms = {};
    appearance.uniforms.reflectMatrix = (window as any).Cesium.Matrix4.toArray(this._reflectMatrix);
    appearance.uniforms.reflectorProjectionMatrix = (window as any).Cesium.Matrix4.toArray(this._reflectorProjectionMatrix);
    appearance.uniforms.reflectorViewMatrix = (window as any).Cesium.Matrix4.toArray(this._reflectorViewMatrix);
    
    const primitive = new (window as any).Cesium.Primitive({
      geometryInstances: new (window as any).Cesium.GeometryInstance({
        geometry: (window as any).Cesium.CoplanarPolygonGeometry.fromPositions({
          vertexFormat: (window as any).Cesium.VertexFormat.POSITION_NORMAL_AND_ST,
          positions: positions,
          stRotation: (window as any).Cesium.Math.toRadians(flowDegrees),
        }),
      }),
      appearance: appearance,
      asynchronous: false,
    });
    
    return primitive;
  }

  private _getFixedFrameToEastNorthUpTransformFromWorldMatrix(): any {
    const eastNorthUpTransform = (window as any).Cesium.Transforms.eastNorthUpToFixedFrame(this._reflectorWorldPosition);
    const inverseTransform = (window as any).Cesium.Matrix4.inverse(eastNorthUpTransform, new (window as any).Cesium.Matrix4());
    return inverseTransform;
  }

  private _createFramebuffer(context: any, width: number, height: number, hdr: boolean): void {
    const colorTexture = this._colorTexture;
    if (
      (window as any).Cesium.defined(colorTexture) &&
      colorTexture.width === width &&
      colorTexture.height === height &&
      this._hdr === hdr
    ) {
      return;
    }
    
    this._destroyResources();
    this._hdr = hdr;
    
    const pixelDatatype = hdr
      ? context.halfFloatingPointTexture
        ? (window as any).Cesium.PixelDatatype.HALF_FLOAT
        : (window as any).Cesium.PixelDatatype.FLOAT
      : (window as any).Cesium.PixelDatatype.UNSIGNED_BYTE;
    
    this._colorTexture = new (window as any).Cesium.Texture({
      context: context,
      width: width,
      height: height,
      pixelFormat: (window as any).Cesium.PixelFormat.RGBA,
      pixelDatatype: pixelDatatype,
      sampler: new (window as any).Cesium.Sampler({
        wrapS: (window as any).Cesium.TextureWrap.CLAMP_TO_EDGE,
        wrapT: (window as any).Cesium.TextureWrap.CLAMP_TO_EDGE,
        minificationFilter: (window as any).Cesium.TextureMinificationFilter.LINEAR,
        magnificationFilter: (window as any).Cesium.TextureMagnificationFilter.LINEAR,
      }),
    });
    
    this._depthStencilTexture = new (window as any).Cesium.Texture({
      context: context,
      width: width,
      height: height,
      pixelFormat: (window as any).Cesium.PixelFormat.DEPTH_STENCIL,
      pixelDatatype: (window as any).Cesium.PixelDatatype.UNSIGNED_INT_24_8,
    });
    
    this._colorFramebuffer = new (window as any).Cesium.Framebuffer({
      context: context,
      colorTextures: [this._colorTexture],
      depthStencilTexture: this._depthStencilTexture,
      destroyAttachments: false,
    });
  }

  private _destroyResources(): void {
    if (this._colorTexture) {
      this._colorTexture.destroy();
    }
    if (this._depthStencilTexture) {
      this._depthStencilTexture.destroy();
    }
    if (this._colorFramebuffer) {
      this._colorFramebuffer.destroy();
    }
    this._colorTexture = undefined;
    this._depthStencilTexture = undefined;
    this._colorFramebuffer = undefined;
  }
}

export { WaterSurface, type WaterSurfaceOptions }; 