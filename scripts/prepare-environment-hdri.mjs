import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { FloatType } from 'three'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import {
  createDefaultContainer,
  read as readKtx2,
  write as writeKtx2,
} from 'ktx-parse'

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const output = path.join(repository, 'public/environment-lab')
const panoramaDirectory = path.join(output, 'panoramas')
const specularDirectory = path.join(output, 'specular')
const cache = path.resolve(
  process.env.ENVIRONMENT_HDR_CACHE_DIR ??
    path.join(homedir(), '.cache', 'cesium-demo', 'environment-lab-hdri'),
)

const licenses = {
  name: 'CC0 1.0 Universal',
  url: 'https://polyhaven.com/license',
  assets: 'https://polyhaven.com/a/',
}

const presets = [
  {
    key: 'day',
    assetId: 'kloofendal_48d_partly_cloudy_puresky',
    radianceScale: 2.0,
  },
  {
    key: 'sunset',
    assetId: 'industrial_sunset_02_puresky',
    radianceScale: 0.5,
  },
  { key: 'rain', assetId: 'overcast_soil_puresky', radianceScale: 0.5 },
]

const width = 128
const height = 128
const levelCount = Math.floor(Math.log2(width)) + 1
const filterSamples = 48
const panoramaRange = 32
const pillowScript = [
  'import json,sys',
  'import numpy as np',
  'from PIL import Image',
  'w,h,scale,limit=map(float,sys.argv[1:5]); w,h=int(w),int(h)',
  'hdr=np.frombuffer(sys.stdin.buffer.read(),dtype=np.float32).reshape((h,w,4))[:,:,:3].astype(np.float32)',
  'normalized=np.clip(hdr*scale,0,limit)',
  'display=np.power(normalized/(1.0+normalized),1.0/2.2)',
  'pixels=np.rint(display*255.0).astype(np.uint8)',
  'out=Image.fromarray(pixels,mode="RGB")',
  'out.save(sys.argv[5],format="JPEG",quality=96,subsampling=0,optimize=True)',
  'check=Image.open(sys.argv[5])',
  'print(json.dumps({"width":check.width,"height":check.height,"format":check.format,"bytes":__import__("os").path.getsize(sys.argv[5])}))',
].join(';')

const basis = [
  { scale: 0.282095, polynomial: (x, y, z) => 1, band: 1 },
  { scale: 0.488603, polynomial: (x, y, z) => y, band: 2 / 3 },
  { scale: 0.488603, polynomial: (x, y, z) => z, band: 2 / 3 },
  { scale: 0.488603, polynomial: (x, y, z) => x, band: 2 / 3 },
  { scale: 1.092548, polynomial: (x, y, z) => y * x, band: 1 / 4 },
  { scale: 1.092548, polynomial: (x, y, z) => y * z, band: 1 / 4 },
  { scale: 0.315392, polynomial: (x, y, z) => 3 * z * z - 1, band: 1 / 4 },
  { scale: 1.092548, polynomial: (x, y, z) => z * x, band: 1 / 4 },
  { scale: 0.546274, polynomial: (x, y, z) => x * x - y * y, band: 1 / 4 },
]

function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

function md5(data) {
  return createHash('md5').update(data).digest('hex')
}

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok)
    throw new Error(`Poly Haven returned HTTP ${response.status}: ${url}`)
  return response.json()
}

async function obtainSource(
  assetId,
  resolution,
  expectedWidth,
  expectedHeight,
) {
  const [fileList, info] = await Promise.all([
    getJson(`https://api.polyhaven.com/files/${assetId}`),
    getJson(`https://api.polyhaven.com/info/${assetId}`),
  ])
  const source = fileList.hdri?.[resolution]?.hdr
  if (!source?.url || !source?.md5 || !Number.isInteger(source.size)) {
    throw new Error(
      `Poly Haven did not provide the requested ${resolution} Radiance HDR: ${assetId}`,
    )
  }

  const filename = `${assetId}-${resolution}.hdr`
  const sourcePath = path.join(cache, filename)
  await mkdir(cache, { recursive: true })
  let bytes
  try {
    bytes = await readFile(sourcePath)
    if (bytes.length !== source.size || md5(bytes) !== source.md5.toLowerCase())
      bytes = undefined
  } catch {
    bytes = undefined
  }
  if (!bytes) {
    const response = await fetch(source.url, {
      signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok)
      throw new Error(
        `HDR download failed with HTTP ${response.status}: ${assetId} ${resolution}`,
      )
    bytes = Buffer.from(await response.arrayBuffer())
    if (
      bytes.length !== source.size ||
      md5(bytes) !== source.md5.toLowerCase()
    ) {
      throw new Error(
        `Downloaded HDR failed the Poly Haven size/MD5 check: ${assetId} ${resolution}`,
      )
    }
    await writeFile(sourcePath, bytes)
  }

  const data = new HDRLoader()
    .setDataType(FloatType)
    .parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    )
  if (
    !(data.data instanceof Float32Array) ||
    data.width !== expectedWidth ||
    data.height !== expectedHeight
  ) {
    throw new Error(
      `Expected a ${expectedWidth}×${expectedHeight} Float32 ${resolution} Radiance image for ${assetId}; got ${data.width}×${data.height}`,
    )
  }
  for (let i = 0; i < data.data.length; i += 4) {
    if (
      ![data.data[i], data.data[i + 1], data.data[i + 2]].every(Number.isFinite)
    ) {
      throw new Error(
        `Decoded HDR contains a non-finite pixel: ${assetId} ${resolution}`,
      )
    }
  }

  return {
    assetId,
    info,
    hdrBytes: bytes,
    hdr: data.data,
    width: data.width,
    height: data.height,
    sourcePath,
    file: source,
    resolution,
  }
}

function normalizeDirection([x, y, z]) {
  const magnitude = Math.hypot(x, y, z)
  if (!(magnitude > 0) || !Number.isFinite(magnitude))
    throw new Error('Environment direction is invalid')
  return [x / magnitude, y / magnitude, z / magnitude]
}

function radianceAt(hdr, imageWidth, imageHeight, direction, radianceScale) {
  const [x, y, z] = normalizeDirection(direction)
  const phi = Math.atan2(z, x)
  const u = (phi + Math.PI) / (Math.PI * 2)
  const v = Math.acos(Math.max(-1, Math.min(1, y))) / Math.PI
  const sx = u * imageWidth - 0.5
  const sy = v * imageHeight - 0.5
  const x0 = Math.floor(sx)
  const y0 = Math.max(0, Math.min(imageHeight - 1, Math.floor(sy)))
  const tx = sx - x0
  const ty = sy - Math.floor(sy)
  const xA = ((x0 % imageWidth) + imageWidth) % imageWidth
  const xB = (xA + 1) % imageWidth
  const yB = Math.min(imageHeight - 1, y0 + 1)
  const result = [0, 0, 0]
  for (let channel = 0; channel < 3; channel++) {
    const a =
      hdr[(y0 * imageWidth + xA) * 4 + channel] * (1 - tx) +
      hdr[(y0 * imageWidth + xB) * 4 + channel] * tx
    const b =
      hdr[(yB * imageWidth + xA) * 4 + channel] * (1 - tx) +
      hdr[(yB * imageWidth + xB) * 4 + channel] * tx
    result[channel] = Math.min(
      panoramaRange,
      Math.max(0, (a * (1 - ty) + b * ty) * radianceScale),
    )
  }
  return result
}

function radicalInverse(value) {
  let result = 0
  let scale = 0.5
  while (value > 0) {
    result += (value & 1) * scale
    scale *= 0.5
    value >>>= 1
  }
  return result
}

function add(a, b, scalar = 1) {
  return [a[0] + b[0] * scalar, a[1] + b[1] * scalar, a[2] + b[2] * scalar]
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function importanceSampleGgx(normal, roughness, sampleIndex, sampleCount) {
  const phi = (Math.PI * 2 * (sampleIndex + 0.5)) / sampleCount
  const xi = radicalInverse(sampleIndex)
  const alphaSquared = roughness ** 4
  const cosTheta = Math.sqrt((1 - xi) / (1 + (alphaSquared - 1) * xi))
  const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta))
  const axis = Math.abs(normal[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0]
  const tangent = normalizeDirection(cross(axis, normal))
  const bitangent = cross(normal, tangent)
  return normalizeDirection(
    add(
      add(
        normal.map((value) => value * cosTheta),
        tangent.map((value) => value * Math.cos(phi) * sinTheta),
      ),
      bitangent.map((value) => value * Math.sin(phi) * sinTheta),
    ),
  )
}

function prefilterDirection(hdr, iw, ih, normal, roughness, radianceScale) {
  if (roughness === 0) return radianceAt(hdr, iw, ih, normal, radianceScale)
  const total = [0, 0, 0]
  let totalWeight = 0
  for (let i = 0; i < filterSamples; i++) {
    const halfway = importanceSampleGgx(normal, roughness, i, filterSamples)
    const normalHalfway = dot(normal, halfway)
    const light = normalizeDirection([
      2 * normalHalfway * halfway[0] - normal[0],
      2 * normalHalfway * halfway[1] - normal[1],
      2 * normalHalfway * halfway[2] - normal[2],
    ])
    const weight = Math.max(0, dot(normal, light))
    if (weight === 0) continue
    const sample = radianceAt(hdr, iw, ih, light, radianceScale)
    for (let channel = 0; channel < 3; channel++)
      total[channel] += sample[channel] * weight
    totalWeight += weight
  }
  return totalWeight > 0
    ? total.map((value) => value / totalWeight)
    : radianceAt(hdr, iw, ih, normal, radianceScale)
}

function cubemapDirection(face, u, v) {
  const faces = [
    [1, -v, -u],
    [-1, -v, u],
    [u, 1, v],
    [u, -1, -v],
    [u, -v, 1],
    [-u, -v, -1],
  ]
  return normalizeDirection(faces[face])
}

function buildSphericalHarmonics(hdr, iw, ih, radianceScale) {
  const coefficients = Array.from({ length: 9 }, () => [0, 0, 0])
  const deltaPhi = (Math.PI * 2) / iw
  for (let row = 0; row < ih; row++) {
    const theta0 = (Math.PI * row) / ih
    const theta1 = (Math.PI * (row + 1)) / ih
    const theta = (Math.PI * (row + 0.5)) / ih
    const solidAngle = deltaPhi * (Math.cos(theta0) - Math.cos(theta1))
    const sinTheta = Math.sin(theta)
    const y = Math.cos(theta)
    for (let column = 0; column < iw; column++) {
      const phi = (Math.PI * 2 * (column + 0.5)) / iw - Math.PI
      const x = Math.cos(phi) * sinTheta
      const z = Math.sin(phi) * sinTheta
      const pixel = (row * iw + column) * 4
      const color = [
        Math.min(panoramaRange, Math.max(0, hdr[pixel] * radianceScale)),
        Math.min(panoramaRange, Math.max(0, hdr[pixel + 1] * radianceScale)),
        Math.min(panoramaRange, Math.max(0, hdr[pixel + 2] * radianceScale)),
      ]
      for (let term = 0; term < 9; term++) {
        const contribution =
          basis[term].scale ** 2 *
          basis[term].band *
          basis[term].polynomial(x, y, z) *
          solidAngle
        for (let channel = 0; channel < 3; channel++)
          coefficients[term][channel] += color[channel] * contribution
      }
    }
  }
  return coefficients
}

function estimateSunDirection(hdr, iw, ih, radianceScale) {
  const sampleStride = Math.max(1, Math.floor((iw * ih) / 250_000))
  const sampledLuminance = []
  let maximum = 0
  for (let pixel = 0; pixel < iw * ih; pixel += sampleStride) {
    const index = pixel * 4
    const luminance =
      (hdr[index] * 0.2126 +
        hdr[index + 1] * 0.7152 +
        hdr[index + 2] * 0.0722) *
      radianceScale
    if (Number.isFinite(luminance)) {
      sampledLuminance.push(luminance)
      maximum = Math.max(maximum, luminance)
    }
  }
  sampledLuminance.sort((a, b) => a - b)
  const percentile =
    sampledLuminance[Math.floor(sampledLuminance.length * 0.999)] ?? maximum
  const threshold = Math.max(percentile, maximum * 0.55)
  let vector = [0, 0, 0]
  let totalWeight = 0
  for (let row = 0; row < ih; row++) {
    const theta = (Math.PI * (row + 0.5)) / ih
    const sinTheta = Math.sin(theta)
    const y = Math.cos(theta)
    for (let column = 0; column < iw; column++) {
      const index = (row * iw + column) * 4
      const luminance =
        (hdr[index] * 0.2126 +
          hdr[index + 1] * 0.7152 +
          hdr[index + 2] * 0.0722) *
        radianceScale
      const excess = Math.max(0, luminance - threshold)
      const weight = excess * excess
      if (weight === 0) continue
      const phi = (Math.PI * 2 * (column + 0.5)) / iw - Math.PI
      vector = add(
        vector,
        [Math.cos(phi) * sinTheta, y, Math.sin(phi) * sinTheta],
        weight,
      )
      totalWeight += weight
    }
  }
  if (!(totalWeight > 0))
    throw new Error('No bright direction found in the HDRI')
  const hdrYUp = normalizeDirection(vector)
  return {
    hdrYUp,
    enu: [hdrYUp[0], -hdrYUp[2], hdrYUp[1]],
    method: 'luminance-weighted centroid of pixels above max(p99.9, 55% peak)',
  }
}

function averageHorizon(hdr, iw, ih, radianceScale) {
  const center = ih / 2
  const halfBand = Math.max(2, Math.round(ih / 180))
  const total = [0, 0, 0]
  let count = 0
  for (
    let row = Math.floor(center - halfBand);
    row < Math.ceil(center + halfBand);
    row++
  ) {
    for (let column = 0; column < iw; column++) {
      const index = (row * iw + column) * 4
      for (let channel = 0; channel < 3; channel++) {
        total[channel] += Math.min(
          panoramaRange,
          Math.max(0, hdr[index + channel] * radianceScale),
        )
      }
      count++
    }
  }
  return total.map((value) => value / count)
}

function makeKtxContainer(hdr, iw, ih, radianceScale) {
  const texture = createDefaultContainer()
  Object.assign(texture, {
    vkFormat: 109,
    typeSize: 4,
    pixelWidth: width,
    pixelHeight: height,
    pixelDepth: 0,
    layerCount: 0,
    faceCount: 6,
    levelCount,
    supercompressionScheme: 0,
  })
  Object.assign(texture.dataFormatDescriptor[0], {
    colorModel: 1,
    transferFunction: 1,
    bytesPlane: [16, 0, 0, 0, 0, 0, 0, 0],
    samples: [0, 1, 2, 15].map((channel, index) => ({
      bitOffset: index * 32,
      bitLength: 31,
      channelType: channel | 0xc0,
      samplePosition: [0, 0, 0, 0],
      sampleLower: 0,
      sampleUpper: 0x3f800000,
    })),
  })
  texture.keyValue.KTXwriter = 'cesium-demo Poly Haven HDRI baker'

  for (let mip = 0; mip < levelCount; mip++) {
    const size = width >> mip
    const data = new Float32Array(6 * size * size * 4)
    let offset = 0
    for (let face = 0; face < 6; face++) {
      for (let row = 0; row < size; row++) {
        for (let column = 0; column < size; column++) {
          const direction = cubemapDirection(
            face,
            (2 * (column + 0.5)) / size - 1,
            (2 * (row + 0.5)) / size - 1,
          )
          const color = prefilterDirection(
            hdr,
            iw,
            ih,
            direction,
            mip / (levelCount - 1),
            radianceScale,
          )
          data.set([color[0], color[1], color[2], 1], offset)
          offset += 4
        }
      }
    }
    texture.levels.push({
      levelData: new Uint8Array(data.buffer),
      uncompressedByteLength: data.byteLength,
    })
  }
  return texture
}

function assertFiniteArray(values, label) {
  for (const row of values)
    for (const channel of row)
      assert(Number.isFinite(channel), `${label} has a non-finite value`)
}

async function createPanorama(source, destination, radianceScale) {
  const python =
    process.env.PYTHON_EXECUTABLE ??
    (process.platform === 'win32' ? 'python' : 'python3')
  const result = spawnSync(
    python,
    [
      '-c',
      pillowScript,
      String(source.width),
      String(source.height),
      String(radianceScale),
      String(panoramaRange),
      destination,
    ],
    {
      input: Buffer.from(
        source.hdr.buffer,
        source.hdr.byteOffset,
        source.hdr.byteLength,
      ),
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  )
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(
      `HDR-to-JPEG conversion failed: ${result.stderr || result.stdout}`,
    )
  const dimensions = JSON.parse(result.stdout.trim())
  assert.deepEqual(
    [dimensions.width, dimensions.height, dimensions.format],
    [source.width, source.height, 'JPEG'],
    'Panorama must preserve the decoded source resolution',
  )
  return dimensions
}

function validateKtx(bytes, name) {
  const texture = readKtx2(bytes)
  assert.equal(texture.vkFormat, 109, `${name}: expected linear RGBA32F KTX2`)
  assert.equal(texture.pixelWidth, width)
  assert.equal(texture.pixelHeight, height)
  assert.equal(texture.faceCount, 6)
  assert.equal(texture.levelCount, levelCount)
  assert.equal(texture.levels.length, levelCount)
  for (let mip = 0; mip < levelCount; mip++) {
    const expectedLength = 6 * (width >> mip) * (height >> mip) * 16
    assert.equal(
      texture.levels[mip].levelData.byteLength,
      expectedLength,
      `${name}: malformed mip ${mip}`,
    )
    const values = new Float32Array(
      texture.levels[mip].levelData.buffer,
      texture.levels[mip].levelData.byteOffset,
      texture.levels[mip].levelData.byteLength / Float32Array.BYTES_PER_ELEMENT,
    )
    for (let index = 0; index < values.length; index++) {
      assert(
        Number.isFinite(values[index]),
        `${name}: non-finite value in mip ${mip}`,
      )
      assert(
        values[index] >= 0 && values[index] <= panoramaRange + 1e-5,
        `${name}: out-of-range value in mip ${mip}`,
      )
    }
  }
  return {
    width: texture.pixelWidth,
    height: texture.pixelHeight,
    faces: texture.faceCount,
    levels: texture.levelCount,
    vkFormat: texture.vkFormat,
  }
}

async function main() {
  await Promise.all([
    mkdir(panoramaDirectory, { recursive: true }),
    mkdir(specularDirectory, { recursive: true }),
  ])
  const manifest = {}
  const provenance = {
    generatedAt: new Date().toISOString(),
    license: licenses,
    coordinateSystem: {
      hdrDirection: '[east, up, south]',
      panorama:
        'equirectangular; u=0.5+atan2(south,east)/(2π), v=acos(up)/π; top row is +up',
      cesiumEnu: 'sunDirection=[hdr.x,-hdr.z,hdr.y] in [east,north,up] order',
      sphericalHarmonics:
        'Cesium polynomial order [L00,L1-1,L10,L11,L2-2,L2-1,L20,L21,L22]; first-three terms are Y-up/z-south/x-east',
    },
    bake: {
      sourceResolution:
        'Panorama uses the native 4K HDR; SH, sun, horizon and GGX use the 2K HDR lighting source. No panorama upscaling.',
      specular: {
        format: 'KTX2 RGBA32F linear',
        width,
        height,
        faces: 6,
        levels: levelCount,
        ggxSamples: filterSamples,
      },
      normalization: {
        panoramaEncoding: 'reinhard-srgb',
        panoramaRange,
        radianceScale:
          'recorded per preset in assets[key].normalization and manifest[key].radianceScale',
      },
      sunDirection:
        'Luminance-weighted centroid above max(p99.9, 55% peak), transformed from HDR Y-up into local ENU',
      horizonColor:
        'Linear RGB mean of the ±1 degree band around the equirectangular horizon; same normalized radiance',
    },
    assets: {},
  }

  const baked = await Promise.all(
    presets.map(async ({ key, assetId, radianceScale }) => {
      const [source, panoramaSource] = await Promise.all([
        obtainSource(assetId, '2k', 2048, 1024),
        obtainSource(assetId, '4k', 4096, 2048),
      ])
      return { key, source, panoramaSource, radianceScale }
    }),
  )
  for (const { key, source, panoramaSource, radianceScale } of baked) {
    const { hdr, hdrBytes, info, file, assetId, sourcePath } = source
    const imageWidth = source.width
    const imageHeight = source.height
    const panoramaPath = path.join(panoramaDirectory, `${key}.jpg`)
    const specularPath = path.join(specularDirectory, `${key}.ktx2`)
    const [panorama, coefficients] = await Promise.all([
      createPanorama(
        {
          width: panoramaSource.width,
          height: panoramaSource.height,
          hdr: panoramaSource.hdr,
        },
        panoramaPath,
        radianceScale,
      ),
      Promise.resolve(
        buildSphericalHarmonics(hdr, imageWidth, imageHeight, radianceScale),
      ),
    ])
    const sun = estimateSunDirection(
      hdr,
      imageWidth,
      imageHeight,
      radianceScale,
    )
    const horizonColor = averageHorizon(
      hdr,
      imageWidth,
      imageHeight,
      radianceScale,
    )
    assert.equal(coefficients.length, 9)
    assert(coefficients.every((row) => row.length === 3))
    assertFiniteArray(coefficients, `${key} spherical harmonics`)
    assertFiniteArray([sun.enu, horizonColor], `${key} metadata`)
    assert(
      Math.abs(Math.hypot(...sun.enu) - 1) < 1e-6,
      `${key} sunDirection must be normalized`,
    )

    const cubemap = makeKtxContainer(
      hdr,
      imageWidth,
      imageHeight,
      radianceScale,
    )
    const specularBytes = Buffer.from(writeKtx2(cubemap))
    const specular = validateKtx(specularBytes, key)
    const coefficientsBytes = Buffer.from(JSON.stringify(coefficients))
    const panoramaBytes = await readFile(panoramaPath)
    assert(
      panoramaBytes.length > 20_000,
      `${key} panorama JPEG is unexpectedly small`,
    )
    await Promise.all([
      writeFile(specularPath, specularBytes),
      writeFile(path.join(output, `${key}.sh.json`), coefficientsBytes),
    ])

    manifest[key] = {
      panorama: `panoramas/${key}.jpg`,
      specular: `specular/${key}.ktx2`,
      sphericalHarmonics: coefficients,
      sunDirection: sun.enu,
      horizonColor,
      panoramaEncoding: 'reinhard-srgb',
      panoramaRange,
      radianceScale,
    }
    provenance.assets[key] = {
      assetId,
      title: info.name ?? assetId,
      sourcePage: `${licenses.assets}${assetId}`,
      apiUrl: `https://api.polyhaven.com/files/${assetId}`,
      downloadUrl: file.url,
      sourceResolution: { name: '2k', width: imageWidth, height: imageHeight },
      sourcePurpose:
        'spherical harmonics, GGX specular, sun direction and horizon color',
      panoramaDownloadUrl: panoramaSource.file.url,
      panoramaSourceResolution: {
        name: '4k',
        width: panoramaSource.width,
        height: panoramaSource.height,
      },
      panoramaSourcePurpose: 'background panorama only',
      panoramaSourceBytes: panoramaSource.hdrBytes.length,
      panoramaSourceMd5: md5(panoramaSource.hdrBytes),
      panoramaSourceSha256: sha256(panoramaSource.hdrBytes),
      normalization: {
        radianceScale,
        panoramaEncoding: 'reinhard-srgb',
        panoramaRange,
      },
      sourceBytes: hdrBytes.length,
      sourceMd5: md5(hdrBytes),
      sourceSha256: sha256(hdrBytes),
      license: licenses,
      panorama: {
        path: `panoramas/${key}.jpg`,
        width: panorama.width,
        height: panorama.height,
        bytes: panorama.bytes,
        sha256: sha256(panoramaBytes),
      },
      specular: {
        path: `specular/${key}.ktx2`,
        ...specular,
        bytes: specularBytes.length,
        sha256: sha256(specularBytes),
      },
      sphericalHarmonics: {
        path: `${key}.sh.json`,
        terms: 9,
        channels: 3,
        sha256: sha256(coefficientsBytes),
      },
      sunDirectionEstimate: { hdrYUp: sun.hdrYUp, method: sun.method },
      horizonColor,
    }
    console.log(
      JSON.stringify({
        key,
        assetId,
        panorama,
        specular,
        sunDirection: sun.enu,
        horizonColor,
      }),
    )
  }

  const studioSHBytes = await readFile(
    path.join(repository, 'public/model-rendering/studio-sh.json'),
  )
  const studioSpecularBytes = await readFile(
    path.join(repository, 'public/model-rendering/studio-specular.ktx2'),
  )
  manifest.studio = {
    specular: '../model-rendering/studio-specular.ktx2',
    sphericalHarmonics: JSON.parse(studioSHBytes.toString('utf8')),
  }
  provenance.modelLighting = {
    description:
      'Model-only studio lighting reused from city-rendering; weather panoramas and water keep their original HDRI.',
    coefficients: {
      path: '../model-rendering/studio-sh.json',
      sha256: sha256(studioSHBytes),
    },
    specular: {
      path: manifest.studio.specular,
      sha256: sha256(studioSpecularBytes),
    },
  }
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n')
  const provenanceBytes = Buffer.from(
    JSON.stringify(provenance, null, 2) + '\n',
  )
  await Promise.all([
    writeFile(path.join(output, 'manifest.json'), manifestBytes),
    writeFile(path.join(output, 'sources.json'), provenanceBytes),
  ])

  const savedManifest = JSON.parse(
    await readFile(path.join(output, 'manifest.json'), 'utf8'),
  )
  assert.deepEqual(Object.keys(savedManifest), [
    'day',
    'sunset',
    'rain',
    'studio',
  ])
  assert.deepEqual(savedManifest.studio, manifest.studio)
  for (const { key } of presets) {
    const value = savedManifest[key]
    assert.equal(value.sphericalHarmonics.length, 9, `${key} SH manifest shape`)
    assert.equal(
      value.sphericalHarmonics.every((row) => row.length === 3),
      true,
    )
    assert.equal(value.panoramaEncoding, 'reinhard-srgb')
    assert.equal(value.panoramaRange, 32)
    assert.equal(
      value.radianceScale,
      presets.find((preset) => preset.key === key)?.radianceScale,
    )
  }
  console.log(
    JSON.stringify({
      passed: true,
      output,
      cache,
      presets: Object.keys(savedManifest),
      panoramaSourceResolution: [4096, 2048],
      illuminationSourceResolution: [2048, 1024],
      ktx: { width, height, faces: 6, levels: levelCount, format: 'RGBA32F' },
      normalization: Object.fromEntries(
        presets.map(({ key, radianceScale }) => [key, radianceScale]),
      ),
      panoramaRange,
    }),
  )
}

await main()
