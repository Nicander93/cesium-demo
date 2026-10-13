import * as Cesium from 'cesium'
import { describe, expect, it, vi } from 'vitest'

interface TextureInput {
  width: number
  height: number
  flipY?: boolean
  source: { arrayBufferView: Float32Array }
}

describe('precomputed atmosphere texture orientation', () => {
  it('uploads the lower atmosphere row first without Cesium default Y-flipping', async () => {
    const uploads: TextureInput[] = []
    // Two rows with distinguishable irradiance. Cesium would flip these by default.
    const half = new Uint16Array([
      0x3400, 0x3800, 0x3a00, 0x3c00, 0x3c00, 0x3c00, 0x3c00, 0x3c00,
    ])
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => half.buffer })),
    )
    class Texture {
      constructor(options: TextureInput) {
        uploads.push(options)
      }
    }
    try {
      const module = await import(
        // @ts-expect-error The pinned texture loader is JavaScript.
        '../../vendor/cesium-clouds-atmosphere/AtmosphereFromThreeGeospatial/PrecomputedTexturesLoader.js'
      )
      await module.loadPrecomputedTextures(
        '/lut/',
        {},
        { ...Cesium, Texture, Texture3D: Texture },
      )
      expect(uploads).toHaveLength(5)
      for (const upload of uploads) {
        expect(upload.flipY).toBe(false)
        expect(Array.from(upload.source.arrayBufferView.slice(0, 4))).toEqual([
          0.25, 0.5, 0.75, 1,
        ])
      }
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
