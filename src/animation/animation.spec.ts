import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Cartesian3,
  Ellipsoid,
  PolylineCollection,
  PrimitiveCollection,
  type Viewer,
} from 'cesium'
import { createFlyLine, createFlowArrow, createFountain } from './index'
import { inspectAnimations } from './runtime'
import type { EffectHandle, FlyLineOptions } from './index'

const positions = [
  { lon: 106.6, lat: 26.6, height: 300 },
  { lon: 106.61, lat: 26.61, height: 400 },
]
let now = 0
let nextFrame = 0
let frames: Map<number, FrameRequestCallback>
let viewers: { viewer: Viewer; destroy(): void }[]

function createViewer() {
  let destroyed = false
  const primitives = new PrimitiveCollection()
  const clock = {
    shouldAnimate: false,
    multiplier: 17,
    currentTime: 'unchanged',
  }
  const requestRender = vi.fn()
  const viewer = {
    isDestroyed: () => destroyed,
    scene: { primitives, requestRender },
    clock,
  } as unknown as Viewer
  const result = {
    viewer,
    primitives,
    clock,
    requestRender,
    destroy() {
      primitives.destroy()
      destroyed = true
    },
  }
  viewers.push(result)
  return result
}

function advance(milliseconds: number): void {
  now += milliseconds
  const pending = [...frames.values()]
  frames.clear()
  for (const callback of pending) callback(now)
}

beforeEach(() => {
  now = nextFrame = 0
  frames = new Map()
  viewers = []
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
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
  for (const host of viewers) {
    if (!host.viewer.isDestroyed()) host.destroy()
  }
  advance(0)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('input contracts', () => {
  it.each(
    [
      [],
      [positions[0]],
      [{ lon: NaN, lat: 0 }, positions[1]],
      [{ lon: 181, lat: 0 }, positions[1]],
      [{ lon: 0, lat: 91 }, positions[1]],
      [{ lon: 0, lat: 0, height: Infinity }, positions[1]],
      [positions[0], positions[0]],
    ].map((points) => ({ points })),
  )(
    'rejects invalid paths before allocating scene resources: %j',
    ({ points }) => {
      const host = createViewer()
      expect(() =>
        createFlyLine(host.viewer, {
          positions: points as FlyLineOptions['positions'],
        }),
      ).toThrow()
      expect(host.primitives.length).toBe(0)
      expect(inspectAnimations(host.viewer).effectCount).toBe(0)
    },
  )

  it('accepts a short antimeridian segment and both directions', () => {
    const host = createViewer()
    for (const direction of ['forward', 'backward'] as const) {
      const effect = createFlowArrow(host.viewer, {
        positions: [
          { lon: 179.9, lat: 5 },
          { lon: -179.9, lat: 5 },
        ],
        direction,
      })
      effect.play()
      advance(250)
      expect(effect.timeSeconds).toBe(0.25)
      effect.destroy()
    }
    expect(host.primitives.length).toBe(0)
  })

  it.each([
    { speed: Infinity },
    { widthPx: 0 },
    { opacity: -1 },
    { color: 'invalid-color' },
    { direction: 'north' },
    { unknown: 4 },
  ])('rejects invalid path options %j without allocating', (options) => {
    const host = createViewer()
    expect(() =>
      createFlyLine(host.viewer, { positions, ...options } as FlyLineOptions),
    ).toThrow()
    expect(host.primitives.length).toBe(0)
  })

  it('rejects invalid fountains and arrow spacing', () => {
    const host = createViewer()
    for (const patch of [
      { emissionRate: -1 },
      { emissionRate: 2001 },
      { lifetime: 0 },
      { minSpeed: 20, maxSpeed: 10 },
      { quality: 'ultra' },
    ]) {
      expect(() =>
        createFountain(host.viewer, {
          position: positions[0]!,
          ...patch,
        } as Parameters<typeof createFountain>[1]),
      ).toThrow()
    }
    expect(() =>
      createFlowArrow(host.viewer, { positions, spacing: 0 }),
    ).toThrow()
    expect(host.primitives.length).toBe(0)
  })
})

describe('lifecycle and time', () => {
  it('is idle at creation; resume/play no-ops follow the documented state table', () => {
    const host = createViewer()
    const effect = createFlyLine(host.viewer, { positions })
    expect(effect.state).toBe('idle')
    effect.pause()
    effect.resume()
    expect(effect.state).toBe('idle')
    expect(frames.size).toBe(0)
    effect.play()
    effect.play()
    expect(frames.size).toBe(1)
    advance(1000)
    effect.pause()
    const paused = effect.timeSeconds
    advance(5000)
    expect(effect.timeSeconds).toBe(paused)
    effect.play()
    expect(effect.state).toBe('paused')
    effect.resume()
    advance(500)
    expect(effect.timeSeconds).toBe(1.5)
    effect.stop()
    expect(effect.timeSeconds).toBe(0)
    expect(effect.state).toBe('stopped')
    expect(frames.size).toBe(0)
    effect.play()
    advance(250)
    expect(effect.timeSeconds).toBe(0.25)
    effect.destroy()
    effect.destroy()
    for (const operation of [
      () => effect.play(),
      () => effect.pause(),
      () => effect.resume(),
      () => effect.stop(),
      () => effect.update({ speed: 2 }),
    ]) {
      expect(operation).toThrow(/destroyed/)
    }
  })

  it('shares one pending frame per Viewer and stops active requests when all are paused', () => {
    const first = createViewer()
    const second = createViewer()
    const a = createFlyLine(first.viewer, { positions })
    const b = createFlowArrow(first.viewer, { positions })
    const c = createFlyLine(second.viewer, { positions })
    a.play()
    b.play()
    c.play()
    expect(frames.size).toBe(2)
    expect(inspectAnimations(first.viewer).activeEffects).toBe(2)
    a.pause()
    expect(frames.size).toBe(2)
    b.stop()
    expect(frames.size).toBe(1)
    c.destroy()
    expect(frames.size).toBe(0)
    expect(first.clock).toEqual({
      shouldAnimate: false,
      multiplier: 17,
      currentTime: 'unchanged',
    })
    a.destroy()
    b.destroy()
  })

  it('evaluates the same phase regardless of frame cadence, and speed updates preserve phase', () => {
    const sample = (steps: number[]) => {
      const host = createViewer()
      const effect = createFlyLine(host.viewer, { positions, speed: 0.35 })
      effect.play()
      for (const step of steps) advance(step)
      effect.pause()
      const phase = inspectAnimations(host.viewer).effects[0] as {
        phase: number
      }
      effect.update({ speed: 0.7 })
      expect(inspectAnimations(host.viewer).effects[0]).toMatchObject({
        phase: phase.phase,
      })
      effect.destroy()
      return phase.phase
    }
    expect(sample([1000])).toBeCloseTo(
      sample(Array.from({ length: 20 }, () => 50)),
      10,
    )
  })

  it('rejects geometry hot updates and validates patches atomically', () => {
    const host = createViewer()
    const effect = createFlowArrow(host.viewer, { positions, speed: 1 })
    effect.play()
    advance(250)
    expect(() => effect.update({ positions })).toThrow(/hot update/)
    expect(() => effect.update({ color: '#ff0000', speed: -1 })).toThrow()
    advance(250)
    expect(inspectAnimations(host.viewer).effects[0]).toMatchObject({
      phase: 0.5,
    })
    effect.update({
      direction: 'backward',
      color: '#ffffff',
      opacity: 0.5,
      spacing: 20,
    })
    effect.destroy()
  })
})

describe('resources and ENU particles', () => {
  it('restores the host primitive baseline after 20 complete cycles', () => {
    const host = createViewer()
    const sentinel = host.primitives.add(new PolylineCollection())
    for (let i = 0; i < 20; i++) {
      const handles = [
        createFlyLine(host.viewer, { positions }),
        createFlowArrow(host.viewer, { positions }),
        createFountain(host.viewer, { position: positions[0]! }),
      ]
      for (const effect of handles) effect.play()
      expect(host.primitives.length).toBe(4)
      advance(100)
      for (const effect of handles) effect.pause()
      expect(host.primitives.length).toBe(3)
      for (const effect of handles) effect.resume()
      expect(host.primitives.length).toBe(4)
      for (const effect of handles) effect.stop()
      for (const effect of handles) effect.destroy()
      expect(host.primitives.length).toBe(1)
      expect(host.primitives.contains(sentinel)).toBe(true)
      expect(inspectAnimations(host.viewer)).toMatchObject({
        effectCount: 0,
        activeEffects: 0,
        schedulerPending: false,
      })
      expect(frames.size).toBe(0)
    }
  })

  it.each([
    { lon: 0, lat: 0 },
    { lon: 106.63, lat: 26.65 },
    { lon: 18.95, lat: 69.65 },
  ])('uses negative local Up at %j', (position) => {
    const host = createViewer()
    const effect = createFountain(host.viewer, {
      position,
      quality: 'basic',
      emissionRate: 120,
    })
    expect(effect.capabilities).toEqual({
      seek: 'reset',
      pause: 'restart',
      reverse: false,
    })
    effect.play()
    const diagnostic = inspectAnimations(host.viewer).effects[0] as {
      gravityDirection: Cartesian3
      effectiveEmissionRate: number
    }
    const up = Ellipsoid.WGS84.geodeticSurfaceNormal(
      Cartesian3.fromDegrees(position.lon, position.lat),
      new Cartesian3(),
    )
    expect(Cartesian3.dot(diagnostic.gravityDirection, up)).toBeCloseTo(-1, 12)
    expect(diagnostic.effectiveEmissionRate).toBe(60)
    effect.pause()
    expect(host.primitives.length).toBe(0)
    effect.resume()
    effect.update({ emissionRate: 0, particleSizePx: 10, lifetime: 3 })
    expect(inspectAnimations(host.viewer).effects[0]).toMatchObject({
      effectiveEmissionRate: 0,
    })
    effect.destroy()
  })

  it('cleans up when the host destroys its Viewer before active effects', () => {
    const host = createViewer()
    const fly = createFlyLine(host.viewer, { positions })
    const fountain = createFountain(host.viewer, { position: positions[0]! })
    fly.play()
    fountain.play()
    host.destroy()
    advance(100)
    expect(fly.state).toBe('destroyed')
    expect(fountain.state).toBe('destroyed')
    expect(frames.size).toBe(0)
    expect(inspectAnimations(host.viewer).effectCount).toBe(0)
    fountain.destroy()
    expect(() => createFlyLine(host.viewer, { positions })).toThrow(/destroyed/)
  })

  it('permits explicit disposal after idle host destruction', () => {
    const host = createViewer()
    const effect: EffectHandle<FlyLineOptions> = createFlyLine(host.viewer, {
      positions,
    })
    host.destroy()
    expect(() => effect.play()).toThrow(/destroyed/)
    expect(effect.state).toBe('destroyed')
    expect(inspectAnimations(host.viewer).effectCount).toBe(0)
  })
})
