import * as Cesium from 'cesium'

export interface ReflectionOptions {
  resolutionScale: number
  maxSize: number
  maxFps: number
  reflectGlobe: boolean
}

// Cesium 1.132 has no public planar reflection pass. Keep all private engine access here.
// No engine prototypes are patched; shared frame state is restored even when rendering fails.
const engine = Cesium as unknown as Record<string, any>
const waterPrimitives = new WeakMap<Cesium.Scene, Set<Cesium.Primitive>>()

export function registerWaterPrimitive(scene: Cesium.Scene, primitive: Cesium.Primitive): () => void {
  let primitives = waterPrimitives.get(scene)
  if (!primitives) waterPrimitives.set(scene, primitives = new Set())
  primitives.add(primitive)
  return () => { primitives.delete(primitive) }
}

export class PlanarReflection {
  private scene: any
  private view: any
  private camera: Cesium.Camera
  private color: any
  private depth: any
  private framebuffer: any
  private material: Cesium.Material
  private lastUpdate = -Infinity
  private destroyed = false
  private frames = 0
  private targets = 0
  private lastMs = 0
  private viewProjection = new Cesium.Matrix4()
  private reflectionFromEye = new Cesium.Matrix4()

  constructor(scene: Cesium.Scene, material: Cesium.Material) {
    this.scene = scene
    this.material = material
    if (!engine.View || !engine.Texture || !(scene as any)._defaultView) throw new Error('Planar reflection requires the supported Cesium 1.132 renderer')
    this.camera = new Cesium.Camera(scene)
    this.view = new engine.View(scene, this.camera, new Cesium.BoundingRectangle(0, 0, 1, 1))
  }

  invalidate(): void { this.lastUpdate = -Infinity }

  getDiagnostics() {
    return { reflectionFrames: this.frames, reflectionTargetsCreated: this.targets, reflectionWidth: this.color?.width ?? 0, reflectionHeight: this.color?.height ?? 0, lastReflectionMs: this.lastMs }
  }

  update(point: Cesium.Cartesian3, normal: Cesium.Cartesian3, options: ReflectionOptions, now: number): boolean {
    if (this.destroyed) return false
    const scene = this.scene
    const originalCamera = scene.camera as Cesium.Camera
    if (Cesium.Cartesian3.dot(Cesium.Cartesian3.subtract(originalCamera.positionWC, point, new Cesium.Cartesian3()), normal) <= 0) return false
    if (now - this.lastUpdate < 1000 / options.maxFps) {
      this.updateProjection(originalCamera)
      return true
    }
    const start = performance.now()
    const context = scene.context
    const dimensions = reflectionDimensions(context.drawingBufferWidth, context.drawingBufferHeight, options)
    this.createTarget(dimensions.width, dimensions.height)
    this.updateCamera(originalCamera, point, normal)

    const originalView = scene._view
    const originalShadow = scene.shadowMap
    const globeShow = scene.globe?.show
    const logDepth = scene._logDepthBuffer
    const hdr = scene._hdr
    const environment = { ...scene._environmentState }
    const frameState = scene._frameState
    const passes = { ...frameState.passes }
    const frameCamera = frameState.camera
    const atmosphere = frameState.atmosphere
    const cullingVolume = frameState.cullingVolume
    const commands = frameState.commandList.slice()
    const shadows = frameState.shadowMaps.slice()
    const tilesetPass = frameState.tilesetPassState
    const uniformState = context.uniformState
    const updateFrustum = uniformState.updateFrustum
    const hidden = [...waterPrimitives.get(scene) ?? []].map(primitive => ({ primitive, show: primitive.show }))
    // Oblique clipping is scoped to this context and pass. Main-view logarithmic depth stays intact.
    const plane = Cesium.Plane.fromPointNormal(point, normal)
    Cesium.Plane.transform(plane, this.camera.viewMatrix, plane)
    uniformState.updateFrustum = function (frustum: any) {
      updateFrustum.call(this, frustum)
      const projection = Cesium.Matrix4.clone(frustum.projectionMatrix, this._projection)
      clipProjection(projection, plane)
    }
    let beganGlobe = false
    try {
      hidden.forEach(({ primitive }) => { primitive.show = false })
      scene._view = this.view
      scene.shadowMap = undefined
      if (scene.globe) scene.globe.show = options.reflectGlobe
      scene._logDepthBuffer = false
      scene._hdr = false
      scene.updateFrameState()
      frameState.passes.render = true
      frameState.passes.postProcess = false
      frameState.tilesetPassState = new engine.Cesium3DTilePassState({ pass: engine.Cesium3DTilePass.RENDER })
      frameState.backgroundColor = scene.backgroundColor
      // preRender can precede the host's first render, which normally initializes this field.
      frameState.atmosphere = scene.atmosphere
      scene.fog.update(frameState)
      uniformState.update(frameState)
      this.view.viewport.width = dimensions.width
      this.view.viewport.height = dimensions.height
      const passState = this.view.passState
      passState.viewport = Cesium.BoundingRectangle.clone(this.view.viewport, passState.viewport)
      passState.framebuffer = this.framebuffer
      passState.blendingEnabled = undefined
      passState.scissorTest = undefined
      context.beginFrame()
      if (scene.globe) { scene.globe.beginFrame(frameState); beganGlobe = true }
      scene.updateEnvironment()
      scene.updateAndExecuteCommands(passState, scene.backgroundColor)
      scene.resolveFramebuffers(passState)
      Cesium.Matrix4.multiply(this.camera.frustum.projectionMatrix, this.camera.viewMatrix, this.viewProjection)
      // Texture ownership is transferred to Material; the framebuffer only borrows its attachment.
      this.material.uniforms.reflexTexture = this.color
      this.updateProjection(originalCamera)
      this.material.uniforms.reflectionReady = 1
      this.frames++
      this.lastUpdate = now
      return true
    } finally {
      if (beganGlobe) scene.globe.endFrame(frameState)
      uniformState.updateFrustum = updateFrustum
      scene._view = originalView
      scene.shadowMap = originalShadow
      if (scene.globe) scene.globe.show = globeShow
      scene._logDepthBuffer = logDepth
      scene._hdr = hdr
      Object.assign(scene._environmentState, environment)
      Object.assign(frameState.passes, passes)
      frameState.camera = frameCamera
      frameState.atmosphere = atmosphere
      frameState.cullingVolume = cullingVolume
      frameState.tilesetPassState = tilesetPass
      frameState.commandList.length = 0
      frameState.commandList.push(...commands)
      frameState.shadowMaps.length = 0
      frameState.shadowMaps.push(...shadows)
      hidden.forEach(({ primitive, show }) => { primitive.show = show })
      scene.updateFrameState()
      uniformState.update(frameState)
      context.endFrame()
      this.lastMs = performance.now() - start
    }
  }

  private updateCamera(source: Cesium.Camera, point: Cesium.Cartesian3, normal: Cesium.Cartesian3): void {
    const distance = Cesium.Cartesian3.dot(Cesium.Cartesian3.subtract(source.positionWC, point, new Cesium.Cartesian3()), normal)
    Cesium.Cartesian3.subtract(source.positionWC, Cesium.Cartesian3.multiplyByScalar(normal, distance * 2, new Cesium.Cartesian3()), this.camera.position)
    reflectDirection(source.directionWC, normal, this.camera.direction)
    reflectDirection(source.upWC, normal, this.camera.up)
    Cesium.Cartesian3.cross(this.camera.direction, this.camera.up, this.camera.right)
    Cesium.Cartesian3.normalize(this.camera.right, this.camera.right)
    this.camera.frustum = source.frustum.clone()
  }

  private updateProjection(source: Cesium.Camera): void {
    // Compose in JS double precision; the fragment shader never reconstructs large ECEF values.
    Cesium.Matrix4.multiply(this.viewProjection, source.inverseViewMatrix, this.reflectionFromEye)
    this.material.uniforms.reflectionFromEye = Cesium.Matrix4.toArray(this.reflectionFromEye, this.material.uniforms.reflectionFromEye)
  }

  private createTarget(width: number, height: number): void {
    if (this.color?.width === width && this.color?.height === height) return
    if ((this.material as any)._textures.reflexTexture === this.color) delete (this.material as any)._textures.reflexTexture
    this.material.uniforms.reflexTexture = Cesium.Material.DefaultImageId
    this.material.uniforms.reflectionReady = 0
    this.destroyTarget()
    const context = this.scene.context
    this.color = new engine.Texture({ context, width, height, pixelFormat: Cesium.PixelFormat.RGBA, pixelDatatype: Cesium.PixelDatatype.UNSIGNED_BYTE,
      sampler: new engine.Sampler({ wrapS: engine.TextureWrap.CLAMP_TO_EDGE, wrapT: engine.TextureWrap.CLAMP_TO_EDGE, minificationFilter: Cesium.TextureMinificationFilter.LINEAR, magnificationFilter: Cesium.TextureMagnificationFilter.LINEAR }) })
    this.depth = new engine.Texture({ context, width, height, pixelFormat: Cesium.PixelFormat.DEPTH_STENCIL, pixelDatatype: Cesium.PixelDatatype.UNSIGNED_INT_24_8 })
    this.framebuffer = new engine.Framebuffer({ context, colorTextures: [this.color], depthStencilTexture: this.depth, destroyAttachments: false })
    this.material.uniforms.reflexTexture = this.color
    this.targets++
  }

  private destroyTarget(): void {
    if (this.framebuffer && !this.framebuffer.isDestroyed()) this.framebuffer.destroy()
    if (this.depth && !this.depth.isDestroyed()) this.depth.destroy()
    if (this.color && !this.color.isDestroyed()) this.color.destroy()
    this.framebuffer = this.depth = this.color = undefined
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    // Detach the borrowed framebuffer texture before the material's own cleanup.
    if ((this.material as any)._textures.reflexTexture === this.color) delete (this.material as any)._textures.reflexTexture
    this.material.uniforms.reflexTexture = Cesium.Material.DefaultImageId
    this.destroyTarget()
    this.view.destroy()
  }
}

function reflectDirection(direction: Cesium.Cartesian3, normal: Cesium.Cartesian3, result: Cesium.Cartesian3): void {
  const offset = Cesium.Cartesian3.multiplyByScalar(normal, 2 * Cesium.Cartesian3.dot(direction, normal), new Cesium.Cartesian3())
  Cesium.Cartesian3.subtract(direction, offset, result)
}

function clipProjection(projection: any, plane: Cesium.Plane): void {
  const clip = new Cesium.Cartesian4(plane.normal.x, plane.normal.y, plane.normal.z, plane.distance)
  const q = new Cesium.Cartesian4((Math.sign(clip.x) + projection[8]) / projection[0], (Math.sign(clip.y) + projection[9]) / projection[5], -1, (1 + projection[10]) / projection[14])
  const denominator = Cesium.Cartesian4.dot(clip, q)
  if (Math.abs(denominator) < 1e-8) return
  Cesium.Cartesian4.multiplyByScalar(clip, 2 / denominator, clip)
  projection[2] = clip.x
  projection[6] = clip.y
  projection[10] = clip.z + 1
  projection[14] = clip.w
}

export function reflectionDimensions(width: number, height: number, options: Pick<ReflectionOptions, 'resolutionScale' | 'maxSize'>) {
  const scale = Math.min(options.resolutionScale, options.maxSize / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}
