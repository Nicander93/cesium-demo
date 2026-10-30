import type { Viewer } from 'cesium'
import {
  createCameraTrack,
  validateCameraOptions,
  type CameraTrackOptions,
} from './camera.js'
import { createFountain, validateFountainInput } from './fountain.js'
import { createFlyLine, createFlowArrow, validatePathInput } from './path.js'
import {
  createTimeline,
  validateTrackId,
  validateTrackRange,
  type TimelineHandle,
} from './timeline.js'
import { validateKeys } from './validation.js'
import type {
  EffectHandle,
  FlyLineOptions,
  FlowArrowOptions,
  FountainOptions,
} from './types.js'

interface TrackDefinitionBase {
  id: string
  /** Start and duration in presentation seconds. */
  at: number
  duration: number
  fill?: 'none' | 'hold'
}
export type AnimationTrackDefinition =
  | (TrackDefinitionBase & { kind: 'fly-line'; options: FlyLineOptions })
  | (TrackDefinitionBase & { kind: 'flow-arrow'; options: FlowArrowOptions })
  | (TrackDefinitionBase & { kind: 'fountain'; options: FountainOptions })
  | (TrackDefinitionBase & { kind: 'camera'; options: CameraTrackOptions })

export interface AnimationDefinition {
  schemaVersion: 1
  duration: number
  loop?: 'none' | 'repeat'
  tracks: AnimationTrackDefinition[]
}
export interface AnimationInstance {
  readonly definition: AnimationDefinition
  readonly timeline: TimelineHandle
  readonly effects: ReadonlyMap<string, EffectHandle<unknown>>
  destroy(): void
}

/** Validate completely before allocating scene resources; return an independent JSON copy. */
export function parseAnimationDefinition(input: unknown): AnimationDefinition {
  validateKeys(input as object, ['schemaVersion', 'duration', 'loop', 'tracks'])
  const value = input as AnimationDefinition
  if (value.schemaVersion !== 1)
    throw new RangeError('Unsupported animation schemaVersion')
  if (!Number.isFinite(value.duration) || value.duration <= 0)
    throw new RangeError('Animation duration must be finite and positive')
  if (value.loop !== undefined && !['none', 'repeat'].includes(value.loop))
    throw new RangeError('Unknown animation loop mode')
  if (!Array.isArray(value.tracks))
    throw new TypeError('Animation tracks must be an array')
  const ids = new Set<string>()
  const cameras: AnimationTrackDefinition[] = []
  for (const track of value.tracks) {
    validateKeys(track, ['id', 'kind', 'at', 'duration', 'fill', 'options'])
    validateTrackId(track.id)
    if (ids.has(track.id)) throw new Error('Duplicate track id: ' + track.id)
    ids.add(track.id)
    validateTrackRange(track.at, track.duration, value.duration)
    if (track.fill !== undefined && !['none', 'hold'].includes(track.fill))
      throw new RangeError('fill must be none or hold')
    switch (track.kind) {
      case 'fly-line':
        validatePathInput(track.options, 'fly')
        break
      case 'flow-arrow':
        validatePathInput(track.options, 'arrow')
        break
      case 'fountain':
        validateFountainInput(track.options)
        break
      case 'camera':
        validateCameraOptions(track.options)
        if (
          track.options.keyframes[track.options.keyframes.length - 1]!.time >
          track.duration
        )
          throw new RangeError(
            'Camera keyframes must be within the track duration',
          )
        for (const camera of cameras) {
          if (
            track.at < camera.at + camera.duration &&
            camera.at < track.at + track.duration
          )
            throw new Error('Camera tracks must not overlap')
        }
        cameras.push(track)
        break
      default:
        throw new RangeError('Unknown animation track kind')
    }
  }
  return JSON.parse(JSON.stringify(value)) as AnimationDefinition
}

/** Recreate an editor-exported definition in any host Viewer without the editor or UI. */
export function createAnimation(
  viewer: Viewer,
  input: AnimationDefinition,
  options: { driver?: 'internal' | 'external' } = {},
): AnimationInstance {
  validateKeys(options, ['driver'])
  const definition = parseAnimationDefinition(input)
  const effects = new Map<string, EffectHandle<unknown>>()
  const timeline = createTimeline(viewer, {
    duration: definition.duration,
    loop: definition.loop ?? 'none',
    driver: options.driver ?? 'internal',
    disposeEffects: true,
  })
  function destroy(): void {
    const failures: unknown[] = []
    try {
      timeline.destroy()
    } catch (error) {
      failures.push(error)
    }
    for (const effect of effects.values()) {
      try {
        effect.destroy()
      } catch (error) {
        failures.push(error)
      }
    }
    if (failures.length)
      throw new AggregateError(failures, 'Animation cleanup failed')
  }
  try {
    for (const track of definition.tracks) {
      let effect: EffectHandle<unknown>
      switch (track.kind) {
        case 'fly-line':
          effect = createFlyLine(viewer, track.options)
          break
        case 'flow-arrow':
          effect = createFlowArrow(viewer, track.options)
          break
        case 'fountain':
          effect = createFountain(viewer, track.options)
          break
        case 'camera':
          effect = createCameraTrack(viewer, track.options)
          break
      }
      effects.set(track.id, effect)
      timeline.add({
        id: track.id,
        effect,
        at: track.at,
        duration: track.duration,
        fill: track.fill ?? 'none',
      })
    }
  } catch (error) {
    try {
      destroy()
    } catch {
      /* Preserve the creation error after attempting every owned cleanup. */
    }
    throw error
  }
  return { definition, timeline, effects, destroy }
}
