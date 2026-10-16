import * as Cesium from 'cesium'

// Cesium 1.132 adapter. Private manager update/readiness/texture ownership access
// is confined here; no FrameState or GPU objects enter the public water API.
export class WaterEnvironment {
  private manager: any
  private material: Cesium.Material
  private camera: Cesium.Camera
  private scene: Cesium.Scene
  private position: Cesium.Cartesian3
  private destroyed = false
  private lightSignature = ''
  private lutFrame = -1
  private brdfTexture: unknown
  private updates = 0
  private generations = 0
  private error: string | null = null
  enabled = true
  atmosphere = true

  constructor(
    scene: Cesium.Scene,
    material: Cesium.Material,
    position: Cesium.Cartesian3,
  ) {
    this.scene = scene
    this.material = material
    this.camera = scene.camera
    this.position = Cesium.Cartesian3.clone(position)
    const version = (Cesium as unknown as { VERSION?: string }).VERSION
    if (!version || !/^1\.132(?:\.|$)/.test(version))
      throw new Error('Water environment adapter verified only on Cesium 1.132')
  }

  setPosition(position: Cesium.Cartesian3): void {
    Cesium.Cartesian3.clone(position, this.position)
  }

  update(frameState: any): void {
    if (
      this.destroyed ||
      !!this.error ||
      !this.enabled ||
      frameState.camera !== this.camera ||
      !frameState.passes.render ||
      frameState.mode !== Cesium.SceneMode.SCENE3D
    )
      return
    try {
      const generator = frameState.brdfLutGenerator
      if (typeof generator?.update !== 'function')
        throw new Error('Water BRDF lookup is unavailable')
      generator.update(frameState)
      if (generator.colorTexture) {
        this.brdfTexture = generator.colorTexture
        // Keep the Fabric input at DefaultImageId. Bind a borrowed scene texture
        // without transferring its ownership to the material update function.
        ;(
          this.material as unknown as { _textures: Record<string, unknown> }
        )._textures.waterBrdfLut = this.brdfTexture
      }
      if (generator.colorTexture && this.lutFrame < 0)
        this.lutFrame = frameState.frameNumber
      this.material.uniforms.waterBrdfReady =
        this.lutFrame >= 0 && frameState.frameNumber > this.lutFrame ? 1 : 0
      if (!this.atmosphere) {
        this.material.uniforms.waterEnvironmentReady = 0
        return
      }
      if (
        !Cesium.DynamicEnvironmentMapManager.isDynamicUpdateSupported(
          this.scene,
        )
      )
        throw new Error(
          'Dynamic atmosphere requires floating-point render targets',
        )
      this.manager ??= new Cesium.DynamicEnvironmentMapManager({
        mipmapLevels: 7,
        gamma: 1,
        brightness: 1,
        saturation: 1,
      })
      this.manager.position = this.position
      this.manager.atmosphereScatteringIntensity = Math.max(
        0,
        this.scene.light.intensity,
      )
      const light = frameState.context.uniformState.lightDirectionWC
      const color = this.scene.light.color
      const signature = [
        light.x,
        light.y,
        light.z,
        color.red,
        color.green,
        color.blue,
        this.scene.light.intensity,
      ]
        .map((v) => v.toFixed(5))
        .join(',')
      if (this.lightSignature && signature !== this.lightSignature)
        this.manager.reset()
      this.lightSignature = signature
      const wasDirty = this.manager._radianceMapDirty
      this.manager.update(frameState)
      if (wasDirty && !this.manager._radianceMapDirty) this.generations++
      const m = this.manager
      const ready =
        !!m.radianceCubeMap &&
        !m._radianceMapDirty &&
        !m._radianceCommandsDirty &&
        !m._convolutionsCommandsDirty &&
        !m._irradianceCommandDirty &&
        !m._irradianceTextureDirty &&
        !m._sphericalHarmonicCoefficientsDirty &&
        !m._radianceMapComputeCommands.some(Boolean) &&
        !m._convolutionComputeCommands.some(Boolean)
      this.material.uniforms.waterEnvironmentReady = ready ? 1 : 0
      if (ready) {
        // Cesium 1.132's samplerCube update destroys an existing CubeMap even
        // when passed the same object again. Leave the public input at DefaultCubeMapId.
        ;(
          this.material as unknown as { _textures: Record<string, unknown> }
        )._textures.waterEnvironmentMap = m.radianceCubeMap
        this.material.uniforms.waterEnvironmentMaxLod = m.maximumMipmapLevel - 1
        m.sphericalHarmonicCoefficients.forEach(
          (c: Cesium.Cartesian3, i: number) => {
            this.material.uniforms['waterSH' + i] = Cesium.Cartesian3.clone(
              c,
              this.material.uniforms['waterSH' + i],
            )
          },
        )
      } else this.scene.requestRender()
      this.updates++
      this.error = null
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
      this.material.uniforms.waterEnvironmentReady = 0
      // Leave the rest of the scene and the fallback material operational.
      this.atmosphere = false
    }
  }

  getDiagnostics() {
    return {
      environmentAvailable: this.material.uniforms.waterEnvironmentReady > 0,
      brdfAvailable: this.material.uniforms.waterBrdfReady > 0,
      environmentUpdates: this.updates,
      environmentGenerations: this.generations,
      environmentError: this.error,
    }
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    // The manager owns this shared cubemap; Material.destroy must not destroy it again.
    const textures = (
      this.material as unknown as { _textures: Record<string, unknown> }
    )._textures
    if (
      this.manager?.radianceCubeMap &&
      textures.waterEnvironmentMap === this.manager.radianceCubeMap
    )
      delete textures.waterEnvironmentMap
    if (this.brdfTexture && textures.waterBrdfLut === this.brdfTexture)
      delete textures.waterBrdfLut
    this.material.uniforms.waterBrdfLut = Cesium.Material.DefaultImageId
    this.material.uniforms.waterEnvironmentMap =
      Cesium.Material.DefaultCubeMapId
    this.material.uniforms.waterEnvironmentReady =
      this.material.uniforms.waterBrdfReady = 0
    this.manager?.destroy()
    this.manager = undefined
  }
}

/** Keep Scene defaults and borrowed environment textures out of Fabric destruction. */
export function protectWaterEnvironmentOwnership(
  material: Cesium.Material,
): Cesium.Material {
  const destroy = material.destroy
  material.destroy = function () {
    const textures = (this as unknown as { _textures: Record<string, unknown> })
      ._textures
    // Both slots are borrowed, including context.defaultCubeMap in legacy mode.
    // Cesium 1.132 exempts defaultTexture but not defaultCubeMap in Material.destroy.
    delete textures.waterEnvironmentMap
    delete textures.waterBrdfLut
    return destroy.call(this)
  }
  return material
}
