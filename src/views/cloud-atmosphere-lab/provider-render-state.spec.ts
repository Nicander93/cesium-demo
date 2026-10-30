import type * as Cesium from 'cesium'
import { describe, expect, it, vi } from 'vitest'
import { deferBuiltInToneMapping, viewerSnapshot } from './provider-render-state'

describe('provider render ownership', () => {
  it.each([true, false])('restores the previous atmosphere and fog flags (%s)', (enabled) => {
    const scene = {
      highDynamicRange: false,
      globe: { depthTestAgainstTerrain: false, show: true, showGroundAtmosphere: enabled, enableLighting: true, shadows: 2 },
      skyAtmosphere: { show: true },
      fog: { enabled: true, renderable: enabled },
      requestRenderMode: true,
      requestRender: vi.fn(),
    }
    const viewer = { scene, useDefaultRenderLoop: true }
    const restore = viewerSnapshot(viewer as unknown as Cesium.Viewer)
    scene.globe.showGroundAtmosphere = !enabled
    scene.fog.renderable = !enabled
    scene.globe.show = false
    scene.skyAtmosphere.show = false
    scene.highDynamicRange = true
    viewer.useDefaultRenderLoop = false
    restore()
    restore()
    expect(scene.globe.showGroundAtmosphere).toBe(enabled)
    expect(scene.fog).toEqual({ enabled: true, renderable: enabled })
    expect(scene.globe.show).toBe(true)
    expect(scene.skyAtmosphere.show).toBe(true)
    expect(scene.highDynamicRange).toBe(false)
    expect(viewer.useDefaultRenderLoop).toBe(true)
    expect(scene.requestRender).toHaveBeenCalledTimes(1)
  })

  it('restores built-in tone mapping even when a post-process execution fails', () => {
    const tone = { enabled: true }
    const execute = vi.fn(() => {
      expect(tone.enabled).toBe(false)
      throw new Error('test draw failure')
    })
    const collection = { _tonemapping: tone, execute }
    const remove = deferBuiltInToneMapping({ postProcessStages: collection } as unknown as Cesium.Scene)
    expect(() => collection.execute()).toThrow('test draw failure')
    expect(tone.enabled).toBe(true)
    remove()
    expect(collection.execute).toBe(execute)
  })
})
