import { Cartesian3, Color, Matrix3, Matrix4, Transforms } from 'cesium'

export type EnvironmentPreset = 'day' | 'sunset' | 'rain'

export interface EnvironmentOptions {
  exposure: number
  skyRotation: number
  fog: number
  rain: number
  shadows: boolean
  skyIntensity: number
  sunIntensity: number
  sunColor: string
  sunAuto: boolean
  sunHeading: number
  sunElevation: number
  modelLighting: 'weather' | 'studio'
  diffuseIntensity: number
  specularIntensity: number
  fogBrightness: number
  rainSpeed: number
  rainAngle: number
  rainLength: number
  hdr: boolean
  tonemapper: 'aces' | 'neutral' | 'reinhard'
}

export interface EnvironmentAsset {
  panorama: string
  specular: string
  sphericalHarmonics: number[][]
  sunDirection: number[]
  horizonColor?: number[]
  panoramaEncoding?: string
}

export const environmentPresets = {
  day: {
    name: '晴日',
    subtitle: '清透天空 · 柔和日光',
    sunlight: 2.5,
    sunColor: '#fff5e5',
    fogColor: '#bed4e0',
    options: { exposure: 1, skyRotation: 0, fog: 0.16, rain: 0, shadows: true },
  },
  sunset: {
    name: '落日',
    subtitle: '暖色天际 · 拉长的阴影',
    sunlight: 2.2,
    sunColor: '#ffc17f',
    fogColor: '#c6a99e',
    options: {
      exposure: 0.95,
      skyRotation: 180,
      fog: 0.38,
      rain: 0,
      shadows: true,
    },
  },
  rain: {
    name: '雨幕',
    subtitle: '柔散天光 · 湿润地表',
    sunlight: 0.45,
    sunColor: '#d9e5ef',
    fogColor: '#8296a2',
    options: {
      exposure: 0.85,
      skyRotation: 0,
      fog: 0.6,
      rain: 0.55,
      shadows: false,
    },
  },
} satisfies Record<
  EnvironmentPreset,
  {
    name: string
    subtitle: string
    sunlight: number
    sunColor: string
    fogColor: string
    options: Pick<
      EnvironmentOptions,
      'exposure' | 'skyRotation' | 'fog' | 'rain' | 'shadows'
    >
  }
>

export function presetEnvironmentOptions(
  preset: EnvironmentPreset,
): EnvironmentOptions {
  const settings = environmentPresets[preset]
  return normalizeEnvironmentOptions({
    ...settings.options,
    sunIntensity: settings.sunlight,
    sunColor: settings.sunColor,
  })
}

export function normalizeEnvironmentOptions(
  options: Partial<EnvironmentOptions>,
): EnvironmentOptions {
  const bound = (
    value: number | undefined,
    low: number,
    high: number,
    fallback: number,
  ) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(high, Math.max(low, value))
      : fallback
  const flag = (value: boolean | undefined, fallback: boolean) =>
    typeof value === 'boolean' ? value : fallback
  return {
    exposure: bound(options.exposure, 0.25, 2.5, 1),
    skyRotation: bound(options.skyRotation, -180, 180, 0),
    fog: bound(options.fog, 0, 1, 0),
    rain: bound(options.rain, 0, 1, 0),
    shadows: flag(options.shadows, true),
    skyIntensity: bound(options.skyIntensity, 0, 3, 1),
    sunIntensity: bound(
      options.sunIntensity,
      0,
      8,
      environmentPresets.day.sunlight,
    ),
    sunColor:
      typeof options.sunColor === 'string' &&
      /^#[0-9a-f]{6}$/i.test(options.sunColor)
        ? options.sunColor.toLowerCase()
        : environmentPresets.day.sunColor,
    sunAuto: flag(options.sunAuto, true),
    sunHeading: bound(options.sunHeading, 0, 360, 135),
    sunElevation: bound(options.sunElevation, 1, 89, 45),
    modelLighting: options.modelLighting === 'studio' ? 'studio' : 'weather',
    diffuseIntensity: bound(options.diffuseIntensity, 0, 1, 1),
    specularIntensity: bound(options.specularIntensity, 0, 1, 1),
    fogBrightness: bound(options.fogBrightness, 0, 1, 0.35),
    rainSpeed: bound(options.rainSpeed, 0, 4, 1),
    rainAngle: bound(options.rainAngle, -45, 45, 12.4),
    rainLength: bound(options.rainLength, 0.25, 3, 1),
    hdr: flag(options.hdr, true),
    tonemapper: ['aces', 'neutral', 'reinhard'].includes(
      options.tonemapper ?? '',
    )
      ? options.tonemapper!
      : 'aces',
  }
}

/** A shared ENU reference keeps the panorama, sun and model IBL in one orientation. */
export function environmentFrames(anchor: Cartesian3, rotationDegrees: number) {
  const frame = Transforms.eastNorthUpToFixedFrame(anchor)
  Matrix4.multiplyByMatrix3(
    frame,
    Matrix3.fromRotationZ((rotationDegrees * Math.PI) / 180),
    frame,
  )
  const hdrFrame = Matrix4.multiplyByMatrix3(
    frame,
    Matrix3.fromRotationX(Math.PI / 2),
    new Matrix4(),
  )
  const worldToEnvironment = Matrix3.transpose(
    Matrix4.getMatrix3(hdrFrame, new Matrix3()),
    new Matrix3(),
  )
  return { frame, worldToEnvironment }
}

export function presetFogColor(preset: EnvironmentPreset): Color {
  return Color.fromCssColorString(environmentPresets[preset].fogColor)
}
