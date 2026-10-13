import * as Cesium from 'cesium'
import { SceneCapture, ShoreMask } from './capture'

export class ShoreDepth {
  private scene: Cesium.Scene
  private camera: Cesium.Camera
  private capture: SceneCapture
  private mask: ShoreMask
  private material: Cesium.Material
  private positions: readonly Cesium.Cartographic[]
  private lastUpdate = -Infinity
  private retryAt = 0
  private frames = 0
  private destroyed = false
  private error: string | null = null
  private viewProjection = new Cesium.Matrix4()
  private fromEye = new Cesium.Matrix4()

  constructor(scene: Cesium.Scene, material: Cesium.Material, positions: readonly Cesium.Cartographic[]) {
    this.scene = scene
    this.material = material
    this.positions = positions
    this.camera = new Cesium.Camera(scene)
    this.capture = new SceneCapture(scene, this.camera, material, 'shoreDepthTexture', true)
    this.mask = new ShoreMask(scene, material)
  }

  invalidate(): void { this.lastUpdate = -Infinity; this.retryAt = 0 }

  update(point: Cesium.Cartesian3, height: number, resolution: number, now: number): void {
    if (this.destroyed) return
    if (now >= this.retryAt && now - this.lastUpdate >= 500) {
      try {
        const localToWorld = Cesium.Transforms.eastNorthUpToFixedFrame(point)
        const worldToLocal = Cesium.Matrix4.inverse(localToWorld, new Cesium.Matrix4())
        const points = this.positions.map(position => Cesium.Matrix4.multiplyByPoint(worldToLocal, Cesium.Cartesian3.fromRadians(position.longitude, position.latitude, height), new Cesium.Cartesian3()))
        const padding = Math.max(this.material.uniforms.foamWidth * 2, 3)
        const left = Math.min(...points.map(p => p.x)) - padding
        const right = Math.max(...points.map(p => p.x)) + padding
        const bottom = Math.min(...points.map(p => p.y)) - padding
        const top = Math.max(...points.map(p => p.y)) + padding
        const width = Math.max(right - left, 1)
        const length = Math.max(top - bottom, 1)
        Cesium.Matrix4.multiplyByPoint(localToWorld, new Cesium.Cartesian3((left + right) / 2, (top + bottom) / 2, 500), this.camera.position)
        const rotation = Cesium.Matrix4.getMatrix3(localToWorld, new Cesium.Matrix3())
        Cesium.Matrix3.multiplyByVector(rotation, new Cesium.Cartesian3(0, 0, -1), this.camera.direction)
        Cesium.Matrix3.multiplyByVector(rotation, Cesium.Cartesian3.UNIT_Y, this.camera.up)
        Cesium.Cartesian3.cross(this.camera.direction, this.camera.up, this.camera.right)
        this.camera.frustum = new Cesium.OrthographicFrustum({ width, aspectRatio: width / length, near: 1, far: 1000 })
        const scale = resolution / Math.max(width, length)
        this.capture.render(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(length * scale)), true)
        Cesium.Matrix4.multiply(this.camera.frustum.projectionMatrix, this.camera.viewMatrix, this.viewProjection)
        const localFromCamera = Cesium.Matrix4.multiply(worldToLocal, this.camera.inverseViewMatrix, new Cesium.Matrix4())
        const localFromClip = Cesium.Matrix4.multiply(localFromCamera, Cesium.Matrix4.inverse(this.capture.projection, new Cesium.Matrix4()), new Cesium.Matrix4())
        this.material.uniforms.shoreHeightFromClip = Cesium.Matrix4.toArray(localFromClip)
        this.material.uniforms.shoreSize = new Cesium.Cartesian2(width, length)
        this.mask.update(this.capture.depthTexture, localFromClip, this.material.uniforms.shoreSize, this.capture.width, this.capture.height)
        this.material.uniforms.shoreReady = 1
        this.frames++
        this.lastUpdate = now
        this.error = null
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error)
        this.retryAt = now + 2000
        this.material.uniforms.shoreReady = 0
      }
    }
    Cesium.Matrix4.multiply(this.viewProjection, this.scene.camera.inverseViewMatrix, this.fromEye)
    this.material.uniforms.shoreFromEye = Cesium.Matrix4.toArray(this.fromEye, this.material.uniforms.shoreFromEye)
  }

  getDiagnostics() {
    return { shoreFrames: this.frames, shoreTargetsCreated: this.capture.targetsCreated, shoreWidth: this.capture.width, shoreHeight: this.capture.height, shoreError: this.error }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.material.uniforms.shoreReady = 0
    this.capture.destroy()
    this.mask.destroy()
  }
}
