import { describe, expect, it } from 'vitest'
import { Cartesian3, Matrix3, Matrix4 } from 'cesium'
import {
  environmentFrames,
  environmentPresets,
  normalizeEnvironmentOptions,
  presetEnvironmentOptions,
} from './presets'

describe('shared environment coordinates and budgets', () => {
  it('maps local east/up/south to the same Y-up HDR coordinates as model IBL', () => {
    const anchor = Cartesian3.fromDegrees(119, 33, 30)
    const { frame, worldToEnvironment } = environmentFrames(anchor, 0)
    for (const [local, expected] of [
      [new Cartesian3(1, 0, 0), new Cartesian3(1, 0, 0)],
      [new Cartesian3(0, 0, 1), new Cartesian3(0, 1, 0)],
      [new Cartesian3(0, 1, 0), new Cartesian3(0, 0, -1)],
    ]) {
      const world = Matrix4.multiplyByPointAsVector(
        frame,
        local,
        new Cartesian3(),
      )
      const actual = Matrix3.multiplyByVector(
        worldToEnvironment,
        world,
        new Cartesian3(),
      )
      expect(Cartesian3.equalsEpsilon(actual, expected, 1e-10)).toBe(true)
    }
  })
  it('rotates sun and environment together without translation contaminating directions', () => {
    const anchor = Cartesian3.fromDegrees(-20, 55, 1500)
    const { frame, worldToEnvironment } = environmentFrames(anchor, 135)
    const direction = Cartesian3.normalize(
      new Cartesian3(0.3, 0.6, 0.7),
      new Cartesian3(),
    )
    const world = Matrix4.multiplyByPointAsVector(
      frame,
      direction,
      new Cartesian3(),
    )
    const actual = Matrix3.multiplyByVector(
      worldToEnvironment,
      world,
      new Cartesian3(),
    )
    expect(actual.x).toBeCloseTo(direction.x, 10)
    expect(actual.y).toBeCloseTo(direction.z, 10)
    expect(actual.z).toBeCloseTo(-direction.y, 10)
    expect(Cartesian3.magnitude(actual)).toBeCloseTo(1, 10)
  })
  it('bounds malformed controls before they reach shaders', () => {
    expect(
      normalizeEnvironmentOptions({
        exposure: NaN,
        skyRotation: 500,
        fog: -1,
        rain: Infinity,
        shadows: false,
      }),
    ).toMatchObject({
      exposure: 1,
      skyRotation: 180,
      fog: 0,
      rain: 0,
      shadows: false,
    })
    for (const preset of Object.keys(environmentPresets) as Array<
      keyof typeof environmentPresets
    >) {
      const options = presetEnvironmentOptions(preset)
      expect(normalizeEnvironmentOptions(options)).toEqual(options)
      expect(options.sunIntensity).toBe(environmentPresets[preset].sunlight)
      expect(options.sunColor).toBe(environmentPresets[preset].sunColor)
    }
  })
})
