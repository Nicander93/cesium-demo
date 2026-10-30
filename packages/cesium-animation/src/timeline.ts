import type { Viewer } from 'cesium'
import {
  getEffectControl,
  registerTimelineTask,
  type EffectControl,
} from './runtime.js'
import { validateKeys, validateNumber } from './validation.js'
import type { EffectHandle, EffectState } from './types.js'

export interface SeekReport {
  exact: string[]
  reset: string[]
}
export interface TrackSpec<TOptions = unknown> {
  id: string
  effect: EffectHandle<TOptions>
  /** Start and duration in presentation seconds. */
  at: number
  duration: number
  fill?: 'none' | 'hold'
}
export interface TimelineOptions {
  duration: number
  driver?: 'internal' | 'external'
  loop?: 'none' | 'repeat'
  /** Only explicit ownership opts into disposing externally supplied effects. */
  disposeEffects?: boolean
}
export interface TimelineHandle {
  readonly state: EffectState
  readonly error: Error | undefined
  readonly timeSeconds: number
  readonly duration: number
  readonly speed: number
  readonly driver: 'internal' | 'external'
  add<TOptions>(track: TrackSpec<TOptions>): void
  remove(id: string): EffectHandle<unknown> | undefined
  play(): void
  pause(): void
  resume(): void
  stop(): void
  seek(time: number): SeekReport
  setTime(time: number): SeekReport
  setSpeed(rate: number): void
  subscribe(listener: () => void): () => void
  destroy(): void
}

interface BoundTrack {
  id: string
  effect: EffectHandle<unknown>
  at: number
  duration: number
  fill: 'none' | 'hold'
  control: EffectControl
}

export function validateTrackRange(
  at: number,
  duration: number,
  total: number,
): void {
  validateNumber('track.at', at, 0, total)
  if (!Number.isFinite(duration) || duration <= 0 || at + duration > total) {
    throw new RangeError(
      'Track duration must be positive and within the Timeline',
    )
  }
}

export function validateTrackId(id: string): void {
  if (typeof id !== 'string' || !id.trim() || id.length > 128)
    throw new RangeError(
      'Track id must be a nonempty string of at most 128 characters',
    )
}

/** Own presentation time, strict effect ownership and no writes to the host Clock. */
export function createTimeline(
  viewer: Viewer,
  options: TimelineOptions,
): TimelineHandle {
  validateKeys(options, ['duration', 'driver', 'loop', 'disposeEffects'])
  if (!Number.isFinite(options.duration) || options.duration <= 0)
    throw new RangeError('Timeline duration must be finite and positive')
  const {
    duration,
    driver = 'internal',
    loop = 'none',
    disposeEffects = false,
  } = options
  if (!['internal', 'external'].includes(driver))
    throw new RangeError('Unknown Timeline driver')
  if (!['none', 'repeat'].includes(loop))
    throw new RangeError('Unknown loop mode')
  if (typeof disposeEffects !== 'boolean')
    throw new TypeError('disposeEffects must be boolean')
  const owner = {}
  const tracks = new Map<string, BoundTrack>()
  const listeners = new Set<() => void>()
  let state: EffectState = 'idle'
  let timeSeconds = 0
  let speed = 1
  let failure: Error | undefined
  const pendingDisposals = new Set<BoundTrack>()
  let anchorTime = 0
  let anchorNow = 0

  function assertUsable(): void {
    if (state === 'destroyed') throw new Error('Timeline has been destroyed')
    if (viewer.isDestroyed()) {
      timeline.destroy()
      throw new Error('Host Viewer has been destroyed')
    }
  }
  function assertInternal(): void {
    assertUsable()
    if (driver !== 'internal')
      throw new Error('External Timeline accepts setTime() only')
  }
  function notify(): void {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error))
      }
    }
  }
  function applyTime(
    reset: boolean,
    running = state === 'playing',
  ): SeekReport {
    try {
      const report: SeekReport = { exact: [], reset: [] }
      const ordered = [...tracks.values()].sort((a, b) => a.at - b.at)
      const latestCamera = ordered
        .filter(
          (track) => track.control.kind === 'camera' && timeSeconds >= track.at,
        )
        .at(-1)
      for (const track of ordered) {
        const local = Math.min(
          track.duration,
          Math.max(0, timeSeconds - track.at),
        )
        const active =
          timeSeconds >= track.at && timeSeconds < track.at + track.duration
        const shown =
          (active ||
            (timeSeconds >= track.at + track.duration &&
              track.fill === 'hold')) &&
          (track.control.kind !== 'camera' || track === latestCamera)
        const didReset = track.control.evaluate(
          owner,
          local,
          shown,
          running && active,
          reset,
          shown && !active && track.fill === 'hold',
        )
        if (track.effect.capabilities.seek === 'exact')
          report.exact.push(track.id)
        else if (didReset || reset) report.reset.push(track.id)
      }
      if (!viewer.isDestroyed()) viewer.scene.requestRender()
      return report
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error))
      try {
        timeline.destroy()
      } catch {
        /* Every owned cleanup was attempted; preserve the evaluation error. */
      }
      throw error
    }
  }
  function reanchor(): void {
    anchorTime = timeSeconds
    anchorNow = performance.now()
  }
  function advance(now: number): void {
    if (state !== 'playing') return
    const next = anchorTime + (Math.max(0, now - anchorNow) / 1000) * speed
    let reset = false
    if (next >= duration) {
      if (loop === 'repeat') {
        timeSeconds = next % duration
        anchorTime = timeSeconds
        anchorNow = now
        reset = true
      } else {
        timeSeconds = duration
        state = 'stopped'
        scheduler.stop()
      }
    } else timeSeconds = next
    applyTime(reset)
    notify()
  }
  const scheduler = registerTimelineTask(viewer, {
    advance,
    destroy: () => timeline.destroy(),
    onError(error) {
      failure = error instanceof Error ? error : new Error(String(error))
      timeline.destroy()
    },
  })
  const timeline: TimelineHandle = {
    get state() {
      return state
    },
    get error() {
      return failure
    },
    get timeSeconds() {
      return timeSeconds
    },
    duration,
    driver,
    get speed() {
      return speed
    },
    add(spec) {
      assertUsable()
      validateKeys(spec, ['id', 'effect', 'at', 'duration', 'fill'])
      validateTrackId(spec.id)
      if (tracks.has(spec.id)) throw new Error('Duplicate track id: ' + spec.id)
      validateTrackRange(spec.at, spec.duration, duration)
      if (spec.fill !== undefined && !['none', 'hold'].includes(spec.fill))
        throw new RangeError('fill must be none or hold')
      const control = getEffectControl(spec.effect)
      if (control.viewer !== viewer)
        throw new Error('Track effect belongs to a different Viewer')
      if (control.kind === 'camera') {
        for (const track of tracks.values()) {
          if (
            track.control.kind === 'camera' &&
            spec.at < track.at + track.duration &&
            track.at < spec.at + spec.duration
          ) {
            throw new Error('Camera tracks must not overlap')
          }
        }
      }
      control.claim(owner)
      tracks.set(spec.id, {
        ...spec,
        effect: spec.effect,
        fill: spec.fill ?? 'none',
        control,
      })
      applyTime(false)
      notify()
    },
    remove(id) {
      assertUsable()
      const track = tracks.get(id)
      if (!track) return undefined
      tracks.delete(id)
      try {
        track.control.release(owner)
      } finally {
        if (disposeEffects) track.effect.destroy()
      }
      if (!viewer.isDestroyed()) viewer.scene.requestRender()
      notify()
      return track.effect
    },
    play() {
      assertInternal()
      if (state !== 'idle' && state !== 'stopped') return
      timeSeconds = 0
      state = 'playing'
      reanchor()
      applyTime(true)
      scheduler.start()
      notify()
    },
    pause() {
      assertInternal()
      if (state !== 'playing') return
      advance(performance.now())
      if (state !== 'playing') return
      state = 'paused'
      scheduler.stop()
      applyTime(false)
      notify()
    },
    resume() {
      assertInternal()
      if (state !== 'paused') return
      state = 'playing'
      reanchor()
      applyTime(false)
      scheduler.start()
      notify()
    },
    stop() {
      assertInternal()
      scheduler.stop()
      timeSeconds = 0
      state = 'stopped'
      applyTime(true, false)
      notify()
    },
    seek(time) {
      assertInternal()
      validateNumber('seek time', time, 0, duration)
      timeSeconds = time
      reanchor()
      const report = applyTime(true)
      notify()
      return report
    },
    setTime(time) {
      assertUsable()
      if (driver !== 'external')
        throw new Error('Internal Timeline uses seek(), not setTime()')
      validateNumber('external time', time, 0, duration)
      const reset = state === 'idle' || time < timeSeconds
      timeSeconds = time
      state = time < duration ? 'playing' : 'stopped'
      const report = applyTime(reset, time < duration)
      notify()
      return report
    },
    setSpeed(rate) {
      assertInternal()
      if (!Number.isFinite(rate) || rate <= 0)
        throw new RangeError('Timeline speed must be finite and positive')
      if (state === 'playing') advance(performance.now())
      speed = rate
      reanchor()
      notify()
    },
    subscribe(listener) {
      assertUsable()
      if (typeof listener !== 'function')
        throw new TypeError('Timeline listener must be a function')
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    destroy() {
      if (state === 'destroyed' && pendingDisposals.size === 0) return
      state = 'destroyed'
      scheduler.destroy()
      for (const track of tracks.values()) pendingDisposals.add(track)
      tracks.clear()
      const failures: unknown[] = []
      for (const track of pendingDisposals) {
        try {
          try {
            track.control.release(owner)
          } finally {
            if (disposeEffects) track.effect.destroy()
          }
          pendingDisposals.delete(track)
        } catch (error) {
          failures.push(error)
        }
      }
      notify()
      listeners.clear()
      if (!viewer.isDestroyed()) viewer.scene.requestRender()
      if (failures.length)
        throw new AggregateError(failures, 'Timeline cleanup failed')
    },
  }
  return timeline
}
