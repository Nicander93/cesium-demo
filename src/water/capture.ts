import * as Cesium from 'cesium'

const engine = Cesium as unknown as Record<string, any>
const waterPrimitives = new WeakMap<Cesium.Scene, Set<Cesium.Primitive>>()

export function registerWaterPrimitive(scene: Cesium.Scene, primitive: Cesium.Primitive): () => void {
  let primitives = waterPrimitives.get(scene)
  if (!primitives) waterPrimitives.set(scene, primitives = new Set())
  primitives.add(primitive)
  return () => { primitives.delete(primitive) }
}

// Cesium 1.132's private renderer is confined to this adapter. Each pass owns its View and targets.
export class SceneCapture {
  private scene: any
  private view: any
  private material: Cesium.Material
  private uniform: string
  private directDepth: boolean
  private color: any
  private depth: any
  private framebuffer: any
  private postProcess = new Cesium.PostProcessStageCollection()
  private destroyed = false
  readonly projection = new Cesium.Matrix4()
  targetsCreated = 0

  constructor(scene: Cesium.Scene, camera: Cesium.Camera, material: Cesium.Material, uniform: string, directDepth = false) {
    this.scene = scene
    this.material = material
    this.uniform = uniform
    this.directDepth = directDepth
    if (!engine.View || !engine.Texture || !(scene as any)._defaultView) throw new Error('Water capture requires the supported Cesium 1.132 renderer')
    this.view = new engine.View(scene, camera, new Cesium.BoundingRectangle(0, 0, 1, 1))
    this.postProcess.fxaa.enabled = false
    if (directDepth) {
      // Write our depth attachment directly instead of Cesium's intermediate globe depth.
      this.view.oit?.destroy()
      this.view.globeDepth?.destroy()
      this.view.oit = this.view.globeDepth = undefined
    }
  }

  get width(): number { return this.color?.width ?? 0 }
  get height(): number { return this.color?.height ?? 0 }
  get depthTexture(): unknown { return this.depth }

  render(width: number, height: number, reflectGlobe: boolean, clipPlane?: Cesium.Plane): void {
    if (this.destroyed) throw new Error('SceneCapture has been destroyed')
    this.createTarget(width, height)
    const scene = this.scene
    const context = scene.context
    const originalView = scene._view
    const originalShadow = scene.shadowMap
    const originalPostProcess = scene.postProcessStages
    const globeShow = scene.globe?.show
    // Reuse the main view's loaded terrain tiles. A second quadtree frame would
    // replace its selection/load queues and run host height callbacks from the mirrored camera.
    const reuseTerrain = reflectGlobe && !this.directDepth && !!scene.globe
    const terrainDebug = reuseTerrain ? scene.globe._surface?._debug : undefined
    if (reuseTerrain && typeof terrainDebug?.suspendLodUpdate !== 'boolean') {
      throw new Error('Terrain reflection requires the supported Cesium 1.132 quadtree adapter')
    }
    const originalSuspendLod = terrainDebug?.suspendLodUpdate
    const logDepth = scene._logDepthBuffer
    const hdr = scene._hdr
    const farToNearRatio = scene.farToNearRatio
    const environment = { ...scene._environmentState }
    const frameState = scene._frameState
    const passes = { ...frameState.passes }
    const frameCamera = frameState.camera
    const cullingVolume = frameState.cullingVolume
    const atmosphere = frameState.atmosphere
    const background = frameState.backgroundColor
    const commands = frameState.commandList.slice()
    const shadows = frameState.shadowMaps.slice()
    const frustumSplits = frameState.frustumSplits?.slice()
    const tilesetPass = frameState.tilesetPassState
    const uniformState = context.uniformState
    const updateFrustum = uniformState.updateFrustum
    const hidden = [...waterPrimitives.get(scene) ?? []].map(primitive => ({ primitive, show: primitive.show }))
    if (clipPlane) {
      const plane = Cesium.Plane.transform(clipPlane, this.view.camera.viewMatrix, new Cesium.Plane(Cesium.Cartesian3.UNIT_Z, 0))
      uniformState.updateFrustum = function (frustum: any) {
        updateFrustum.call(this, frustum)
        clipProjection(this._projection, plane)
      }
    }
    let beganGlobe = false
    try {
      hidden.forEach(({ primitive }) => { primitive.show = false })
      scene._view = this.view
      scene.shadowMap = undefined
      scene.postProcessStages = this.postProcess
      if (scene.globe) scene.globe.show = reflectGlobe
      if (terrainDebug) terrainDebug.suspendLodUpdate = true
      scene._logDepthBuffer = false
      scene._hdr = false
      if (this.directDepth) scene.farToNearRatio = 1e9
      scene.updateFrameState()
      frameState.passes.render = true
      frameState.passes.postProcess = false
      // Auxiliary views request visible tiles without replacing main-view render statistics.
      frameState.tilesetPassState = new engine.Cesium3DTilePassState({ pass: engine.Cesium3DTilePass.SHADOW })
      frameState.backgroundColor = scene.backgroundColor ?? Cesium.Color.BLACK
      frameState.atmosphere = scene.atmosphere
      scene.fog.update(frameState)
      uniformState.update(frameState)
      this.view.viewport.width = width
      this.view.viewport.height = height
      const passState = this.view.passState
      passState.viewport = Cesium.BoundingRectangle.clone(this.view.viewport, passState.viewport)
      passState.framebuffer = this.framebuffer
      passState.blendingEnabled = undefined
      passState.scissorTest = undefined
      context.beginFrame()
      if (scene.globe && !reuseTerrain) { scene.globe.beginFrame(frameState); beganGlobe = true }
      scene.updateEnvironment()
      scene.updateAndExecuteCommands(passState, frameState.backgroundColor)
      scene.resolveFramebuffers(passState)
      // Single-frustum depth may fit its near/far planes to the visible geometry.
      Cesium.Matrix4.clone(uniformState.projection ?? this.view.camera.frustum.projectionMatrix, this.projection)
      this.material.uniforms[this.uniform] = this.directDepth ? this.depth : this.color
    } finally {
      try { if (beganGlobe) scene.globe.endFrame(frameState) } finally {
        uniformState.updateFrustum = updateFrustum
        scene._view = originalView
        scene.shadowMap = originalShadow
        scene.postProcessStages = originalPostProcess
        if (scene.globe) scene.globe.show = globeShow
        if (terrainDebug) terrainDebug.suspendLodUpdate = originalSuspendLod
        scene._logDepthBuffer = logDepth
        scene._hdr = hdr
        scene.farToNearRatio = farToNearRatio
        Object.assign(scene._environmentState, environment)
        scene.updateFrameState()
        Object.assign(frameState.passes, passes)
        frameState.camera = frameCamera
        frameState.cullingVolume = cullingVolume
        frameState.atmosphere = atmosphere
        frameState.backgroundColor = background
        frameState.tilesetPassState = tilesetPass
        frameState.commandList.length = 0
        frameState.commandList.push(...commands)
        frameState.shadowMaps.length = 0
        frameState.shadowMaps.push(...shadows)
        if (frustumSplits) frameState.frustumSplits.splice(0, frameState.frustumSplits.length, ...frustumSplits)
        hidden.forEach(({ primitive, show }) => { primitive.show = show })
        uniformState.update(frameState)
        context.endFrame()
      }
    }
  }

  private createTarget(width: number, height: number): void {
    if (this.width === width && this.height === height) return
    this.detachTexture()
    this.destroyTarget()
    const context = this.scene.context
    this.color = new engine.Texture({ context, width, height, pixelFormat: Cesium.PixelFormat.RGBA, pixelDatatype: Cesium.PixelDatatype.UNSIGNED_BYTE,
      sampler: new engine.Sampler({ wrapS: engine.TextureWrap.CLAMP_TO_EDGE, wrapT: engine.TextureWrap.CLAMP_TO_EDGE, minificationFilter: Cesium.TextureMinificationFilter.LINEAR, magnificationFilter: Cesium.TextureMagnificationFilter.LINEAR }) })
    this.depth = new engine.Texture({ context, width, height, pixelFormat: Cesium.PixelFormat.DEPTH_STENCIL, pixelDatatype: Cesium.PixelDatatype.UNSIGNED_INT_24_8 })
    this.framebuffer = new engine.Framebuffer({ context, colorTextures: [this.color], depthStencilTexture: this.depth, destroyAttachments: false })
    this.targetsCreated++
  }

  private detachTexture(): void {
    const texture = this.directDepth ? this.depth : this.color
    if (texture && (this.material as any)._textures[this.uniform] === texture) delete (this.material as any)._textures[this.uniform]
    this.material.uniforms[this.uniform] = Cesium.Material.DefaultImageId
  }

  private destroyTarget(): void {
    for (const resource of [this.framebuffer, this.depth, this.color]) if (resource && !resource.isDestroyed()) resource.destroy()
    this.framebuffer = this.depth = this.color = undefined
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.detachTexture()
    this.destroyTarget()
    this.view.destroy()
    this.postProcess.destroy()
  }
}

const shoreMaskShader = `
in vec2 v_textureCoordinates;
uniform sampler2D depthTexture;
uniform mat4 localFromClip;
uniform vec2 mapSize;
uniform float foamWidth;
float heightAt(vec2 uv) {
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return -1000.0;
  float depth = texture(depthTexture, uv).r;
  if (depth >= 0.999999 || depth <= 0.0) return -1000.0;
  vec4 local = localFromClip * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  return local.z / local.w;
}
void main() {
  vec2 uv = v_textureCoordinates;
  float height = heightAt(uv);
  float shallow = 1.0 - smoothstep(0.0, max(foamWidth, 0.001), max(-height, 0.0));
  float shore = 0.0;
  for (int direction = 0; direction < 8; direction++) {
    float angle = float(direction) * 0.78539816;
    vec2 offset = vec2(cos(angle), sin(angle)) * foamWidth / mapSize;
    float ray = 0.0;
    for (int radius = 1; radius <= 4; radius++) {
      float distance = float(radius) * 0.25;
      ray = max(ray, smoothstep(-0.15, 0.15, heightAt(uv + offset * distance)) * (1.0 - distance * 0.8));
    }
    shore += ray * 0.125;
  }
  float band = max(shallow, shore * 2.5) * (1.0 - smoothstep(0.05, 0.3, height));
  out_FragColor = vec4(clamp(band, 0.0, 1.0), 0.0, 0.0, 1.0);
}`

// Build a linearly filtered shoreline mask at low frequency, keeping depth taps out of every water fragment.
export class ShoreMask {
  private context: any
  private material: Cesium.Material
  private texture: any
  private framebuffer: any
  private command: any
  private depth: unknown
  private localFromClip = new Cesium.Matrix4()
  private size = new Cesium.Cartesian2()
  private width = 0
  private destroyed = false

  constructor(scene: Cesium.Scene, material: Cesium.Material) { this.context = (scene as any).context; this.material = material }

  update(depth: unknown, matrix: Cesium.Matrix4, size: Cesium.Cartesian2, width: number, height: number): void {
    if (this.destroyed) return
    if (this.texture?.width !== width || this.texture?.height !== height) {
      this.destroyTarget()
      this.texture = new engine.Texture({ context: this.context, width, height, pixelFormat: Cesium.PixelFormat.RGBA, pixelDatatype: Cesium.PixelDatatype.UNSIGNED_BYTE,
        sampler: new engine.Sampler({ minificationFilter: Cesium.TextureMinificationFilter.LINEAR, magnificationFilter: Cesium.TextureMagnificationFilter.LINEAR }) })
      this.framebuffer = new engine.Framebuffer({ context: this.context, colorTextures: [this.texture], destroyAttachments: false })
    }
    this.depth = depth
    Cesium.Matrix4.clone(matrix, this.localFromClip)
    Cesium.Cartesian2.clone(size, this.size)
    this.width = this.material.uniforms.foamWidth
    this.command ??= this.context.createViewportQuadCommand(shoreMaskShader, { uniformMap: {
      depthTexture: () => this.depth,
      localFromClip: () => this.localFromClip,
      mapSize: () => this.size,
      foamWidth: () => this.width,
    } })
    this.command.framebuffer = this.framebuffer
    this.command.renderState = engine.RenderState.fromCache({ viewport: new Cesium.BoundingRectangle(0, 0, width, height) })
    this.command.execute(this.context)
    this.material.uniforms.shoreMaskTexture = this.texture
  }

  private destroyTarget(): void {
    if (this.texture && (this.material as any)._textures.shoreMaskTexture === this.texture) delete (this.material as any)._textures.shoreMaskTexture
    this.material.uniforms.shoreMaskTexture = Cesium.Material.DefaultImageId
    if (this.framebuffer && !this.framebuffer.isDestroyed()) this.framebuffer.destroy()
    if (this.texture && !this.texture.isDestroyed()) this.texture.destroy()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.destroyTarget()
    this.command?.shaderProgram.destroy()
  }
}

function clipProjection(projection: Cesium.Matrix4, plane: Cesium.Plane): void {
  const clip = new Cesium.Cartesian4(plane.normal.x, plane.normal.y, plane.normal.z, plane.distance)
  const q = new Cesium.Cartesian4((Math.sign(clip.x) + projection[8]) / projection[0], (Math.sign(clip.y) + projection[9]) / projection[5], -1, (1 + projection[10]) / projection[14])
  const denominator = Cesium.Cartesian4.dot(clip, q)
  if (Math.abs(denominator) < 1e-8) return
  Cesium.Cartesian4.multiplyByScalar(clip, 2 / denominator, clip)
  const values = Cesium.Matrix4.toArray(projection)
  values[2] = clip.x
  values[6] = clip.y
  values[10] = clip.z + 1
  values[14] = clip.w
  Cesium.Matrix4.fromArray(values, 0, projection)
}
