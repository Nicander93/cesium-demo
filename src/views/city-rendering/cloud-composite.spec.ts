import * as Cesium from 'cesium'
import { describe, expect, it } from 'vitest'
// @ts-expect-error The pinned vendor module is JavaScript.
import { createCloudComposite } from '../../vendor/cesium-clouds-atmosphere/cloud-composite.js'

describe('cloud composition preserves scene resolution', () => {
  it('routes the original scene and cloud buffer to a full-resolution merge', () => {
    const cloud = new Cesium.PostProcessStage({
      name: 'TestCloudBuffer',
      textureScale: 0.75,
      pixelDatatype: Cesium.PixelDatatype.HALF_FLOAT,
      fragmentShader: 'void main() { out_FragColor = vec4(0.0); }',
    })
    const composite = createCloudComposite(
      cloud,
    ) as Cesium.PostProcessStageComposite
    const merge = composite.get(1) as Cesium.PostProcessStage
    expect(composite.inputPreviousStageTexture).toBe(false)
    expect(composite.get(0)).toBe(cloud)
    expect(merge.textureScale).toBe(1)
    expect(merge.pixelDatatype).toBe(Cesium.PixelDatatype.HALF_FLOAT)
    expect(merge.uniforms.cloudTexture).toBe(cloud.name)
    composite.enabled = false
    expect(cloud.enabled).toBe(false)
    expect(merge.enabled).toBe(false)
    composite.enabled = true
    expect(cloud.enabled).toBe(true)
    expect(merge.enabled).toBe(true)
    composite.destroy()
    expect(cloud.isDestroyed()).toBe(true)
    expect(merge.isDestroyed()).toBe(true)
  })

  it('assembles the standalone cloud output used by the merge', async () => {
    const { ThreeGeospatialPipeline } = await import(
      // @ts-expect-error The pinned vendor entry is JavaScript.
      '../../vendor/cesium-clouds-atmosphere/ThreeGeospatialPipeline.js'
    )
    const pipeline = new ThreeGeospatialPipeline(
      {},
      { separateCloudComposite: true },
    )
    pipeline.atmosphere = {
      getAtmosphereForClouds: () => ({
        constants: { getShaderDefines: () => '' },
      }),
    }
    const fragment = await pipeline._buildCloudFragmentShader()
    expect(fragment).toContain('#define CLOUD_OUTPUT_ONLY')
    expect(fragment).toContain(
      '#ifdef CLOUD_OUTPUT_ONLY\n  sceneColor = vec4(0.0);',
    )
    expect(fragment).toContain('wdSum += rayDist * opacityWeight')
  })
})
