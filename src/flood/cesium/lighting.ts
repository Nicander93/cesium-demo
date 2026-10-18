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
    opacityDepth: appearance.opacityDepth,
    bodyScattering: appearance.bodyScattering,
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
        // Interpolate body colors in linear space with one depth weight.
        // Clear-water RGB extinction ratios must not be imposed on arbitrary sediment colors.
        return waterDisplay(mix(waterLinear(deepColor.rgb),waterLinear(shallowColor.rgb),exp(-depth/colorDepth)));
      }
      vec3 floodFoamColor() { return foamColor.rgb; }
      vec3 floodLinearFoamColor() { return waterLinear(foamColor.rgb); }
      float floodOpacity() { return surfaceOpacity; }
      float floodDepthOpacity(float depth) { return 1.0-exp(-max(depth,0.0)/opacityDepth); }
      float floodWaveStrength() { return waveStrength; }
      float floodFlowStrength() { return flowStrength; }
      float floodVisualTime() { return visualTime; }
      float floodFlowEnabled() { return flowEnabled; }
      float floodFoamOpacity() { return foamOpacity; }
      float floodDiagnosticMode() { return diagnosticMode; }
      float floodSurfaceStyle() { return surfaceStyle; }
      float floodLightingModel() { return microfacetEnabled; }
      vec3 floodSurfaceLighting(vec3 N, vec3 V, vec3 L, vec3 body) {
        // Bounded Lambertian body proxy for turbid water, alongside the existing sky-lit body.
        // The Fresnel complement reserves energy for surface reflection. This is not a volume integrator.
        float f0=pow((indexOfRefraction-1.0)/(indexOfRefraction+1.0),2.0);
        float transmitted=1.0-waterFresnel(f0,max(dot(N,V),0.0));
        vec3 bodyLight=waterLinear(body)*max(czm_lightColorHdr,vec3(0.0))
          *max(dot(N,L),0.0)*transmitted*bodyScattering/3.14159265359;
        return waterMicrofacet(N,V,L,vec3(0.0),0.0,roughness,body)+bodyLight;
      }
      vec3 floodDisplayColor(vec3 rgb) { return waterDisplay(rgb); }
      czm_material czm_getMaterial(czm_materialInput inputValue) { return czm_getDefaultMaterial(inputValue); }
    `,
      },
    }),
  )
}
