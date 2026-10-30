import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildVegetationGlb } from './instancing'
import { prepareVegetationAssets } from './asset-loader'
import type { Plant } from './planting'

function parseImages(glb: Uint8Array): string[] {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength)
  const length = view.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + length)).trim()) as { images: { uri: string }[] }
  return json.images.map(image => image.uri)
}

describe('shared vegetation texture preparation', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: () => Promise.resolve(new Blob(['texture'])),
    }))
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1024, height: 1024, close: vi.fn() }))
  })

  it('validates static assets once and embeds the same deployable URLs for every chunk', async () => {
    await prepareVegetationAssets('http://localhost:5173/cesium-demo/vegetation-lab/')
    const plants: Plant[] = [
      { id: 1, species: 'pine', x: -2, y: 1, z: 0, scale: 1, yaw: 0 },
      { id: 2, species: 'pine', x: 2, y: 1, z: 0, scale: 1, yaw: 1 },
    ]
    const first = parseImages(buildVegetationGlb(plants.slice(0, 1), -24, 24, 'near'))
    const second = parseImages(buildVegetationGlb(plants.slice(1), 24, 24, 'far'))
    expect(first).toEqual(second)
    expect(first).toEqual([
      'http://localhost:5173/cesium-demo/vegetation-lab/pine_tree_01/twig_basecolor_alpha_1k.png',
      'http://localhost:5173/cesium-demo/vegetation-lab/pine_tree_01/bark_diff_1k.jpg',
      'http://localhost:5173/cesium-demo/vegetation-lab/pine_tree_01/bark_nor_gl_1k.jpg',
    ])
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(createImageBitmap).toHaveBeenCalledTimes(3)
  })

  it('does not publish texture URLs when a texture fails validation', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      blob: () => Promise.resolve(new Blob()),
    } as Response)
    await expect(prepareVegetationAssets('http://localhost:5173/cesium-demo/vegetation-lab/')).rejects.toThrow('404')
  })
})
