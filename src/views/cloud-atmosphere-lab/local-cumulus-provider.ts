import * as Cesium from 'cesium'
import { loadWeatherTextures } from '../../vendor/cesium-geospatial/clouds/weatherTextures'
import fragmentShader from './local-cumulus.frag?raw'
import type { LabEffect, ProviderContext, ProviderDiagnostic } from './providers'
import type { LabState } from './url-state'
import { deferBuiltInToneMapping, viewerSnapshot } from './provider-render-state'
import { resolveCloudsHdrDatatype } from '../../vendor/cesium-geospatial/clouds/CloudsPass'

const assetRoot = `${import.meta.env.BASE_URL}city-rendering/atmosphere/clouds-assets`
const errText = (error: unknown) => error instanceof Error ? error.message : String(error)

export async function createLocalCumulusProvider(context: ProviderContext): Promise<LabEffect> {
  const { viewer, report, signal } = context
  const restore = viewerSnapshot(viewer)
  const scene = viewer.scene
  const diagnostic: ProviderDiagnostic = { provider: 'local', status: 'loading', detail: '加载本地 shape/detail 3D 噪声；固定局部 ENU 云体，全分辨率无 TAA' }
  report(diagnostic)
  let textures: Awaited<ReturnType<typeof loadWeatherTextures>> | undefined
  let pass: Cesium.PostProcessStage | undefined
  let finalTone: Cesium.PostProcessStage | undefined
  let removeTone: () => void = () => undefined
  let destroyed = false
  const startedAt = performance.now()
  let state: LabState = { ...context.state }
  const context3d = (scene as unknown as { context: Cesium.Context }).context

  const destroyTexture = (texture: Cesium.Texture | Cesium.Texture3D | undefined) => {
    if (texture && !texture.isDestroyed()) texture.destroy()
  }
  const cleanup = () => {
    if (destroyed) return
    destroyed = true
    try { if (finalTone && !finalTone.isDestroyed()) scene.postProcessStages.remove(finalTone) } catch { /* stage removal is best-effort during failed construction */ }
    try { if (pass && !pass.isDestroyed()) scene.postProcessStages.remove(pass) } catch { /* stage removal is best-effort during failed construction */ }
    if (textures) {
      const ownedTextures = textures
      textures = undefined
      for (const texture of [ownedTextures.shape, ownedTextures.shapeDetail, ownedTextures.stbn, ownedTextures.localWeather]) {
        try { destroyTexture(texture) } catch { /* continue restoring other owned resources */ }
      }
    }
    try { removeTone() } catch { /* restore viewer state even if tone hook cleanup fails */ }
    try { restore() } catch { /* cleanup remains idempotent after partial restoration */ }
  }

  try {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    textures = await loadWeatherTextures(context3d, assetRoot, signal)
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    // Retain the loader's canonical R8 sampler3D assets; STBN/weather are deliberately unused
    // because this reference has no jitter or history.
    destroyTexture(textures.stbn)
    destroyTexture(textures.localWeather)

    scene.globe.depthTestAgainstTerrain = true
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = true
    scene.highDynamicRange = scene.highDynamicRangeSupported
    removeTone = deferBuiltInToneMapping(scene)
    const pixelDatatype = resolveCloudsHdrDatatype(scene)
    if (pixelDatatype === Cesium.PixelDatatype.UNSIGNED_BYTE) {
      diagnostic.detail = '当前 GPU 不支持可渲染浮点纹理；线性 HDR 中间结果会裁切到 8 bit'
      report(diagnostic)
    }
    pass = new Cesium.PostProcessStage({
      name: 'CloudLabLocalCumulusRaymarch',
      fragmentShader,
      pixelDatatype,
      uniforms: {
        u_shapeTexture: () => textures?.shape,
        u_detailTexture: () => textures?.shapeDetail,
        u_worldToEnu: () => localWorldToEnu,
        u_cameraPosition: () => viewer.camera.positionWC,
        u_windOffset: () => {
          const seconds = state.animated ? (performance.now() - startedAt) / 1000 : 0
          return new Cesium.Cartesian2(seconds * 9, seconds * 3)
        },
        u_cloudBaseM: () => state.cloudBaseM,
        u_cloudThicknessM: () => state.cloudThicknessM,
        u_coverage: () => state.coverage,
        u_viewSteps: () => state.quality === 'reference' ? 256 : 144,
      },
    })
    scene.postProcessStages.add(pass)
    finalTone = new Cesium.PostProcessStage({
      name: 'CloudLabLocalFinalToneMapping',
      fragmentShader: `uniform sampler2D colorTexture;
        uniform float u_exposure;
        in vec2 v_textureCoordinates;
        void main() {
          vec4 sampleColor = texture(colorTexture, v_textureCoordinates);
          vec3 color = czm_pbrNeutralTonemapping(max(sampleColor.rgb, vec3(0.0)) * u_exposure);
          out_FragColor = vec4(czm_inverseGamma(color), sampleColor.a);
        }`,
      uniforms: { u_exposure: () => state.exposure },
    })
    scene.postProcessStages.add(finalTone)
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')

    const target = context3d as Cesium.Context & { drawingBufferWidth: number; drawingBufferHeight: number }
    diagnostic.status = 'initialized'
    diagnostic.detail = `局部积云 ENU 参考 · ${state.quality === 'reference' ? 256 : 144} 固定步 · 无 TAA/jitter · HDR ${pixelDatatype === Cesium.PixelDatatype.UNSIGNED_BYTE ? '8-bit fallback' : pixelDatatype === Cesium.PixelDatatype.HALF_FLOAT ? 'half-float' : 'float'} · 等待首帧`
    diagnostic.width = target.drawingBufferWidth
    diagnostic.height = target.drawingBufferHeight
    diagnostic.renderTargetWidth = target.drawingBufferWidth
    diagnostic.renderTargetHeight = target.drawingBufferHeight
    diagnostic.temporalResolve = false
    diagnostic.cloudVisible = true
    report(diagnostic)
  } catch (error) {
    cleanup()
    diagnostic.status = 'failed'
    diagnostic.detail = errText(error)
    report(diagnostic)
    throw error
  }

  return {
    update(next) {
      state = { ...next }
      diagnostic.detail = `局部积云 ENU 参考 · ${state.quality === 'reference' ? 256 : 144} 固定步 · 无 TAA/jitter`
      viewer.scene.requestRender()
    },
    diagnostic: () => diagnostic,
    isReady() {
      diagnostic.stageReady = Boolean(pass?.ready && finalTone?.ready)
      return diagnostic.stageReady
    },
    destroy: cleanup,
  }
}

const anchor = Cesium.Cartesian3.fromDegrees(119.0317, 33.5921, 0)
const enuToWorld = Cesium.Transforms.eastNorthUpToFixedFrame(anchor)
const localWorldToEnu = Cesium.Matrix4.inverseTransformation(enuToWorld, new Cesium.Matrix4())
