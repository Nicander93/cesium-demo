import {
  Cartesian3,
  Cartographic,
  EllipsoidGeodesic,
  Math as CesiumMath,
  type Viewer,
} from 'cesium'
import { createEffectHandle } from './runtime.js'
import { validateKeys, validateNumber, validatePoint } from './validation.js'
import type { EffectHandle, GeoPoint } from './types.js'

export interface CameraKeyframe {
  /** Seconds relative to the start of the camera track. */
  time: number
  position: GeoPoint
  /** Heading, pitch and roll in degrees. */
  heading: number
  pitch: number
  roll: number
  /** Interpolation to the next keyframe; defaults to linear. */
  easing?: 'linear' | 'smoothstep'
}
export interface CameraTrackOptions {
  keyframes: CameraKeyframe[]
}

export function validateCameraOptions(options: CameraTrackOptions): void {
  validateKeys(options, ['keyframes'])
  if (!Array.isArray(options.keyframes) || options.keyframes.length < 2)
    throw new RangeError('Camera requires at least two keyframes')
  let previous = -1
  for (const key of options.keyframes) {
    validateKeys(key, [
      'time',
      'position',
      'heading',
      'pitch',
      'roll',
      'easing',
    ])
    validateNumber('keyframe.time', key.time, 0, Number.MAX_VALUE)
    if (key.time <= previous)
      throw new RangeError('Camera keyframe times must strictly increase')
    previous = key.time
    validatePoint(key.position)
    validateNumber('heading', key.heading, -360, 360)
    validateNumber('pitch', key.pitch, -90, 90)
    validateNumber('roll', key.roll, -360, 360)
    if (
      key.easing !== undefined &&
      !['linear', 'smoothstep'].includes(key.easing)
    )
      throw new RangeError('Unknown camera easing')
  }
  if (options.keyframes[0]?.time !== 0)
    throw new RangeError('First camera keyframe must start at zero')
  for (let index = 1; index < options.keyframes.length; index++) {
    const from = options.keyframes[index - 1]!.position
    const to = options.keyframes[index]!.position
    const a = Cartesian3.fromDegrees(from.lon, from.lat)
    const b = Cartesian3.fromDegrees(to.lon, to.lat)
    if (Math.PI - Cartesian3.angleBetween(a, b) < 0.02)
      throw new RangeError(
        'Near-antipodal camera keyframes require an intermediate keyframe',
      )
  }
}

function angularLerp(from: number, to: number, fraction: number): number {
  const delta = CesiumMath.negativePiToPi(CesiumMath.toRadians(to - from))
  return CesiumMath.toRadians(from) + delta * fraction
}

/** Random-access camera keyframes; never uses the command-based camera.flyTo(). */
export function createCameraTrack(
  viewer: Viewer,
  input: CameraTrackOptions,
): EffectHandle<CameraTrackOptions> {
  if (viewer.isDestroyed()) throw new Error('Host Viewer has been destroyed')
  validateCameraOptions(input)
  const keyframes = input.keyframes.map((key) => ({
    ...key,
    position: { ...key.position },
  }))
  // Precompute the geographic segments so seeking never relies on earlier frames.
  const segments = keyframes.slice(0, -1).map((from, index) => {
    const to = keyframes[index + 1]!
    const start = Cartographic.fromDegrees(from.position.lon, from.position.lat)
    const end = Cartographic.fromDegrees(to.position.lon, to.position.lat)
    const sameHorizontal =
      Math.abs(CesiumMath.negativePiToPi(end.longitude - start.longitude)) <
        1e-12 && Math.abs(end.latitude - start.latitude) < 1e-12
    return {
      from,
      to,
      start,
      geodesic: sameHorizontal ? undefined : new EllipsoidGeodesic(start, end),
    }
  })
  let visible = false

  function sample(time: number): void {
    if (!visible) return
    const last = keyframes[keyframes.length - 1]!
    let position: GeoPoint
    let heading: number
    let pitch: number
    let roll: number
    if (time >= last.time) {
      position = last.position
      heading = CesiumMath.toRadians(last.heading)
      pitch = CesiumMath.toRadians(last.pitch)
      roll = CesiumMath.toRadians(last.roll)
    } else {
      const segment =
        segments.find((candidate) => time < candidate.to.time) ??
        segments[segments.length - 1]!
      const { from, to, start, geodesic } = segment
      let fraction = Math.min(
        1,
        Math.max(0, (time - from.time) / (to.time - from.time)),
      )
      if (from.easing === 'smoothstep')
        fraction = fraction * fraction * (3 - 2 * fraction)
      const geographic = geodesic?.interpolateUsingFraction(fraction) ?? start
      position = {
        lon: CesiumMath.toDegrees(geographic.longitude),
        lat: CesiumMath.toDegrees(geographic.latitude),
        height:
          (from.position.height ?? 0) +
          ((to.position.height ?? 0) - (from.position.height ?? 0)) * fraction,
      }
      heading = angularLerp(from.heading, to.heading, fraction)
      pitch = CesiumMath.toRadians(
        from.pitch + (to.pitch - from.pitch) * fraction,
      )
      roll = angularLerp(from.roll, to.roll, fraction)
    }
    viewer.camera.setView({
      destination: Cartesian3.fromDegrees(
        position.lon,
        position.lat,
        position.height ?? 0,
      ),
      orientation: { heading, pitch, roll },
    })
  }

  return createEffectHandle<CameraTrackOptions>(
    viewer,
    { seek: 'exact', pause: 'exact', reverse: false },
    {
      kind: 'camera',
      sample,
      start: sample,
      pause() {},
      // stop/destroy release control but deliberately do not restore the host's view.
      stop() {},
      setVisible(value) {
        visible = value
      },
      update() {
        throw new Error(
          'Camera keyframe hot updates are unsupported; recreate the track',
        )
      },
      destroy() {},
      inspect: () => ({ kind: 'camera', keyframeCount: keyframes.length }),
    },
  )
}
