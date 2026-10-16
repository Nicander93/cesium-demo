import * as Cesium from 'cesium'
import type { WaterSurfaceUpdateOptions } from './surface'
export type WaterPresetName = 'calm-lake' | 'windy-lake'
export type WaterPresetOptions = Required<
  Pick<
    WaterSurfaceUpdateOptions,
    | 'waveModel'
    | 'waveLength'
    | 'waveDirection'
    | 'waveSpread'
    | 'waveIrregularity'
    | 'detailStrength'
    | 'roughness'
    | 'specularIntensity'
    | 'reflectionStrength'
    | 'waveStrength'
    | 'waveSpeed'
    | 'waterColor'
    | 'waterAlpha'
    | 'reflectivity'
    | 'distortionScale'
    | 'quality'
    | 'reflection'
    | 'reflectGlobe'
    | 'reflectionMaxSize'
    | 'reflectionMaxFps'
    | 'edgeFadeWidth'
    | 'foam'
  >
>

/** Presets are starting configurations, not fixed effects or physical flow data. */
export function createWaterPreset(
  name: WaterPresetName = 'calm-lake',
): WaterPresetOptions {
  if (name !== 'calm-lake' && name !== 'windy-lake')
    throw new RangeError('Unknown water preset')
  const windy = name === 'windy-lake'
  return {
    waveModel: 'spectrum',
    waveLength: windy ? 28 : 48,
    waveDirection: 55,
    waveSpread: windy ? 55 : 35,
    waveIrregularity: windy ? 0.65 : 0.35,
    detailStrength: windy ? 0.7 : 0.35,
    roughness: windy ? 0.32 : 0.18,
    specularIntensity: 0.7,
    reflectionStrength: 1,
    waveStrength: windy ? 1.5 : 0.8,
    waveSpeed: windy ? 1 : 0.7,
    waterColor: Cesium.Color.fromCssColorString('#238da1'),
    waterAlpha: 0.97,
    reflectivity: 0.045,
    distortionScale: windy ? 4 : 2.5,
    quality: 'balanced',
    reflection: true,
    reflectGlobe: true,
    reflectionMaxSize: 1024,
    reflectionMaxFps: 15,
    edgeFadeWidth: 0.08,
    foam: false,
  }
}
