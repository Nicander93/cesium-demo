import * as Cesium from 'cesium'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { WaterSurface } from '../surface'

const update = vi.hoisted(() => vi.fn())
vi.mock('../reflection', async () => {
  const { registerWaterPrimitive } = await import('../capture')
  return {
    registerWaterPrimitive,
    PlanarReflection: class {
      private material: Cesium.Material
      constructor(_scene: Cesium.Scene, material: Cesium.Material) { this.material = material }
      update() { const result = update(); if (result) this.material.uniforms.reflectionReady = 1; return result }
      invalidate() {}
      getDiagnostics() { return { reflectionFrames: 0, reflectionTargetsCreated: 0, reflectionWidth: 0, reflectionHeight: 0, lastReflectionMs: 0 } }
      destroy() {}
    },
  }
})

beforeAll(() => { vi.stubGlobal('ImageBitmap', class ImageBitmap {}); vi.stubGlobal('OffscreenCanvas', class OffscreenCanvas {}) })
afterAll(() => { vi.unstubAllGlobals() })
afterEach(() => { update.mockReset(); vi.restoreAllMocks() })

function fixture() {
  const scene = { primitives: new Cesium.PrimitiveCollection(), preRender: new Cesium.Event(), postRender: new Cesium.Event(), requestRender: vi.fn(), isDestroyed: () => false, mode: Cesium.SceneMode.SCENE3D }
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
  const water = new WaterSurface({ scene: scene as unknown as Cesium.Scene, height: 44, foam: false,
    positions: [Cesium.Cartographic.fromDegrees(119, 33), Cesium.Cartographic.fromDegrees(119.001, 33), Cesium.Cartographic.fromDegrees(119, 33.001)] })
  return { scene, clock, water }
}

describe('reflection recovery', () => {
  it('backs off a temporary network error and recovers without toggling reflection', () => {
    const f = fixture()
    update.mockImplementationOnce(() => { throw new Cesium.RequestErrorEvent(503) }).mockReturnValue(true)
    f.scene.preRender.raiseEvent()
    expect(f.water.getDiagnostics().reflectionEnabled).toBe(true)
    expect(f.water.getDiagnostics().error).not.toBeNull()
    f.clock.mockReturnValue(500)
    f.scene.preRender.raiseEvent()
    expect(update).toHaveBeenCalledTimes(1)
    f.clock.mockReturnValue(1001)
    f.scene.preRender.raiseEvent()
    expect(update).toHaveBeenCalledTimes(2)
    expect(f.water.getDiagnostics().error).toBeNull()
    expect(f.water.getDiagnostics().reflectionAvailable).toBe(true)
    f.water.destroy()
  })

  it('bounds repeated renderer failures and allows an explicit retry', () => {
    const f = fixture()
    update.mockImplementation(() => { throw new Error('GPU unavailable') })
    for (const now of [0, 1001, 3002]) { f.clock.mockReturnValue(now); f.scene.preRender.raiseEvent() }
    expect(update).toHaveBeenCalledTimes(3)
    expect(f.water.getDiagnostics().reflectionEnabled).toBe(false)
    update.mockReturnValue(true)
    f.water.setOptions({ reflection: true })
    f.scene.preRender.raiseEvent()
    expect(f.water.getDiagnostics().error).toBeNull()
    expect(f.water.getDiagnostics().reflectionAvailable).toBe(true)
    f.water.destroy()
  })
})
