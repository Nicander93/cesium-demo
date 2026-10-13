import * as Cesium from 'cesium'
import { describe, expect, it } from 'vitest'

interface ShaderContext {
  webgl2: boolean
  textureFloatLinear: boolean
  floatingPointTexture: boolean
}
interface ShaderAssembler {
  createCombinedFragmentShader: (context: ShaderContext) => string
}

describe('cloud shader assembly against Cesium 1.132', () => {
  it('injects both eye-coordinate overloads into the actual cloud shader', async () => {
    const { ThreeGeospatialPipeline } = await import(
      // @ts-expect-error The pinned vendor entry is JavaScript.
      '../../vendor/cesium-clouds-atmosphere/ThreeGeospatialPipeline.js'
    )
    const pipeline = new ThreeGeospatialPipeline({})
    pipeline.atmosphere = {
      getAtmosphereForClouds: () => ({
        constants: { getShaderDefines: () => '' },
      }),
    }
    const fragment = (await pipeline._buildCloudFragmentShader()) as string
    // ShaderSource is a runtime export; Cesium omits this private class from its public declarations.
    const { ShaderSource } = Cesium as unknown as {
      ShaderSource: new (options: {
        sources: string[]
        defines: string[]
      }) => ShaderAssembler
    }
    const source = new ShaderSource({
      sources: [fragment],
      defines: ['LOG_DEPTH_READ_ONLY'],
    })
    const context = {
      webgl2: true,
      textureFloatLinear: true,
      floatingPointTexture: true,
    }
    const combined = source.createCombinedFragmentShader(context)
    expect(combined).toMatch(/vec4\s+czm_windowToEyeCoordinates\(vec4/)
    expect(combined).toMatch(/vec4\s+czm_windowToEyeCoordinates\(vec2/)
    expect(combined).toContain('uv * czm_viewport.zw')
    expect(fragment).not.toContain('fakeDepthPlane')
    expect(fragment).not.toContain('czm_unpackDepth')
    expect(fragment).toContain('vec3 getCameraRay(vec2 uv)')
    expect(fragment).toContain(
      'u_rayInverseProjection * vec4(uv * 2.0 - 1.0, 0.0, 1.0)',
    )
    expect(fragment).toContain('end = min(end, begin + u_maxRayDistance)')
    expect(fragment).toContain(
      'if (end <= begin || second.z <= 0.0) return vec2(-1.0)',
    )
    expect(fragment).toContain('float stepSize = maxDist / sampleCount')
    expect(fragment).toContain('mix(0.5, getSTBN(), u_jitterStrength)')
    expect(fragment).not.toContain('u_minSecondaryStepSize / iterCount')
    expect(fragment).not.toContain('opticalDepth += sampleShadowOpticalDepth')
  })
})
