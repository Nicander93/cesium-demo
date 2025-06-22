// 导入类型声明
declare global {
  interface Window {
    Cesium: any;
  }
}

// 导入GUI库（如果可用）
// import { GUI } from 'lil-gui';
const waterMaterial =
  "\nuniform sampler2D reflexTexture; // 反射贴图\nuniform sampler2D normalTexture; // 法线贴图\nuniform float time;\n\nuniform mat4 fixedFrameToEastNorthUpTransform; // 水面的东北天矩阵的逆矩阵\n\n// 从顶点着色器传来的\nin vec4 v_worldPosition; // 当前像素的世界坐标\nin vec4 v_uv; // 原本的纹理坐标乘以贴图矩阵\n\n// 可配置的参数\nuniform float size; // 波纹大小（数值越大波纹越密集）\nuniform vec4 waterColor; // 水面颜色\nuniform float waterAlpha; // 水面透明度\nuniform float rf0; // 水面反射率\nuniform vec3 lightDirection; // 光照方向\nuniform float sunShiny; // 光照强度\nuniform float distortionScale; // 倒影的扭曲程度\n\nconst vec3 sunColor = vec3( 1.0 );\n\n\n// 获取噪声\n// vec4 czm_getWaterNoise(sampler2D normalMap, vec2 uv, float time, float angleInRadians)\nvec4 getNoise( sampler2D normalMap, vec2 uv ) {\n    vec2 uv0 = ( uv / 103.0 ) + vec2( time / 17.0, time / 29.0 );\n    vec2 uv1 = uv / 107.0 - vec2( time / -19.0, time / 31.0 );\n    vec2 uv2 = uv / vec2( 8907.0, 9803.0 ) + vec2( time / 101.0, time / 97.0 );\n    vec2 uv3 = uv / vec2( 1091.0, 1027.0 ) - vec2( time / 109.0, time / -113.0 );\n    vec4 noise = texture( normalMap, uv0 ) +\n        texture( normalMap, uv1 ) +\n        texture( normalMap, uv2 ) +\n        texture( normalMap, uv3 );\n    return noise * 0.5 - 1.0;\n}\n\nvoid sunLight( const vec3 surfaceNormal, const vec3 eyeDirection, float shiny, float spec, float diffuse, inout vec3 diffuseColor, inout vec3 specularColor ) {\n    vec3 sunDirection = normalize( lightDirection );\n    vec3 reflection = normalize( reflect( -sunDirection, surfaceNormal ) );  // 获得太阳对表面法线的反射向量\n    float direction = max( 0.0, dot( eyeDirection, reflection ) );  // 当太阳反射方向和眼睛的方向一致时，direction 最大，为 1，当角度大于 90度时最小，最小为 0\n    specularColor += pow( direction, shiny ) * sunColor * spec;\n    diffuseColor += max( dot( sunDirection, surfaceNormal ), 0.0 ) * sunColor * diffuse;\n}\n\nczm_material czm_getMaterial(czm_materialInput materialInput) {\n    czm_material material = czm_getDefaultMaterial(materialInput);\n\n    // 通过法线贴图计算新的表面法线\n    vec2 transformedSt = materialInput.st * 2.0 - 1.0;  // [0, 1] => [-1, 1]\n    vec4 noise = getNoise( normalTexture, transformedSt * size );\n    vec3 surfaceNormal = normalize( noise.xzy );  // [0, +1]，Y up\n\n    // 漫反射光\n    vec3 diffuseLight = vec3( 0.0 );\n    // 高光\n    vec3 specularLight = vec3( 0.0 );\n\n    // 获取视线方向（世界坐标）\n    vec3 eye = ( czm_inverseView * vec4( vec3(0.0), 1.0 ) ).xyz;\n    // 获取视线方向（水面的本地坐标）\n    eye = ( fixedFrameToEastNorthUpTransform * vec4( eye, 1.0) ).xyz;\n    // 当前像素的本地坐标\n    vec3 world = ( fixedFrameToEastNorthUpTransform * vec4( v_worldPosition.xyz, 1.0) ).xyz;\n\n    vec3 worldToEye = eye - world;  // east, north, up\n    worldToEye = vec3( worldToEye.x, worldToEye.z, -worldToEye.y );  // Y up\n    vec3 eyeDirection = normalize( worldToEye );\n\n    float shiny = sunShiny;\n    float spec = 2.0;\n    float diffuse = 0.5;\n    sunLight( surfaceNormal, eyeDirection, shiny, spec, diffuse, diffuseLight, specularLight );\n\n    float distance = length( worldToEye );\n    float distortionScale = distortionScale;\n    vec2 distortion = surfaceNormal.xz * ( 0.001 + 1.0 / distance ) * distortionScale;\n    vec3 reflectionSample = vec3( texture( reflexTexture, (v_uv.xy / v_uv.w) * 0.5 + 0.5 + distortion ) );\n\n    float theta = max( dot( eyeDirection, surfaceNormal ), 0.0 );\n    float rf0 = rf0;\n    float reflectance = mix( rf0, 1.0, pow( 1.0 - theta, 5.0 ) );\n\n    vec3 waterColor = waterColor.rgb;\n\n    // surfaceNormal 是以反射平面为 X-Y 平面的，\n    // 所以 eyeDirection 也得是以反射平面为 X-Y 平面。\n    vec3 scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ) * waterColor;\n    vec3 albedo = mix(\n        sunColor * diffuseLight * 0.3 + scatter,\n        vec3( 0.1 ) + reflectionSample * 0.9 + reflectionSample * specularLight,\n        reflectance\n    );\n    material.diffuse = albedo.rgb;\n    material.alpha = waterAlpha;\n\n    return material;\n}\n";
const waterVertexShader = `
in vec3 position3DHigh;
in vec3 position3DLow;
in vec3 normal;
in vec2 st;
in float batchId;

out vec3 v_positionEC;
out vec3 v_normalEC;
out vec2 v_st;

uniform mat4 reflectorProjectionMatrix;
uniform mat4 reflectorViewMatrix;
uniform mat4 reflectMatrix;
out vec4 v_worldPosition;
out vec4 v_uv;

void main() {
    vec4 p = czm_computePosition();
    
    v_positionEC = (czm_modelViewRelativeToEye * p).xyz;
    v_normalEC = czm_normal * normal;
    v_st = st;
    
    mat4 modelView = reflectorViewMatrix * reflectMatrix * czm_model;
    modelView[3][0] = 0.0;
    modelView[3][1] = 0.0;
    modelView[3][2] = 0.0;
    v_uv = reflectorProjectionMatrix * modelView * p;
    vec4 positionMC = vec4(position3DHigh + position3DLow, 1.0);
    v_worldPosition = czm_model * positionMC;
    
    gl_Position = czm_modelViewProjectionRelativeToEye * p;
}
`;
// 水面配置接口
interface WaterSurfaceOptions {
  scene: any;
  positions: any[];
  height: number;
  flowDegrees?: number;
  normalMapUrl?: string;
  rippleSize?: number;
  waterColor?: any;
  waterAlpha?: number;
  reflectivity?: number;
  lightDirection?: any;
  sunShiny?: number;
  distortionScale?: number;
}

function createColorTexture(context: any): any {
  const Cesium = (window as any).Cesium;
  const whitePixel = new Cesium.Texture({
    context: context,
    source: {
      width: 1,
      height: 1,
      arrayBufferView: new Uint8Array([255, 0, 0, 255]),
    },
    sampler: new Cesium.Sampler({
      wrapS: Cesium.TextureWrap.REPEAT,
      wrapT: Cesium.TextureWrap.REPEAT,
      minificationFilter: Cesium.TextureMinificationFilter.LINEAR,
      magnificationFilter: Cesium.TextureMinificationFilter.LINEAR,
    }),
  });
  whitePixel.type = "sampler2D";
  return whitePixel;
}
function reflect(incident: any, normal: any): any {
  const Cesium = (window as any).Cesium;
  const reflected = normal.clone();
  const cloneTexture = incident.clone();
  const dotProduct = Cesium.Cartesian3.dot(incident, normal) * 2;
  Cesium.Cartesian3.multiplyByScalar(normal, dotProduct, reflected);
  return Cesium.Cartesian3.subtract(incident, reflected, cloneTexture);
}

function isPowerOfTwo(value: number): boolean {
  return (value & (value - 1)) === 0 && value !== 0;
}

function loadTextureImage(options: {
  context: any;
  material: any;
  uniformName: string;
  imgSrc: string;
}): void {
  const Cesium = (window as any).Cesium;
  const { context, material, uniformName, imgSrc } = options;
  const image = new Image();
  image.src = imgSrc;
  image.addEventListener("load", () => {
    const texture = new Cesium.Texture({
      context: context,
      source: image,
      sampler: new Cesium.Sampler({
        wrapS: Cesium.TextureWrap.REPEAT,
        wrapT: Cesium.TextureWrap.REPEAT,
        minificationFilter: Cesium.TextureMinificationFilter.LINEAR,
        magnificationFilter: Cesium.TextureMagnificationFilter.LINEAR,
      }),
    });
    texture.type = "sampler2D";
    if (isPowerOfTwo(image.width) && isPowerOfTwo(image.height)) {
      texture.generateMipmap(Cesium.MipmapHint.NICEST);
    }
    material.uniforms[uniformName] = texture;
  });
}
const ender3DTile = new Cesium.Cesium3DTilePassState({
  pass: Cesium.Cesium3DTilePass.RENDER,
});
const tempColor = new Cesium.Color();
function enderContent(onRender, endererHook) {
  const currentRender = onRender._frameState;
  const enderContext = onRender.context;
  const enderUniforms = enderContext.uniformState;
  const uniforms = onRender._defaultView;
  onRender._view = uniforms;
  onRender.updateFrameState();
  currentRender.passes.render = true;
  currentRender.passes.postProcess = onRender.postProcessStages.hasSelected;
  currentRender.tilesetPassState = ender3DTile;
  let userState = Cesium.defaultValue(
    onRender.backgroundColor,
    Cesium.Color.BLACK,
  );
  if (onRender._hdr) {
    userState = Cesium.Color.clone(userState, tempColor);
    userState.red = Math.pow(userState.red, onRender.gamma);
    userState.green = Math.pow(userState.green, onRender.gamma);
    userState.blue = Math.pow(userState.blue, onRender.gamma);
  }
  currentRender.backgroundColor = userState;
  onRender.fog.update(currentRender);
  enderUniforms.update(currentRender);
  const hexIndex = onRender.shadowMap;
  if (Cesium.defined(hexIndex) && hexIndex.enabled) {
    if (
      !Cesium.defined(onRender.light) ||
      onRender.light instanceof Cesium.SunLight
    ) {
      Cesium.Cartesian3.negate(
        enderUniforms.sunDirectionWC,
        onRender._shadowMapCamera.direction,
      );
    } else {
      Cesium.Cartesian3.clone(
        onRender.light.direction,
        onRender._shadowMapCamera.direction,
      );
    }
    currentRender.shadowMaps.push(hexIndex);
  }
  onRender._computeCommandList.length = 0;
  onRender._overlayCommandList.length = 0;
  const encryptedId = uniforms.viewport;
  encryptedId.x = 0;
  encryptedId.y = 0;
  encryptedId.width = enderContext.drawingBufferWidth;
  encryptedId.height = enderContext.drawingBufferHeight;
  const fetchRealtime = uniforms.passState;
  fetchRealtime.framebuffer = endererHook;
  fetchRealtime.blendingEnabled = undefined;
  fetchRealtime.scissorTest = undefined;
  fetchRealtime.viewport = Cesium.BoundingRectangle.clone(
    encryptedId,
    fetchRealtime.viewport,
  );
  if (Cesium.defined(onRender.globe)) {
    onRender.globe.beginFrame(currentRender);
  }
  onRender.updateEnvironment();
  onRender.updateAndExecuteCommands(fetchRealtime, userState);
  onRender.resolveFramebuffers(fetchRealtime);
  if (Cesium.defined(onRender.globe)) {
    onRender.globe.endFrame(currentRender);
    if (!onRender.globe.tilesLoaded) {
      onRender._renderRequested = true;
    }
  }
  enderContext.endFrame();
}
const clippingScale = 0;
class riverSurface {
  constructor(ceneInfo) {
    this._scene = ceneInfo.scene;
    this._height = ceneInfo.height;
    this._flowDegrees = Cesium.defaultValue(ceneInfo.flowDegrees, 0);
    const positions3D = ceneInfo.positions;
    const _positions3D = positions3D.length;
    let _ceneInfo = 0;
    let flowPositions = 0;
    let ceneData = 0;
    this._positions = [];
    positions3D.forEach((geoCoordinate) => {
      const latitudeValue = geoCoordinate.latitude;
      const longitude = geoCoordinate.longitude;
      _ceneInfo += Math.cos(latitudeValue) * Math.cos(longitude);
      flowPositions += Math.cos(latitudeValue) * Math.sin(longitude);
      ceneData += Math.sin(latitudeValue);
      this._positions.push(
        Cesium.Cartesian3.fromRadians(
          geoCoordinate.longitude,
          geoCoordinate.latitude,
          this._height,
        ),
      );
    });
    _ceneInfo /= _positions3D;
    flowPositions /= _positions3D;
    ceneData /= _positions3D;
    const cartesian3d = Math.atan2(flowPositions, _ceneInfo);
    const __ceneInfo = Math.sqrt(
      _ceneInfo * _ceneInfo + flowPositions * flowPositions,
    );
    const ceneInfoRef = Math.atan2(ceneData, __ceneInfo);
    this._reflectorWorldPosition = Cesium.Cartesian3.fromRadians(
      cartesian3d,
      ceneInfoRef,
      this._height,
    );
    this._originalreflectorWorldPosition = this._reflectorWorldPosition.clone();
    this._normal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(
      this._reflectorWorldPosition,
    );
    this._waterPlane = Cesium.Plane.fromPointNormal(
      this._reflectorWorldPosition,
      this._normal,
    );
    this._reflectMatrix = new Cesium.Matrix4(
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
      0,
      0,
      0,
      1,
    );
    this._reflectorViewMatrix = Cesium.Matrix4.IDENTITY.clone();
    this._reflectorProjectionMatrix = Cesium.Matrix4.IDENTITY.clone();
    this._initUniforms = {
      normalMapUrl: Cesium.defaultValue(
        ceneInfo.normalMapUrl,
        "/img/waterNormals.jpg",
      ),
      size: Cesium.defaultValue(ceneInfo.rippleSize, 50),
      waterColor: Cesium.defaultValue(
        ceneInfo.waterColor,
        Cesium.Color.fromCssColorString("#001e0f"),
      ),
      waterAlpha: Cesium.defaultValue(ceneInfo.waterAlpha, 0.9),
      rf0: Cesium.defaultValue(ceneInfo.reflectivity, 0.3),
      lightDirection: Cesium.defaultValue(
        ceneInfo.lightDirection,
        new Cesium.Cartesian3(0, 0, 1),
      ),
      sunShiny: Cesium.defaultValue(ceneInfo.sunShiny, 100),
      distortionScale: Cesium.defaultValue(ceneInfo.distortionScale, 3.7),
    };
    const previousQuery = this._scene.context;
    this._createFramebuffer(
      previousQuery,
      previousQuery.drawingBufferWidth,
      previousQuery.drawingBufferHeight,
      this._scene.highDynamicRange,
    );
    this._primitive = this._createPrimitive(this._positions, this._flowDegrees);
    this._scene.primitives.add(this._primitive);
    this.preRender = this.preRender.bind(this);
    this._scene.preRender.addEventListener(this.preRender);
    this._scene.logarithmicDepthBuffer = false;
    Cesium.UniformState.prototype.updateFrustum = function (customFrustum) {
      Cesium.Matrix4.clone(
        Cesium.defaultValue(
          customFrustum.customProjectionMatrix,
          customFrustum.projectionMatrix,
        ),
        this._projection,
      );
      this._inverseProjectionDirty = true;
      this._viewProjectionDirty = true;
      this._inverseViewProjectionDirty = true;
      this._modelViewProjectionDirty = true;
      this._modelViewProjectionRelativeToEyeDirty = true;
      if (Cesium.defined(customFrustum.infiniteProjectionMatrix)) {
        Cesium.Matrix4.clone(
          customFrustum.infiniteProjectionMatrix,
          this._infiniteProjection,
        );
        this._modelViewInfiniteProjectionDirty = true;
      }
      this._currentFrustum.x = customFrustum.near;
      this._currentFrustum.y = customFrustum.far;
      this._farDepthFromNearPlusOne =
        customFrustum.far - customFrustum.near + 1;
      this._log2FarDepthFromNearPlusOne = Cesium.Math.log2(
        this._farDepthFromNearPlusOne,
      );
      this._oneOverLog2FarDepthFromNearPlusOne =
        1 / this._log2FarDepthFromNearPlusOne;
      if (Cesium.defined(customFrustum._offCenterFrustum)) {
        customFrustum = customFrustum._offCenterFrustum;
      }
      this._frustumPlanes.x = customFrustum.top;
      this._frustumPlanes.y = customFrustum.bottom;
      this._frustumPlanes.z = customFrustum.left;
      this._frustumPlanes.w = customFrustum.right;
    };
    Cesium.PerspectiveFrustum.prototype.clone = function (clonePerspFrz) {
      if (!Cesium.defined(clonePerspFrz)) {
        clonePerspFrz = new Cesium.PerspectiveFrustum();
      }
      clonePerspFrz.aspectRatio = this.aspectRatio;
      clonePerspFrz.fov = this.fov;
      clonePerspFrz.near = this.near;
      clonePerspFrz.far = this.far;
      clonePerspFrz._aspectRatio = undefined;
      clonePerspFrz._fov = undefined;
      clonePerspFrz._near = undefined;
      clonePerspFrz._far = undefined;
      this._offCenterFrustum.clone(clonePerspFrz._offCenterFrustum);
      clonePerspFrz.customProjectionMatrix = this.customProjectionMatrix;
      return clonePerspFrz;
    };
  }
  get rippleSize() {
    return this._material.uniforms.size;
  }
  set rippleSize(rippleSize) {
    this._material.uniforms.size = rippleSize;
  }
  get waterAlpha() {
    return this._material.uniforms.waterAlpha;
  }
  set waterAlpha(waterTransluc) {
    this._material.uniforms.waterAlpha = waterTransluc;
  }
  get reflectivity() {
    return this._material.uniforms.rf0;
  }
  set reflectivity(eflectivity) {
    this._material.uniforms.rf0 = eflectivity;
  }
  get distortionScale() {
    return this._material.uniforms.distortionScale;
  }
  set distortionScale(distortionAmn) {
    this._material.uniforms.distortionScale = distortionAmn;
  }
  get height() {
    return this._height;
  }
  set height(newHeight) {
    this._height = newHeight;
    const eflector3D = Cesium.Cartographic.fromCartesian(
      this._originalreflectorWorldPosition,
    );
    const _cartesian3d = Cesium.Cartesian3.fromRadians(
      eflector3D.longitude,
      eflector3D.latitude,
      this._height,
    );
    const originalRefle = Cesium.Cartesian3.subtract(
      _cartesian3d,
      this._originalreflectorWorldPosition,
      new Cesium.Cartesian3(),
    );
    const convertToCart = Cesium.Matrix4.fromTranslation(originalRefle);
    this._primitive.modelMatrix = convertToCart;
    this._reflectorWorldPosition = _cartesian3d;
    this._normal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(
      this._reflectorWorldPosition,
    );
    this._waterPlane = Cesium.Plane.fromPointNormal(
      this._reflectorWorldPosition,
      this._normal,
    );
    this._reflectMatrix = new Cesium.Matrix4(
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
      0,
      0,
      0,
      1,
    );
  }
  _createReflectionWaterMaterial() {
    const ceneContext = this._scene.context;
    const ectorOrPlace = _colorTexture(ceneContext);
    const {
      normalMapUrl: normalMapUrl,
      size: textureSize,
      waterColor: obfuscatedId,
      waterAlpha: createWaterBp,
      rf0: hexColorValue,
      lightDirection: _normalMapUrl,
      sunShiny: currentDate,
      distortionScale: createWaterSH,
    } = this._initUniforms;
    const inifiedId = {
      context: ceneContext,
      framebuffer: this._colorFramebuffer,
    };
    const waterTexture = Cesium.Texture.fromFramebuffer(inifiedId);
    waterTexture.type = "sampler2D";
    const eflectionId = {
      size: textureSize,
      waterColor: obfuscatedId,
      waterAlpha: createWaterBp,
      rf0: hexColorValue,
      lightDirection: _normalMapUrl,
      sunShiny: currentDate,
      distortionScale: createWaterSH,
      normalTexture: ectorOrPlace,
      reflexTexture: waterTexture,
      time: 0,
      fixedFrameToEastNorthUpTransform: Cesium.Matrix4.toArray(
        this._getFixedFrameToEastNorthUpTransformFromWorldMatrix(),
      ),
    };
    const eflectionMat = {
      type: "ReflectionWater",
      uniforms: eflectionId,
      source: waterMaterial,
    };
    const _eflectionMat = new Cesium.Material({
      fabric: eflectionMat,
      translucent: false,
      minificationFilter: Cesium.TextureMinificationFilter.LINEAR,
      magnificationFilter: Cesium.TextureMagnificationFilter.LINEAR,
    });
    addEarthImage({
      context: ceneContext,
      material: _eflectionMat,
      uniformName: "normalTexture",
      imgSrc: normalMapUrl,
    });
    return _eflectionMat;
  }
  _updateVirtualCamera(cameraObject) {
    let negativeZAxis = new Cesium.Cartesian3(0, 0, -1);
    let cameraVector = new Cesium.Cartesian3();
    this._virtualCamera = Cesium.Camera.clone(
      cameraObject,
      this._virtualCamera,
    );
    const virtualCamera = cameraObject.positionWC.clone();
    let updateCamera = Cesium.Cartesian3.subtract(
      this._reflectorWorldPosition,
      virtualCamera,
      new Cesium.Cartesian3(),
    );
    if (Cesium.Cartesian3.dot(updateCamera, this._normal) > 0) {
      return false;
    }
    updateCamera = normalVector(updateCamera, this._normal);
    Cesium.Cartesian3.negate(updateCamera, updateCamera);
    Cesium.Cartesian3.add(
      updateCamera,
      this._reflectorWorldPosition,
      updateCamera,
    );
    this._virtualCamera.position = updateCamera.clone();
    Cesium.Cartesian3.add(
      cameraObject.directionWC,
      virtualCamera,
      negativeZAxis,
    );
    Cesium.Cartesian3.subtract(
      this._reflectorWorldPosition,
      negativeZAxis,
      cameraVector,
    );
    cameraVector = normalVector(cameraVector, this._normal);
    Cesium.Cartesian3.negate(cameraVector, cameraVector);
    Cesium.Cartesian3.add(
      cameraVector,
      this._reflectorWorldPosition,
      cameraVector,
    );
    this._virtualCamera.direction = Cesium.Cartesian3.subtract(
      cameraVector,
      this._virtualCamera.position,
      new Cesium.Cartesian3(),
    );
    Cesium.Cartesian3.normalize(
      this._virtualCamera.direction,
      this._virtualCamera.direction,
    );
    Cesium.Cartesian3.add(cameraObject.upWC, virtualCamera, negativeZAxis);
    Cesium.Cartesian3.subtract(
      this._reflectorWorldPosition,
      negativeZAxis,
      cameraVector,
    );
    cameraVector = normalVector(cameraVector, this._normal);
    Cesium.Cartesian3.negate(cameraVector, cameraVector);
    Cesium.Cartesian3.add(
      cameraVector,
      this._reflectorWorldPosition,
      cameraVector,
    );
    this._virtualCamera.up = Cesium.Cartesian3.subtract(
      cameraVector,
      this._virtualCamera.position,
      new Cesium.Cartesian3(),
    );
    Cesium.Cartesian3.normalize(this._virtualCamera.up, this._virtualCamera.up);
    this._reflectorProjectionMatrix =
      this._virtualCamera.frustum.projectionMatrix;
    this._reflectorViewMatrix = this._virtualCamera.viewMatrix;
    const cloneCamera = Cesium.Plane.fromPointNormal(
      this._reflectorWorldPosition,
      this._normal,
    );
    Cesium.Plane.transform(
      cloneCamera,
      this._virtualCamera.viewMatrix,
      cloneCamera,
    );
    const ceneCamera = new Cesium.Cartesian4(
      cloneCamera.normal.x,
      cloneCamera.normal.y,
      cloneCamera.normal.z,
      cloneCamera.distance,
    );
    const currentPrice = Cesium.Matrix4.clone(
      this._virtualCamera.frustum.projectionMatrix,
    );
    const _virtualCamera = new Cesium.Cartesian4(
      (Math.sign(ceneCamera.x) + currentPrice[8]) / currentPrice[0],
      (Math.sign(ceneCamera.y) + currentPrice[9]) / currentPrice[5],
      -1,
      (1 + currentPrice[10]) / currentPrice[14],
    );
    Cesium.Cartesian4.multiplyByScalar(
      ceneCamera,
      2 / Cesium.Cartesian4.dot(ceneCamera, _virtualCamera),
      ceneCamera,
    );
    currentPrice[2] = ceneCamera.x;
    currentPrice[6] = ceneCamera.y;
    currentPrice[10] = ceneCamera.z + 1 - clippingScale;
    currentPrice[14] = ceneCamera.w;
    this._virtualCamera.frustum.customProjectionMatrix =
      Cesium.Matrix4.clone(currentPrice);
    return true;
  }
  preRender(ceneSettings) {
    const defaultCamera = ceneSettings._defaultView.camera;
    const _ceneSettings = ceneSettings.shadowMap;
    const houldShowGps = ceneSettings.globe.show;
    const howGpsOnGlob = ceneSettings.globe.showSkirts;
    if (!this._updateVirtualCamera(ceneSettings._defaultView.camera)) {
      this._primitive.show = false;
      return;
    }
    this._primitive.show = false;
    ceneSettings._defaultView.camera = this._virtualCamera;
    ceneSettings.shadowMap = undefined;
    ceneSettings.globe.show = false;
    ceneSettings.globe.showSkirts = false;
    const ealTimeInfo = ceneSettings.context;
    const __ceneSettings = ealTimeInfo.drawingBufferWidth;
    const hashReference = ealTimeInfo.drawingBufferHeight;
    const essionKey = ceneSettings.highDynamicRange;
    this._createFramebuffer(
      ealTimeInfo,
      __ceneSettings,
      hashReference,
      essionKey,
    );
    enderContent(ceneSettings, this._colorFramebuffer);
    const encodedHexId = this._primitive.appearance;
    const ___ceneSettings = {
      context: ealTimeInfo,
      framebuffer: this._colorFramebuffer,
    };
    const generateRealE = Cesium.Texture.fromFramebuffer(___ceneSettings);
    generateRealE.type = "sampler2D";
    this._material.uniforms.reflexTexture = generateRealE;
    this._material.uniforms.time = performance.now() / 1000;
    this._material.uniforms.fixedFrameToEastNorthUpTransform =
      Cesium.Matrix4.toArray(
        this._getFixedFrameToEastNorthUpTransformFromWorldMatrix(),
      );
    encodedHexId.uniforms.reflectMatrix = Cesium.Matrix4.toArray(
      this._reflectMatrix,
    );
    encodedHexId.uniforms.reflectorProjectionMatrix = Cesium.Matrix4.toArray(
      this._reflectorProjectionMatrix,
    );
    encodedHexId.uniforms.reflectorViewMatrix = Cesium.Matrix4.toArray(
      this._reflectorViewMatrix,
    );
    this._primitive.show = true;
    ceneSettings._defaultView.camera = defaultCamera;
    ceneSettings.shadowMap = _ceneSettings;
    ceneSettings.globe.show = houldShowGps;
    ceneSettings.globe.showSkirts = howGpsOnGlob;
  }
  _createPrimitive(initialize, initialData) {
    const __eflectionMat = this._createReflectionWaterMaterial();
    this._material = __eflectionMat;
    const visualEffect = {
      material: __eflectionMat,
      vertexShaderSource: waterVertexSh,
      translucent: true,
    };
    const _visualEffect = new Cesium.MaterialAppearance(visualEffect);
    _visualEffect.uniforms = {};
    _visualEffect.uniforms.reflectMatrix = Cesium.Matrix4.toArray(
      this._reflectMatrix,
    );
    _visualEffect.uniforms.reflectorProjectionMatrix = Cesium.Matrix4.toArray(
      this._reflectorProjectionMatrix,
    );
    _visualEffect.uniforms.reflectorViewMatrix = Cesium.Matrix4.toArray(
      this._reflectorViewMatrix,
    );
    const primitiveFx = new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({
        geometry: Cesium.CoplanarPolygonGeometry.fromPositions({
          vertexFormat: Cesium.VertexFormat.POSITION_NORMAL_AND_ST,
          positions: initialize,
          stRotation: Cesium.Math.toRadians(initialData),
        }),
      }),
      appearance: _visualEffect,
      asynchronous: false,
    });
    return primitiveFx;
  }
  _getFixedFrameToEastNorthUpTransformFromWorldMatrix() {
    const eastNorthUpTf = Cesium.Transforms.eastNorthUpToFixedFrame(
      this._reflectorWorldPosition,
    );
    const worldMatrixIn = Cesium.Matrix4.inverse(
      eastNorthUpTf,
      new Cesium.Matrix4(),
    );
    return worldMatrixIn;
  }
  _createFramebuffer(colorTextureW, _colorTextureW, creationData, framebuffer) {
    const colorTexture = this._colorTexture;
    if (
      Cesium.defined(colorTexture) &&
      colorTexture.width === _colorTextureW &&
      colorTexture.height === creationData &&
      this._hdr === framebuffer
    ) {
      return;
    }
    this._destroyResource();
    this._hdr = framebuffer;
    const __colorTextureW = framebuffer
      ? colorTextureW.halfFloatingPointTexture
        ? Cesium.PixelDatatype.HALF_FLOAT
        : Cesium.PixelDatatype.FLOAT
      : Cesium.PixelDatatype.UNSIGNED_BYTE;
    this._colorTexture = new Cesium.Texture({
      context: colorTextureW,
      width: _colorTextureW,
      height: creationData,
      pixelFormat: Cesium.PixelFormat.RGBA,
      pixelDatatype: __colorTextureW,
      sampler: new Cesium.Sampler({
        wrapS: Cesium.TextureWrap.CLAMP_TO_EDGE,
        wrapT: Cesium.TextureWrap.CLAMP_TO_EDGE,
        minificationFilter: Cesium.TextureMinificationFilter.LINEAR,
        magnificationFilter: Cesium.TextureMagnificationFilter.LINEAR,
      }),
    });
    this._depthStencilTexture = new Cesium.Texture({
      context: colorTextureW,
      width: _colorTextureW,
      height: creationData,
      pixelFormat: Cesium.PixelFormat.DEPTH_STENCIL,
      pixelDatatype: Cesium.PixelDatatype.UNSIGNED_INT_24_8,
    });
    this._colorFramebuffer = new Cesium.Framebuffer({
      context: colorTextureW,
      colorTextures: [this._colorTexture],
      depthStencilTexture: this._depthStencilTexture,
      destroyAttachments: false,
    });
  }
  _destroyResource() {
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
export { riverSurface as default };
const unknownColor = new Cesium.Viewer("map", {
  infoBox: false,
  fullscreenButton: false,
  vrButton: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  selectionIndicator: false,
  timeline: false,
  navigationHelpButton: false,
  navigationInstructionsInitiallyVisible: false,
  animation: false,
  baseLayerPicker: false,
  terrainProvider: await Cesium.createWorldTerrainAsync(),
});
unknownColor._cesiumWidget._creditContainer.style.display = "none";
unknownColor.scene.globe.depthTestAgainstTerrain = true;
unknownColor.scene.debugShowFramesPerSecond = true;
const geographicLoc = [
  Cesium.Cartographic.fromDegrees(
    -75.59967741159785,
    40.04091766662355,
    76.37856662343563,
  ),
  Cesium.Cartographic.fromDegrees(
    -75.59955207631664,
    40.036827420667116,
    71.6963743893841,
  ),
  Cesium.Cartographic.fromDegrees(
    -75.59376378325359,
    40.0367060679407,
    83.98039248519758,
  ),
  Cesium.Cartographic.fromDegrees(
    -75.5936186712503,
    40.03959922674249,
    82.13316846253008,
  ),
  Cesium.Cartographic.fromDegrees(
    -75.59550520685805,
    40.04082628776817,
    84.00794582002823,
  ),
];
Cesium.Cesium3DTileset.fromUrl("/tiles/40866/tileset.json").then(
  (zoomIntoScene) => {
    unknownColor.scene.primitives.add(zoomIntoScene);
    unknownColor.zoomTo(zoomIntoScene);
  },
);
const cesium3DTile = {
  scene: unknownColor.scene,
  positions: geographicLoc,
  height: 81,
  rippleSize: 100,
};
const cesiumTileset = new riverSurface(cesium3DTile);
const guiLayout2 = new uiContainer();
const waterGeometry = {
  波纹大小: 50,
  透明度: 0.9,
  反射率: 0.3,
  扭曲: 3.7,
  高度: 81,
};
function updateWaterEe() {
  cesiumTileset.rippleSize = waterGeometry.波纹大小;
  cesiumTileset.waterAlpha = waterGeometry.透明度;
  cesiumTileset.reflectivity = waterGeometry.反射率;
  cesiumTileset.distortionScale = waterGeometry.扭曲;
  cesiumTileset.height = waterGeometry.高度;
}
guiLayout2
  .add(waterGeometry, "波纹大小")
  .min(0)
  .max(300)
  .onChange(updateWaterEe);
guiLayout2.add(waterGeometry, "透明度").min(0).max(1).onChange(updateWaterEe);
guiLayout2.add(waterGeometry, "反射率").min(0).max(1).onChange(updateWaterEe);
guiLayout2.add(waterGeometry, "扭曲").min(0).max(8).onChange(updateWaterEe);
guiLayout2.add(waterGeometry, "高度").min(70).max(100).onChange(updateWaterEe);
