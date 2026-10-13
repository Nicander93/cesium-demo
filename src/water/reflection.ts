import * as Cesium from 'cesium'
import { SceneCapture } from './capture'
export { registerWaterPrimitive } from './capture'

export interface ReflectionOptions {
  resolutionScale: number
  maxSize: number
  maxFps: number
  reflectGlobe: boolean
}

export class PlanarReflection {
  private scene: Cesium.Scene
  private camera: Cesium.Camera
  private capture: SceneCapture
  private material: Cesium.Material
  private lastUpdate = -Infinity
  private destroyed = false
  private frames = 0
  private lastMs = 0
  private sourcePose = new Cesium.Matrix4()
  private sourceProjection = new Cesium.Matrix4()
  private viewProjection = new Cesium.Matrix4()
  private reflectionFromEye = new Cesium.Matrix4()

  constructor(scene: Cesium.Scene, material: Cesium.Material) {
    this.scene = scene
    this.material = material
    this.camera = new Cesium.Camera(scene)
    this.capture = new SceneCapture(scene, this.camera, material, 'reflexTexture')
  }

  invalidate(): void { this.lastUpdate = -Infinity }

  getDiagnostics() {
    return { reflectionFrames: this.frames, reflectionTargetsCreated: this.capture.targetsCreated, reflectionWidth: this.capture.width, reflectionHeight: this.capture.height, lastReflectionMs: this.lastMs }
  }

  update(point: Cesium.Cartesian3, normal: Cesium.Cartesian3, options: ReflectionOptions, now: number): boolean {
    if (this.destroyed) return false
    const source = this.scene.camera
    if (Cesium.Cartesian3.dot(Cesium.Cartesian3.subtract(source.positionWC, point, new Cesium.Cartesian3()), normal) <= 0) return false
    const cameraChanged = !Cesium.Matrix4.equalsEpsilon(source.inverseViewMatrix, this.sourcePose, 1e-7)
      || !Cesium.Matrix4.equalsEpsilon(source.frustum.projectionMatrix, this.sourceProjection, 1e-7)
    if (!cameraChanged && now - this.lastUpdate < 1000 / options.maxFps) {
      this.updateProjection(source)
      return true
    }
    const start = performance.now()
    const context = (this.scene as any).context
    const dimensions = reflectionDimensions(context.drawingBufferWidth, context.drawingBufferHeight, options)
    const distance = Cesium.Cartesian3.dot(Cesium.Cartesian3.subtract(source.positionWC, point, new Cesium.Cartesian3()), normal)
    Cesium.Cartesian3.subtract(source.positionWC, Cesium.Cartesian3.multiplyByScalar(normal, distance * 2, new Cesium.Cartesian3()), this.camera.position)
    reflectDirection(source.directionWC, normal, this.camera.direction)
    reflectDirection(source.upWC, normal, this.camera.up)
    Cesium.Cartesian3.cross(this.camera.direction, this.camera.up, this.camera.right)
    Cesium.Cartesian3.normalize(this.camera.right, this.camera.right)
    this.camera.frustum = source.frustum.clone()
    expandFrustum(this.camera.frustum)
    try {
      this.capture.render(dimensions.width, dimensions.height, options.reflectGlobe, Cesium.Plane.fromPointNormal(point, normal))
      Cesium.Matrix4.multiply(this.camera.frustum.projectionMatrix, this.camera.viewMatrix, this.viewProjection)
      this.updateProjection(source)
      this.material.uniforms.reflectionReady = 1
      Cesium.Matrix4.clone(source.inverseViewMatrix, this.sourcePose)
      Cesium.Matrix4.clone(source.frustum.projectionMatrix, this.sourceProjection)
      this.frames++
      this.lastUpdate = now
      return true
    } finally { this.lastMs = performance.now() - start }
  }

  private updateProjection(source: Cesium.Camera): void {
    Cesium.Matrix4.multiply(this.viewProjection, source.inverseViewMatrix, this.reflectionFromEye)
    this.material.uniforms.reflectionFromEye = Cesium.Matrix4.toArray(this.reflectionFromEye, this.material.uniforms.reflectionFromEye)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.capture.destroy()
  }
}

function reflectDirection(direction: Cesium.Cartesian3, normal: Cesium.Cartesian3, result: Cesium.Cartesian3): void {
  const offset = Cesium.Cartesian3.multiplyByScalar(normal, 2 * Cesium.Cartesian3.dot(direction, normal), new Cesium.Cartesian3())
  Cesium.Cartesian3.subtract(direction, offset, result)
}

function expandFrustum(frustum: unknown): void {
  const padding = 1.2
  if (frustum instanceof Cesium.PerspectiveFrustum && frustum.fov !== undefined) frustum.fov = Math.min(Math.PI - 0.01, 2 * Math.atan(Math.tan(frustum.fov / 2) * padding))
  else if (frustum instanceof Cesium.OrthographicFrustum && frustum.width !== undefined) frustum.width *= padding
  else if (frustum instanceof Cesium.PerspectiveOffCenterFrustum || frustum instanceof Cesium.OrthographicOffCenterFrustum) {
    if (frustum.left === undefined || frustum.right === undefined || frustum.top === undefined || frustum.bottom === undefined) return
    frustum.left *= padding; frustum.right *= padding; frustum.top *= padding; frustum.bottom *= padding
  }
}

export function reflectionDimensions(width: number, height: number, options: Pick<ReflectionOptions, 'resolutionScale' | 'maxSize'>) {
  const scale = Math.min(options.resolutionScale, options.maxSize / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}
