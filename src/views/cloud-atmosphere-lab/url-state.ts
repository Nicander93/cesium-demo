export type ProviderId = 'basic' | 'current' | 'community' | 'local'
export type QualityId = 'reference' | 'balanced'
export type ViewId = 'ground' | 'inside' | 'cloudscape' | 'above' | 'orbit'
export type WeatherId = 'sunny' | 'sunset' | 'overcast'
const cloudDebugModes = ['weather', 'sampleCount', 'march', 'marchA', 'classify', 'alpha', 'alphaTemporal', 'fixedJitter', 'fixedLightJitter', 'fixedViewJitter', 'opticalStep', 'fullTemporal', 'raw', 'probeOD', 'probeLight', 'probePreAerial'] as const

export interface LabState {
  provider: ProviderId
  quality: QualityId
  view: ViewId
  weather: WeatherId
  coverage: number
  cloudBaseM: number
  cloudThicknessM: number
  communityMaxStepM: number
  communityDetailScale: number
  communityShapeScale: number
  shapeMipmaps: boolean
  cloudPresentation: 'adaptive' | 'full'
  cloudSampling: 'legacy' | 'filtered'
  cloudLighting: 'legacy' | 'diffuse'
  cloudForm: 'layered' | 'cumulus'
  cloudShadows: boolean
  communityDebug: typeof cloudDebugModes[number] | null
  exposure: number
  sunHour: number
  animated: boolean
}

export const defaultLabState: LabState = {
  provider: 'community', quality: 'balanced', view: 'ground', weather: 'sunny',
  coverage: 0.32, cloudBaseM: 1800, cloudThicknessM: 1200, communityMaxStepM: 600, communityDetailScale: 1, communityShapeScale: 1, shapeMipmaps: false, cloudPresentation: 'adaptive', cloudSampling: 'filtered', cloudLighting: 'diffuse', cloudForm: 'cumulus', cloudShadows: true, communityDebug: null, exposure: 1, sunHour: 14, animated: false,
}

const allowed = {
  provider: ['basic', 'current', 'community', 'local'],
  quality: ['reference', 'balanced'],
  view: ['ground', 'inside', 'cloudscape', 'above', 'orbit'],
  weather: ['sunny', 'sunset', 'overcast'],
  cloudPresentation: ['adaptive', 'full'],
  cloudSampling: ['legacy', 'filtered'],
  cloudLighting: ['legacy', 'diffuse'],
  cloudForm: ['layered', 'cumulus'],
} as const

export function readLabState(search: string): LabState {
  const params = new URLSearchParams(search)
  const state = { ...defaultLabState }
  for (const key of Object.keys(allowed) as (keyof typeof allowed)[]) {
    const value = params.get(key)
    if (value && (allowed[key] as readonly string[]).includes(value)) {
      ;(state as unknown as Record<string, string>)[key] = value
    }
  }
  const number = (key: string, fallback: number, min: number, max: number) => {
    const raw = params.get(key)
    if (raw === null || raw.trim() === '') return fallback
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
  }
  state.coverage = number('coverage', state.coverage, 0, 1)
  state.cloudBaseM = number('base', state.cloudBaseM, 500, 12000)
  state.cloudThicknessM = number('thickness', state.cloudThicknessM, 200, 8000)
  state.communityMaxStepM = number('communityStep', state.communityMaxStepM, 80, 1000)
  state.communityDetailScale = number('detailScale', state.communityDetailScale, 0, 1.5)
  state.communityShapeScale = number('shapeScale', state.communityShapeScale, 0, 1.5)
  state.shapeMipmaps = params.get('shapeMipmaps') === '1'
  state.cloudShadows = params.get('cloudShadows') !== '0'
  const communityDebug = params.get('cloudDebug')
  state.communityDebug = communityDebug && (cloudDebugModes as readonly string[]).includes(communityDebug)
    ? communityDebug as typeof cloudDebugModes[number]
    : null
  state.exposure = number('exposure', state.exposure, 0.1, 4)
  state.sunHour = number('sunHour', state.weather === 'sunset' ? 18.5 : 14, 5, 20)
  state.animated = params.get('animated') === '1'
  return state
}

export function writeLabState(state: LabState): string {
  const params = new URLSearchParams()
  for (const key of ['provider', 'quality', 'view', 'weather'] as const) params.set(key, state[key])
  params.set('coverage', state.coverage.toFixed(2))
  params.set('base', String(Math.round(state.cloudBaseM)))
  params.set('thickness', String(Math.round(state.cloudThicknessM)))
  if (state.communityMaxStepM !== defaultLabState.communityMaxStepM) params.set('communityStep', String(Math.round(state.communityMaxStepM)))
  if (state.communityDetailScale !== defaultLabState.communityDetailScale) params.set('detailScale', state.communityDetailScale.toFixed(2))
  if (state.communityShapeScale !== defaultLabState.communityShapeScale) params.set('shapeScale', state.communityShapeScale.toFixed(2))
  if (state.shapeMipmaps) params.set('shapeMipmaps', '1')
  if (!state.cloudShadows) params.set('cloudShadows', '0')
  if (state.cloudPresentation !== defaultLabState.cloudPresentation) params.set('cloudPresentation', state.cloudPresentation)
  if (state.cloudSampling !== defaultLabState.cloudSampling) params.set('cloudSampling', state.cloudSampling)
  if (state.cloudLighting !== defaultLabState.cloudLighting) params.set('cloudLighting', state.cloudLighting)
  if (state.cloudForm !== defaultLabState.cloudForm) params.set('cloudForm', state.cloudForm)
  if (state.communityDebug) params.set('cloudDebug', state.communityDebug)
  params.set('exposure', state.exposure.toFixed(2))
  if (state.sunHour !== (state.weather === 'sunset' ? 18.5 : 14)) params.set('sunHour', state.sunHour.toFixed(2))
  if (state.animated) params.set('animated', '1')
  return `?${params.toString()}`
}
