import * as Cesium from 'cesium'
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest'
import {
  WaterSurface,
  createWaterMaterial,
  updateWaterMaterial,
  updateWaterMaterialView,
  createWaterPreset,
} from './index'
const positions = [
  Cesium.Cartographic.fromDegrees(119, 33),
  Cesium.Cartographic.fromDegrees(119.001, 33),
  Cesium.Cartographic.fromDegrees(119, 33.001),
]
function fixture() {
  const scene = {
    primitives: new Cesium.PrimitiveCollection(),
    preRender: new Cesium.Event(),
    postRender: new Cesium.Event(),
    requestRender: vi.fn(),
    isDestroyed: () => false,
    mode: Cesium.SceneMode.SCENE3D,
  }
  return {
    scene,
    water: new WaterSurface({
      scene: scene as unknown as Cesium.Scene,
      positions,
      height: 44,
      reflection: false,
      foam: false,
    }),
  }
}
beforeAll(() => {
  vi.stubGlobal('ImageBitmap', class {})
  vi.stubGlobal('OffscreenCanvas', class {})
})
afterAll(() => vi.unstubAllGlobals())
describe('tunable reusable water', () => {
  it('validates all new controls before partially updating the material', () => {
    const material = createWaterMaterial({ waterAlpha: 0.9 })
    expect(() =>
      updateWaterMaterial(material, { waterAlpha: 0.4, waveLength: 0 }),
    ).toThrow()
    expect(material.uniforms.waterAlpha).toBe(0.9)
    expect(() => updateWaterMaterial(material, { roughness: 2 })).toThrow()
    expect(() =>
      updateWaterMaterial(material, { waveIrregularity: 2 }),
    ).toThrow()
    expect(() =>
      updateWaterMaterial(material, { waveDirection: Infinity }),
    ).toThrow()
    expect(() =>
      updateWaterMaterial(material, { detailStrength: -1 }),
    ).toThrow()
    material.destroy()
  })
  it('updates controls without replacing host geometry or material, including zero strengths', () => {
    const { scene, water } = fixture(),
      geometry = scene.primitives.get(0),
      material = water.material
    water.setOptions({
      waveModel: 'multiscale',
      waveLength: 72,
      waveDirection: 90,
      waveStrength: 0,
      detailStrength: 0,
      reflectionStrength: 0,
      specularIntensity: 0,
      roughness: 0.8,
    })
    expect(scene.primitives.get(0)).toBe(geometry)
    expect(water.material).toBe(material)
    const options = water.getOptions()
    expect(options.waveLength).toBe(72)
    expect(options.waveDirection).toBeCloseTo(90)
    expect(options.waveStrength).toBe(0)
    expect(options.reflectionStrength).toBe(0)
    expect(options.roughness).toBe(0.8)
    water.destroy()
  })
  it('returns detached configurations and independently editable preset colors', () => {
    const { water } = fixture(),
      snapshot = water.getOptions()
    if (!snapshot.waterColor) throw new Error('Missing resolved water color')
    snapshot.waterColor.red = 0.9
    expect(water.getOptions().waterColor?.red).not.toBe(0.9)
    const first = createWaterPreset(),
      second = createWaterPreset()
    first.waterColor.green = 0.9
    expect(second.waterColor.green).not.toBe(0.9)
    expect(createWaterPreset('windy-lake').waveStrength).toBeGreaterThan(
      second.waveStrength,
    )
    water.destroy()
  })
  it('combines the public camera matrix into a precise local metric wave frame', () => {
    const material = createWaterMaterial({ waveModel: 'multiscale' }),
      origin = Cesium.Cartesian3.fromDegrees(119, 33, 100)
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(origin)
    const inverseViewMatrix = Cesium.Matrix4.multiply(
      enu,
      Cesium.Matrix4.fromTranslation(new Cesium.Cartesian3(20, 30, 40)),
      new Cesium.Matrix4(),
    )
    updateWaterMaterialView(
      material,
      { inverseViewMatrix } as Cesium.Camera,
      origin,
    )
    const translation = Cesium.Matrix4.getTranslation(
      Cesium.Matrix4.fromArray(material.uniforms.waveFromEye),
      new Cesium.Cartesian3(),
    )
    expect(translation.x).toBeCloseTo(20, 5)
    expect(translation.y).toBeCloseTo(30, 5)
    expect(translation.z).toBeCloseTo(40, 5)
    expect(material.uniforms.metricWavesReady).toBe(1)
    material.destroy()
  })
  it('seeks and freezes the visual clock without changing height or resources', () => {
    const { scene, water } = fixture(),
      geometry = scene.primitives.get(0)
    water.setOptions({ waveSpeed: 0 })
    water.setVisualTime(15)
    scene.preRender.raiseEvent(scene)
    expect(water.material.uniforms.time).toBe(15)
    expect(water.height).toBe(44)
    expect(() => water.setVisualTime(-1)).toThrow()
    expect(water.material.uniforms.time).toBe(15)
    expect(scene.primitives.get(0)).toBe(geometry)
    water.destroy()
  })
})
