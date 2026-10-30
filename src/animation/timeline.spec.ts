import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import {
  Cartesian3,
  Cartographic,
  Math as CesiumMath,
  PolylineCollection,
  PrimitiveCollection,
  type Viewer,
} from 'cesium'
import {
  createAnimation,
  createCameraTrack,
  createFlyLine,
  createFlowArrow,
  createTimeline,
  parseAnimationDefinition,
  type AnimationDefinition,
  type CameraTrackOptions,
} from './index'
import { inspectAnimations } from './runtime'
import { createEffectHandle } from '../../packages/cesium-animation/src/runtime'

const points = [
  { lon: 106.63, lat: 26.647, height: 100 },
  { lon: 106.64, lat: 26.65, height: 250 },
]
const cameraOptions: CameraTrackOptions = {
  keyframes: [
    {
      time: 0,
      position: { lon: 179, lat: 0, height: 1000 },
      heading: 350,
      pitch: -30,
      roll: 0,
    },
    {
      time: 10,
      position: { lon: -179, lat: 0, height: 2000 },
      heading: 10,
      pitch: -50,
      roll: 0,
    },
  ],
}
let now: number
let sequence: number
let frames: Map<number, FrameRequestCallback>
let hosts: { viewer: Viewer; destroy(): void }[]

function host() {
  let destroyed = false
  const primitives = new PrimitiveCollection()
  const setView = vi.fn()
  const clock = {
    shouldAnimate: false,
    multiplier: 11,
    currentTime: 'host-time',
  }
  const viewer = {
    isDestroyed: () => destroyed,
    scene: { primitives, requestRender: vi.fn() },
    camera: { setView, flyTo: vi.fn() },
    clock,
  } as unknown as Viewer
  const result = {
    viewer,
    primitives,
    setView,
    clock,
    destroy() {
      primitives.destroy()
      destroyed = true
    },
  }
  hosts.push(result)
  return result
}
function step(milliseconds: number) {
  now += milliseconds
  const pending = [...frames.values()]
  frames.clear()
  for (const callback of pending) callback(now)
}
function definition(): AnimationDefinition {
  return {
    schemaVersion: 1,
    duration: 10,
    tracks: [
      {
        id: 'line',
        kind: 'fly-line',
        at: 0,
        duration: 8,
        options: { positions: points },
      },
      {
        id: 'arrow',
        kind: 'flow-arrow',
        at: 2,
        duration: 6,
        options: { positions: points },
      },
      {
        id: 'water',
        kind: 'fountain',
        at: 3,
        duration: 5,
        options: { position: points[0]! },
      },
    ],
  }
}
function diagnostics(viewer: Viewer) {
  return inspectAnimations(viewer).effects as {
    kind: string
    state: string
    timeSeconds: number
    visible: boolean
    phase?: number
    simulationTimeSeconds?: number
    particleCount?: number
  }[]
}
beforeEach(() => {
  now = sequence = 0
  hosts = []
  frames = new Map()
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback)
    return sequence
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('ImageBitmap', class ImageBitmap {})
  vi.stubGlobal('OffscreenCanvas', class OffscreenCanvas {})
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    createRadialGradient: () => ({ addColorStop() {} }),
    fillRect() {},
  } as unknown as CanvasRenderingContext2D)
})
afterEach(() => {
  for (const item of hosts) if (!item.viewer.isDestroyed()) item.destroy()
  step(0)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Timeline ownership and evaluation', () => {
  it('owns one time driver, rejects independent controls and a second owner', () => {
    const h = host()
    const line = createFlyLine(h.viewer, { positions: points })
    const first = createTimeline(h.viewer, { duration: 10 })
    const second = createTimeline(h.viewer, { duration: 10 })
    first.add({ id: 'line', effect: line, at: 0, duration: 8 })
    expect(() =>
      second.add({ id: 'duplicate-owner', effect: line, at: 0, duration: 8 }),
    ).toThrow(/belongs/)
    for (const operation of [
      () => line.play(),
      () => line.pause(),
      () => line.resume(),
      () => line.stop(),
    ])
      expect(operation).toThrow(/Timeline/)
    first.play()
    expect(frames.size).toBe(1)
    expect(inspectAnimations(h.viewer)).toMatchObject({
      effectCount: 1,
      timelineCount: 2,
      activeEffects: 1,
    })
    first.destroy()
    expect(line.state).toBe('stopped')
    expect(h.primitives.length).toBe(1)
    line.play()
    step(100)
    expect(line.timeSeconds).toBeCloseTo(0.1)
    line.destroy()
    second.destroy()
  })

  it('shares one RAF with independently playing effects and releases only its demand', () => {
    const h = host()
    const independent = createFlyLine(h.viewer, { positions: points })
    const animation = createAnimation(h.viewer, definition())
    independent.play()
    animation.timeline.play()
    expect(frames.size).toBe(1)
    animation.timeline.pause()
    expect(frames.size).toBe(1)
    independent.stop()
    expect(frames.size).toBe(0)
    animation.destroy()
    independent.destroy()
  })

  it('validates ids, duration, foreign Viewers and active effects before claiming', () => {
    const a = host(),
      b = host()
    const line = createFlyLine(a.viewer, { positions: points })
    const timeline = createTimeline(b.viewer, { duration: 10 })
    expect(() =>
      timeline.add({ id: 'foreign', effect: line, at: 0, duration: 2 }),
    ).toThrow(/Viewer/)
    const own = createTimeline(a.viewer, { duration: 10 })
    for (const patch of [
      { id: '' },
      { at: -1 },
      { at: 9, duration: 2 },
      { duration: 0 },
      { duration: NaN },
      { fill: 'forever' },
    ]) {
      expect(() =>
        own.add({
          id: 'x',
          effect: line,
          at: 0,
          duration: 2,
          ...patch,
        } as Parameters<typeof own.add>[0]),
      ).toThrow()
    }
    line.play()
    expect(() =>
      own.add({ id: 'active', effect: line, at: 0, duration: 2 }),
    ).toThrow(/Stop/)
    line.stop()
    own.add({ id: 'x', effect: line, at: 0, duration: 2 })
    expect(() =>
      own.add({ id: 'x', effect: line, at: 0, duration: 2 }),
    ).toThrow(/Duplicate/)
    own.destroy()
    timeline.destroy()
    line.destroy()
  })

  it('seeks exactly regardless of history and applies half-open ranges plus hold', () => {
    const h = host()
    const line = createFlyLine(h.viewer, { positions: points })
    const arrow = createFlowArrow(h.viewer, { positions: points })
    const timeline = createTimeline(h.viewer, { duration: 10 })
    timeline.add({ id: 'line', effect: line, at: 2, duration: 3 })
    timeline.add({
      id: 'arrow',
      effect: arrow,
      at: 1,
      duration: 2,
      fill: 'hold',
    })
    expect(diagnostics(h.viewer).every((item) => !item.visible)).toBe(true)
    timeline.seek(2.5)
    const a = diagnostics(h.viewer)
    expect(a[0]).toMatchObject({
      timeSeconds: 0.5,
      phase: 0.175,
      visible: true,
    })
    timeline.seek(8)
    expect(diagnostics(h.viewer)[0]?.visible).toBe(false)
    expect(diagnostics(h.viewer)[1]).toMatchObject({
      visible: true,
      timeSeconds: 2,
    })
    timeline.seek(2.5)
    expect(diagnostics(h.viewer)).toEqual(a)
    timeline.seek(5)
    expect(diagnostics(h.viewer)[0]?.visible).toBe(false)
    for (const value of [-1, 11, NaN, Infinity])
      expect(() => timeline.seek(value)).toThrow()
    timeline.destroy()
    line.destroy()
    arrow.destroy()
  })

  it('uses monotonic wall time, applies speed continuously and resumes from pause', () => {
    const h = host()
    const animation = createAnimation(h.viewer, definition())
    const timeline = animation.timeline
    timeline.play()
    step(1000)
    expect(timeline.timeSeconds).toBe(1)
    timeline.setSpeed(2)
    step(500)
    expect(timeline.timeSeconds).toBe(2)
    timeline.pause()
    step(4000)
    expect(timeline.timeSeconds).toBe(2)
    expect(frames.size).toBe(0)
    timeline.resume()
    step(500)
    expect(timeline.timeSeconds).toBe(3)
    for (const rate of [0, -1, NaN, Infinity])
      expect(() => timeline.setSpeed(rate)).toThrow()
    timeline.stop()
    expect(timeline.timeSeconds).toBe(0)
    expect(h.clock).toEqual({
      shouldAnimate: false,
      multiplier: 11,
      currentTime: 'host-time',
    })
    animation.destroy()
  })

  it('reports particle reset, clears particles while paused and restarts on resume', () => {
    const h = host()
    const animation = createAnimation(h.viewer, definition())
    const timeline = animation.timeline
    const report = timeline.seek(5)
    expect(report).toEqual({ exact: ['line', 'arrow'], reset: ['water'] })
    expect(h.primitives.length).toBe(2)
    timeline.play()
    timeline.seek(5)
    expect(h.primitives.length).toBe(3)
    step(100)
    expect(
      diagnostics(h.viewer).find((item) => item.kind === 'fountain')
        ?.simulationTimeSeconds,
    ).toBeCloseTo(0.1)
    timeline.pause()
    expect(h.primitives.length).toBe(2)
    timeline.resume()
    expect(h.primitives.length).toBe(3)
    expect(
      diagnostics(h.viewer).find((item) => item.kind === 'fountain')
        ?.simulationTimeSeconds,
    ).toBe(0)
    animation.destroy()
  })

  it('wraps 20 times without duplicate particle resources or frame subscriptions', () => {
    const h = host()
    const data = definition()
    data.duration = 1
    data.loop = 'repeat'
    data.tracks = [
      {
        id: 'water',
        kind: 'fountain',
        at: 0,
        duration: 1,
        options: { position: points[0]! },
      },
    ]
    const animation = createAnimation(h.viewer, data)
    animation.timeline.play()
    for (let i = 0; i < 20; i++) {
      step(1100)
      expect(animation.timeline.timeSeconds).toBeCloseTo(((i + 1) * 0.1) % 1, 8)
      expect(h.primitives.length).toBe(1)
      expect(frames.size).toBe(1)
    }
    animation.destroy()
    expect(h.primitives.length).toBe(0)
    expect(frames.size).toBe(0)
  })

  it('finishes at duration, leaves no demand and plays again from zero', () => {
    const h = host()
    const animation = createAnimation(h.viewer, definition())
    animation.timeline.play()
    step(12000)
    expect(animation.timeline.state).toBe('stopped')
    expect(animation.timeline.timeSeconds).toBe(10)
    expect(frames.size).toBe(0)
    animation.timeline.play()
    expect(animation.timeline.timeSeconds).toBe(0)
    animation.destroy()
  })

  it('external driver accepts setTime, never starts RAF and rejects the internal controls', () => {
    const h = host()
    const animation = createAnimation(h.viewer, definition(), {
      driver: 'external',
    })
    const timeline = animation.timeline
    timeline.setTime(4)
    timeline.setTime(4.1)
    expect(timeline.timeSeconds).toBe(4.1)
    expect(frames.size).toBe(0)
    expect(
      diagnostics(h.viewer).find((item) => item.kind === 'fountain')
        ?.simulationTimeSeconds,
    ).toBeCloseTo(0.1)
    expect(timeline.setTime(3.5).reset).toContain('water')
    for (const operation of [
      () => timeline.play(),
      () => timeline.pause(),
      () => timeline.resume(),
      () => timeline.stop(),
      () => timeline.seek(2),
      () => timeline.setSpeed(2),
    ])
      expect(operation).toThrow(/External/)
    expect(() => timeline.setTime(-1)).toThrow()
    animation.destroy()
    const internal = createTimeline(h.viewer, { duration: 1 })
    expect(() => internal.setTime(0)).toThrow(/Internal/)
    internal.destroy()
  })

  it('removes tracks, permits unsubscribe and disposes only explicit ownership', () => {
    const h = host()
    const line = createFlyLine(h.viewer, { positions: points })
    const timeline = createTimeline(h.viewer, {
      duration: 10,
      disposeEffects: true,
    })
    const listener = vi.fn()
    const unsubscribe = timeline.subscribe(listener)
    timeline.add({ id: 'line', effect: line, at: 0, duration: 8 })
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    timeline.remove('line')
    expect(line.state).toBe('destroyed')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(timeline.remove('missing')).toBeUndefined()
    timeline.destroy()
    timeline.destroy()
    expect(() => timeline.play()).toThrow(/destroyed/)
  })
})

describe('camera and definition', () => {
  it('evaluates geodesic positions, altitude and the shortest heading on repeated seek', () => {
    const h = host()
    const camera = createCameraTrack(h.viewer, cameraOptions)
    const timeline = createTimeline(h.viewer, { duration: 12 })
    timeline.add({
      id: 'camera',
      effect: camera,
      at: 0,
      duration: 10,
      fill: 'hold',
    })
    timeline.seek(5)
    const pose = h.setView.mock.calls.at(-1)![0] as {
      destination: Cartesian3
      orientation: { heading: number; pitch: number }
    }
    const geographic = Cartographic.fromCartesian(pose.destination)
    expect(Math.abs(CesiumMath.toDegrees(geographic.longitude))).toBeCloseTo(
      180,
      7,
    )
    expect(geographic.height).toBeCloseTo(1500, 5)
    expect(CesiumMath.negativePiToPi(pose.orientation.heading)).toBeCloseTo(
      0,
      9,
    )
    expect(CesiumMath.toDegrees(pose.orientation.pitch)).toBeCloseTo(-40, 9)
    timeline.seek(0)
    timeline.seek(5)
    expect(h.setView.mock.calls.at(-1)![0]).toEqual(pose)
    timeline.seek(10)
    const last = h.setView.mock.calls.at(-1)![0] as { destination: Cartesian3 }
    expect(Cartographic.fromCartesian(last.destination).height).toBeCloseTo(
      2000,
      5,
    )
    expect(h.viewer.camera.flyTo).not.toHaveBeenCalled()
    timeline.destroy()
    camera.destroy()
  })

  it('rejects camera overlap and prevents an older hold camera from reclaiming later shots', () => {
    const h = host()
    const aOptions = {
      keyframes: cameraOptions.keyframes.map((key) => ({
        ...key,
        time: key.time / 5,
      })),
    }
    const bOptions = {
      keyframes: aOptions.keyframes.map((key) => ({
        ...key,
        position: { lon: 20, lat: 30, height: 5000 },
      })),
    }
    const a = createCameraTrack(h.viewer, aOptions)
    const b = createCameraTrack(h.viewer, bOptions)
    const timeline = createTimeline(h.viewer, { duration: 10 })
    // Intentionally reverse insertion order.
    timeline.add({ id: 'second', effect: b, at: 3, duration: 2 })
    timeline.add({ id: 'first', effect: a, at: 0, duration: 2, fill: 'hold' })
    const conflict = createCameraTrack(h.viewer, aOptions)
    expect(() =>
      timeline.add({ id: 'conflict', effect: conflict, at: 1, duration: 2 }),
    ).toThrow(/overlap/)
    conflict.destroy()
    timeline.play()
    step(3500)
    step(2000)
    const end = h.setView.mock.calls.at(-1)![0] as { destination: Cartesian3 }
    expect(Cartographic.fromCartesian(end.destination).height).toBeCloseTo(
      5000,
      5,
    )
    const count = h.setView.mock.calls.length
    step(1000)
    expect(h.setView.mock.calls.length).toBe(count)
    timeline.destroy()
    a.destroy()
    b.destroy()
  })

  it.each([
    { keyframes: [] },
    { keyframes: [cameraOptions.keyframes[1], cameraOptions.keyframes[0]] },
    {
      keyframes: cameraOptions.keyframes.map((key) => ({ ...key, pitch: 95 })),
    },
    {
      keyframes: cameraOptions.keyframes.map((key) => ({
        ...key,
        easing: 'invalid',
      })),
    },
    {
      keyframes: [
        cameraOptions.keyframes[0],
        { ...cameraOptions.keyframes[1], position: { lon: -1, lat: 0 } },
      ],
    },
  ])(
    'rejects invalid or antipodal camera keyframes before allocating %j',
    (options) => {
      const h = host()
      expect(() =>
        createCameraTrack(h.viewer, options as CameraTrackOptions),
      ).toThrow()
      expect(inspectAnimations(h.viewer).effectCount).toBe(0)
    },
  )

  it('fully validates and deep-copies exported definitions before scene allocation', () => {
    const h = host()
    const source = definition()
    const parsed = parseAnimationDefinition(source)
    source.tracks[0]!.at = 99
    expect(parsed.tracks[0]!.at).toBe(0)
    for (const patch of [
      { schemaVersion: 2 },
      { duration: NaN },
      { loop: 'pingpong' },
      { unknown: 1 },
      { tracks: [{ ...parsed.tracks[0], kind: 'unknown' }] },
      { tracks: [parsed.tracks[0], parsed.tracks[0]] },
      {
        tracks: [
          { ...parsed.tracks[0], options: { positions: points, widthPx: 0 } },
        ],
      },
    ])
      expect(() =>
        createAnimation(h.viewer, {
          ...parsed,
          ...patch,
        } as AnimationDefinition),
      ).toThrow()
    expect(h.primitives.length).toBe(0)
    expect(inspectAnimations(h.viewer).timelineCount).toBe(0)
    const animation = createAnimation(h.viewer, parsed)
    parsed.duration = 99
    expect(animation.definition.duration).toBe(10)
    animation.destroy()
  })

  it('cleans up every owned resource when the host is destroyed first', () => {
    const h = host()
    const animation = createAnimation(h.viewer, definition())
    animation.timeline.play()
    animation.timeline.seek(4)
    h.destroy()
    step(100)
    expect(animation.timeline.state).toBe('destroyed')
    expect(
      [...animation.effects.values()].every(
        (effect) => effect.state === 'destroyed',
      ),
    ).toBe(true)
    expect(inspectAnimations(h.viewer)).toMatchObject({
      effectCount: 0,
      timelineCount: 0,
      schedulerPending: false,
    })
    animation.destroy()
  })
})

describe('failure isolation', () => {
  it('isolates a failing task without stalling other effects sharing the Viewer', () => {
    const h = host()
    const healthy = createFlyLine(h.viewer, { positions: points })
    const broken = createEffectHandle(
      h.viewer,
      { seek: 'exact', pause: 'exact', reverse: false },
      {
        kind: 'fly',
        sample(time) {
          if (time > 0) throw new Error('sample failed')
        },
        start() {},
        pause() {},
        stop() {},
        setVisible() {},
        update() {},
        destroy() {},
      },
    )
    healthy.play()
    broken.play()
    step(100)
    expect(broken.state).toBe('destroyed')
    expect(broken.error?.message).toBe('sample failed')
    expect(healthy.timeSeconds).toBe(0.1)
    expect(frames.size).toBe(1)
    expect(inspectAnimations(h.viewer).errors).toContain('Error: sample failed')
    step(100)
    expect(healthy.timeSeconds).toBe(0.2)
    healthy.destroy()
  })

  it('cleans other owned tracks and retries failed cleanup without leaving scheduler bookkeeping', () => {
    const h = host()
    let attempts = 0
    const broken = createEffectHandle(
      h.viewer,
      { seek: 'exact', pause: 'exact', reverse: false },
      {
        kind: 'fly',
        sample() {},
        start() {},
        pause() {},
        stop() {},
        setVisible() {},
        update() {},
        destroy() {
          if (++attempts === 1) throw new Error('cleanup failed')
        },
      },
    )
    const line = createFlyLine(h.viewer, { positions: points })
    const timeline = createTimeline(h.viewer, {
      duration: 10,
      disposeEffects: true,
    })
    timeline.add({ id: 'broken', effect: broken, at: 0, duration: 8 })
    timeline.add({ id: 'line', effect: line, at: 0, duration: 8 })
    timeline.play()
    expect(() => timeline.destroy()).toThrow(/cleanup/)
    expect(line.state).toBe('destroyed')
    expect(frames.size).toBe(0)
    expect(h.primitives.length).toBe(0)
    expect(inspectAnimations(h.viewer).effectCount).toBe(0)
    expect(() => timeline.destroy()).not.toThrow()
    expect(attempts).toBe(2)
  })

  it('isolates subscriber errors, notifies other subscribers and still completes disposal', () => {
    const h = host()
    const timeline = createTimeline(h.viewer, { duration: 1 })
    const listener = vi.fn()
    timeline.subscribe(() => {
      throw new Error('listener failed')
    })
    timeline.subscribe(listener)
    timeline.play()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(timeline.error?.message).toBe('listener failed')
    timeline.destroy()
    expect(listener).toHaveBeenCalledTimes(2)
    expect(frames.size).toBe(0)
  })

  it('rolls back earlier tracks and a partially created primitive on creation failure', () => {
    const h = host()
    const originalAdd = h.primitives.add.bind(h.primitives)
    let calls = 0
    let failedCollection: PolylineCollection | undefined
    vi.spyOn(h.primitives, 'add').mockImplementation((primitive, index) => {
      if (++calls === 2) {
        failedCollection = primitive as PolylineCollection
        throw new Error('host add failed')
      }
      return originalAdd(primitive, index)
    })
    expect(() => createAnimation(h.viewer, definition())).toThrow(
      /host add failed/,
    )
    expect(failedCollection?.isDestroyed()).toBe(true)
    expect(h.primitives.length).toBe(0)
    expect(inspectAnimations(h.viewer)).toMatchObject({
      effectCount: 0,
      timelineCount: 0,
      schedulerPending: false,
    })
  })

  it('keeps initialization failures idle and allows a clean retry', () => {
    const h = host()
    let attempt = 0
    const rollback = vi.fn()
    const effect = createEffectHandle(
      h.viewer,
      { seek: 'exact', pause: 'exact', reverse: false },
      {
        kind: 'fly',
        sample() {},
        start() {
          if (++attempt === 1) throw new Error('initialization failed')
        },
        pause: rollback,
        stop() {},
        setVisible() {},
        update() {},
        destroy() {},
      },
    )
    expect(() => effect.play()).toThrow(/initialization failed/)
    expect(effect.state).toBe('idle')
    expect(rollback).toHaveBeenCalledTimes(1)
    expect(frames.size).toBe(0)
    effect.play()
    expect(effect.state).toBe('playing')
    step(100)
    expect(effect.timeSeconds).toBe(0.1)
    effect.destroy()
  })

  it('fails only the owning Timeline when a bound renderer throws', () => {
    const h = host()
    const healthy = createFlyLine(h.viewer, { positions: points })
    const broken = createEffectHandle(
      h.viewer,
      { seek: 'exact', pause: 'exact', reverse: false },
      {
        kind: 'fly',
        sample(time) {
          if (time > 1) throw new Error('timeline sample failed')
        },
        start() {},
        pause() {},
        stop() {},
        setVisible() {},
        update() {},
        destroy() {},
      },
    )
    const timeline = createTimeline(h.viewer, {
      duration: 5,
      disposeEffects: true,
    })
    timeline.add({ id: 'broken', effect: broken, at: 0, duration: 5 })
    timeline.play()
    healthy.play()
    step(2000)
    expect(timeline.state).toBe('destroyed')
    expect(timeline.error?.message).toBe('timeline sample failed')
    expect(broken.state).toBe('destroyed')
    expect(healthy.timeSeconds).toBe(2)
    expect(frames.size).toBe(1)
    healthy.destroy()
  })

  it('preserves unrelated primitives through 20 animation creation/disposal cycles', () => {
    const h = host()
    const sentinel = h.primitives.add(new PolylineCollection())
    for (let i = 0; i < 20; i++) {
      const animation = createAnimation(h.viewer, definition())
      animation.timeline.play()
      animation.timeline.seek(4)
      animation.timeline.pause()
      animation.timeline.resume()
      animation.timeline.stop()
      animation.destroy()
      expect(h.primitives.length).toBe(1)
      expect(h.primitives.contains(sentinel)).toBe(true)
      expect(frames.size).toBe(0)
    }
  })
})
