import * as Cesium from 'cesium'
import { describe, expect, it } from 'vitest'
// @ts-expect-error The pinned vendor module is JavaScript.
import * as cameraRay from '../../vendor/cesium-clouds-atmosphere/camera-ray.js'

const { cameraRayShader, createCameraRayUniforms } = cameraRay

describe('sky rays use the main camera', () => {
  it('injects the log-depth decoder without relying on the old sky ray function', () => {
    const { ShaderSource } = Cesium as unknown as {
      ShaderSource: new (options: { sources: string[]; defines: string[] }) => {
        createCombinedFragmentShader: (context: {
          webgl2: boolean
          textureFloatLinear: boolean
          floatingPointTexture: boolean
        }) => string
      }
    }
    const source = new ShaderSource({
      defines: ['LOG_DEPTH_READ_ONLY'],
      sources: [
        cameraRayShader +
          '\nvoid main() { out_FragColor = getSceneEyePosition(vec2(0.5), 0.4); }',
      ],
    }).createCombinedFragmentShader({
      webgl2: true,
      textureFloatLinear: true,
      floatingPointTexture: true,
    })
    expect(source).toMatch(/vec4\s+czm_windowToEyeCoordinates\(vec2/)
    expect(source).toMatch(/vec4\s+czm_windowToEyeCoordinates\(vec4/)
    expect(source).toContain('float depthFromNear = exp2(log2Depth) - 1.0')
  })
  it('keeps a normalized screen ray unchanged when geometry frustums and render sizes change', () => {
    const frustum = new Cesium.PerspectiveFrustum({
      fov: Math.PI / 3,
      aspectRatio: 16 / 9,
      near: 0.5,
      far: 800000000,
    })
    const viewer = {
      camera: { frustum, inverseViewMatrix: Cesium.Matrix4.IDENTITY },
      scene: {
        context: { uniformState: { projection: Cesium.Matrix4.IDENTITY } },
      },
    }
    const uniforms = createCameraRayUniforms(viewer)
    function ray(
      x: number,
      y: number,
      width: number,
      height: number,
    ): Cesium.Cartesian3 {
      const point = Cesium.Matrix4.multiplyByVector(
        uniforms.u_rayInverseProjection(),
        new Cesium.Cartesian4((x / width) * 2 - 1, (y / height) * 2 - 1, 0, 1),
        new Cesium.Cartesian4(),
      )
      const direction = Cesium.Matrix4.multiplyByPointAsVector(
        uniforms.u_rayInverseView(),
        new Cesium.Cartesian3(point.x, point.y, point.z),
        new Cesium.Cartesian3(),
      )
      return Cesium.Cartesian3.normalize(direction, direction)
    }
    const fullRay = ray(1200, 810, 1920, 1080)
    const geometryFrustum = new Cesium.PerspectiveFrustum({
      fov: Math.PI / 3,
      aspectRatio: 16 / 9,
      near: 100,
      far: 200,
    })
    viewer.scene.context.uniformState.projection =
      geometryFrustum.projectionMatrix
    const scaledRay = ray(900, 607.5, 1440, 810)
    expect(Cesium.Cartesian3.distance(fullRay, scaledRay)).toBeLessThan(1e-12)
    expect(fullRay.z).toBeLessThan(0)

    const rotation = Cesium.Matrix3.fromRotationY(Math.PI / 4)
    viewer.camera.inverseViewMatrix =
      Cesium.Matrix4.fromRotationTranslation(rotation)
    const rotatedRay = ray(1200, 810, 1920, 1080)
    const expected = Cesium.Matrix3.multiplyByVector(
      rotation,
      fullRay,
      new Cesium.Cartesian3(),
    )
    expect(Cesium.Cartesian3.distance(rotatedRay, expected)).toBeLessThan(1e-12)
    expect(Cesium.Cartesian3.distance(rotatedRay, fullRay)).toBeGreaterThan(0.2)
  })
})
