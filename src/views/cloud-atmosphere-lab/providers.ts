import * as Cesium from 'cesium'
import { prepareCloudStartupShaders } from './startup-shaders'
import type { ShaderWarmupReport } from './shader-prewarm'
import type { CommunityResources } from './community-resources'
import { createCommunityResourceCache } from './community-resource-loader'
import type { LabState, ProviderId } from './url-state'
import { loadAtmosphereLUTs } from '../../vendor/cesium-geospatial/core/cesium/lutLoader'
import { createAtmosphereStage } from '../../vendor/cesium-geospatial/core/cesium/AtmosphereStage'
import { createCloudsStage } from '../../vendor/cesium-geospatial/clouds/createCloudsStage'
import { loadWeatherTextures } from '../../vendor/cesium-geospatial/clouds/weatherTextures'
import { applyCurrentPipelineSettings, buildCommunityCloudParameters, buildCommunityRenderSettings, buildCommunityPresentationSettings, buildCurrentAtmosphereSettings, buildCommunityAtmosphereSettings } from './provider-settings'
import { deferBuiltInToneMapping, viewerSnapshot } from './provider-render-state'
import { createLocalCumulusProvider } from './local-cumulus-provider'

export interface LabViewer { viewer: Cesium.Viewer }
export interface ProviderDiagnostic {
  provider: ProviderId
  status: 'loading' | 'initialized' | 'ready' | 'failed'
  detail: string
  renderError?: string
  width?: number
  height?: number
  temporalResolve?: boolean
  assetLoadMs?: number
  stageSetupMs?: number
  shaderWarmup?: ShaderWarmupReport
  resourceStats?: ReturnType<CommunityResources['stats']>
  groundShadowEnabled?: boolean
  groundShadowReady?: boolean
  shadowAnchor?: string
  historyReset?: string
  rebuildCount?: number
  renderTargetWidth?: number
  renderTargetHeight?: number
  stageReady?: boolean
  cloudVisible?: boolean
  staticSampleCount?: number
  atmosphereDebug?: number
  cloudVisibility?: number
  cloudRenderingActive?: boolean
}
export interface LabEffect { destroy(): void; update(state: LabState): void; diagnostic(): ProviderDiagnostic; isReady(): boolean; setAtmosphereDebug?(mode: 0 | 6 | 8 | 9 | 10 | 14): void }
export interface ProviderContext {
  viewer: Cesium.Viewer
  state: LabState
  signal: AbortSignal
  report(diagnostic: ProviderDiagnostic): void
  communityResources?: CommunityResources
}

interface CurrentPipeline {
  params: Record<string, any>
  cloudStage?: Cesium.PostProcessStage | null
  atmosphere?: {
    stage?: Cesium.PostProcessStage | null
    _exposureFollowTimeline?: boolean
    _atmosphereExposure?: number
  } | null
  aerial?: { stage?: Cesium.PostProcessStage | null; _surfaceShadowStrength?: number } | null
  init(): Promise<void>
  destroy(): void
}

const assetRoot = `${import.meta.env.BASE_URL}city-rendering/atmosphere`
// Both LUT consumers must use the same scene radiance calibration before ACES.
// This is a display calibration for Cesium's light units, not extra optical depth.
const COMMUNITY_RADIANCE_SCALE = 3
const errText = (error: unknown) => error instanceof Error ? error.message : String(error)

export function createBasicProvider(context: ProviderContext): LabEffect {
  const { viewer, report } = context
  // Recover a render loop disabled by a previous real scene.renderError before
  // snapshotting, so leaving basic mode cannot restore that stale failure state.
  viewer.useDefaultRenderLoop = true
  const restore = viewerSnapshot(viewer)
  const diagnostic: ProviderDiagnostic = { provider: 'basic', status: 'initialized', detail: 'Cesium 基础天空与椭球地球' }
  viewer.scene.globe.enableLighting = true
  viewer.scene.globe.depthTestAgainstTerrain = true
  viewer.scene.skyAtmosphere && (viewer.scene.skyAtmosphere.show = true)
  report(diagnostic)
  return { update: () => viewer.scene.requestRender(), diagnostic: () => diagnostic, isReady: () => true, destroy: restore }
}

export async function createCurrentProvider(context: ProviderContext): Promise<LabEffect> {
  const { viewer, state, signal, report } = context
  const restore = viewerSnapshot(viewer)
  const diagnostic: ProviderDiagnostic = { provider: 'current', status: 'loading', detail: '加载当前仓库 ThreeGeospatialPipeline 本地资产' }
  report(diagnostic)
  let pipeline: CurrentPipeline | undefined
  let finalTone: Cesium.PostProcessStage | undefined
  let removeTone: () => void = () => undefined
  try {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    const module = await import(
      // @ts-expect-error vendored JS module has no declaration file
      '../../vendor/cesium-clouds-atmosphere/ThreeGeospatialPipeline.js'
    )
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    const activePipeline = new module.ThreeGeospatialPipeline(viewer, {
      cloudsAssetsBase: `${assetRoot}/clouds-assets/`,
      atmosphereAssetsBase: `${assetRoot}/lut/`,
      atmosphereShaderBase: `${assetRoot}/shaders/`,
      brunetonShaderBase: `${assetRoot}/shaders/bruneton/`,
      blueNoiseUrl: `${assetRoot}/blue-noise.png`,
      cloudShadowSize: 512,
      separateCloudComposite: true,
    })
    pipeline = activePipeline
    applyCurrentPipelineSettings(activePipeline.params, state)
    viewer.scene.globe.depthTestAgainstTerrain = true
    viewer.scene.skyAtmosphere && (viewer.scene.skyAtmosphere.show = false)
    viewer.scene.highDynamicRange = viewer.scene.highDynamicRangeSupported
    removeTone = deferBuiltInToneMapping(viewer.scene)
    await activePipeline.init()
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    const atmosphereSettings = buildCurrentAtmosphereSettings(state)
    if (activePipeline.atmosphere) {
      activePipeline.atmosphere._exposureFollowTimeline = atmosphereSettings.exposureFollowTimeline
      activePipeline.atmosphere._atmosphereExposure = atmosphereSettings.atmosphereExposure
    }
    if (activePipeline.aerial) activePipeline.aerial._surfaceShadowStrength = atmosphereSettings.aerialSurfaceShadowStrength
    finalTone = new Cesium.PostProcessStage({
      name: 'CloudLabCurrentFinalToneMapping',
      fragmentShader: `uniform sampler2D colorTexture;
        uniform float u_exposure;
        in vec2 v_textureCoordinates;
        void main() {
          vec4 sampleColor = texture(colorTexture, v_textureCoordinates);
          vec3 color = czm_pbrNeutralTonemapping(max(sampleColor.rgb, vec3(0.0)) * u_exposure);
          out_FragColor = vec4(czm_inverseGamma(color), sampleColor.a);
        }`,
      uniforms: { u_exposure: atmosphereSettings.finalExposure },
    })
    viewer.scene.postProcessStages.add(finalTone)
    diagnostic.status = 'initialized'
    diagnostic.detail = '旧实现固定采用 0.75 倍渲染尺度；两个档位只改变步数，TAA 保持关闭；等待真实首帧渲染'
    diagnostic.temporalResolve = false
    diagnostic.cloudVisible = Boolean(activePipeline.cloudStage)
    diagnostic.stageReady = Boolean(activePipeline.cloudStage?.ready && finalTone.ready)
    diagnostic.width = Math.ceil((viewer.scene as unknown as { context: Cesium.Context & { drawingBufferWidth: number; drawingBufferHeight: number } }).context.drawingBufferWidth * (activePipeline.cloudStage?.textureScale ?? 0.75))
    diagnostic.height = Math.ceil((viewer.scene as unknown as { context: Cesium.Context & { drawingBufferWidth: number; drawingBufferHeight: number } }).context.drawingBufferHeight * (activePipeline.cloudStage?.textureScale ?? 0.75))
    report(diagnostic)
  } catch (error) {
    safeCleanup([() => { if (finalTone && !finalTone.isDestroyed()) viewer.scene.postProcessStages.remove(finalTone) }, () => pipeline?.destroy(), removeTone, restore])
    diagnostic.status = 'failed'
    diagnostic.detail = errText(error)
    report(diagnostic)
    throw error
  }
  let destroyed = false
  return {
    update(next) {
      if (!pipeline) return
      applyCurrentPipelineSettings(pipeline.params, next)
      if (finalTone) finalTone.uniforms.u_exposure = next.exposure
      viewer.scene.requestRender()
    },
    diagnostic: () => diagnostic,
    isReady() {
      diagnostic.stageReady = Boolean(pipeline?.cloudStage?.ready && finalTone?.ready)
      diagnostic.cloudVisible = Boolean(pipeline?.params.cloudsVisible && pipeline?.cloudStage?.enabled)
      const context = (viewer.scene as unknown as { context: { drawingBufferWidth: number; drawingBufferHeight: number } }).context
      const scale = pipeline?.cloudStage?.textureScale ?? 0.75
      diagnostic.width = Math.ceil(context.drawingBufferWidth * scale)
      diagnostic.height = Math.ceil(context.drawingBufferHeight * scale)
      return diagnostic.stageReady
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      safeCleanup([() => { if (finalTone && !finalTone.isDestroyed()) viewer.scene.postProcessStages.remove(finalTone) }, () => pipeline?.destroy(), removeTone, restore])
    },
  }
}

export async function createCommunityProvider(context: ProviderContext): Promise<LabEffect> {
  const { viewer, state, signal, report } = context
  const restore = viewerSnapshot(viewer)
  const diagnostic: ProviderDiagnostic = { provider: 'community', status: 'loading', detail: '加载 pinned cesium-geospatial 本地 LUT、shape、STBN 和 weather 图' }
  report(diagnostic)
  let luts: Awaited<ReturnType<typeof loadAtmosphereLUTs>> | undefined
  let weather: Awaited<ReturnType<typeof loadWeatherTextures>> | undefined
  let atmosphere: ReturnType<typeof createAtmosphereStage> | undefined
  let clouds: ReturnType<typeof createCloudsStage> | undefined
  let removeTone: () => void = () => undefined
  const startedAt = performance.now()
  let liveState = { ...state }
  const ownsResources = !context.communityResources
  const resources = context.communityResources ?? createCommunityResourceCache(viewer)
  // Freeze the same density field across lighting presets. Only the Cesium
  // clock drives celestial lighting; this independent clock drives weather.
  const weatherEpoch = Cesium.JulianDate.fromDate(new Date(Date.UTC(2024, 5, 21, 6)))
  const weatherTime = new Cesium.JulianDate()
  try {
    const context3d = (viewer.scene as unknown as { context: Cesium.Context }).context
    const prepared = await resources.get(state.shapeMipmaps || state.cloudSampling === 'filtered', signal)
    luts = prepared.luts
    weather = prepared.weather
    diagnostic.assetLoadMs = performance.now() - startedAt
    diagnostic.resourceStats = resources.stats()
    const stageStartedAt = performance.now()
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    viewer.scene.globe.depthTestAgainstTerrain = true
    viewer.scene.highDynamicRange = viewer.scene.highDynamicRangeSupported
    removeTone = deferBuiltInToneMapping(viewer.scene)
    atmosphere = createAtmosphereStage(viewer.scene, luts, {
      moon: false, moonSurfaceTexture: undefined, lensFlare: false, depthTemporal: false,
      exposureFollowTimeline: false, exposure: state.exposure,
      // Keep optical depth physical and opaque lighting intact; calibrate LUT
      // radiance consistently with the cloud pass before the shared tone mapper.
      distanceScale: 1, inscatterScale: COMMUNITY_RADIANCE_SCALE, groundDim: 1,
      ...buildCommunityAtmosphereSettings(state),
      cloudsShadowBridge: () => clouds?.getGroundShadowBridgeData(),
      limbGlowIntensity: 0.3,
    })
    atmosphere.atmosphereStage.enabled = false
    const renderSettings = buildCommunityRenderSettings(state)
    diagnostic.shaderWarmup = await prepareCloudStartupShaders(viewer.scene, renderSettings, atmosphere.atmosphereStage.fragmentShader, signal)
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    atmosphere.atmosphereStage.enabled = true
    viewer.scene.skyAtmosphere && (viewer.scene.skyAtmosphere.show = false)
    // The LUT pass owns atmospheric transport. Keep Cesium's fog culling, but
    // avoid rendering a second fog/ground-atmosphere contribution underneath it.
    viewer.scene.globe.showGroundAtmosphere = false
    viewer.scene.fog.renderable = false
    const renderTarget = context3d as Cesium.Context & { drawingBufferWidth: number; drawingBufferHeight: number }
    clouds = createCloudsStage(viewer.scene, luts, weather, {
      clouds: true,
      ...renderSettings,
      ...buildCommunityPresentationSettings(state),
      shadowPass: true,
      shadowAnchor: 'world',
      shadowTemporal: false,
      shadowUpdateIntervalMs: 100,
      // Upstream optional spatial filter corrupts the viewport on Cesium 1.132.
      // Temporal accumulation is verified independently; keep the spatial pass disabled.
      spatialDespeckle: 0,
      debugShow: state.communityDebug === 'classify' || state.communityDebug === 'alpha' || state.communityDebug === 'alphaTemporal' || state.communityDebug === 'fullTemporal' || state.communityDebug === 'raw' ? undefined : state.communityDebug ?? undefined,
      overlayDebug: state.communityDebug === 'classify' ? 2 : state.communityDebug === 'alpha' || state.communityDebug === 'alphaTemporal' ? 1 : 0,
      weatherTimeSource: () => {
        const elapsed = liveState.animated ? (performance.now() - startedAt) / 1000 : 0
        return Cesium.JulianDate.addSeconds(weatherEpoch, elapsed, weatherTime)
      },
      cloudsOverlayExposure: state.exposure * COMMUNITY_RADIANCE_SCALE,
      parameters: buildCommunityCloudParameters(state),
    })
    if (!clouds) throw new Error('candidate cloud stage was not created')
    atmosphere.insertStageBeforeLensFlare(clouds.overlayStage)
    atmosphere.atmosphereStage.uniforms.exposure = () => liveState.exposure
    atmosphere.atmosphereStage.uniforms.u_groundShadowStrength = () => liveState.cloudShadows ? 0.7 : 0
    clouds.overlayStage.uniforms.u_cloudsExposure = () => liveState.exposure * COMMUNITY_RADIANCE_SCALE
    diagnostic.stageSetupMs = performance.now() - stageStartedAt
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    diagnostic.status = 'initialized'
    diagnostic.detail = `AtmosphereStage 与 world-anchor BSM 已挂载；shape mipmaps ${state.shapeMipmaps || state.cloudSampling === 'filtered' ? '启用' : '关闭'}；云形 ${state.cloudForm}${state.communityDebug ? `；云诊断 ${state.communityDebug}` : ''}；等待真实首帧渲染`
    diagnostic.renderTargetWidth = renderTarget.drawingBufferWidth
    diagnostic.renderTargetHeight = renderTarget.drawingBufferHeight
    diagnostic.width = clouds.cloudsPass.marchWidth
    diagnostic.height = clouds.cloudsPass.marchHeight
    diagnostic.temporalResolve = renderSettings.temporal
    diagnostic.shadowAnchor = 'world'
    diagnostic.groundShadowEnabled = state.cloudShadows
    diagnostic.cloudVisible = true
    diagnostic.stageReady = false
    report(diagnostic)
  } catch (error) {
    safeCleanup([() => clouds?.destroy(), () => atmosphere?.destroy(), () => { if (ownsResources) resources.destroy() }, removeTone, restore])
    diagnostic.status = 'failed'
    diagnostic.detail = errText(error)
    report(diagnostic)
    throw error
  }
  let destroyed = false
  return {
    update(next) {
      liveState = { ...next }
      diagnostic.groundShadowEnabled = next.cloudShadows
      viewer.scene.requestRender()
    },
    diagnostic: () => diagnostic,
    setAtmosphereDebug(mode) {
      if (!atmosphere || !clouds) return
      atmosphere.atmosphereStage.uniforms.u_debugMode = mode
      atmosphere.tonemapStage.uniforms.u_debugMode = mode
      clouds.overlayStage.enabled = mode === 0
      diagnostic.atmosphereDebug = mode
      viewer.scene.requestRender()
    },
    isReady() {
      diagnostic.stageReady = Boolean(atmosphere?.atmosphereStage.ready && clouds?.overlayStage.ready)
      diagnostic.cloudVisibility = clouds?.visibility ?? 0
      diagnostic.cloudRenderingActive = clouds?.renderingActive ?? false
      diagnostic.cloudVisible = Boolean(clouds?.overlayStage.enabled && diagnostic.cloudVisibility > 0)
      diagnostic.staticSampleCount = clouds?.staticSampleCount ?? -1
      diagnostic.groundShadowReady = Boolean(clouds?.getGroundShadowBridgeData()?.bsm)
      return diagnostic.stageReady
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      safeCleanup([() => clouds?.destroy(), () => atmosphere?.destroy(), () => { if (ownsResources) resources.destroy() }, removeTone, restore])
    },
  }
}

function safeCleanup(cleanups: Array<() => void>): void {
  for (const cleanup of cleanups) {
    try { cleanup() } catch (error) { console.error('[cloud-atmosphere-lab] cleanup failed', error) }
  }
}


export { createLocalCumulusProvider }






