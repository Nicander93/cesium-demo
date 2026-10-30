import * as Cesium from 'cesium'
import { describe, expect, it } from 'vitest'
import { buildCameraPose, localCloudTopM } from './camera-presets'
import { defaultLabState, type ViewId } from './url-state'
import { communityCloudTopM } from './provider-settings'

describe('camera presets', () => {
  it.each(['ground', 'inside', 'cloudscape', 'above', 'orbit'] as ViewId[])('%s uses a real ECEF view matrix aimed at its target', (view) => {
    const pose = buildCameraPose(view, defaultLabState)
    const right = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(pose.direction, pose.up, new Cesium.Cartesian3()), new Cesium.Cartesian3())
    const viewMatrix = Cesium.Matrix4.computeView(pose.destination, pose.direction, pose.up, right, new Cesium.Matrix4())
    const targetInCamera = Cesium.Matrix4.multiplyByPoint(viewMatrix, pose.target, new Cesium.Cartesian3())

    expect(Cesium.Cartesian3.magnitude(pose.direction)).toBeCloseTo(1, 10)
    expect(Cesium.Cartesian3.magnitude(pose.up)).toBeCloseTo(1, 10)
    expect(Cesium.Cartesian3.dot(pose.direction, pose.up)).toBeCloseTo(0, 10)
    expect(targetInCamera.x).toBeCloseTo(0, 6)
    expect(targetInCamera.y).toBeCloseTo(0, 6)
    expect(targetInCamera.z).toBeLessThan(0)
  })

  it('places each view at its requested geodetic altitude and keeps ground outside the fixture blocks', () => {
    const ground = buildCameraPose('ground', defaultLabState)
    const groundPosition = Cesium.Cartographic.fromCartesian(ground.destination)
    const site = Cesium.Cartographic.fromDegrees(119.0317, 33.5921)
    const groundCamera = new Cesium.Cartographic(groundPosition.longitude, groundPosition.latitude, 0)
    const groundDistance = new Cesium.EllipsoidGeodesic(site, groundCamera).surfaceDistance
    expect(groundPosition.height).toBeCloseTo(150, 2)
    expect(groundDistance).toBeGreaterThan(1200)
    expect(groundDistance).toBeLessThan(1400)

    const inside = buildCameraPose('inside', defaultLabState)
    expect(Cesium.Cartographic.fromCartesian(inside.destination).height).toBeCloseTo(
      defaultLabState.cloudBaseM + defaultLabState.cloudThicknessM * 0.5,
      2,
    )
    const above = buildCameraPose('above', defaultLabState)
    expect(Cesium.Cartographic.fromCartesian(above.destination).height).toBeCloseTo(communityCloudTopM(defaultLabState) + 2000, 2)
    expect(Cesium.Cartographic.fromCartesian(buildCameraPose('orbit', defaultLabState).destination).height).toBeCloseTo(18_000_000, 2)
    const cloudscape = buildCameraPose('cloudscape', defaultLabState)
    expect(Cesium.Cartographic.fromCartesian(cloudscape.destination).height).toBeCloseTo(localCloudTopM(defaultLabState) + 1500, 2)
    expect(Cesium.Cartographic.fromCartesian(cloudscape.target).height).toBeCloseTo(localCloudTopM(defaultLabState), 2)
  })

  it('uses the local formation height for its 150m ground and exact cloud-top-above presets', () => {
    const localState = { ...defaultLabState, provider: 'local' as const, cloudBaseM: 3000, cloudThicknessM: 2000 }
    const ground = buildCameraPose('ground', localState)
    const inside = buildCameraPose('inside', localState)
    const above = buildCameraPose('above', localState)
    expect(Cesium.Cartographic.fromCartesian(ground.destination).height).toBeCloseTo(150, 2)
    expect(Cesium.Cartographic.fromCartesian(inside.destination).height).toBeCloseTo(4000, 2)
    expect(localCloudTopM(localState)).toBe(5000)
    expect(Cesium.Cartographic.fromCartesian(above.destination).height).toBeCloseTo(7000, 2)
  })
})

