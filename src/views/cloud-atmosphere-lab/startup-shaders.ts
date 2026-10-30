import { DerivedCommand, ShaderProgram, ShaderSource, VERSION, type Context, type DrawCommand, type Scene } from 'cesium'
import { buildCloudsMainFragmentShader, buildCloudsMainVertexShader } from '../../vendor/cesium-geospatial/clouds/CloudsMaterial'
import { buildCloudsResolveFragmentShader } from '../../vendor/cesium-geospatial/clouds/CloudsResolveMaterial'
import { buildCloudsShadowFragmentShader } from '../../vendor/cesium-geospatial/clouds/ShadowMaterial'
import { buildStandaloneWeatherBakeShader } from '../../vendor/cesium-geospatial/clouds/weatherBakeAssembler'
import { bridgeBakeShaderForDrawPass } from '../../vendor/cesium-geospatial/clouds/WeatherAtlas'
import { applyQualityPreset } from '../../vendor/cesium-geospatial/clouds/qualityPresets'
import { buildCloudResolveLayout } from '../../vendor/cesium-geospatial/clouds/cloudResolveLayout'
import type { buildCommunityRenderSettings } from './provider-settings'
import { prewarmShaders, type ShaderWarmupReport, type StartupShaderProgram } from './shader-prewarm'

interface PreparedShader {
  _vertexShaderText: string
  _fragmentShaderText: string
  _attributeLocations: Record<string, number>
  destroy(): void
}

/** Cesium 1.132 adapter: obtain its final source without initializing a GL program. */
export async function prepareCloudStartupShaders(
  scene: Scene,
  settings: ReturnType<typeof buildCommunityRenderSettings>,
  atmosphereFragment: string,
  signal: AbortSignal,
): Promise<ShaderWarmupReport> {
  if (VERSION !== '1.132' || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    return { status: 'unavailable', durationMs: 0 }
  }
  const started = performance.now()
  try {
    const context = (scene as unknown as { context: Context }).context
    const bridge = context as unknown as {
      createViewportQuadCommand(source: string | ShaderSource): DrawCommand
      drawingBufferWidth: number; drawingBufferHeight: number
      halfFloatingPointTexture: boolean; colorBufferHalfFloat: boolean
      floatingPointTexture: boolean; colorBufferFloat: boolean
    }
    const pixelType = bridge.halfFloatingPointTexture && bridge.colorBufferHalfFloat ? 'half'
      : bridge.floatingPointTexture && bridge.colorBufferFloat ? 'float' : 'byte'
    const programs: StartupShaderProgram[] = []
    function capture(name: string, fragment: string | ShaderSource, colorAttachments: number,
      type: StartupShaderProgram['pixelType'], vertex?: string, derived = false) {
      let command = bridge.createViewportQuadCommand(fragment)
      if (vertex) {
        const original = command.shaderProgram as PreparedShader
        command.shaderProgram = ShaderProgram.fromCache({ context, vertexShaderSource: vertex,
          fragmentShaderSource: fragment as string, attributeLocations: { position: 0, textureCoordinates: 1 } })
        original.destroy()
      }
      const owner = command.shaderProgram as PreparedShader
      try {
        if (derived && scene.logarithmicDepthBuffer) command = DerivedCommand.createLogDepthCommand(command, context).command
        if (derived && scene.highDynamicRange) command = DerivedCommand.createHdrCommand(command, context).command
        const shader = command.shaderProgram as PreparedShader
        if (typeof shader._vertexShaderText !== 'string' || typeof shader._fragmentShaderText !== 'string') throw new Error('Shader source adapter unavailable')
        programs.push({ name, vertexSource: shader._vertexShaderText, fragmentSource: shader._fragmentShaderText,
          attributes: shader._attributeLocations, colorAttachments, pixelType: type })
      } finally { owner.destroy() }
    }
    const quality = applyQualityPreset(settings.quality, settings)
    const resolveLayout = buildCloudResolveLayout(bridge.drawingBufferWidth, bridge.drawingBufferHeight,
      quality.upscaleDivisor, settings.temporalOutputDivisor)
    const main = { ...settings, ...quality.main, shadowSampleCount: quality.groundShadowSamples,
      upscaleDivisor: quality.upscaleDivisor, samplePhaseCount: resolveLayout.upscaleDivisor ** 2 }
    capture('weather', bridgeBakeShaderForDrawPass(buildStandaloneWeatherBakeShader()), 1, 'byte')
    capture('shadow', buildCloudsShadowFragmentShader({ shapeDetail: quality.main.shapeDetail,
      turbulence: quality.main.turbulence, cascadeCount: quality.shadow.cascadeCount, temporalPass: false }), 1, pixelType)
    capture('cloud', buildCloudsMainFragmentShader(main), settings.lightShafts ? 3 : 2, pixelType, buildCloudsMainVertexShader(main), true)
    if (settings.temporal) capture('resolve', buildCloudsResolveFragmentShader({ temporalUpscale: resolveLayout.upscaleDivisor > 1,
      upscaleDivisor: resolveLayout.upscaleDivisor, spatialDespeckle: false }), 1, pixelType, undefined, true)
    capture('atmosphere', new ShaderSource({ defines: [scene.logarithmicDepthBuffer ? 'LOG_DEPTH' : ''], sources: [atmosphereFragment] }), 1, pixelType)
    return await prewarmShaders(programs, signal)
  } catch (error) {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    return { status: 'failed', durationMs: performance.now() - started, detail: String(error) }
  }
}
