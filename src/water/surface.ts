import * as Cesium from 'cesium'
import { createWaterMaterial, updateWaterMaterial, type WaterMaterialOptions } from './material'
import { PlanarReflection, registerWaterPrimitive, type ReflectionOptions } from './reflection'

export type WaterQuality = 'low' | 'balanced' | 'high'
export interface WaterSurfaceOptions extends Omit<WaterMaterialOptions, 'origin'> {
  scene: Cesium.Scene
  positions: readonly Cesium.Cartographic[]
  height: number
  flowDegrees?: number
  quality?: WaterQuality
  reflection?: boolean
  reflectionResolutionScale?: number
  reflectionMaxSize?: number
  reflectionMaxFps?: number
  reflectGlobe?: boolean
  onError?: (error: unknown) => void
}
export type WaterSurfaceUpdateOptions = Omit<WaterMaterialOptions, 'origin'> & Partial<Pick<WaterSurfaceOptions, 'height' | 'quality' | 'reflection' | 'reflectionResolutionScale' | 'reflectionMaxSize' | 'reflectionMaxFps' | 'reflectGlobe'>>

const qualityOptions: Record<WaterQuality, ReflectionOptions> = {
  low: { resolutionScale: 0.35, maxSize: 512, maxFps: 15, reflectGlobe: false },
  balanced: { resolutionScale: 0.75, maxSize: 1536, maxFps: 30, reflectGlobe: false },
  high: { resolutionScale: 1, maxSize: 2048, maxFps: 60, reflectGlobe: false },
}

export class WaterSurface {
  readonly material: Cesium.Material
  /** Resolves at the first rendered geometry frame, or false if destroyed before that frame. */
  readonly ready: Promise<boolean>
  private scene: Cesium.Scene
  private primitive: Cesium.Primitive
  private reflectionPass: PlanarReflection | undefined
  private reflectionEnabled: boolean
  private reflectionOptions: ReflectionOptions
  private quality: WaterQuality
  private point: Cesium.Cartesian3
  private originalPoint: Cesium.Cartesian3
  private normal: Cesium.Cartesian3
  private currentHeight: number
  private started = performance.now()
  private readyMs: number | null = null
  private destroyed = false
  private error: string | null = null
  private onError: ((error: unknown) => void) | undefined
  private removePreRender: () => void
  private removePostRender: () => void
  private unregisterPrimitive: () => void
  private resolveReady!: (ready: boolean) => void

  constructor(options: WaterSurfaceOptions) {
    validateHeight(options.height)
    if (options.positions.length < 3 || options.positions.length > 10000 || options.positions.some(position => !Number.isFinite(position.longitude) || !Number.isFinite(position.latitude) || Math.abs(position.latitude) > Math.PI / 2 || Math.abs(position.longitude) > Math.PI)) throw new RangeError('positions must contain 3–10000 valid Cartographic points')
    if (options.flowDegrees !== undefined && !Number.isFinite(options.flowDegrees)) throw new RangeError('flowDegrees must be finite')
    this.quality = options.quality ?? 'balanced'
    this.reflectionOptions = resolveReflectionOptions(options, this.quality)
    this.reflectionEnabled = options.reflection ?? true
    this.scene = options.scene
    this.onError = options.onError
    this.currentHeight = options.height
    const positions = options.positions.map(position => Cesium.Cartesian3.fromRadians(position.longitude, position.latitude, options.height))
    const center = Cesium.BoundingSphere.fromPoints(positions).center
    const cartographic = Cesium.Cartographic.fromCartesian(center)
    this.point = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, options.height)
    this.originalPoint = Cesium.Cartesian3.clone(this.point)
    this.normal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(this.point)
    this.material = createWaterMaterial(options)
    this.updateLocalFrame()
    this.primitive = new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({ geometry: Cesium.CoplanarPolygonGeometry.fromPositions({ positions, stRotation: Cesium.Math.toRadians(options.flowDegrees ?? 0), vertexFormat: Cesium.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat }) }),
      appearance: new Cesium.MaterialAppearance({ material: this.material, translucent: true, closed: false, faceForward: true }),
      asynchronous: false,
    })
    this.scene.primitives.add(this.primitive)
    this.unregisterPrimitive = registerWaterPrimitive(this.scene, this.primitive)
    this.ready = new Promise(resolve => { this.resolveReady = resolve })
    this.removePreRender = this.scene.preRender.addEventListener(this.handlePreRender)
    this.removePostRender = this.scene.postRender.addEventListener(() => {
      if (this.readyMs === null && this.primitive.ready) {
        this.readyMs = performance.now() - this.started
        this.resolveReady(true)
      }
    })
    this.scene.requestRender()
  }

  setOptions(options: WaterSurfaceUpdateOptions): void {
    this.assertAlive()
    if (options.height !== undefined) validateHeight(options.height)
    const quality = options.quality ?? this.quality
    const reflectionOptions = resolveReflectionOptions(options, quality, options.quality === undefined ? this.reflectionOptions : undefined)
    updateWaterMaterial(this.material, options)
    this.quality = quality
    this.reflectionOptions = reflectionOptions
    if (options.reflection !== undefined) {
      this.reflectionEnabled = options.reflection
      if (!options.reflection) this.material.uniforms.reflectionReady = 0
    }
    if (options.height !== undefined) this.height = options.height
    this.reflectionPass?.invalidate()
    this.scene.requestRender()
  }

  get height(): number { return this.currentHeight }
  set height(value: number) {
    this.assertAlive()
    validateHeight(value)
    if (value === this.currentHeight) return
    this.currentHeight = value
    const position = Cesium.Cartographic.fromCartesian(this.originalPoint)
    Cesium.Cartesian3.fromRadians(position.longitude, position.latitude, value, Cesium.Ellipsoid.WGS84, this.point)
    this.primitive.modelMatrix = Cesium.Matrix4.fromTranslation(Cesium.Cartesian3.subtract(this.point, this.originalPoint, new Cesium.Cartesian3()))
    Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(this.point, this.normal)
    this.updateLocalFrame()
    this.reflectionPass?.invalidate()
    this.scene.requestRender()
  }

  get rippleSize(): number { return this.material.uniforms.size }
  set rippleSize(value: number) { this.setOptions({ rippleSize: value }) }
  get waterAlpha(): number { return this.material.uniforms.waterAlpha }
  set waterAlpha(value: number) { this.setOptions({ waterAlpha: value }) }
  get reflectivity(): number { return this.material.uniforms.rf0 }
  set reflectivity(value: number) { this.setOptions({ reflectivity: value }) }
  get distortionScale(): number { return this.material.uniforms.distortionScale }
  set distortionScale(value: number) { this.setOptions({ distortionScale: value }) }
  get show(): boolean { return this.primitive.show }
  set show(value: boolean) { this.assertAlive(); this.primitive.show = value; this.reflectionPass?.invalidate(); this.scene.requestRender() }

  getDiagnostics() {
    return { readyMs: this.readyMs, quality: this.quality, reflectionEnabled: this.reflectionEnabled, destroyed: this.destroyed, error: this.error, geometryCreated: 1,
      ...this.reflectionPass?.getDiagnostics() ?? { reflectionFrames: 0, reflectionTargetsCreated: 0, reflectionWidth: 0, reflectionHeight: 0, lastReflectionMs: 0 } }
  }

  isDestroyed(): boolean { return this.destroyed }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.removePreRender()
    this.removePostRender()
    this.unregisterPrimitive()
    if (!this.scene.isDestroyed()) this.scene.primitives.remove(this.primitive)
    else if (!this.primitive.isDestroyed()) this.primitive.destroy()
    this.reflectionPass?.destroy()
    this.material.destroy()
    this.resolveReady(false)
    if (!this.scene.isDestroyed()) this.scene.requestRender()
  }

  private handlePreRender = (): void => {
    if (this.destroyed || !this.primitive.show) return
    const now = performance.now()
    this.material.uniforms.time = (now - this.started) / 1000
    if (!this.reflectionEnabled || this.scene.mode !== Cesium.SceneMode.SCENE3D) { this.material.uniforms.reflectionReady = 0; return }
    try {
      this.reflectionPass ??= new PlanarReflection(this.scene, this.material)
      if (!this.reflectionPass.update(this.point, this.normal, this.reflectionOptions, now)) this.material.uniforms.reflectionReady = 0
    } catch (error) {
      this.reflectionEnabled = false
      this.material.uniforms.reflectionReady = 0
      this.error = error instanceof Error ? error.message : String(error)
      this.onError?.(error)
    }
  }

  private updateLocalFrame(): void {
    this.material.uniforms.worldToLocal = Cesium.Matrix4.toArray(Cesium.Matrix4.inverse(Cesium.Transforms.eastNorthUpToFixedFrame(this.point), new Cesium.Matrix4()))
    this.material.uniforms.localFrameReady = 1
  }

  private assertAlive(): void { if (this.destroyed) throw new Error('WaterSurface has been destroyed') }
}

function validateHeight(height: number): void { if (!Number.isFinite(height)) throw new RangeError('height must be finite') }

function resolveReflectionOptions(options: WaterSurfaceUpdateOptions, quality: WaterQuality, previous?: ReflectionOptions): ReflectionOptions {
  if (!qualityOptions[quality]) throw new RangeError('Unknown water quality')
  const result = { ...previous ?? qualityOptions[quality] }
  if (options.reflectionResolutionScale !== undefined) result.resolutionScale = options.reflectionResolutionScale
  if (options.reflectionMaxSize !== undefined) result.maxSize = options.reflectionMaxSize
  if (options.reflectionMaxFps !== undefined) result.maxFps = options.reflectionMaxFps
  if (options.reflectGlobe !== undefined) result.reflectGlobe = options.reflectGlobe
  if (!Number.isFinite(result.resolutionScale) || result.resolutionScale <= 0 || result.resolutionScale > 1) throw new RangeError('reflectionResolutionScale must be in (0, 1]')
  if (!Number.isInteger(result.maxSize) || result.maxSize < 32 || result.maxSize > 4096) throw new RangeError('reflectionMaxSize must be an integer in [32, 4096]')
  if (!Number.isFinite(result.maxFps) || result.maxFps <= 0 || result.maxFps > 120) throw new RangeError('reflectionMaxFps must be in (0, 120]')
  return result
}
