import * as Cesium from 'cesium'
import { describe, expect, it, vi } from 'vitest'
import { PlanarReflection, registerWaterPrimitive } from '../reflection'
import { SceneCapture } from '../capture'

vi.mock('cesium', async importOriginal => {
  const original = await importOriginal<typeof import('cesium')>()
  class Resource {
    width: number
    height: number
    destroyed = false
    constructor(options: { width: number; height: number }) { this.width = options.width; this.height = options.height }
    isDestroyed() { return this.destroyed }
    destroy() { if (this.destroyed) throw new Error('double destruction'); this.destroyed = true }
  }
  class Camera {
    position = new original.Cartesian3()
    direction = new original.Cartesian3(0, 0, -1)
    up = new original.Cartesian3(0, 1, 0)
    right = new original.Cartesian3(1, 0, 0)
    viewMatrix = original.Matrix4.clone(original.Matrix4.IDENTITY)
    frustum = new original.PerspectiveFrustum({ fov: 1, aspectRatio: 1, near: 1, far: 1000 })
  }
  class View {
    camera: Camera
    viewport: Cesium.BoundingRectangle
    passState: { viewport: Cesium.BoundingRectangle }
    constructor(_scene: unknown, camera: Camera, viewport: Cesium.BoundingRectangle) { this.camera = camera; this.viewport = viewport; this.passState = { viewport } }
    destroy() {}
  }
  return { ...original, Camera, View, Texture: Resource, Framebuffer: Resource, Sampler: class Sampler {} }
})

function fixture() {
  const updateFrustum = vi.fn()
  const camera = { positionWC: new Cesium.Cartesian3(0, 0, 100), inverseViewMatrix: Cesium.Matrix4.fromTranslation(new Cesium.Cartesian3(0, 0, 100)), directionWC: new Cesium.Cartesian3(0, 0, -1), upWC: new Cesium.Cartesian3(0, 1, 0), frustum: new Cesium.PerspectiveFrustum({ fov: 1, aspectRatio: 1 }) }
  const view = { camera }
  const context = { drawingBufferWidth: 800, drawingBufferHeight: 600, uniformState: { updateFrustum, update: vi.fn() }, beginFrame: vi.fn(), endFrame: vi.fn() }
  const scene = {
    camera, _view: view, _defaultView: view, context, shadowMap: {}, _hdr: true, _logDepthBuffer: true,
    _environmentState: { originalFramebuffer: 'host' },
    _frameState: { camera, passes: { render: true, postProcess: true }, commandList: [], shadowMaps: [], tilesetPassState: {}, cullingVolume: {} },
    globe: { _surface: { _debug: { suspendLodUpdate: false } }, show: true, beginFrame: vi.fn(), endFrame: vi.fn() }, fog: { update: vi.fn() },
    postProcessStages: { host: true }, farToNearRatio: 1000,
    atmosphere: new Cesium.Atmosphere(), backgroundColor: Cesium.Color.BLACK, updateFrameState: vi.fn(), updateEnvironment: vi.fn(),
    updateAndExecuteCommands: vi.fn(), resolveFramebuffers: vi.fn(),
  }
  const material = { uniforms: {} as Record<string, any>, _textures: {} }
  const pass = new PlanarReflection(scene as unknown as Cesium.Scene, material as unknown as Cesium.Material)
  return { scene, view, context, material, pass, updateFrustum }
}

const options = { resolutionScale: .5, maxSize: 1024, maxFps: 30, reflectGlobe: false }
const point = new Cesium.Cartesian3()
const normal = new Cesium.Cartesian3(0, 0, 1)

describe('reflection pass isolation', () => {
  it('reuses host terrain selection without auxiliary load/height updates and restores the LOD flag on failure', () => {
    const f = fixture()
    f.scene.updateAndExecuteCommands.mockImplementation(() => {
      expect(f.scene.globe._surface._debug.suspendLodUpdate).toBe(true)
      throw new Error('Terrain draw failed')
    })
    expect(() => f.pass.update(point, normal, { ...options, reflectGlobe: true }, 0)).toThrow('Terrain draw failed')
    expect(f.scene.globe.beginFrame).not.toHaveBeenCalled()
    expect(f.scene.globe.endFrame).not.toHaveBeenCalled()
    expect(f.scene.globe._surface._debug.suspendLodUpdate).toBe(false)
    expect(f.scene._view).toBe(f.view)
    f.pass.destroy()
  })
  it('renders a cached tileset on the first frame before the host has supplied atmosphere', () => {
    const f = fixture()
    f.scene.updateAndExecuteCommands.mockImplementation(() => {
      const frameState = f.scene._frameState as unknown as { atmosphere: Cesium.Atmosphere }
      expect(frameState.atmosphere.dynamicLighting).toBe(f.scene.atmosphere.dynamicLighting)
    })
    expect(f.pass.update(point, normal, options, 0)).toBe(true)
    expect(f.pass.getDiagnostics().reflectionFrames).toBe(1)
    expect(f.scene._frameState).not.toHaveProperty('atmosphere', f.scene.atmosphere)
    f.pass.destroy()
  })

  it('restores host view, visibility and engine state when rendering throws', () => {
    const f = fixture()
    const primitive = { show: true } as Cesium.Primitive
    const unregister = registerWaterPrimitive(f.scene as unknown as Cesium.Scene, primitive)
    const shadow = f.scene.shadowMap
    const postProcess = f.scene.postProcessStages
    f.scene.updateAndExecuteCommands.mockImplementation(() => { f.scene._environmentState.originalFramebuffer = 'reflection'; throw new Error('GPU pass failed') })
    expect(() => f.pass.update(point, normal, options, 0)).toThrow('GPU pass failed')
    expect(f.scene._view).toBe(f.view)
    expect(f.scene._defaultView).toBe(f.view)
    expect(f.scene.shadowMap).toBe(shadow)
    expect(f.scene.postProcessStages).toBe(postProcess)
    expect(f.scene.globe.show).toBe(true)
    expect(f.scene._hdr).toBe(true)
    expect(f.scene._logDepthBuffer).toBe(true)
    expect(f.context.uniformState.updateFrustum).toBe(f.updateFrustum)
    expect(f.scene._environmentState.originalFramebuffer).toBe('host')
    expect(primitive.show).toBe(true)
    unregister()
    f.pass.destroy()
  })

  it('reuses a target over time and only recreates it when dimensions change', () => {
    const f = fixture()
    for (let now = 0; now <= 1000; now += 10) f.pass.update(point, normal, options, now)
    expect(f.pass.getDiagnostics().reflectionFrames).toBeLessThanOrEqual(31)
    expect(f.pass.getDiagnostics().reflectionTargetsCreated).toBe(1)
    f.pass.invalidate()
    f.pass.update(point, normal, { ...options, resolutionScale: 1 }, 1010)
    expect(f.pass.getDiagnostics().reflectionTargetsCreated).toBe(2)
    f.pass.destroy()
    f.pass.destroy()
  })

  it('captures camera movement immediately and preserves the host frustum', () => {
    const f = fixture()
    f.pass.update(point, normal, options, 0)
    const before = Cesium.Matrix4.fromArray(f.material.uniforms.reflectionFromEye)
    const fov = f.scene.camera.frustum.fov
    f.scene.camera.inverseViewMatrix = Cesium.Matrix4.fromTranslation(new Cesium.Cartesian3(1, 0, 100))
    f.pass.update(point, normal, options, 1)
    const after = Cesium.Matrix4.fromArray(f.material.uniforms.reflectionFromEye)
    const positionInMovedCamera = new Cesium.Cartesian4(-1, 0, -50, 1)
    const positionInPreviousCamera = new Cesium.Cartesian4(0, 0, -50, 1)
    expect(Cesium.Cartesian4.equalsEpsilon(
      Cesium.Matrix4.multiplyByVector(before, positionInPreviousCamera, new Cesium.Cartesian4()),
      Cesium.Matrix4.multiplyByVector(after, positionInMovedCamera, new Cesium.Cartesian4()),
      1e-10,
    )).toBe(true)
    expect(f.pass.getDiagnostics().reflectionFrames).toBe(2)
    expect(f.scene.camera.frustum.fov).toBe(fov)
    expect(f.pass.getDiagnostics().reflectionTargetsCreated).toBe(1)
    f.pass.destroy()
  })

  it('restores single-frustum depth capture state and releases borrowed depth targets once', () => {
    const f = fixture()
    const capture = new SceneCapture(f.scene as unknown as Cesium.Scene, f.scene.camera as unknown as Cesium.Camera, f.material as unknown as Cesium.Material, 'shoreDepthTexture', true)
    const postProcess = f.scene.postProcessStages
    f.scene.updateAndExecuteCommands.mockImplementationOnce(() => {
      expect(f.scene.farToNearRatio).toBe(1e9)
      throw new Error('Depth pass failed')
    })
    expect(() => capture.render(512, 256, true)).toThrow('Depth pass failed')
    expect(f.scene.farToNearRatio).toBe(1000)
    expect(f.scene.postProcessStages).toBe(postProcess)
    capture.render(512, 256, true)
    const texture = f.material.uniforms.shoreDepthTexture
    expect(texture.width).toBe(512)
    ;(f.material._textures as Record<string, unknown>).shoreDepthTexture = texture
    capture.render(256, 128, true)
    expect(texture.isDestroyed()).toBe(true)
    expect(f.material._textures).not.toHaveProperty('shoreDepthTexture')
    expect(capture.targetsCreated).toBe(2)
    capture.destroy()
    capture.destroy()
    f.pass.destroy()
  })
})
