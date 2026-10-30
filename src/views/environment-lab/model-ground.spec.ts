import { describe, expect, it } from 'vitest'
import { Cartesian3, Matrix3, Matrix4, Transforms } from 'cesium'
import {
  chooseModelGroundHeight,
  isTargetModelHit,
  boxDisplayBaseHeight,
} from './model-ground'

describe('real model display water reference', () => {
  it('rejects the observed minus20km depth even though it is finite', () => {
    expect(() =>
      chooseModelGroundHeight([-20476, -20475, -20400], 137, 740),
    ).toThrow()
    expect(chooseModelGroundHeight([-20476, 95, 98, 100, 125], 137, 740)).toBe(
      95,
    )
  })
  it('requires enough valid surface samples and preserves legitimate below-sea-level models', () => {
    expect(() =>
      chooseModelGroundHeight([92, NaN, Infinity, 94], 137, 740),
    ).toThrow()
    expect(chooseModelGroundHeight([-420, -419, -418, -415], -400, 100)).toBe(
      -420,
    )
  })
  it('accepts only hits belonging to the requested tileset', () => {
    const target = {}
    const position = new Cartesian3(1, 2, 3)
    expect(
      isTargetModelHit({ object: { primitive: target }, position }, target),
    ).toBe(true)
    expect(
      isTargetModelHit({ object: { primitive: {} }, position }, target),
    ).toBe(false)
    expect(isTargetModelHit({ position }, target)).toBe(false)
    expect(
      isTargetModelHit(
        { object: { primitive: target }, position: new Cartesian3(NaN, 0, 0) },
        target,
      ),
    ).toBe(false)
  })
})

describe('model bounding-box display baseline', () => {
  it('uses transformed ENU box corners without reading scene depth', () => {
    const center = Cartesian3.fromDegrees(108.96, 34.22, 450)
    const axes = Matrix4.getMatrix3(
      Transforms.eastNorthUpToFixedFrame(center),
      new Matrix3(),
    )
    Matrix3.multiplyByScale(axes, new Cartesian3(100, 200, 30), axes)
    expect(boxDisplayBaseHeight({ center, halfAxes: axes })).toBeCloseTo(420, 1)
  })
  it('does not invent a baseline from a bounding sphere', () => {
    expect(
      boxDisplayBaseHeight({
        center: Cartesian3.fromDegrees(108.96, 34.22, 450),
        radius: 300,
      }),
    ).toBeUndefined()
  })
})
