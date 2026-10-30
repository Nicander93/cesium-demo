import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createOfficeGlb } from '../src/views/landscape-showcase/office-model.ts'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDirectory, '..')
const generatorPath = path.join(
  projectRoot,
  'src/views/landscape-showcase/office-model.ts',
)
const outputDirectory = path.join(
  projectRoot,
  'public/landscape-showcase/offices',
)
const generatorSha256 = createHash('sha256')
  .update((await readFile(generatorPath, 'utf8')).replace(/\r\n/g, '\n'))
  .digest('hex')
const assets = []

function inspectGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error('Office generator returned an invalid GLB header.')
  }
  const jsonLength = view.getUint32(12, true)
  const json = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trim(),
  )
  const triangleCount = json.meshes[0].primitives.reduce((sum, primitive) => {
    return sum + json.accessors[primitive.indices].count / 3
  }, 0)
  return { type: json.asset.extras.buildingType, triangleCount }
}

await mkdir(outputDirectory, { recursive: true })
for (let seed = 1; seed <= 12; seed++) {
  const bytes = createOfficeGlb(seed)
  const { type, triangleCount } = inspectGlb(bytes)
  const filename = `office-${String(seed).padStart(2, '0')}.glb`
  await writeFile(path.join(outputDirectory, filename), bytes)
  assets.push({
    filename,
    seed,
    type,
    bytes: bytes.byteLength,
    triangles: triangleCount,
  })
}

const manifest = {
  format: 'cesium-demo-showcase-offices-v1',
  generator: 'src/views/landscape-showcase/office-model.ts',
  generatorSha256,
  assets,
}
await writeFile(
  path.join(outputDirectory, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
)
const totalBytes = assets.reduce((sum, asset) => sum + asset.bytes, 0)
const triangleCounts = assets.map((asset) => asset.triangles)
console.log(
  JSON.stringify(
    {
      count: assets.length,
      totalBytes,
      triangleRange: [Math.min(...triangleCounts), Math.max(...triangleCounts)],
      types: [...new Set(assets.map((asset) => asset.type))],
      generatorSha256,
    },
    null,
    2,
  ),
)
