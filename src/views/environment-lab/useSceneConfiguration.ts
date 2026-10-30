import { computed, ref } from 'vue'
import {
  createSceneConfigurations,
  createSceneConfiguration,
  normalizeSceneConfiguration,
  type SceneConfiguration,
  type SceneConfigurations,
} from './configuration'
import type { DemoScene } from './landscape'

const STORAGE_KEY = 'environment-lab:profiles:v1'
const SCENE_IDS: DemoScene[] = ['city', 'reservoir', 'flood']

function selectedScene(params: URLSearchParams): DemoScene {
  const value = params.get('scene')
  return SCENE_IDS.includes(value as DemoScene) ? (value as DemoScene) : 'city'
}

function decodeConfig(value: string | null): unknown {
  if (!value) return undefined
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(
      normalized + '='.repeat((4 - (normalized.length % 4)) % 4),
    )
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    )
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return undefined
  }
}

function encodeConfig(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function safeProfile(scene: DemoScene, value: unknown): SceneConfiguration {
  const normalized = normalizeSceneConfiguration(scene, value)
  const modelUrl = normalized.source.modelUrl.trim()
  if (!modelUrl) return normalized
  try {
    const url = new URL(modelUrl)
    if (
      !/^https?:\/\//i.test(modelUrl) ||
      !['http:', 'https:'].includes(url.protocol)
    )
      normalized.source.modelUrl = ''
    else normalized.source.modelUrl = url.href
  } catch {
    normalized.source.modelUrl = ''
  }
  return normalized
}

function readProfiles(): SceneConfigurations {
  const profiles = createSceneConfigurations()
  try {
    const stored = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? 'null',
    ) as unknown
    if (
      stored &&
      typeof stored === 'object' &&
      'version' in stored &&
      'profiles' in stored
    ) {
      const value = stored as {
        version: number
        profiles: Record<string, unknown>
      }
      if (value.version === 1)
        for (const id of SCENE_IDS)
          profiles[id] = safeProfile(id, value.profiles[id])
    }
  } catch {
    // Ignore invalid storage and continue with safe defaults.
  }
  return profiles
}

function legacyConfiguration(
  scene: DemoScene,
  params: URLSearchParams,
  saved: SceneConfiguration,
): SceneConfiguration | undefined {
  if (params.has('config')) return undefined
  const requestedWeather = params.get('weather')
  const hasLegacySettings =
    ['day', 'sunset', 'rain'].includes(requestedWeather ?? '') ||
    ['exposure', 'fog', 'rotation', 'rain'].some((key) => params.has(key)) ||
    ((scene === 'city' || params.get('waterReference') === 'offset') &&
      params.has('water')) ||
    params.has('model')
  if (!hasLegacySettings) return undefined
  const config = JSON.parse(JSON.stringify(saved)) as SceneConfiguration
  if (['day', 'sunset', 'rain'].includes(requestedWeather ?? '')) {
    config.weather = requestedWeather as SceneConfiguration['weather']
    config.environment = createSceneConfiguration(
      scene,
      config.weather,
    ).environment
  }
  const assign = (
    queryKey: string,
    target: keyof SceneConfiguration['environment'],
  ) => {
    const value = Number(params.get(queryKey))
    const legacyFog =
      target === 'fog' &&
      !params.has('envVersion') &&
      config.weather === 'day' &&
      params.get('fog') === '0.32'
    if (legacyFog) {
      config.environment.fog = 0.16
      return
    }
    if (params.has(queryKey) && Number.isFinite(value))
      config.environment[target] = value as never
  }
  assign('exposure', 'exposure')
  assign('fog', 'fog')
  assign('rotation', 'skyRotation')
  assign('rain', 'rain')
  const water = Number(params.get('water'))
  if (
    (scene === 'city' || params.get('waterReference') === 'offset') &&
    params.has('water') &&
    Number.isFinite(water)
  )
    config.water.level = water
  if (params.has('model')) config.source.modelUrl = params.get('model') ?? ''
  return safeProfile(scene, config)
}

export function useSceneConfiguration() {
  const params = new URLSearchParams(location.search)
  const scene = ref(selectedScene(params))
  const profiles = ref<SceneConfigurations>(readProfiles())
  const initial = decodeConfig(params.get('config'))
  const migrated = initial
    ? safeProfile(scene.value, initial)
    : legacyConfiguration(scene.value, params, profiles.value[scene.value])
  if (migrated) profiles.value[scene.value] = migrated
  const configuration = computed(() => profiles.value[scene.value])

  function save(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: 1, profiles: profiles.value }),
      )
    } catch {
      // The active in-memory configuration remains usable if storage is unavailable.
    }
  }
  function replace(sceneId: DemoScene, value: SceneConfiguration): void {
    profiles.value[sceneId] = safeProfile(sceneId, value)
    save()
  }
  function setScene(sceneId: DemoScene): void {
    scene.value = sceneId
  }
  function reset(sceneId = scene.value): void {
    replace(sceneId, createSceneConfiguration(sceneId))
  }
  function importProfiles(text: string): void {
    const payload: unknown = JSON.parse(text)
    if (
      !isRecord(payload) ||
      payload.version !== 1 ||
      !isRecord(payload.profiles)
    )
      throw new Error('配置文件格式无效：需要版本 1 的 profiles 数据。')

    const entries = Object.entries(payload.profiles)
    if (
      !entries.length ||
      entries.some(([id]) => !SCENE_IDS.includes(id as DemoScene))
    )
      throw new Error('配置文件必须包含至少一个已知场景。')

    const next = JSON.parse(
      JSON.stringify(profiles.value),
    ) as SceneConfigurations
    for (const [sceneId, rawProfile] of entries) {
      const id = sceneId as DemoScene
      if (!isRecord(rawProfile))
        throw new Error('场景 ' + id + ' 配置必须是对象。')
      if ('source' in rawProfile && !isRecord(rawProfile.source))
        throw new Error('场景 ' + id + ' 的数据源配置格式无效。')
      const source = isRecord(rawProfile.source) ? rawProfile.source : undefined
      if (source && 'modelUrl' in source && typeof source.modelUrl !== 'string')
        throw new Error('场景 ' + id + ' 的模型地址必须是字符串。')

      const normalized = normalizeSceneConfiguration(id, rawProfile)
      if (normalized.source.modelUrl) {
        let url: URL
        try {
          url = new URL(normalized.source.modelUrl)
        } catch {
          throw new Error('场景 ' + id + ' 的模型地址必须使用 HTTP(S)。')
        }
        if (
          !/^https?:\/\//i.test(normalized.source.modelUrl) ||
          !['http:', 'https:'].includes(url.protocol)
        )
          throw new Error('场景 ' + id + ' 的模型地址必须使用 HTTP(S)。')
        normalized.source.modelUrl = url.href
      }
      next[id] = safeProfile(id, normalized)
    }
    profiles.value = next
    save()
  }
  function exportProfiles(): string {
    return JSON.stringify({ version: 1, profiles: profiles.value }, null, 2)
  }
  function updateUrl(screen: boolean): void {
    const query = new URLSearchParams({
      scene: scene.value,
      weather: configuration.value.weather,
      envVersion: '3',
      config: encodeConfig(configuration.value),
      exposure: String(configuration.value.environment.exposure),
      fog: String(configuration.value.environment.fog),
      rotation: String(configuration.value.environment.skyRotation),
      rain: String(configuration.value.environment.rain),
      water: String(configuration.value.water.level),
    })
    if (screen) query.set('presentation', 'screen')
    query.set('waterReference', 'offset')
    history.replaceState(history.state, '', `${location.pathname}?${query}`)
  }

  save()
  return {
    scene,
    profiles,
    configuration,
    setScene,
    replace,
    reset,
    importProfiles,
    exportProfiles,
    updateUrl,
  }
}
