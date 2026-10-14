import * as Cesium from 'cesium'

export interface WaterMaterialOptions {
  origin?: Cesium.Cartesian3
  normalMapUrl?: string
  rippleSize?: number
  waveStrength?: number
  waterColor?: Cesium.Color
  waterAlpha?: number
  /** Optional fade width in normalized geometry UVs, 0–0.5; useful for local display crops. */
  edgeFadeWidth?: number
  reflectivity?: number
  sunShiny?: number
  distortionScale?: number
  lightDirection?: Cesium.Cartesian3
  foam?: boolean
  foamWidth?: number
  foamIntensity?: number
  foamSpeed?: number
}

// Uses standard MaterialAppearance inputs, so the material also works on host-owned geometry.
const source = `
uniform sampler2D normalTexture;
uniform sampler2D reflexTexture;
uniform float time;
uniform float size;
uniform float waveStrength;
uniform vec4 waterColor;
uniform float waterAlpha;
uniform float edgeFadeWidth;
uniform float rf0;
uniform vec3 lightDirection;
uniform float sunShiny;
uniform float distortionScale;
uniform float reflectionReady;
uniform mat4 worldToLocal;
uniform mat4 reflectionFromEye;
uniform float localFrameReady;
uniform float useNormalTexture;
uniform sampler2D shoreDepthTexture;
uniform sampler2D shoreMaskTexture;
uniform mat4 shoreFromEye;
uniform mat4 shoreHeightFromClip;
uniform vec2 shoreSize;
uniform float shoreReady;
uniform float foamEnabled;
uniform float foamWidth;
uniform float foamIntensity;
uniform float foamSpeed;

float foamNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec4 h = fract(sin(vec4(dot(i, vec2(127.1, 311.7)), dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7)), dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7)), dot(i + 1.0, vec2(127.1, 311.7)))) * 43758.5453);
  return mix(mix(h.x, h.y, f.x), mix(h.z, h.w, f.x), f.y);
}

float shoreHeight(vec2 uv) {
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return -1000.0;
  float depth = texture(shoreDepthTexture, uv).r;
  if (depth >= 0.999999 || depth <= 0.0) return -1000.0;
  vec4 local = shoreHeightFromClip * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  return local.z / local.w;
}

float shoreLand(vec2 uv) { return smoothstep(-0.15, 0.15, shoreHeight(uv)); }

float shoreFoam(vec3 positionEC) {
  if (foamEnabled < 0.5 || shoreReady < 0.5 || foamWidth <= 0.0) return 0.0;
  vec4 clip = shoreFromEye * vec4(positionEC, 1.0);
  vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
  float band = texture(shoreMaskTexture, uv).r;
  vec2 local = (uv - 0.5) * shoreSize;
  float noise = foamNoise(local * 2.0 + vec2(time * foamSpeed * 0.3, -time * foamSpeed * 0.2));
  float wave = 0.5 + 0.5 * sin(band * 14.0 - time * foamSpeed * 6.0 + foamNoise(local * 0.3) * 4.0);
  return clamp(band * foamIntensity * smoothstep(0.25, 0.75, noise + wave * 0.3), 0.0, 1.0);
}

vec3 waterNormal(vec2 uv) {
  if (useNormalTexture < 0.5) {
    return normalize(vec3(sin(uv.x * 0.15 + time) * 0.18, 1.0, cos(uv.y * 0.17 - time * 0.8) * 0.18));
  }
  // Fabric image samplers clamp at the edge. Wrap UVs so animated waves keep repeating.
  vec4 noise = texture(normalTexture, fract(uv / 103.0 + vec2(time / 17.0, time / 29.0)))
    + texture(normalTexture, fract(uv / 107.0 - vec2(time / -19.0, time / 31.0)))
    + texture(normalTexture, fract(uv / vec2(8907.0, 9803.0) + vec2(time / 101.0, time / 97.0)))
    + texture(normalTexture, fract(uv / vec2(1091.0, 1027.0) - vec2(time / 109.0, time / -113.0)));
  vec3 n = (noise * 0.5 - 1.0).xzy;
  return normalize(n + vec3(0.0, 0.0001, 0.0));
}

czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material material = czm_getDefaultMaterial(materialInput);
  vec3 normal = waterNormal((materialInput.st * 2.0 - 1.0) * size);
  normal = normalize(vec3(normal.x * waveStrength, normal.y, normal.z * waveStrength));
  // Keep fragment math near the camera; ECEF reconstruction quantizes close-up reflections.
  vec3 toEye = mat3(worldToLocal) * czm_inverseViewRotation * materialInput.positionToEyeEC;
  toEye = vec3(toEye.x, toEye.z, -toEye.y);
  vec3 eyeDirection = normalize(toEye);
  if (localFrameReady < 0.5) {
    vec3 nEC = normalize(materialInput.normalEC);
    vec3 axis = abs(nEC.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 tangent = normalize(cross(axis, nEC));
    vec3 bitangent = cross(nEC, tangent);
    vec3 eyeEC = normalize(materialInput.positionToEyeEC);
    eyeDirection = vec3(dot(eyeEC, tangent), dot(eyeEC, nEC), -dot(eyeEC, bitangent));
  }
  vec3 light = normalize(lightDirection);
  float diffuse = max(dot(light, normal), 0.0) * 0.5;
  float specular = pow(max(dot(reflect(-light, normal), eyeDirection), 0.0), sunShiny) * 2.0;
  vec4 projected = reflectionFromEye * vec4(-materialInput.positionToEyeEC, 1.0);
  vec2 uv = projected.xy / max(projected.w, 0.0001) * 0.5 + 0.5;
  vec2 distortion = normal.xz * (0.001 + 1.0 / max(length(toEye), 1.0)) * distortionScale;
  vec2 reflectionUV = uv + distortion;
  vec2 edgeDistance = min(reflectionUV, 1.0 - reflectionUV);
  float inBounds = smoothstep(0.0, 0.02, min(edgeDistance.x, edgeDistance.y)) * step(0.0, projected.w);
  vec3 reflected = mix(vec3(0.30, 0.46, 0.60), texture(reflexTexture, clamp(reflectionUV, 0.001, 0.999)).rgb, reflectionReady * inBounds);
  float fresnel = mix(rf0, 1.0, pow(1.0 - max(dot(eyeDirection, normal), 0.0), 5.0));
  vec3 scatter = max(dot(normal, eyeDirection), 0.0) * waterColor.rgb;
  material.diffuse = mix(vec3(diffuse * 0.3) + scatter, vec3(0.1) + reflected * 0.9 + reflected * specular, fresnel);
  material.alpha = waterAlpha;
  float foam = shoreFoam(-materialInput.positionToEyeEC);
  material.diffuse = mix(material.diffuse, vec3(0.88, 0.95, 0.93), foam);
  material.alpha = mix(material.alpha, 1.0, foam);
  if (edgeFadeWidth > 0.0) {
    vec2 edge = min(materialInput.st, 1.0 - materialInput.st);
    material.alpha *= smoothstep(0.0, edgeFadeWidth, min(edge.x, edge.y));
  }
  return material;
}`

export function createWaterMaterial(options: WaterMaterialOptions = {}): Cesium.Material {
  validateWaterMaterial(options)
  return new Cesium.Material({
    fabric: {
      type: 'DemoWaterSurface',
      source,
      uniforms: {
        normalTexture: options.normalMapUrl ?? Cesium.Material.DefaultImageId,
        reflexTexture: Cesium.Material.DefaultImageId,
        time: 0,
        size: options.rippleSize ?? 50,
        waveStrength: options.waveStrength ?? 1,
        waterColor: Cesium.Color.clone(options.waterColor ?? Cesium.Color.fromCssColorString('#001e0f')),
        waterAlpha: options.waterAlpha ?? 0.9,
        edgeFadeWidth: options.edgeFadeWidth ?? 0,
        rf0: options.reflectivity ?? 0.3,
        lightDirection: Cesium.Cartesian3.clone(options.lightDirection ?? new Cesium.Cartesian3(0, 1, 0)),
        sunShiny: options.sunShiny ?? 100,
        distortionScale: options.distortionScale ?? 3.7,
        reflectionReady: 0,
        useNormalTexture: options.normalMapUrl ? 1 : 0,
        localFrameReady: options.origin ? 1 : 0,
        worldToLocal: localFrame(options.origin),
        reflectionFromEye: Cesium.Matrix4.toArray(Cesium.Matrix4.IDENTITY),
        shoreDepthTexture: Cesium.Material.DefaultImageId,
        shoreMaskTexture: Cesium.Material.DefaultImageId,
        shoreFromEye: Cesium.Matrix4.toArray(Cesium.Matrix4.IDENTITY),
        shoreHeightFromClip: Cesium.Matrix4.toArray(Cesium.Matrix4.IDENTITY),
        shoreSize: new Cesium.Cartesian2(1, 1),
        shoreReady: 0,
        foamEnabled: options.foam === false ? 0 : 1,
        foamWidth: options.foamWidth ?? 2,
        foamIntensity: options.foamIntensity ?? 0.8,
        foamSpeed: options.foamSpeed ?? 0.5,
      },
    },
    translucent: (material: Cesium.Material) => material.uniforms.waterAlpha < 1 || material.uniforms.edgeFadeWidth > 0,
  })
}

export function updateWaterMaterial(material: Cesium.Material, options: WaterMaterialOptions & { time?: number }): void {
  validateWaterMaterial(options)
  if (options.time !== undefined && !Number.isFinite(options.time)) throw new RangeError('time must be finite')
  const names = { waveStrength: 'waveStrength', rippleSize: 'size', waterAlpha: 'waterAlpha', edgeFadeWidth: 'edgeFadeWidth', reflectivity: 'rf0', sunShiny: 'sunShiny', distortionScale: 'distortionScale', time: 'time', foamWidth: 'foamWidth', foamIntensity: 'foamIntensity', foamSpeed: 'foamSpeed' } as const
  for (const key of Object.keys(names) as (keyof typeof names)[]) {
    if (options[key] !== undefined) material.uniforms[names[key]] = options[key]
  }
  if (options.normalMapUrl !== undefined) { material.uniforms.normalTexture = options.normalMapUrl; material.uniforms.useNormalTexture = 1 }
  if (options.origin !== undefined) { material.uniforms.worldToLocal = localFrame(options.origin); material.uniforms.localFrameReady = 1 }
  if (options.waterColor !== undefined) material.uniforms.waterColor = Cesium.Color.clone(options.waterColor)
  if (options.lightDirection !== undefined) material.uniforms.lightDirection = Cesium.Cartesian3.clone(options.lightDirection)
  if (options.foam !== undefined) material.uniforms.foamEnabled = options.foam ? 1 : 0
}

function validateWaterMaterial(options: WaterMaterialOptions): void {
  if (options.edgeFadeWidth !== undefined && (!Number.isFinite(options.edgeFadeWidth) || options.edgeFadeWidth < 0 || options.edgeFadeWidth > 0.5)) throw new RangeError('edgeFadeWidth must be in [0, 0.5]')
  for (const key of ['waveStrength', 'rippleSize', 'sunShiny', 'distortionScale', 'foamWidth', 'foamSpeed'] as const) {
    const value = options[key]
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || (key === 'sunShiny' && value === 0))) throw new RangeError(`${key} is invalid`)
  }
  for (const key of ['waterAlpha', 'reflectivity', 'foamIntensity'] as const) {
    const value = options[key]
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) throw new RangeError(`${key} must be between 0 and 1`)
  }
  if (options.normalMapUrl !== undefined && !options.normalMapUrl.trim()) throw new TypeError('normalMapUrl must not be empty')
  if (options.origin && ![options.origin.x, options.origin.y, options.origin.z].every(Number.isFinite)) throw new TypeError('origin must be finite')
  if (options.waterColor && ![options.waterColor.red, options.waterColor.green, options.waterColor.blue, options.waterColor.alpha].every(Number.isFinite)) throw new TypeError('waterColor must be finite')
  if (options.lightDirection && (!Number.isFinite(Cesium.Cartesian3.magnitude(options.lightDirection)) || Cesium.Cartesian3.magnitude(options.lightDirection) === 0)) throw new TypeError('lightDirection must be nonzero and finite')
}

function localFrame(origin?: Cesium.Cartesian3): number[] {
  return Cesium.Matrix4.toArray(origin ? Cesium.Matrix4.inverse(Cesium.Transforms.eastNorthUpToFixedFrame(origin), new Cesium.Matrix4()) : Cesium.Matrix4.IDENTITY)
}
