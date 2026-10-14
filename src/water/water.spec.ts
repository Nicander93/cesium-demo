import * as Cesium from 'cesium'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createWaterMaterial, updateWaterMaterial, WaterSurface } from './index'
import { reflectionDimensions } from './reflection'

function createScene() {
  const scene = { primitives: new Cesium.PrimitiveCollection(), preRender: new Cesium.Event(), postRender: new Cesium.Event(), requestRender: vi.fn(), isDestroyed: () => false, mode: Cesium.SceneMode.SCENE3D }
  return scene as unknown as Cesium.Scene
}
const positions = [Cesium.Cartographic.fromDegrees(119, 33), Cesium.Cartographic.fromDegrees(119.001, 33), Cesium.Cartographic.fromDegrees(119, 33.001)]

beforeAll(() => { vi.stubGlobal('ImageBitmap', class ImageBitmap {}); vi.stubGlobal('OffscreenCanvas', class OffscreenCanvas {}) })
afterAll(() => { vi.unstubAllGlobals() })

describe('water material and surface ownership', () => {
  it('creates a standard material and changes uniforms without replacing it', () => {
    const material = createWaterMaterial({ waterAlpha: .8 })
    updateWaterMaterial(material, { time: 2, waterAlpha: .5, rippleSize: 80 })
    expect(material.uniforms.time).toBe(2)
    expect(material.uniforms.waterAlpha).toBe(.5)
    expect(material.uniforms.size).toBe(80)
    expect(material.isTranslucent()).toBe(true)
    updateWaterMaterial(material, { waterAlpha: 1 })
    expect(material.isTranslucent()).toBe(false)
    updateWaterMaterial(material, { waterAlpha: .9 })
    expect(material.isTranslucent()).toBe(true)
    expect(material.shaderSource).not.toMatch(/v_worldPosition|v_uv/)
    material.destroy()
  })

  it('moves water repeatedly without recreating geometry, material, or resetting appearance', () => {
    const scene = createScene()
    const water = new WaterSurface({ scene, positions, height: 44, reflection: false })
    const primitive = scene.primitives.get(0)
    const material = water.material
    water.setOptions({ rippleSize: 90, waterAlpha: .6 })
    water.height = 44
    water.height = 60
    water.height = 80
    expect(scene.primitives.length).toBe(1)
    expect(scene.primitives.get(0)).toBe(primitive)
    expect(water.material).toBe(material)
    expect(water.rippleSize).toBe(90)
    expect(water.waterAlpha).toBe(.6)
    expect(Cesium.Cartesian3.magnitude(Cesium.Matrix4.getTranslation(primitive.modelMatrix, new Cesium.Cartesian3()))).toBeCloseTo(36)
    water.destroy()
  })

  it('rejects invalid updates before altering the water', () => {
    const scene = createScene()
    const water = new WaterSurface({ scene, positions, height: 44 })
    expect(() => water.setOptions({ height: 80, reflectionResolutionScale: 0 })).toThrow()
    expect(water.height).toBe(44)
    expect(() => water.setOptions({ rippleSize: 30, waterAlpha: 2 })).toThrow()
    expect(water.rippleSize).toBe(50)
    expect(() => water.height = NaN).toThrow()
    water.destroy()
  })

  it('cleans listeners and owned resources once, leaving host primitives intact', async () => {
    const scene = createScene()
    const hostPrimitive = new Cesium.Primitive()
    scene.primitives.add(hostPrimitive)
    const first = new WaterSurface({ scene, positions, height: 44, reflection: false })
    const second = new WaterSurface({ scene, positions, height: 70, reflection: false })
    expect(scene.preRender.numberOfListeners).toBe(2)
    first.destroy()
    first.destroy()
    expect(await first.ready).toBe(false)
    expect(first.material.isDestroyed()).toBe(true)
    expect(scene.primitives.length).toBe(2)
    expect(scene.preRender.numberOfListeners).toBe(1)
    expect(() => first.height = 30).toThrow(/destroyed/)
    second.destroy()
    expect(scene.preRender.numberOfListeners).toBe(0)
    expect(scene.postRender.numberOfListeners).toBe(0)
    expect(scene.primitives.get(0)).toBe(hostPrimitive)
    scene.primitives.destroy()
  })

  it('resolves readiness only after the geometry was rendered', async () => {
    const scene = createScene()
    const water = new WaterSurface({ scene, positions, height: 44, reflection: false })
    Object.defineProperty(scene.primitives.get(0), 'ready', { value: true })
    scene.postRender.raiseEvent(scene)
    expect(await water.ready).toBe(true)
    expect(water.getDiagnostics().readyMs).not.toBeNull()
    water.destroy()
  })

  it('bounds reflection pixels while retaining viewport aspect ratio', () => {
    expect(reflectionDimensions(1920, 1080, { resolutionScale: .5, maxSize: 1024 })).toEqual({ width: 960, height: 540 })
    expect(reflectionDimensions(3840, 2160, { resolutionScale: 1, maxSize: 1024 })).toEqual({ width: 1024, height: 576 })
    expect(reflectionDimensions(1, 1, { resolutionScale: .35, maxSize: 512 })).toEqual({ width: 1, height: 1 })
  })
})


it('changes wave speed without jumping phase and can pause and resume', () => {
  let now = 0
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
  const scene = createScene()
  const water = new WaterSurface({ scene, positions, height: 44, reflection: false, waveSpeed: 1 })
  const material = water.material
  try {
    now = 1000
    scene.preRender.raiseEvent(scene)
    expect(material.uniforms.time).toBe(1)
    now = 1500
    water.setOptions({ waveSpeed: 2, waveStrength: 1.5 })
    expect(material.uniforms.time).toBe(1.5)
    expect(material.uniforms.waveStrength).toBe(1.5)
    now = 2000
    scene.preRender.raiseEvent(scene)
    expect(material.uniforms.time).toBe(2.5)
    water.setOptions({ waveSpeed: 0 })
    now = 4000
    scene.preRender.raiseEvent(scene)
    expect(material.uniforms.time).toBe(2.5)
    water.setOptions({ waveSpeed: 1, waveStrength: 0 })
    now = 5000
    scene.preRender.raiseEvent(scene)
    expect(material.uniforms.time).toBe(3.5)
    expect(material.uniforms.waveStrength).toBe(0)
    expect(() => water.setOptions({ waveSpeed: -1 })).toThrow()
    expect(() => water.setOptions({ waveStrength: NaN })).toThrow()
    expect(water.material).toBe(material)
  } finally {
    water.destroy()
    clock.mockRestore()
  }
})

it('fades a local crop without forcing opaque rendering and rejects invalid fade widths', () => {
  const material = createWaterMaterial({ waterAlpha: 1 })
  expect(material.isTranslucent()).toBe(false)
  updateWaterMaterial(material, { edgeFadeWidth: 0.08 })
  expect(material.isTranslucent()).toBe(true)
  expect(() => updateWaterMaterial(material, { edgeFadeWidth: 0.6 })).toThrow()
  expect(material.uniforms.edgeFadeWidth).toBe(0.08)
  material.destroy()
})
