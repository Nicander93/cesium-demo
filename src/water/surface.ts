import * as Cesium from 'cesium'
import { createWaterMaterial, updateWaterMaterial, updateWaterMaterialView, type WaterMaterialOptions } from './material'
import { PlanarReflection, registerWaterPrimitive, type ReflectionOptions } from './reflection'
import { ShoreDepth } from './shore'
import { WaterEnvironment } from './environment'
import { createShorelineMask } from './shoreline'

export type WaterQuality = 'low' | 'balanced' | 'high'
export interface WaterSurfaceOptions extends Omit<WaterMaterialOptions, 'origin'> {
  /** Full mapped natural boundary, before display cropping; static, no bathymetry implied. */
  shoreline?: readonly Cesium.Cartographic[]
  scene: Cesium.Scene
  positions: readonly Cesium.Cartographic[]
  height: number
  flowDegrees?: number
  waveSpeed?: number
  quality?: WaterQuality
  reflection?: boolean
  reflectionResolutionScale?: number
  reflectionMaxSize?: number
  reflectionMaxFps?: number
  reflectGlobe?: boolean
  /** Generate atmospheric IBL in microfacet mode; defaults to true. */
  skyEnvironment?: boolean
  onError?: (error: unknown) => void
}
export type WaterSurfaceUpdateOptions = Omit<WaterMaterialOptions, 'origin'> & Partial<Pick<WaterSurfaceOptions, 'waveSpeed' | 'height' | 'quality' | 'reflection' | 'reflectionResolutionScale' | 'reflectionMaxSize' | 'reflectionMaxFps' | 'reflectGlobe' | 'skyEnvironment'>>

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
  private shorelineMask: ReturnType<typeof createShorelineMask> | undefined
  private environmentPass: WaterEnvironment | undefined
  private environmentError: string | null = null
  private skyEnvironment = true
  private shoreDepth: ShoreDepth | undefined
  private positions: readonly Cesium.Cartographic[]
  private shoreError: string | null = null
  private reflectionEnabled: boolean
  private reflectionOptions: ReflectionOptions
  private quality: WaterQuality
  private point: Cesium.Cartesian3
  private originalPoint: Cesium.Cartesian3
  private normal: Cesium.Cartesian3
  private currentHeight: number
  private started = performance.now()
  private lastWaveUpdate = this.started
  private waveTime = 0
  private currentWaveSpeed = 1
  private readyMs: number | null = null
  private destroyed = false
  private error: string | null = null
  private retryAt = 0
  private reflectionFailures = 0
  private onError: ((error: unknown) => void) | undefined
  private removePreRender: () => void
  private removePostRender: () => void
  private unregisterPrimitive: () => void
  private resolveReady!: (ready: boolean) => void

  constructor(options: WaterSurfaceOptions) {
    if (options.shoreline && options.foamWidth !== undefined && options.foamWidth > 64) throw new RangeError('Mapped shoreline foamWidth must not exceed 64 metres')
    validateHeight(options.height)
    validateWaveSpeed(options.waveSpeed)
    this.currentWaveSpeed = options.waveSpeed ?? 1
    if (options.positions.length < 3 || options.positions.length > 10000 || options.positions.some(position => !Number.isFinite(position.longitude) || !Number.isFinite(position.latitude) || Math.abs(position.latitude) > Math.PI / 2 || Math.abs(position.longitude) > Math.PI)) throw new RangeError('positions must contain 3–10000 valid Cartographic points')
    if (options.flowDegrees !== undefined && !Number.isFinite(options.flowDegrees)) throw new RangeError('flowDegrees must be finite')
    this.quality = options.quality ?? 'balanced'
    this.reflectionOptions = resolveReflectionOptions(options, this.quality)
    this.reflectionEnabled = options.reflection ?? true
    this.scene = options.scene
    this.skyEnvironment = options.skyEnvironment ?? true
    this.positions = options.positions.map(position => Cesium.Cartographic.clone(position))
    this.onError = options.onError
    this.currentHeight = options.height
    const positions = options.positions.map(position => Cesium.Cartesian3.fromRadians(position.longitude, position.latitude, options.height))
    const center = Cesium.BoundingSphere.fromPoints(positions).center
    const cartographic = Cesium.Cartographic.fromCartesian(center)
    this.point = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, options.height)
    this.originalPoint = Cesium.Cartesian3.clone(this.point)
    this.normal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(this.point)
    if (options.shoreline) this.shorelineMask = createShorelineMask(options.shoreline, this.positions, this.point, options.height)
    this.material = createWaterMaterial(options)
    if (this.shorelineMask) {
      this.material.uniforms.shorelineTexture = this.shorelineMask.canvas
      this.material.uniforms.shorelineBounds = this.shorelineMask.bounds
      this.material.uniforms.shorelineReady = 1
    }
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
    if (this.shorelineMask && options.foamWidth !== undefined && options.foamWidth > 64) throw new RangeError('Mapped shoreline foamWidth must not exceed 64 metres')
    validateWaveSpeed(options.waveSpeed)
    if (options.height !== undefined) validateHeight(options.height)
    const quality = options.quality ?? this.quality
    const reflectionOptions = resolveReflectionOptions(options, quality, options.quality === undefined ? this.reflectionOptions : undefined)
    updateWaterMaterial(this.material, options)
    if (options.waveSpeed !== undefined && options.waveSpeed !== this.currentWaveSpeed) {
      this.advanceWaveTime(performance.now())
      this.currentWaveSpeed = options.waveSpeed
    }
    this.quality = quality
    if(options.skyEnvironment !== undefined) this.skyEnvironment = options.skyEnvironment
    this.reflectionOptions = reflectionOptions
    if (options.reflection !== undefined) {
      this.reflectionEnabled = options.reflection
      this.retryAt = 0
      this.reflectionFailures = 0
      this.error = null
      if (!options.reflection) this.material.uniforms.reflectionReady = 0
    }
    if (options.height !== undefined) this.height = options.height
    this.reflectionPass?.invalidate()
    this.shoreDepth?.invalidate()
    this.scene.requestRender()
  }

  /** Seek only the visual wave clock, without changing water height or host time. */
  setVisualTime(seconds: number): void {
    this.assertAlive()
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('visual time must be finite and nonnegative')
    this.waveTime = seconds
    this.lastWaveUpdate = performance.now()
    this.material.uniforms.time = seconds
    this.scene.requestRender()
  }

  /** A detached snapshot of the current rendering configuration; no Viewer or GPU objects. */
  getOptions(): WaterSurfaceUpdateOptions {
    this.assertAlive()
    const u = this.material.uniforms
    return { lightingModel: u.microfacetEnabled > 0.5 ? 'microfacet' : 'legacy', indexOfRefraction: u.indexOfRefraction, environmentIntensity: u.environmentIntensity, skyEnvironment: this.skyEnvironment, height: this.currentHeight, waveSpeed: this.currentWaveSpeed, quality: this.quality,
      reflection: this.reflectionEnabled, reflectGlobe: this.reflectionOptions.reflectGlobe,
      reflectionResolutionScale: this.reflectionOptions.resolutionScale, reflectionMaxSize: this.reflectionOptions.maxSize, reflectionMaxFps: this.reflectionOptions.maxFps,
      shadingMode: u.waterCompositeOutput > 0.5 ? 'water-composite' : 'legacy-phong', waveModel: u.waveModel > 0.5 ? 'multiscale' : 'legacy', waveLength: u.waveLength, waveDirection: Cesium.Math.toDegrees(u.waveDirection), waveSpread: Cesium.Math.toDegrees(u.waveSpread), waveIrregularity: u.waveIrregularity,
      detailStrength: u.detailStrength, roughness: u.roughness, specularIntensity: u.specularIntensity, reflectionStrength: u.reflectionStrength,
      rippleSize: u.size, waveStrength: u.waveStrength, waterColor: Cesium.Color.clone(u.waterColor), waterAlpha: u.waterAlpha,
      environmentColor: Cesium.Color.clone(u.environmentColor), lightDirection: Cesium.Cartesian3.clone(u.lightDirection), edgeFadeWidth: u.edgeFadeWidth, shoreFadeDistance: u.shoreFadeDistance, reflectivity: u.rf0, sunShiny: u.sunShiny, distortionScale: u.distortionScale,
      foam: u.foamEnabled > 0.5, foamWidth: u.foamWidth, foamIntensity: u.foamIntensity, foamSpeed: u.foamSpeed,
      ...(typeof u.normalTexture === 'string' && u.useNormalTexture > 0.5 ? { normalMapUrl: u.normalTexture } : {}),
    }
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
    this.shoreDepth?.invalidate()
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
    return { ...this.environmentPass?.getDiagnostics() ?? { environmentAvailable: false, brdfAvailable: false, environmentUpdates: 0, environmentGenerations: 0, environmentError: this.environmentError }, readyMs: this.readyMs, quality: this.quality, reflectionEnabled: this.reflectionEnabled, reflectionAvailable: this.material.uniforms.reflectionReady > 0, reflectionFailures: this.reflectionFailures, destroyed: this.destroyed, error: this.error, geometryCreated: 1,
      ...this.reflectionPass?.getDiagnostics() ?? { reflectionFrames: 0, reflectionTargetsCreated: 0, reflectionWidth: 0, reflectionHeight: 0, lastReflectionMs: 0 },
      foamEnabled: this.material.uniforms.foamEnabled > 0,
      foamAvailable: this.material.uniforms.shoreReady > 0 || this.material.uniforms.shorelineReady > 0,
      shorelineAvailable: this.material.uniforms.shorelineReady > 0,
      shorelineMaskWidth: this.shorelineMask?.width ?? 0, shorelineMaskHeight: this.shorelineMask?.height ?? 0, shorelineTexelSize: this.shorelineMask?.texelSize ?? 0,
      ...this.shoreDepth?.getDiagnostics() ?? { shoreFrames: 0, shoreTargetsCreated: 0, shoreWidth: 0, shoreHeight: 0, shoreError: this.shoreError },
    }
  }

  getWaterShaderSource(): string { this.assertAlive(); return this.primitive.appearance.getFragmentShaderSource() }

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
    this.shoreDepth?.destroy()
    this.material.uniforms.shorelineReady = 0
    if(this.environmentPass && !this.environmentPass.isDestroyed()) { if(!this.scene.isDestroyed()) this.scene.primitives.remove(this.environmentPass); else this.environmentPass.destroy() }
    this.material.destroy()
    if (this.shorelineMask) this.shorelineMask.canvas.width = this.shorelineMask.canvas.height = 1
    this.shorelineMask = undefined
    this.resolveReady(false)
    if (!this.scene.isDestroyed()) this.scene.requestRender()
  }

  private handlePreRender = (): void => {
    if (this.destroyed) return
    if (!this.primitive.show) { if(this.environmentPass) this.environmentPass.enabled=false; return }
    const now = performance.now()
    this.advanceWaveTime(now)
    if (this.material.uniforms.microfacetEnabled > 0.5 && !this.environmentError) {
      try {
        if(!this.environmentPass) { const pass = new WaterEnvironment(this.scene,this.material,this.point); this.scene.primitives.add(pass); this.environmentPass = pass }
        this.environmentPass.enabled = true
        this.environmentPass.atmosphere = this.skyEnvironment
        this.environmentPass.setPosition(this.point)
      } catch(error) { this.environmentError = String(error) }
    } else if(this.environmentPass) this.environmentPass.enabled = false
    if (this.scene.camera) updateWaterMaterialView(this.material, this.scene.camera, this.point)
    if (this.scene.mode !== Cesium.SceneMode.SCENE3D) { this.material.uniforms.reflectionReady = this.material.uniforms.shoreReady = this.material.uniforms.shorelineReady = 0; return }
    this.material.uniforms.shorelineReady = this.shorelineMask ? 1 : 0
    if (this.material.uniforms.foamEnabled > 0 && !this.shorelineMask) {
      try {
        this.shoreDepth ??= new ShoreDepth(this.scene, this.material, this.positions)
        this.shoreDepth.update(this.point, this.currentHeight, this.quality === 'high' ? 1024 : this.quality === 'balanced' ? 512 : 256, now)
      } catch (error) {
        this.shoreError = error instanceof Error ? error.message : String(error)
        this.material.uniforms.foamEnabled = this.material.uniforms.shoreReady = 0
      }
    }
    if (!this.reflectionEnabled) { this.material.uniforms.reflectionReady = 0; return }
    if (now < this.retryAt) return
    try {
      this.reflectionPass ??= new PlanarReflection(this.scene, this.material)
      if (!this.reflectionPass.update(this.point, this.normal, this.reflectionOptions, now)) this.material.uniforms.reflectionReady = 0
      else { this.error = null; this.reflectionFailures = 0 }
    } catch (error) {
      this.material.uniforms.reflectionReady = 0
      this.reflectionFailures++
      this.retryAt = now + Math.min(8000, 1000 * 2 ** Math.min(this.reflectionFailures - 1, 3))
      const networkError = error instanceof Cesium.RequestErrorEvent
      if (!networkError && this.reflectionFailures >= 3) this.reflectionEnabled = false
      this.error = error instanceof Error ? error.message : String(error)
      this.onError?.(error)
    }
  }

  private advanceWaveTime(now: number): void {
    this.waveTime += Math.max(0, now - this.lastWaveUpdate) / 1000 * this.currentWaveSpeed
    this.lastWaveUpdate = now
    this.material.uniforms.time = this.waveTime
  }

  private updateLocalFrame(): void {
    this.material.uniforms.worldToLocal = Cesium.Matrix4.toArray(Cesium.Matrix4.inverse(Cesium.Transforms.eastNorthUpToFixedFrame(this.point), new Cesium.Matrix4()))
    this.material.uniforms.localFrameReady = 1
  }

  private assertAlive(): void { if (this.destroyed) throw new Error('WaterSurface has been destroyed') }
}

function validateWaveSpeed(speed: number | undefined): void {
  if (speed !== undefined && (!Number.isFinite(speed) || speed < 0)) throw new RangeError('waveSpeed must be finite and nonnegative')
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
