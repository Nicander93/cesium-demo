import * as Cesium from 'cesium'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../vendor/cesium-clouds-atmosphere/gl-state.js', () => ({
  withOffscreenState: (_gl: unknown, draw: () => unknown) => draw(),
}))

describe('cloud shadow frame ordering', () => {
  it('updates parameters before rendering and publishes the current frame together with its matrices', async () => {
    const { ThreeGeospatialPipeline } = await import(
      // @ts-expect-error The pinned vendor entry is JavaScript.
      '../../vendor/cesium-clouds-atmosphere/ThreeGeospatialPipeline.js'
    )
    const events: string[] = []
    const pipeline = new ThreeGeospatialPipeline({
      scene: { context: { _gl: {} } },
      camera: { positionCartographic: { height: 20 } },
    })
    const pass = {
      updateDynamicParams: () => events.push('parameters'),
      render: () => events.push('shadow'),
      getShadowIntervals: () => Array.from({ length: 4 }, () => [0, 1]),
      getShadowMatrices: () =>
        Array.from({ length: 4 }, () =>
          Cesium.Matrix4.toArray(Cesium.Matrix4.IDENTITY),
        ),
      getTileSize: () => 256,
      getShadowNear: () => 0.1,
      getShadowFar: () => 18000,
    }
    pipeline._bsm.pass = pass
    pipeline._bsm.resolve = { render: () => events.push('resolve') }
    pipeline._bsmResolveGetTexture = () => ({ _texture: {} })
    pipeline.atmosphere = {
      getAtmosphereForClouds: () => ({}),
      setCloudShadow: () => events.push('publish'),
    }
    pipeline._syncBSM()
    expect(events).toEqual(['parameters', 'shadow', 'resolve', 'publish'])

    events.length = 0
    pipeline.params.cloudsVisible = false
    pipeline._syncBSM()
    expect(events).toEqual(['publish'])
  })
})
