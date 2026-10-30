export type ShowcaseScene = 'mountain' | 'coast'
export type ShowcaseWeather = 'day' | 'sunset'
export type ShowcaseView = 'hero' | 'shore' | 'overview'
export interface ShowcaseOptions {
  weather: ShowcaseWeather
  exposure: number
  waveStrength: number
  waveLength: number
  roughness: number
  reflection: boolean
  reflectionStrength: number
  foam: boolean
  foamWidth: number
  waterColor: string
  quality: 'balanced' | 'low'
}
export const showcaseScenes = {
  mountain: {
    title: '峡谷水境',
    subtitle: 'MAUVOISIN / ALPINE WATER',
    description: '真实山体 · 库湾倒影',
    source: 'Mauvoisin · swisstopo / BAFU 公开数据',
  },
  coast: {
    title: '滨海漫游',
    subtitle: 'COASTLINE / URBAN LANDSCAPE',
    description: '海岸公园 · 滨海大道',
    source: '程序办公楼 · Kenney 车辆 · 演示海岸布景',
  },
} as const
export function defaultShowcaseOptions(scene: ShowcaseScene): ShowcaseOptions {
  return {
    weather: 'day',
    exposure: 1,
    waveStrength: scene === 'mountain' ? 0.65 : 0.95,
    waveLength: scene === 'mountain' ? 14 : 22,
    roughness: 0.2,
    reflection: true,
    reflectionStrength: 1,
    foam: true,
    foamWidth: scene === 'mountain' ? 4 : 7,
    waterColor: scene === 'mountain' ? '#18465e' : '#176b7b',
    quality: 'balanced',
  }
}
export function normalizeShowcaseOptions(
  scene: ShowcaseScene,
  input: Partial<ShowcaseOptions>,
): ShowcaseOptions {
  const defaults = defaultShowcaseOptions(scene)
  const bound = (v: unknown, fallback: number, low: number, high: number) =>
    typeof v === 'number' && Number.isFinite(v)
      ? Math.min(high, Math.max(low, v))
      : fallback
  return {
    weather: input.weather === 'sunset' ? 'sunset' : 'day',
    exposure: bound(input.exposure, defaults.exposure, 0.4, 1.8),
    waveStrength: bound(input.waveStrength, defaults.waveStrength, 0, 2),
    waveLength: bound(input.waveLength, defaults.waveLength, 4, 60),
    roughness: bound(input.roughness, defaults.roughness, 0.08, 0.6),
    reflection:
      typeof input.reflection === 'boolean'
        ? input.reflection
        : defaults.reflection,
    reflectionStrength: bound(
      input.reflectionStrength,
      defaults.reflectionStrength,
      0,
      1.5,
    ),
    foam: typeof input.foam === 'boolean' ? input.foam : defaults.foam,
    foamWidth: bound(input.foamWidth, defaults.foamWidth, 1, 16),
    waterColor:
      typeof input.waterColor === 'string' &&
      /^#[0-9a-f]{6}$/i.test(input.waterColor)
        ? input.waterColor
        : defaults.waterColor,
    quality: input.quality === 'low' ? 'low' : 'balanced',
  }
}
