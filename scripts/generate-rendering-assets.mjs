import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDefaultContainer, write } from 'ktx-parse'

const output = resolve(dirname(fileURLToPath(import.meta.url)), '../public/model-rendering')
await mkdir(output, { recursive: true })

// One linear HDR lighting function supplies both engines. No downloaded assets are required.
function radiance([x, y, z]) {
  const ambient = 0.12 + Math.max(y, 0) * 0.16
  const result = [ambient, ambient, ambient]
  const lights = [
    { direction: [-0.6, 0.65, 0.46], size: 0.83, color: [7, 6.7, 6.3] },
    { direction: [0.75, 0.2, -0.63], size: 0.94, color: [3.2, 3.6, 4.2] },
    { direction: [0, 0.98, 0.2], size: 0.95, color: [2, 2, 2] },
  ]
  for (const light of lights) {
    const dot = x * light.direction[0] + y * light.direction[1] + z * light.direction[2]
    const amount = Math.max(0, Math.min(1, (dot - light.size) / 0.04))
    for (let c = 0; c < 3; c++) result[c] += amount * light.color[c]
  }
  return result
}

function normalize(v) {
  const length = Math.hypot(...v)
  return v.map(value => value / length)
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
function faceDirection(face, u, v) {
  return normalize([[1, -v, -u], [-1, -v, u], [u, 1, v], [u, -1, -v], [u, -v, 1], [-u, -v, -1]][face])
}
function radicalInverse(value) {
  let result = 0
  let scale = 0.5
  while (value) {
    result += (value & 1) * scale
    scale *= 0.5
    value >>>= 1
  }
  return result
}

// GGX importance sampling; each mip corresponds to the linear roughness used by Cesium.
function prefilter(normal, roughness) {
  if (roughness === 0) return radiance(normal)
  const tangent = normalize(cross(Math.abs(normal[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0], normal))
  const bitangent = cross(normal, tangent)
  const sum = [0, 0, 0]
  let weight = 0
  const alphaSquared = roughness ** 4
  for (let sample = 0; sample < 128; sample++) {
    const phi = 2 * Math.PI * sample / 128
    const xi = radicalInverse(sample)
    const cosTheta = Math.sqrt((1 - xi) / (1 + (alphaSquared - 1) * xi))
    const sinTheta = Math.sqrt(1 - cosTheta * cosTheta)
    const h = normal.map((n, i) => tangent[i] * Math.cos(phi) * sinTheta + bitangent[i] * Math.sin(phi) * sinTheta + n * cosTheta)
    const light = h.map((value, i) => 2 * cosTheta * value - normal[i])
    const ndotl = Math.max(0, light.reduce((value, component, i) => value + component * normal[i], 0))
    if (ndotl === 0) continue
    const color = radiance(light)
    weight += ndotl
    for (let c = 0; c < 3; c++) sum[c] += color[c] * ndotl
  }
  return sum.map(value => value / weight)
}

const texture = createDefaultContainer()
Object.assign(texture, { vkFormat: 109, typeSize: 4, pixelWidth: 128, pixelHeight: 128, faceCount: 6, levelCount: 8 })
Object.assign(texture.dataFormatDescriptor[0], {
  colorModel: 1, transferFunction: 1, bytesPlane: [16, 0, 0, 0, 0, 0, 0, 0],
  samples: [0, 1, 2, 15].map((channel, i) => ({ bitOffset: i * 32, bitLength: 31, channelType: channel | 0xc0, samplePosition: [0, 0, 0, 0], sampleLower: 0, sampleUpper: 0x3f800000 })),
})
texture.keyValue.KTXwriter = 'cesium-demo neutral studio generator'
for (let mip = 0; mip < 8; mip++) {
  const size = 128 >> mip
  const data = new Float32Array(6 * size * size * 4)
  let index = 0
  for (let face = 0; face < 6; face++) {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const direction = faceDirection(face, 2 * (x + 0.5) / size - 1, 2 * (y + 0.5) / size - 1)
      const color = prefilter(direction, mip / 7)
      data.set([...color, 1], index)
      index += 4
    }
  }
  texture.levels.push({ levelData: new Uint8Array(data.buffer), uncompressedByteLength: data.byteLength })
}
await writeFile(resolve(output, 'studio-specular.ktx2'), write(texture))

// Integrate radiance in real SH, then bake the cosine convolution and Cesium's polynomial basis.
const coefficients = Array.from({ length: 9 }, () => [0, 0, 0])
const basisFactors = [0.282095, 0.488603, 0.488603, 0.488603, 1.092548, 1.092548, 0.315392, 1.092548, 0.546274]
const bandFactors = [1, 2 / 3, 2 / 3, 2 / 3, 1 / 4, 1 / 4, 1 / 4, 1 / 4, 1 / 4]
const width = 512
const height = 256
const hdrChunks = [Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`)]
for (let row = 0; row < height; row++) {
  const theta = Math.PI * (row + 0.5) / height
  const scanline = new Uint8Array(width * 4)
  for (let column = 0; column < width; column++) {
    const phi = 2 * Math.PI * (column + 0.5) / width - Math.PI
    // Matches Three's equirectangular sampling: atan(z, x), asin(y).
    const [x, y, z] = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)]
    const color = radiance([x, y, z])
    const polynomials = [1, y, z, x, y * x, y * z, 3 * z * z - 1, z * x, x * x - y * y]
    const solidAngle = Math.sin(theta) * Math.PI / height * 2 * Math.PI / width
    for (let term = 0; term < 9; term++) for (let c = 0; c < 3; c++) {
      coefficients[term][c] += color[c] * polynomials[term] * basisFactors[term] ** 2 * bandFactors[term] * solidAngle
    }
    const exponent = Math.ceil(Math.log2(Math.max(...color)))
    const scale = 256 / 2 ** exponent
    for (let c = 0; c < 3; c++) scanline[c * width + column] = Math.min(255, Math.floor(color[c] * scale))
    scanline[3 * width + column] = exponent + 128
  }
  hdrChunks.push(Buffer.from([2, 2, width >> 8, width & 255]))
  for (let channel = 0; channel < 4; channel++) {
    for (let start = 0; start < width; start += 127) {
      const count = Math.min(127, width - start)
      hdrChunks.push(Buffer.from([count]), Buffer.from(scanline.subarray(channel * width + start, channel * width + start + count)))
    }
  }
}
await writeFile(resolve(output, 'studio.hdr'), Buffer.concat(hdrChunks))
await writeFile(resolve(output, 'studio-sh.json'), JSON.stringify(coefficients))

const positions = []
const normals = []
const indices = []
const segments = 48
const rings = 24
for (let ring = 0; ring <= rings; ring++) for (let segment = 0; segment <= segments; segment++) {
  const theta = ring * Math.PI / rings
  const phi = segment * 2 * Math.PI / segments
  const point = [-Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)]
  positions.push(...point)
  normals.push(...point)
}
for (let ring = 0; ring < rings; ring++) for (let segment = 0; segment < segments; segment++) {
  const a = ring * (segments + 1) + segment
  const b = a + segments + 1
  if (ring !== 0) indices.push(a, b, a + 1)
  if (ring !== rings - 1) indices.push(b, b + 1, a + 1)
}
const arrays = [new Float32Array(positions), new Float32Array(normals), new Uint16Array(indices)]
let offset = 0
const bufferViews = arrays.map((array, i) => {
  const view = { buffer: 0, byteOffset: offset, byteLength: array.byteLength, target: i === 2 ? 34963 : 34962 }
  offset += array.byteLength
  return view
})
const materials = []
const meshes = []
const nodes = []
for (let row = 0; row < 2; row++) for (let column = 0; column < 4; column++) {
  const roughness = [0.07, 0.25, 0.5, 0.85][column]
  const index = materials.length
  materials.push({ name: `${row === 0 ? 'Metal' : 'Dielectric'} roughness ${roughness}`, pbrMetallicRoughness: { baseColorFactor: row === 0 ? [0.83, 0.54, 0.2, 1] : [0.16, 0.38, 0.65, 1], metallicFactor: row === 0 ? 1 : 0, roughnessFactor: roughness } })
  meshes.push({ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: index }] })
  nodes.push({ mesh: index, translation: [(column - 1.5) * 2.5, (1 - row) * 2.5 + 1, 0] })
}
const gltf = { asset: { version: '2.0', generator: 'cesium-demo material comparison; original generated geometry' }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes, materials, buffers: [{ byteLength: offset }], bufferViews, accessors: [
  { bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min: [-1, -1, -1], max: [1, 1, 1] },
  { bufferView: 1, componentType: 5126, count: normals.length / 3, type: 'VEC3' },
  { bufferView: 2, componentType: 5123, count: indices.length, type: 'SCALAR' },
] }
const json = Buffer.from(JSON.stringify(gltf))
const jsonPadded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20)
json.copy(jsonPadded)
const binary = Buffer.concat(arrays.map(array => Buffer.from(array.buffer)))
const binaryPadded = Buffer.alloc(Math.ceil(binary.length / 4) * 4)
binary.copy(binaryPadded)
const header = Buffer.alloc(20)
header.writeUInt32LE(0x46546c67, 0)
header.writeUInt32LE(2, 4)
header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binaryPadded.length, 8)
header.writeUInt32LE(jsonPadded.length, 12)
header.writeUInt32LE(0x4e4f534a, 16)
const binaryHeader = Buffer.alloc(8)
binaryHeader.writeUInt32LE(binaryPadded.length, 0)
binaryHeader.writeUInt32LE(0x004e4942, 4)
await writeFile(resolve(output, 'material-study.glb'), Buffer.concat([header, jsonPadded, binaryHeader, binaryPadded]))
console.log(`Generated shared studio lighting and material study in ${output}`)
