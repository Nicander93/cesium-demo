import * as Cesium from 'cesium'
import type { LabState, ViewId } from './url-state'
import { communityCloudTopM } from './provider-settings'

const SITE_LONGITUDE = 119.0317
const SITE_LATITUDE = 33.5921
const EARTH_RADIUS_M = Cesium.Ellipsoid.WGS84.maximumRadius

export interface CameraPose {
  destination: Cesium.Cartesian3
  direction: Cesium.Cartesian3
  up: Cesium.Cartesian3
  target: Cesium.Cartesian3
  expectedHeightM: number
}

export function localCloudTopM(state: LabState): number {
  return state.cloudBaseM + state.cloudThicknessM
}

function localPoint(enuToWorld: Cesium.Matrix4, eastM: number, northM: number, upM: number): Cesium.Cartesian3 {
  return Cesium.Matrix4.multiplyByPoint(enuToWorld, new Cesium.Cartesian3(eastM, northM, upM), new Cesium.Cartesian3())
}

function offsetGeodetic(longitude: number, latitude: number, eastM: number, northM: number, heightM: number) {
  const latitudeRadians = Cesium.Math.toRadians(latitude)
  return Cesium.Cartesian3.fromDegrees(
    longitude + Cesium.Math.toDegrees(eastM / (EARTH_RADIUS_M * Math.cos(latitudeRadians))),
    latitude + Cesium.Math.toDegrees(northM / EARTH_RADIUS_M),
    heightM,
  )
}

function buildPose(destination: Cesium.Cartesian3, target: Cesium.Cartesian3, expectedHeightM: number): CameraPose {
  const direction = Cesium.Cartesian3.normalize(Cesium.Cartesian3.subtract(target, destination, new Cesium.Cartesian3()), new Cesium.Cartesian3())
  const surfaceUp = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(destination, new Cesium.Cartesian3())
  const right = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(direction, surfaceUp, new Cesium.Cartesian3()), new Cesium.Cartesian3())
  const up = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(right, direction, new Cesium.Cartesian3()), new Cesium.Cartesian3())
  return { destination, direction, up, target, expectedHeightM }
}

export function buildCameraPose(view: ViewId, state: LabState): CameraPose {
  const site = Cesium.Cartesian3.fromDegrees(SITE_LONGITUDE, SITE_LATITUDE, 0)
  const center = Cesium.Cartesian3.fromDegrees(SITE_LONGITUDE, SITE_LATITUDE, 150)
  const cloudMid = state.cloudBaseM + state.cloudThicknessM * 0.5
  const cloudTop = state.provider === 'local' ? localCloudTopM(state) : communityCloudTopM(state)
  if (view === 'cloudscape') {
    const lowCloudTop = localCloudTopM(state)
    const height = lowCloudTop + 1500
    return buildPose(
      offsetGeodetic(SITE_LONGITUDE, SITE_LATITUDE, 0, 4200, height),
      offsetGeodetic(SITE_LONGITUDE, SITE_LATITUDE, 0, -2500, lowCloudTop),
      height,
    )
  }

  if (state.provider === 'local') {
    const enuToWorld = Cesium.Transforms.eastNorthUpToFixedFrame(site)
    if (view === 'ground') {
      return buildPose(
        offsetGeodetic(SITE_LONGITUDE, SITE_LATITUDE, -12000, -9000, 150),
        localPoint(enuToWorld, 0, 0, state.cloudBaseM + state.cloudThicknessM * 0.67),
        150,
      )
    }
    if (view === 'inside') {
      return buildPose(Cesium.Cartesian3.fromDegrees(SITE_LONGITUDE, SITE_LATITUDE, cloudMid), localPoint(enuToWorld, 1600, 600, cloudMid + 150), cloudMid)
    }
    if (view === 'above') {
      const height = cloudTop + 2000
      return buildPose(offsetGeodetic(SITE_LONGITUDE, SITE_LATITUDE, 0, 4200, height), localPoint(enuToWorld, 0, 0, cloudTop), height)
    }
  }

  if (view === 'ground') {
    // Keep the camera outside the fixture blocks and look slightly upward toward their roofs.
    const destination = offsetGeodetic(SITE_LONGITUDE, SITE_LATITUDE, 1100, 700, 150)
    return buildPose(destination, center, 150)
  }
  if (view === 'inside') {
    const destination = Cesium.Cartesian3.fromDegrees(SITE_LONGITUDE, SITE_LATITUDE, cloudMid)
    const target = offsetGeodetic(SITE_LONGITUDE, SITE_LATITUDE, 1800, 0, cloudMid)
    return buildPose(destination, target, cloudMid)
  }
  if (view === 'above') {
    const height = cloudTop + 2000
    const destination = offsetGeodetic(SITE_LONGITUDE, SITE_LATITUDE, 0, 4200, height)
    const target = Cesium.Cartesian3.fromDegrees(SITE_LONGITUDE, SITE_LATITUDE, cloudTop)
    return buildPose(destination, target, height)
  }

  const destination = Cesium.Cartesian3.fromDegrees(SITE_LONGITUDE, SITE_LATITUDE, 18_000_000)
  return buildPose(destination, site, 18_000_000)
}

