import type { LabState, ProviderId, ViewId, WeatherId } from './url-state'

export interface AtmosphereLabDevState {
  state: LabState
  camera?: {
    longitude: number
    latitude: number
    height: number
    heading: number
    pitch: number
    roll: number
    position: { x: number; y: number; z: number }
    direction: { x: number; y: number; z: number }
  }
  canvas?: { clientWidth: number; clientHeight: number; bufferWidth: number; bufferHeight: number }
  postProcess: { count: number; ready: boolean; stages: Array<{ name: string; ready: boolean; enabled: boolean }> }
  diagnostic: Record<string, unknown>
  errors: string[]
  scene: { globeVisible: boolean; skyVisible: boolean; globeAtmosphere?: boolean; fogRendered?: boolean; globeLighting?: boolean; cloudVisible: boolean; activeProvider?: ProviderId; tilesLoaded: boolean; tileLoadQueueLength?: number; imageryLayerCount: number; primitiveCount: number }
}

export interface AtmosphereLabDevApi {
  getState(): AtmosphereLabDevState
  setProvider(provider: ProviderId): void
  setView(view: ViewId): void
  setWeather(weather: WeatherId): void
  setAtmosphereDebug(mode: 0 | 6 | 8 | 9 | 10 | 14): void
  /** Reproduce manually zoomed camera heights without selecting a preset/rebuilding effects. */
  setCameraHeight(heightM: number): void
  setCameraPose(pose: { height: number; pitch: number; heading?: number }): void
  setOptions(options: Partial<Pick<LabState, 'quality' | 'coverage' | 'cloudBaseM' | 'cloudThicknessM' | 'exposure' | 'sunHour' | 'animated' | 'cloudPresentation' | 'cloudForm' | 'cloudSampling' | 'cloudLighting' | 'cloudShadows'>>): void
}

declare global {
  interface Window {
    __atmosphereLab?: AtmosphereLabDevApi
  }
}
