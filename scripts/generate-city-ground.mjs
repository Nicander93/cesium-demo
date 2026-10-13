import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const output = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../public/city-rendering',
)
const siteOnly = process.argv.includes('--site-only')
await mkdir(output, { recursive: true })
const positions = [],
  normals = [],
  indices = []
const faces = [
  [
    [1, 0, 0],
    [
      [0.5, -0.5, -0.5],
      [0.5, 0.5, -0.5],
      [0.5, 0.5, 0.5],
      [0.5, -0.5, 0.5],
    ],
  ],
  [
    [-1, 0, 0],
    [
      [-0.5, -0.5, 0.5],
      [-0.5, 0.5, 0.5],
      [-0.5, 0.5, -0.5],
      [-0.5, -0.5, -0.5],
    ],
  ],
  [
    [0, 1, 0],
    [
      [-0.5, 0.5, -0.5],
      [-0.5, 0.5, 0.5],
      [0.5, 0.5, 0.5],
      [0.5, 0.5, -0.5],
    ],
  ],
  [
    [0, -1, 0],
    [
      [-0.5, -0.5, 0.5],
      [-0.5, -0.5, -0.5],
      [0.5, -0.5, -0.5],
      [0.5, -0.5, 0.5],
    ],
  ],
  [
    [0, 0, 1],
    [
      [0.5, -0.5, 0.5],
      [0.5, 0.5, 0.5],
      [-0.5, 0.5, 0.5],
      [-0.5, -0.5, 0.5],
    ],
  ],
  [
    [0, 0, -1],
    [
      [-0.5, -0.5, -0.5],
      [-0.5, 0.5, -0.5],
      [0.5, 0.5, -0.5],
      [0.5, -0.5, -0.5],
    ],
  ],
]
for (const [normal, corners] of faces) {
  const start = positions.length / 3
  for (const corner of corners) {
    positions.push(...corner)
    normals.push(...normal)
  }
  indices.push(start, start + 1, start + 2, start, start + 2, start + 3)
}
const materials = [
  {
    name: 'Asphalt',
    pbrMetallicRoughness: {
      baseColorFactor: [0.035, 0.045, 0.058, 1],
      roughnessFactor: 0.92,
      metallicFactor: 0,
    },
  },
  {
    name: 'Paving',
    pbrMetallicRoughness: {
      baseColorFactor: [0.31, 0.33, 0.34, 1],
      roughnessFactor: 0.83,
      metallicFactor: 0,
    },
  },
  {
    name: 'Lane paint',
    pbrMetallicRoughness: {
      baseColorFactor: [0.8, 0.76, 0.58, 1],
      roughnessFactor: 0.7,
      metallicFactor: 0,
    },
  },
  {
    name: 'Grass',
    pbrMetallicRoughness: {
      baseColorFactor: [0.075, 0.22, 0.12, 1],
      roughnessFactor: 1,
      metallicFactor: 0,
    },
  },
  {
    name: 'Stone',
    pbrMetallicRoughness: {
      baseColorFactor: [0.22, 0.255, 0.27, 1],
      roughnessFactor: 0.9,
      metallicFactor: 0,
    },
  },
  {
    name: 'Foliage',
    pbrMetallicRoughness: {
      baseColorFactor: [0.065, 0.23, 0.11, 1],
      roughnessFactor: 0.9,
      metallicFactor: 0,
    },
  },
  {
    name: 'Wood',
    pbrMetallicRoughness: {
      baseColorFactor: [0.12, 0.08, 0.04, 1],
      roughnessFactor: 1,
      metallicFactor: 0,
    },
  },
]
const nodes = []
function box(name, x, y, z, width, length, height, material) {
  nodes.push({
    name,
    mesh: material,
    translation: [x, z, -y],
    scale: [width, height, length],
  })
}
for (const side of [-1, 1]) {
  if (!siteOnly)
    box('Surrounding landscape', side * 3050, 0, 0.8, 6000, 7200, 2, 3)
  box('Riverbank land', side * 183, 0, 1, 266, 640, 2, 1)
  box('Quay wall', side * 49, 0, 0.8, 2, 640, 2.4, 4)
  box('Promenade', side * 57, 0, 2.1, 14, 640, 0.2, 1)
  for (const x of [72, 282])
    box('Boulevard', side * x, 0, 2.13, 22, 610, 0.26, 0)
  for (const y of [-220, -110, 0, 110, 220])
    box('Cross street', side * 183, y, 2.13, 266, 22, 0.26, 0)
  for (const x of [72, 282])
    for (let y = -285; y < 290; y += 15) {
      if (
        [-220, -110, 0, 110, 220].some(
          (crossing) => Math.abs(y - crossing) < 16,
        )
      )
        continue
      box('Lane marker', side * x, y, 2.28, 0.25, 6, 0.025, 2)
    }
  for (const y of [-165, -55, 55, 165])
    for (const x of [123, 194, 251])
      box('Building parcel', side * x, y, 2.1, 55, 82, 0.2, 1)
  for (let y = -290; y <= 290; y += 29) {
    box('Tree trunk', side * 55, y, 4.2, 0.9, 0.9, 4, 6)
    box('Tree canopy', side * 55, y, 7, 5, 5, 4.2, 5)
  }
  for (const y of [-275, 275])
    box('Riverside park', side * 179, y, 2.2, 173, 57, 0.3, 3)
}
for (const y of [-220, 0, 220]) {
  box('Bridge deck', 0, y, 1.75, 106, 25, 0.8, 4)
  box('Bridge road', 0, y, 2.22, 106, 22, 0.14, 0)
  for (const side of [-1, 1])
    box('Bridge parapet', 0, y + side * 12, 3, 106, 0.7, 1.7, 1)
  for (let x = -46; x <= 46; x += 15)
    box('Bridge lane marker', x, y, 2.31, 6, 0.25, 0.025, 2)
}
const arrays = [
  new Float32Array(positions),
  new Float32Array(normals),
  new Uint16Array(indices),
]
const views = [],
  chunks = []
let offset = 0
for (const array of arrays) {
  const bytes = Buffer.from(array.buffer)
  views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length })
  chunks.push(bytes)
  offset += bytes.length
  const padding = (4 - (offset % 4)) % 4
  if (padding) {
    chunks.push(Buffer.alloc(padding))
    offset += padding
  }
}
const gltf = {
  asset: { version: '2.0', generator: 'cesium-demo riverside test ground' },
  scene: 0,
  scenes: [{ nodes: nodes.map((_, index) => index) }],
  nodes,
  materials,
  meshes: materials.map((_, material) => ({
    primitives: [
      { attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material },
    ],
  })),
  buffers: [{ byteLength: offset }],
  bufferViews: views,
  accessors: [
    {
      bufferView: 0,
      componentType: 5126,
      count: 24,
      type: 'VEC3',
      min: [-0.5, -0.5, -0.5],
      max: [0.5, 0.5, 0.5],
    },
    { bufferView: 1, componentType: 5126, count: 24, type: 'VEC3' },
    { bufferView: 2, componentType: 5123, count: 36, type: 'SCALAR' },
  ],
}
const json = Buffer.from(JSON.stringify(gltf)),
  jsonPadding = (4 - (json.length % 4)) % 4
const jsonChunk = Buffer.concat([json, Buffer.alloc(jsonPadding, 0x20)]),
  binary = Buffer.concat(chunks)
const header = Buffer.alloc(12),
  jsonHeader = Buffer.alloc(8),
  binaryHeader = Buffer.alloc(8)
header.writeUInt32LE(0x46546c67)
header.writeUInt32LE(2, 4)
header.writeUInt32LE(28 + jsonChunk.length + binary.length, 8)
jsonHeader.writeUInt32LE(jsonChunk.length)
jsonHeader.writeUInt32LE(0x4e4f534a, 4)
binaryHeader.writeUInt32LE(binary.length)
binaryHeader.writeUInt32LE(0x004e4942, 4)
await writeFile(
  resolve(output, siteOnly ? 'riverside-site.glb' : 'riverside-ground.glb'),
  Buffer.concat([header, jsonHeader, jsonChunk, binaryHeader, binary]),
)
console.log(
  `Generated ${nodes.length} road, bridge, quay and vegetation nodes.`,
)
