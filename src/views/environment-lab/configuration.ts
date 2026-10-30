import {
  normalizeEnvironmentOptions,
  presetEnvironmentOptions,
  type EnvironmentOptions,
  type EnvironmentPreset,
} from '../../environment/presets'
import type { DemoScene } from './landscape'

export interface ShadowSettings {
  size: 1024 | 2048 | 4096
  soft: boolean
  distance: number
  darkness: number
  depthBias: number
  normalOffset: number
  backgroundReceives: boolean
  treeShadows: 'off' | 'cast' | 'both'
  buildingShadows: 'cast' | 'both'
}
export interface WaterSettings {
  level: number
  visible: boolean
  color: string
  waveStrength: number
  waveScale: number
  waveSpeed: number
  reflection: number
  flow: number
  receiveShadows: boolean
}
export interface QualitySettings {
  resolutionScale: number
  pixelBudget: '720' | '1080' | '1440'
  fxaa: boolean
  terrainError: number
  tilesetError: number
  cacheMB: number
}
export interface SourceSettings {
  modelUrl: string
  modelHeightOffset: number
  imageryBrightness: number
  imagerySaturation: number
  imageryContrast: number
  terrainLighting: boolean
  terrainShadows: boolean
  modelShadows: 'off' | 'cast' | 'both'
}
export interface PresentationSettings {
  maskOpacity: number
  vignette: number
  showLabels: boolean
}
export interface SceneConfiguration {
  weather: EnvironmentPreset
  view: 'overview' | 'near' | 'low'
  environment: EnvironmentOptions
  shadows: ShadowSettings
  water: WaterSettings
  quality: QualitySettings
  source: SourceSettings
  presentation: PresentationSettings
}
export type SceneConfigurations = Record<DemoScene, SceneConfiguration>

export function createSceneConfiguration(
  scene: DemoScene,
  weather: EnvironmentPreset = 'day',
): SceneConfiguration {
  const environment = presetEnvironmentOptions(weather)
  if (scene !== 'city') environment.shadows = false
  if (scene === 'city') {
    environment.modelLighting = 'studio'
    environment.diffuseIntensity = 0.8
    environment.specularIntensity = 0.8
    environment.tonemapper = 'neutral'
    if (weather === 'day') environment.sunIntensity = 1.8
  }
  return {
    weather,
    view: 'overview',
    environment,
    shadows: {
      size: 2048,
      soft: true,
      distance: 1800,
      darkness: 0.3,
      depthBias: 0.00015,
      normalOffset: 0.5,
      backgroundReceives: false,
      treeShadows: 'cast',
      buildingShadows: 'cast',
    },
    water: {
      level: scene === 'city' ? 1 : 0,
      visible: true,
      color: scene === 'city' ? '#163d3f' : '#397e83',
      waveStrength: 1,
      waveScale: 1,
      waveSpeed: 1,
      reflection: 1,
      flow: 0,
      receiveShadows: scene === 'city',
    },
    quality: {
      resolutionScale: 1,
      pixelBudget: '1080',
      fxaa: true,
      terrainError: 3,
      tilesetError: 16,
      cacheMB: 128,
    },
    source: {
      modelUrl: '',
      modelHeightOffset: 0,
      imageryBrightness: 1,
      imagerySaturation: 1,
      imageryContrast: 1,
      terrainLighting: false,
      terrainShadows: false,
      modelShadows: 'off',
    },
    presentation: { maskOpacity: 0.7, vignette: 0.22, showLabels: true },
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
function bound(
  value: unknown,
  fallback: number,
  low: number,
  high: number,
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(high, Math.max(low, value))
    : fallback
}
function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}
function pick<T extends string | number>(
  value: unknown,
  values: readonly T[],
  fallback: T,
): T {
  return values.includes(value as T) ? (value as T) : fallback
}
function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : fallback
}

/** Imported, saved and shared configurations use the same bounds as live controls. */
export function normalizeSceneConfiguration(
  scene: DemoScene,
  value: unknown,
): SceneConfiguration {
  const input = record(value)
  const weather = pick(input.weather, ['day', 'sunset', 'rain'] as const, 'day')
  const defaults = createSceneConfiguration(scene, weather)
  const env = record(input.environment),
    shadow = record(input.shadows),
    water = record(input.water)
  const quality = record(input.quality),
    source = record(input.source),
    presentation = record(input.presentation)
  return {
    weather,
    view: pick(input.view, ['overview', 'near', 'low'] as const, defaults.view),
    environment: normalizeEnvironmentOptions({
      ...defaults.environment,
      ...env,
    } as EnvironmentOptions),
    shadows: {
      size: pick(
        shadow.size,
        [1024, 2048, 4096] as const,
        defaults.shadows.size,
      ),
      soft: flag(shadow.soft, true),
      distance: bound(shadow.distance, 1800, 200, 10000),
      darkness: bound(shadow.darkness, 0.3, 0, 1),
      depthBias: bound(shadow.depthBias, 0.00015, 0.000001, 0.003),
      normalOffset: bound(shadow.normalOffset, 0.5, 0, 3),
      backgroundReceives: flag(shadow.backgroundReceives, false),
      treeShadows: pick(
        shadow.treeShadows,
        ['off', 'cast', 'both'] as const,
        'cast',
      ),
      buildingShadows: pick(
        shadow.buildingShadows,
        ['cast', 'both'] as const,
        'cast',
      ),
    },
    water: {
      level: bound(
        water.level,
        defaults.water.level,
        scene === 'city' ? -2 : 0,
        scene === 'city' ? 42 : 20,
      ),
      visible: flag(water.visible, true),
      color: color(water.color, defaults.water.color),
      waveStrength: bound(water.waveStrength, 1, 0, 4),
      waveScale: bound(water.waveScale, 1, 0.25, 4),
      waveSpeed: bound(water.waveSpeed, 1, 0, 4),
      reflection: bound(water.reflection, 1, 0, 1),
      flow: bound(water.flow, 0, 0, 1),
      receiveShadows: flag(water.receiveShadows, defaults.water.receiveShadows),
    },
    quality: {
      resolutionScale: bound(quality.resolutionScale, 1, 0.5, 1),
      pixelBudget: pick(
        quality.pixelBudget,
        ['720', '1080', '1440'] as const,
        '1080',
      ),
      fxaa: flag(quality.fxaa, true),
      terrainError: bound(quality.terrainError, 3, 1, 16),
      tilesetError: bound(quality.tilesetError, 16, 2, 64),
      cacheMB: bound(quality.cacheMB, 128, 32, 512),
    },
    source: {
      modelUrl:
        typeof source.modelUrl === 'string' ? source.modelUrl.trim() : '',
      modelHeightOffset: bound(source.modelHeightOffset, 0, -200, 200),
      imageryBrightness: bound(source.imageryBrightness, 1, 0.2, 2),
      imagerySaturation: bound(source.imagerySaturation, 1, 0, 2),
      imageryContrast: bound(source.imageryContrast, 1, 0.2, 2),
      terrainLighting: flag(source.terrainLighting, false),
      terrainShadows: flag(source.terrainShadows, false),
      modelShadows: pick(
        source.modelShadows,
        ['off', 'cast', 'both'] as const,
        'off',
      ),
    },
    presentation: {
      maskOpacity: bound(presentation.maskOpacity, 0.7, 0, 1),
      vignette: bound(presentation.vignette, 0.22, 0, 0.7),
      showLabels: flag(presentation.showLabels, true),
    },
  }
}

export function createSceneConfigurations(): SceneConfigurations {
  return {
    city: createSceneConfiguration('city'),
    reservoir: createSceneConfiguration('reservoir'),
    flood: createSceneConfiguration('flood'),
  }
}
