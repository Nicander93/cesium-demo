import * as Cesium from 'cesium'
import { getFloodAppearancePreset } from './appearance'
import { microfacetLighting } from '../../water/lighting'
import { protectWaterEnvironmentOwnership } from '../../water/environment'

export interface FloodLightingOptions {
  model?: 'legacy' | 'microfacet'
  roughness?: number
  specularIntensity?: number
  environmentIntensity?: number
  skyEnvironment?: boolean
}

export function resolveFloodLighting(
  options: FloodLightingOptions,
  current: Required<FloodLightingOptions> = {
    model: 'legacy',
    roughness: 0.32,
    specularIntensity: 1,
    environmentIntensity: 1,
    skyEnvironment: true,
  },
): Required<FloodLightingOptions> {
  const next = { ...current, ...options }
  if (next.model !== 'legacy' && next.model !== 'microfacet')
    throw new RangeError('未知洪水光照模型')
  if (typeof next.skyEnvironment !== 'boolean')
    throw new TypeError('skyEnvironment 必须为布尔值')
  if (
    !Number.isFinite(next.roughness) ||
    next.roughness < 0 ||
    next.roughness > 1
  )
    throw new RangeError('roughness 必须在 0–1 之间')
  for (const key of ['specularIntensity', 'environmentIntensity'] as const)
    if (!Number.isFinite(next[key]) || next[key] < 0 || next[key] > 4)
      throw new RangeError(key + ' 必须在 0–4 之间')
  return next
}

/** Shared water BRDF and environment slots; the layer owns lifecycle, the host owns lighting. */
export function createFloodMaterial(): Cesium.Material {
  const appearance = getFloodAppearancePreset('clear')
  const uniforms: Record<string, unknown> = {
    shallowColor: Cesium.Color.fromCssColorString(appearance.shallowColor),
    deepColor: Cesium.Color.fromCssColorString(appearance.deepColor),
    foamColor: Cesium.Color.fromCssColorString(appearance.foamColor),
    colorDepth: appearance.colorDepth,
    surfaceOpacity: appearance.opacity,
    waveStrength: appearance.waveStrength,
    flowStrength: appearance.flowStrength,
    visualTime: 0,
    flowEnabled: 1,
    foamOpacity: 0.75,
    diagnosticMode: 0,
    surfaceStyle: 0,
    microfacetEnabled: 0,
    indexOfRefraction: 1.333,
    roughness: 0.32,
    specularIntensity: 1,
    environmentIntensity: 1,
    reflectionStrength: 1,
    environmentColor: new Cesium.Color(0.3, 0.46, 0.6, 1),
    waterEnvironmentMap: Cesium.Material.DefaultCubeMapId,
    waterBrdfLut: Cesium.Material.DefaultImageId,
    waterEnvironmentReady: 0,
    waterEnvironmentMaxLod: 6,
    waterBrdfReady: 0,
    lightingDebug: 0,
  }
  for (let i = 0; i < 9; i++) uniforms['waterSH' + i] = new Cesium.Cartesian3()
  return protectWaterEnvironmentOwnership(
    new Cesium.Material({
      fabric: {
        type: 'FloodSurfaceClock',
        uniforms,
        source:
          microfacetLighting +
          `
      vec3 floodBodyColor(float depth) {
        // Preserve the original channel ratios; this is an artistic depth-color proxy.
        return mix(deepColor.rgb, shallowColor.rgb, exp(-vec3(3.5,1.5,1.0)*depth/colorDepth));
      }
      vec3 floodFoamColor() { return foamColor.rgb; }
      vec3 floodLinearFoamColor() { return waterLinear(foamColor.rgb); }
      float floodOpacity() { return surfaceOpacity; }
      float floodWaveStrength() { return waveStrength; }
      float floodFlowStrength() { return flowStrength; }
      float floodVisualTime() { return visualTime; }
      float floodFlowEnabled() { return flowEnabled; }
      float floodFoamOpacity() { return foamOpacity; }
      float floodDiagnosticMode() { return diagnosticMode; }
      float floodSurfaceStyle() { return surfaceStyle; }
      float floodLightingModel() { return microfacetEnabled; }
      vec3 floodSurfaceLighting(vec3 N, vec3 V, vec3 L, vec3 body) {
        return waterMicrofacet(N,V,L,vec3(0.0),0.0,roughness,body);
      }
      vec3 floodDisplayColor(vec3 rgb) { return waterDisplay(rgb); }
      czm_material czm_getMaterial(czm_materialInput inputValue) { return czm_getDefaultMaterial(inputValue); }
    `,
      },
    }),
  )
}
