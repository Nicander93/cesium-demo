export interface GeoPoint {
  /** WGS84 longitude in degrees, [-180, 180]. */
  lon: number
  /** WGS84 latitude in degrees, [-90, 90]. */
  lat: number
  /** Metres above the WGS84 ellipsoid; defaults to zero. */
  height?: number
}

export type EffectState =
  | 'idle'
  | 'playing'
  | 'paused'
  | 'stopped'
  | 'destroyed'

export interface EffectCapabilities {
  readonly seek: 'exact' | 'reset' | 'unsupported'
  readonly pause: 'exact' | 'restart'
  readonly reverse: boolean
}

export interface EffectHandle<TOptions> {
  readonly state: EffectState
  readonly error: Error | undefined
  readonly capabilities: EffectCapabilities
  /** Local presentation time in seconds. A Timeline supplies it when the effect is bound. */
  readonly timeSeconds: number
  play(): void
  pause(): void
  resume(): void
  stop(): void
  update(options: Partial<TOptions>): void
  destroy(): void
}

export interface FlyLineOptions {
  positions: GeoPoint[]
  color?: string
  /** Screen pixels. */
  widthPx?: number
  /** Pattern cycles per second, not metres per second. Zero is stationary. */
  speed?: number
  direction?: 'forward' | 'backward'
  opacity?: number
}

export interface FlowArrowOptions extends FlyLineOptions {
  /** Number of repeated arrow patterns along the complete path, [1, 200]. */
  spacing?: number
}

export interface FountainOptions {
  position: GeoPoint
  /** Requested particles per second. Basic quality uses half this rate. */
  emissionRate?: number
  /** Individual particle lifetime in seconds, not emitter duration. */
  lifetime?: number
  /** Metres per second. */
  minSpeed?: number
  maxSpeed?: number
  /** Metres per second squared, along the negative local Up direction. */
  gravity?: number
  particleSizePx?: number
  color?: string
  quality?: 'basic' | 'standard'
}
