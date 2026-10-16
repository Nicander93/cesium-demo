import * as Cesium from 'cesium'
import { microfacetLighting } from './lighting'
import { createWaveBands, spectralWaves } from './waves'
import { protectWaterEnvironmentOwnership } from './environment'

export interface WaterMaterialOptions {
  /** Experimental GGX surface lighting; legacy keeps existing appearance. */
  lightingModel?: 'legacy' | 'microfacet'
  /** Air-to-water dielectric IOR, default 1.333, range [1, 2.5]. Microfacet only. */
  indexOfRefraction?: number
  /** Artistic scale of indirect reflection and the tinted body proxy, default 1, [0, 4]. */
  environmentIntensity?: number
  /** Opt-in output experiment. Legacy keeps Cesium's additional Phong lighting. */
  shadingMode?: 'legacy-phong' | 'water-composite'
  origin?: Cesium.Cartesian3
  normalMapUrl?: string
  rippleSize?: number
  /** Legacy remains the default. Metric wave models require updateWaterMaterialView(). */
  waveModel?: 'legacy' | 'multiscale' | 'spectrum'
  /** Dominant wavelength in local ENU metres with WaterSurface. */
  waveLength?: number
  /** Compass bearing of wave travel, degrees clockwise from north. */
  waveDirection?: number
  /** Angular spread around the dominant travel bearing, degrees in [0, 90]. */
  waveSpread?: number
  waveIrregularity?: number
  detailStrength?: number
  roughness?: number
  specularIntensity?: number
  reflectionStrength?: number
  environmentColor?: Cesium.Color
  waveStrength?: number
  waterColor?: Cesium.Color
  waterAlpha?: number
  /** Optional fade width in normalized geometry UVs, 0–0.5; useful for local display crops. */
  edgeFadeWidth?: number
  reflectivity?: number
  sunShiny?: number
  distortionScale?: number
  lightDirection?: Cesium.Cartesian3
  /** Mapped-shore horizontal fade in metres, [0,64]; requires WaterSurface shoreline input. */
  shoreFadeDistance?: number
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
uniform float waveModel;
uniform float waterCompositeOutput;
uniform float waveLength;
uniform float waveDirection;
uniform float waveSpread;
uniform float waveIrregularity;
uniform float detailStrength;
uniform float roughness;
uniform float specularIntensity;
uniform float reflectionStrength;
uniform vec4 environmentColor;
uniform mat4 waveFromEye;
uniform float metricWavesReady;
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
uniform sampler2D shorelineTexture;
uniform vec4 shorelineBounds;
uniform float shorelineReady;
uniform float shoreFadeDistance;

float mappedShoreDistance(vec3 positionEC) {
  vec2 p = (waveFromEye * vec4(positionEC, 1.0)).xy;
  vec2 uv = (p - shorelineBounds.xy) / shorelineBounds.zw;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 64.0;
  // Canvas row zero contains the ENU south row; Fabric uploads canvases with flipY.
  uv.y = 1.0 - uv.y;
  vec2 code = texture(shorelineTexture, uv).rg;
  return ((code.r * 65280.0 + code.g * 255.0) / 65535.0 * 2.0 - 1.0) * 64.0;
}
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
  if (foamEnabled < 0.5) return 0.0;
  if (shorelineReady > 0.5) {
    if (foamWidth <= 0.0) return 0.0;
    float distance = mappedShoreDistance(positionEC);
    float band = 1.0 - smoothstep(0.0, foamWidth, max(distance, 0.0));
    vec2 local = (waveFromEye * vec4(positionEC, 1.0)).xy;
    float noise = foamNoise(local * 0.8 + vec2(time * foamSpeed * 0.3, -time * foamSpeed * 0.2));
    return clamp(band * foamIntensity * smoothstep(0.4, 0.8, noise), 0.0, 1.0);
  }
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

vec3 metricWaterNormal(vec2 p) {
  vec2 slope = vec2(0.0);
  // Three incommensurate components per scale reduce repeated parallel bands.
  // Weights preserve approximately the previous slope energy instead of boosting contrast.
  for (int i = 0; i < 4; i++) {
    float f = float(i);
    float baseLength = waveLength * pow(0.48, f);
    float seed = fract(sin(f * 12.9898 + 78.233) * 43758.5453);
    float phaseWarp = (foamNoise(p / (baseLength * 1.5) + vec2(f * 13.7, f * 7.1)) - 0.5) * waveIrregularity * 7.5;
    for (int j = 0; j < 3; j++) {
      float component = float(j);
      float ratio = j == 0 ? 1.0 : (j == 1 ? 0.81 + seed * 0.08 : 1.12 + seed * 0.17);
      float spread = j == 0 ? 0.0 : (j == 1 ? 0.45 + seed * 0.55 : -(0.45 + fract(seed * 7.13) * 0.55));
      float angle = waveDirection + waveSpread * spread;
      vec2 direction = vec2(sin(angle), cos(angle));
      float k = 6.2831853 / (baseLength * ratio);
      float phase = dot(p, direction) * k - time * sqrt(9.81 * k) + f * 2.13 + component * 2.3999632 + phaseWarp;
      float resolved = 1.0 - smoothstep(0.6, 2.2, fwidth(phase));
      float weight = j == 0 ? 0.65 : 0.54;
      slope += direction * cos(phase) * (0.10 / pow(1.35, f)) * weight * resolved;
    }
  }
  float detailLength = max(0.3, waveLength * 0.08);
  vec3 fine = waterNormal(p * (103.0 / detailLength));
  float footprint = max(length(dFdx(p / detailLength)), length(dFdy(p / detailLength)));
  float resolved = 1.0 - smoothstep(0.15, 0.7, footprint);
  slope += vec2(-fine.x, fine.z) * detailStrength * 0.13 * resolved;
  return normalize(vec3(-slope.x * waveStrength, 1.0, slope.y * waveStrength));
}

${spectralWaves}

${microfacetLighting}

czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material material = czm_getDefaultMaterial(materialInput);
  vec3 normal;
  float waveVariance = 0.0;
  if (waveModel > 1.5 && metricWavesReady > 0.5) {
    vec2 p = (waveFromEye * vec4(-materialInput.positionToEyeEC,1.0)).xy;
    vec2 dpdx = dFdx(p), dpdy = dFdy(p);
    if (waveDiagnostic > 2.5) { p=waveProbe.xy; dpdx=vec2(waveProbe.z,0.0); dpdy=vec2(0.0,waveProbe.w); }
    normal = spectralWaterNormal(p,dpdx,dpdy,waveVariance);
  } else if (waveModel > 0.5 && metricWavesReady > 0.5) {
    vec2 localPosition = (waveFromEye * vec4(-materialInput.positionToEyeEC, 1.0)).xy;
    normal = metricWaterNormal(localPosition);
  } else {
    normal = waterNormal((materialInput.st * 2.0 - 1.0) * size);
    normal = normalize(vec3(normal.x * waveStrength, normal.y, normal.z * waveStrength));
  }
  float surfaceRoughness = waveModel > 1.5 ? waterFilteredRoughness(waveVariance) : roughness;
  if (waveDiagnostic > 0.5) {
    bool showRoughness = (waveDiagnostic > 1.5 && waveDiagnostic < 2.5) || waveDiagnostic > 3.5;
    material.diffuse = vec3(0.0);
    material.specular = 0.0;
    material.emission = showRoughness ? vec3(surfaceRoughness) : vec3(normal.x*0.5+0.5,normal.z*0.5+0.5,normal.y);
    material.alpha = 1.0;
    return material;
  }
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
  if (waveModel > 0.5) {
    vec3 localLight = mat3(worldToLocal) * czm_inverseViewRotation * czm_lightDirectionEC;
    light = normalize(vec3(localLight.x, localLight.z, -localLight.y));
  }
  float diffuse = max(dot(light, normal), 0.0) * 0.5;
  float exponent = sunShiny;
  if (waveModel > 0.5) exponent = mix(220.0, 6.0, surfaceRoughness * surfaceRoughness);
  float variance = dot(dFdx(normal), dFdx(normal)) + dot(dFdy(normal), dFdy(normal));
  float filteredExponent = exponent / (1.0 + exponent * variance * 4.0);
  float specular = pow(max(dot(reflect(-light, normal), eyeDirection), 0.0), filteredExponent) * 2.0 * specularIntensity * filteredExponent / exponent;
  vec4 projected = reflectionFromEye * vec4(-materialInput.positionToEyeEC, 1.0);
  vec2 uv = projected.xy / max(projected.w, 0.0001) * 0.5 + 0.5;
  vec2 distortion = normal.xz * (0.001 + 1.0 / max(length(toEye), 1.0)) * distortionScale;
  vec2 reflectionUV = uv + distortion;
  vec2 edgeDistance = min(reflectionUV, 1.0 - reflectionUV);
  float inBounds = smoothstep(0.0, 0.02, min(edgeDistance.x, edgeDistance.y)) * step(0.0, projected.w);
  vec2 sampleUV = clamp(reflectionUV, 0.001, 0.999);
  vec3 reflectedSample = texture(reflexTexture, sampleUV).rgb;
  if (waveModel > 0.5 && surfaceRoughness > 0.01) {
    float radius = surfaceRoughness * surfaceRoughness * 0.008;
    reflectedSample = (reflectedSample * 2.0
      + texture(reflexTexture, clamp(sampleUV + vec2(radius,0.0),0.001,0.999)).rgb
      + texture(reflexTexture, clamp(sampleUV - vec2(radius,0.0),0.001,0.999)).rgb
      + texture(reflexTexture, clamp(sampleUV + vec2(0.0,radius),0.001,0.999)).rgb
      + texture(reflexTexture, clamp(sampleUV - vec2(0.0,radius),0.001,0.999)).rgb) / 6.0;
  }
  vec3 reflected = mix(environmentColor.rgb, reflectedSample, reflectionReady * inBounds);
  float fresnel = mix(rf0, 1.0, pow(1.0 - max(dot(eyeDirection, normal), 0.0), 5.0)) * reflectionStrength;
  vec3 scatter = max(dot(normal, eyeDirection), 0.0) * waterColor.rgb;
  material.diffuse = mix(vec3(diffuse * 0.3) + scatter, vec3(0.1) + reflected * 0.9 + reflected * specular, fresnel);
  if (microfacetEnabled > 0.5) {
    vec3 hostLight = mat3(worldToLocal) * czm_inverseViewRotation * czm_lightDirectionEC;
    hostLight = normalize(vec3(hostLight.x,hostLight.z,-hostLight.y));
    if (localFrameReady < 0.5) {
      // Match the fallback eye basis for a host-owned material without an ENU origin.
      vec3 nEC = normalize(materialInput.normalEC);
      vec3 axis = abs(nEC.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
      vec3 tangent = normalize(cross(axis, nEC));
      vec3 bitangent = cross(nEC, tangent);
      hostLight = normalize(vec3(dot(czm_lightDirectionEC,tangent),dot(czm_lightDirectionEC,nEC),-dot(czm_lightDirectionEC,bitangent)));
    }
    material.diffuse = waterMicrofacet(normal,eyeDirection,hostLight,reflectedSample,reflectionReady*inBounds,surfaceRoughness);
  }
  material.alpha = waterAlpha;
  float foam = shoreFoam(-materialInput.positionToEyeEC);
  material.diffuse = mix(material.diffuse, (microfacetEnabled > 0.5 ? waterLinear(vec3(0.88,0.95,0.93)) : vec3(0.88,0.95,0.93)), foam);
  material.alpha = mix(material.alpha, 1.0, foam);
  if (edgeFadeWidth > 0.0) {
    vec2 edge = min(materialInput.st, 1.0 - materialInput.st);
    material.alpha *= smoothstep(0.0, edgeFadeWidth, min(edge.x, edge.y));
  }
  if (shorelineReady > 0.5 && shoreFadeDistance > 0.0) {
    material.alpha *= smoothstep(0.0, shoreFadeDistance, mappedShoreDistance(-materialInput.positionToEyeEC));
  }
  if (microfacetEnabled > 0.5) {
#ifndef HDR
    material.diffuse = waterDisplay(material.diffuse);
#endif
  }
  if (waterCompositeOutput > 0.5 || microfacetEnabled > 0.5) {
    // The water color above already contains lighting/reflection. Use emission as
    // Cesium's prelit-color carrier, not as an extra self-illumination contribution.
    material.emission = material.diffuse;
    material.diffuse = vec3(0.0);
    material.specular = 0.0;
  }
  return material;
}`

export function createWaterMaterial(options: WaterMaterialOptions = {}): Cesium.Material {
  validateWaterMaterial(options)
  return protectWaterEnvironmentOwnership(new Cesium.Material({
    fabric: {
      type: 'DemoWaterSurface',
      source,
      uniforms: {
        normalTexture: options.normalMapUrl ?? Cesium.Material.DefaultImageId,
        reflexTexture: Cesium.Material.DefaultImageId,
        time: 0,
        ...createWaveBands({waveLength:options.waveLength ?? 48,direction:Cesium.Math.toRadians(options.waveDirection ?? 55),spread:Cesium.Math.toRadians(options.waveSpread ?? 35),irregularity:options.waveIrregularity ?? 0.35}),
        waveDiagnostic: 0, waveProbe: new Cesium.Cartesian4(),
        microfacetEnabled: options.lightingModel === 'microfacet' ? 1 : 0,
        indexOfRefraction: options.indexOfRefraction ?? 1.333,
        environmentIntensity: options.environmentIntensity ?? 1,
        waterEnvironmentMap: Cesium.Material.DefaultCubeMapId,
        waterBrdfLut: Cesium.Material.DefaultImageId,
        waterEnvironmentReady: 0, waterEnvironmentMaxLod: 6, waterBrdfReady: 0, lightingDebug: 0,
        waterSH0: new Cesium.Cartesian3(),
        waterSH1: new Cesium.Cartesian3(),
        waterSH2: new Cesium.Cartesian3(),
        waterSH3: new Cesium.Cartesian3(),
        waterSH4: new Cesium.Cartesian3(),
        waterSH5: new Cesium.Cartesian3(),
        waterSH6: new Cesium.Cartesian3(),
        waterSH7: new Cesium.Cartesian3(),
        waterSH8: new Cesium.Cartesian3(),
        size: options.rippleSize ?? 50,
        waveStrength: options.waveStrength ?? 1,
        waterCompositeOutput: options.shadingMode === 'water-composite' ? 1 : 0,
        waveModel: options.waveModel === 'spectrum' ? 2 : options.waveModel === 'multiscale' ? 1 : 0,
        waveLength: options.waveLength ?? 48,
        waveDirection: Cesium.Math.toRadians(options.waveDirection ?? 55),
        waveSpread: Cesium.Math.toRadians(options.waveSpread ?? 35),
        waveIrregularity: options.waveIrregularity ?? 0.35,
        detailStrength: options.detailStrength ?? 0.35,
        roughness: options.roughness ?? 0.22,
        specularIntensity: options.specularIntensity ?? 1,
        reflectionStrength: options.reflectionStrength ?? 1,
        environmentColor: Cesium.Color.clone(options.environmentColor ?? new Cesium.Color(0.30,0.46,0.60,1)),
        waveFromEye: Cesium.Matrix4.toArray(Cesium.Matrix4.IDENTITY),
        metricWavesReady: 0,
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
        shorelineTexture: Cesium.Material.DefaultImageId,
        shorelineBounds: new Cesium.Cartesian4(0, 0, 1, 1),
        shorelineReady: 0,
        shoreFadeDistance: options.shoreFadeDistance ?? 0,
        foamEnabled: options.foam === false ? 0 : 1,
        foamWidth: options.foamWidth ?? 2,
        foamIntensity: options.foamIntensity ?? 0.8,
        foamSpeed: options.foamSpeed ?? 0.5,
      },
    },
    translucent: (material: Cesium.Material) => material.uniforms.waterAlpha < 1 || material.uniforms.edgeFadeWidth > 0 || material.uniforms.shoreFadeDistance > 0,
  }))
}

export function updateWaterMaterial(material: Cesium.Material, options: WaterMaterialOptions & { time?: number }): void {
  validateWaterMaterial(options)
  if (options.time !== undefined && !Number.isFinite(options.time)) throw new RangeError('time must be finite')
  const u=material.uniforms
  const bands = options.waveLength !== undefined || options.waveDirection !== undefined || options.waveSpread !== undefined || options.waveIrregularity !== undefined
    ? createWaveBands({waveLength:options.waveLength ?? u.waveLength,direction:options.waveDirection === undefined ? u.waveDirection : Cesium.Math.toRadians(options.waveDirection),spread:options.waveSpread === undefined ? u.waveSpread : Cesium.Math.toRadians(options.waveSpread),irregularity:options.waveIrregularity ?? u.waveIrregularity}) : undefined
  const names = { indexOfRefraction: 'indexOfRefraction', environmentIntensity: 'environmentIntensity', shoreFadeDistance: 'shoreFadeDistance', waveIrregularity: 'waveIrregularity', waveLength: 'waveLength', detailStrength: 'detailStrength', roughness: 'roughness', specularIntensity: 'specularIntensity', reflectionStrength: 'reflectionStrength', waveStrength: 'waveStrength', rippleSize: 'size', waterAlpha: 'waterAlpha', edgeFadeWidth: 'edgeFadeWidth', reflectivity: 'rf0', sunShiny: 'sunShiny', distortionScale: 'distortionScale', time: 'time', foamWidth: 'foamWidth', foamIntensity: 'foamIntensity', foamSpeed: 'foamSpeed' } as const
  for (const key of Object.keys(names) as (keyof typeof names)[]) {
    if (options[key] !== undefined) material.uniforms[names[key]] = options[key]
  }
  if (options.lightingModel !== undefined) material.uniforms.microfacetEnabled = options.lightingModel === 'microfacet' ? 1 : 0
  if (options.shadingMode !== undefined) material.uniforms.waterCompositeOutput = options.shadingMode === 'water-composite' ? 1 : 0
  if (options.waveModel !== undefined) material.uniforms.waveModel = options.waveModel === 'spectrum' ? 2 : options.waveModel === 'multiscale' ? 1 : 0
  if (options.waveSpread !== undefined) material.uniforms.waveSpread = Cesium.Math.toRadians(options.waveSpread)
  if (options.waveDirection !== undefined) material.uniforms.waveDirection = Cesium.Math.toRadians(options.waveDirection)
  if (options.environmentColor !== undefined) material.uniforms.environmentColor = Cesium.Color.clone(options.environmentColor)
  if (options.normalMapUrl !== undefined) { material.uniforms.normalTexture = options.normalMapUrl; material.uniforms.useNormalTexture = 1 }
  if (options.origin !== undefined) { material.uniforms.worldToLocal = localFrame(options.origin); material.uniforms.localFrameReady = 1 }
  if (options.waterColor !== undefined) material.uniforms.waterColor = Cesium.Color.clone(options.waterColor)
  if (options.lightDirection !== undefined) material.uniforms.lightDirection = Cesium.Cartesian3.clone(options.lightDirection)
  if (options.foam !== undefined) material.uniforms.foamEnabled = options.foam ? 1 : 0
  if (bands) Object.assign(u,bands)
}

function validateWaterMaterial(options: WaterMaterialOptions): void {
  if(options.lightingModel !== undefined && options.lightingModel !== 'legacy' && options.lightingModel !== 'microfacet') throw new RangeError('Unknown water lighting model')
  if(options.indexOfRefraction !== undefined && (!Number.isFinite(options.indexOfRefraction)||options.indexOfRefraction<1||options.indexOfRefraction>2.5)) throw new RangeError('indexOfRefraction must be in [1,2.5]')
  if(options.environmentIntensity !== undefined && (!Number.isFinite(options.environmentIntensity)||options.environmentIntensity<0||options.environmentIntensity>4)) throw new RangeError('environmentIntensity must be in [0,4]')
  if (options.shoreFadeDistance !== undefined && (!Number.isFinite(options.shoreFadeDistance) || options.shoreFadeDistance < 0 || options.shoreFadeDistance > 64)) throw new RangeError('shoreFadeDistance must be metres in [0,64]')
  if (options.shadingMode !== undefined && options.shadingMode !== 'legacy-phong' && options.shadingMode !== 'water-composite') throw new RangeError('Unknown water shading mode')
  if (options.waveModel !== undefined && options.waveModel !== 'legacy' && options.waveModel !== 'multiscale' && options.waveModel !== 'spectrum') throw new RangeError('Unknown wave model')
  if (options.waveLength !== undefined && (!Number.isFinite(options.waveLength) || options.waveLength <= 0)) throw new RangeError('waveLength must be positive metres')
  if (options.waveSpread !== undefined && (!Number.isFinite(options.waveSpread) || options.waveSpread < 0 || options.waveSpread > 90)) throw new RangeError('waveSpread must be degrees in [0, 90]')
  if (options.waveDirection !== undefined && !Number.isFinite(options.waveDirection)) throw new RangeError('waveDirection must be finite degrees')
  for (const key of ['detailStrength','specularIntensity'] as const) if (options[key] !== undefined && (!Number.isFinite(options[key]) || options[key] < 0 || options[key] > 4)) throw new RangeError(key+' must be in [0, 4]')
  for (const key of ['roughness','reflectionStrength','waveIrregularity'] as const) if (options[key] !== undefined && (!Number.isFinite(options[key]) || options[key] < 0 || options[key] > 1)) throw new RangeError(key+' must be in [0, 1]')
  if (options.environmentColor && ![options.environmentColor.red,options.environmentColor.green,options.environmentColor.blue,options.environmentColor.alpha].every(Number.isFinite)) throw new TypeError('environmentColor must be finite')
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

/** Update the metric ENU wave frame using public Cesium camera/matrix APIs. Call before rendering. */
export function updateWaterMaterialView(material: Cesium.Material, camera: Cesium.Camera, origin: Cesium.Cartesian3): void {
  const inverse = Cesium.Matrix4.inverse(Cesium.Transforms.eastNorthUpToFixedFrame(origin), new Cesium.Matrix4())
  const fromEye = Cesium.Matrix4.multiply(inverse, camera.inverseViewMatrix, new Cesium.Matrix4())
  material.uniforms.waveFromEye = Cesium.Matrix4.toArray(fromEye, material.uniforms.waveFromEye)
  material.uniforms.worldToLocal = Cesium.Matrix4.toArray(inverse, material.uniforms.worldToLocal)
  material.uniforms.localFrameReady = 1
  material.uniforms.metricWavesReady = 1
}
