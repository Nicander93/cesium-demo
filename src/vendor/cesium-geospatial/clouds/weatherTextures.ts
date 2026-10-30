// weatherTextures.ts — 体积云 weather 噪声纹理加载（M1 T9）
//
// 搬 three-geospatial clouds assets（spec §6 M1 T9）：
//   shape.bin        R8 Uint8 128³（云形状噪声，2MB = 128³×1 byte）
//   shape_detail.bin R8 Uint8 32³（细节噪声，32KB = 32³×1 byte）
//   local_weather.png 2D 512²（LocalWeather size=512；M2 实现 PNG decode + Texture 2D）
//
// format/dimensions 推算自 three 版 CLOUD_SHAPE_TEXTURE_SIZE + 文件大小，M2 云 shader 实际采样时
// 校准（PixelFormat.RED 单通道，WebGL2 sampler3D 采 .r）。three 版还有 procedural 版（CloudShape.ts
// GPU 运行时生成 perlin），本项目 M1 用预计算资产最简，procedural 留作后续优化。
import {
  Texture3D,
  Texture,
  PixelFormat,
  PixelDatatype,
  Sampler,
  TextureWrap,
  TextureMinificationFilter,
  TextureMagnificationFilter
} from 'cesium'
import type { Context } from 'cesium'
import { createWithResourceScope } from '../core/resourceScope'

// 3D 噪声采样 wrap 必须 REPEAT：shapePosition = position×shapeRepeat 是大值循环采样（fract），
// Cesium Sampler 默认 CLAMP_TO_EDGE 会把采样钉在纹理边缘 → 云噪声退化为常数/条纹（实测 2026-08-14）。
// three 版 Data3DTexture 用 RepeatWrapping 等价。
const WEATHER_SAMPLER = new Sampler({
  wrapS: TextureWrap.REPEAT,
  wrapT: TextureWrap.REPEAT,
  wrapR: TextureWrap.REPEAT,
  minificationFilter: TextureMinificationFilter.LINEAR,
  magnificationFilter: TextureMagnificationFilter.LINEAR
})

const WEATHER_MIPMAP_SAMPLER = new Sampler({
  wrapS: TextureWrap.REPEAT,
  wrapT: TextureWrap.REPEAT,
  wrapR: TextureWrap.REPEAT,
  minificationFilter: TextureMinificationFilter.LINEAR_MIPMAP_LINEAR,
  magnificationFilter: TextureMagnificationFilter.LINEAR
})

/** Build a complete box-filtered mip chain for a cubic, normalized R8 volume. */
export function buildR8VolumeMipLevels(source: Uint8Array, size: number): Uint8Array[] {
  if (!Number.isInteger(size) || size < 2 || (size & (size - 1)) !== 0 || source.length !== size ** 3) {
    throw new Error(`Expected a cubic power-of-two R8 volume; got ${size}³ with ${source.length} bytes`)
  }
  const levels: Uint8Array[] = []
  let previous = source
  let previousSize = size
  while (previousSize > 1) {
    const nextSize = previousSize >> 1
    const next = new Uint8Array(nextSize ** 3)
    for (let z = 0; z < nextSize; z++) {
      for (let y = 0; y < nextSize; y++) {
        for (let x = 0; x < nextSize; x++) {
          const index = (z * 2 * previousSize + y * 2) * previousSize + x * 2
          const sum = previous[index]! + previous[index + 1]!
            + previous[index + previousSize]! + previous[index + previousSize + 1]!
            + previous[index + previousSize * previousSize]! + previous[index + previousSize * previousSize + 1]!
            + previous[index + previousSize * previousSize + previousSize]! + previous[index + previousSize * previousSize + previousSize + 1]!
          next[(z * nextSize + y) * nextSize + x] = Math.round(sum / 8)
        }
      }
    }
    levels.push(next)
    previous = next
    previousSize = nextSize
  }
  return levels
}

// STBN（spatiotemporal blue noise）采样必须 NEAREST：蓝噪声的结构在纹素级，LINEAR 插值会把
// 高频误差能量抹平成中频 → 失去蓝噪声特性（人眼不敏感频段收敛）退化回灰雾。three 版
// STBNLoader 同用 NearestFilter + RepeatWrapping。
const STBN_SAMPLER = new Sampler({
  wrapS: TextureWrap.REPEAT,
  wrapT: TextureWrap.REPEAT,
  wrapR: TextureWrap.REPEAT,
  minificationFilter: TextureMinificationFilter.NEAREST,
  magnificationFilter: TextureMagnificationFilter.NEAREST
})

// local_weather 采样用 textureLod 显式 LOD（sampleWeather 按 mipLevel 降噪）——纹理必须
// generateMipmap 且 minFilter 用 mipmap 链，否则不完整纹理采样返回黑（coverage=0 → 无云）。
// three 版普通 Texture 默认 generateMipmaps=true + LinearMipmapLinearFilter 等价。
const LOCAL_WEATHER_SAMPLER = new Sampler({
  wrapS: TextureWrap.REPEAT,
  wrapT: TextureWrap.REPEAT,
  minificationFilter: TextureMinificationFilter.LINEAR_MIPMAP_LINEAR,
  magnificationFilter: TextureMagnificationFilter.LINEAR
})

export interface WeatherTextures {
  /** 云形状噪声 3D（R8 Uint8 128³）。 */
  shape: Texture3D
  /** 云细节噪声 3D（R8 Uint8 32³）。 */
  shapeDetail: Texture3D
  /** STBN 蓝噪声 3D（R8 Uint8 128×128×64，getSTBN march jitter 用；frame=0 静态采样 layer 0）。 */
  stbn: Texture3D
  /** local_weather 2D（RGBA Uint8 PNG；decode 失败时 loader 严格拒绝）。 */
  localWeather: Texture
  /**
   * local_weather.png 成功 decode 后的原始字节（T6）：供 WeatherAtlas 的 pngFallback 使用。
   * decode 失败会使 loader 拒绝，因此成功结果中总会提供此字段。
   */
  localWeatherRaw?: { width: number; height: number; data: Uint8Array }
}

const SHAPE_SIZE = 128
const SHAPE_DETAIL_SIZE = 32
const STBN_SIZE = 128
const STBN_DEPTH = 64

/**
 * PNG decode 为 RGBA 字节（createImageBitmap + OffscreenCanvas 2d，浏览器原生无依赖）。
 * local_weather.png 是 512² RGBA（RGBA 通道 = 4 层 packed coverage）。
 */
async function decodePngRgba(
  blob: Blob
): Promise<{ width: number; height: number; data: Uint8Array }> {
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d')
    if (ctx == null) throw new Error('OffscreenCanvas 2d context 不可用')
    ctx.drawImage(bitmap, 0, 0)
    const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
    return { width: img.width, height: img.height, data: new Uint8Array(img.data.buffer) }
  } finally {
    bitmap.close()
  }
}

/**
 * 加载 weather 纹理（shape + shapeDetail + stbn 3D + localWeather 2D PNG）。
 *
 * local_weather PNG decode 失败或浏览器缺少所需 API 时严格拒绝；不会生成白色 dummy，
 * 避免把 decode/资源问题伪装成有效云分布。已分配的 GPU 纹理会在拒绝前销毁。
 *
 * @param context Cesium Context
 * @param baseUrl weather 资产目录（shape.bin/shape_detail.bin/stbn.bin/local_weather.png）
 */
export async function loadWeatherTextures(
  context: Context,
  baseUrl: string,
  signal?: AbortSignal,
  options: { shapeMipmaps?: boolean } = {}
): Promise<WeatherTextures> {
  const [shapeBuf, detailBuf, stbnBuf, weatherPng] = await Promise.all([
    checkedFetch(`${baseUrl}/shape.bin`, signal).then((r) => r.arrayBuffer()),
    checkedFetch(`${baseUrl}/shape_detail.bin`, signal).then((r) => r.arrayBuffer()),
    checkedFetch(`${baseUrl}/stbn.bin`, signal).then((r) => r.arrayBuffer()),
    checkedFetch(`${baseUrl}/local_weather.png`, signal).then((r) => r.blob())
  ])
  if (shapeBuf.byteLength !== SHAPE_SIZE ** 3) throw new Error(`shape.bin size mismatch: ${shapeBuf.byteLength}`)
  if (detailBuf.byteLength !== SHAPE_DETAIL_SIZE ** 3) throw new Error(`shape_detail.bin size mismatch: ${detailBuf.byteLength}`)
  if (stbnBuf.byteLength !== STBN_SIZE * STBN_SIZE * STBN_DEPTH) throw new Error(`stbn.bin size mismatch: ${stbnBuf.byteLength}`)
  return createWithResourceScope(async (own) => {
    // shape/shape_detail: R8 Uint8 3D（推算 128³/32³；M2 云 shader 采样时校准）。
    // PixelFormat.RED 单通道（WebGL2），UNSIGNED_BYTE。
    const shape = own(new Texture3D({
      context,
      source: {
        width: SHAPE_SIZE,
        height: SHAPE_SIZE,
        depth: SHAPE_SIZE,
        arrayBufferView: new Uint8Array(shapeBuf),
        ...(options.shapeMipmaps ? { mipLevels: buildR8VolumeMipLevels(new Uint8Array(shapeBuf), SHAPE_SIZE) } : {})
      },
      pixelFormat: PixelFormat.RED,
      pixelDatatype: PixelDatatype.UNSIGNED_BYTE,
      sampler: options.shapeMipmaps ? WEATHER_MIPMAP_SAMPLER : WEATHER_SAMPLER,
      flipY: false
    }))
    const shapeDetail = own(new Texture3D({
      context,
      source: {
        width: SHAPE_DETAIL_SIZE,
        height: SHAPE_DETAIL_SIZE,
        depth: SHAPE_DETAIL_SIZE,
        arrayBufferView: new Uint8Array(detailBuf),
        ...(options.shapeMipmaps ? { mipLevels: buildR8VolumeMipLevels(new Uint8Array(detailBuf), SHAPE_DETAIL_SIZE) } : {})
      },
      pixelFormat: PixelFormat.RED,
      pixelDatatype: PixelDatatype.UNSIGNED_BYTE,
      sampler: options.shapeMipmaps ? WEATHER_MIPMAP_SAMPLER : WEATHER_SAMPLER,
      flipY: false
    }))
    // STBN sampling is nearest-filtered; white-noise substitution visibly degrades the march.
    const stbn = own(new Texture3D({
      context,
      source: {
        width: STBN_SIZE,
        height: STBN_SIZE,
        depth: STBN_DEPTH,
        arrayBufferView: new Uint8Array(stbnBuf)
      },
      pixelFormat: PixelFormat.RED,
      pixelDatatype: PixelDatatype.UNSIGNED_BYTE,
      sampler: STBN_SAMPLER,
      flipY: false
    }))

    const { width, height, data } = await decodePngRgba(weatherPng)
    const localWeatherRaw = { width, height, data }
    const localWeather = own(new Texture({
      context,
      source: { width, height, arrayBufferView: data },
      pixelFormat: PixelFormat.RGBA,
      pixelDatatype: PixelDatatype.UNSIGNED_BYTE,
      sampler: LOCAL_WEATHER_SAMPLER,
      flipY: true
    }))
    ;(localWeather as unknown as { generateMipmap: () => void }).generateMipmap()
    return { shape, shapeDetail, stbn, localWeather, localWeatherRaw }
  })
}

async function checkedFetch(url: string, signal?: AbortSignal): Promise<Response> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Asset request failed (${response.status}): ${url}`)
  return response
}




