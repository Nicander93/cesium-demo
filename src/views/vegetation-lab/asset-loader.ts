import { setPineTextureUris } from './instancing'

const textureFiles = [
  'twig_basecolor_alpha_1k.png',
  'bark_diff_1k.jpg',
  'bark_nor_gl_1k.jpg',
] as const

/** Validate shared static textures once before the first terrain planting chunk is built. */
export async function prepareVegetationAssets(baseUrl: string): Promise<void> {
  const root = baseUrl.endsWith('/') ? `${baseUrl}pine_tree_01/` : `${baseUrl}/pine_tree_01/`
  const urls = textureFiles.map(file => new URL(file, root).href)
  const results = await Promise.allSettled(urls.map(async url => {
    const response = await fetch(url, { mode: 'cors' })
    if (!response.ok) throw new Error(`植被纹理加载失败（${response.status}）：${url}`)
    const bitmap = await createImageBitmap(await response.blob())
    if (bitmap.width !== 1024 || bitmap.height !== 1024) {
      bitmap.close()
      throw new Error(`植被纹理必须是 1024 × 1024：${url}`)
    }
    return bitmap
  }))
  for (const result of results) if (result.status === 'fulfilled') result.value.close()
  const failure = results.find(result => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
  setPineTextureUris({ canopy: urls[0]!, bark: urls[1]!, barkNormal: urls[2]! })
}

