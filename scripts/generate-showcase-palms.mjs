import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPalmGeometry } from '../src/views/landscape-showcase/palm-geometry.ts'
import {
  buildCoastPalmGlb,
  readPalmGeometry,
} from '../src/views/landscape-showcase/palm-model.ts'
import { createCoastPalmPlacements } from '../src/views/landscape-showcase/coast-layout.ts'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDirectory, '..')
const outputPath = path.join(projectRoot, 'public/landscape-showcase/palms.glb')
const manifestPath = path.join(
  projectRoot,
  'public/landscape-showcase/palm-manifest.json',
)
const placements = createCoastPalmPlacements()
const prototypes = Array.from({ length: 6 }, (_, seed) => {
  const geometry = createPalmGeometry(seed)
  return {
    trunk: readPalmGeometry(geometry.trunk),
    foliage: readPalmGeometry(geometry.foliage),
    tips: readPalmGeometry(geometry.tips),
  }
})
const glb = buildCoastPalmGlb(placements, prototypes)
const jsonLength = new DataView(
  glb.buffer,
  glb.byteOffset,
  glb.byteLength,
).getUint32(12, true)
const gltf = JSON.parse(
  new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)).trim(),
)
const instancesByPrototype = placements.reduce((counts, placement) => {
  counts[placement.prototype]++
  return counts
}, Array(6).fill(0))
const prototypesSummary = gltf.meshes.map((mesh, index) => ({
  seed: index,
  instances: instancesByPrototype[index],
  geometryTriangles: mesh.primitives.reduce(
    (sum, primitive) => sum + gltf.accessors[primitive.indices].count / 3,
    0,
  ),
}))
const geometryTriangles = prototypesSummary.reduce(
  (sum, prototype) => sum + prototype.geometryTriangles,
  0,
)
const drawTriangles = prototypesSummary.reduce(
  (sum, prototype) => sum + prototype.geometryTriangles * prototype.instances,
  0,
)
const generatorSha256 = createHash('sha256')
  .update(
    await readFile(
      path.join(projectRoot, 'src/views/landscape-showcase/palm-geometry.ts'),
    ),
  )
  .digest('hex')

await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, glb)
await writeFile(
  manifestPath,
  `${JSON.stringify(
    {
      format: 'cesium-demo-coast-palms-v1',
      generator: 'src/views/landscape-showcase/palm-geometry.ts',
      generatorSha256,
      instanceCount: placements.length,
      prototypeCount: prototypes.length,
      totalBytes: glb.byteLength,
      geometryTriangles,
      drawTriangles,
      prototypes: prototypesSummary,
    },
    null,
    2,
  )}\n`,
  'utf8',
)
console.log(
  JSON.stringify(
    {
      instanceCount: placements.length,
      prototypeCount: prototypes.length,
      totalBytes: glb.byteLength,
      geometryTriangles,
      drawTriangles,
      generatorSha256,
    },
    null,
    2,
  ),
)
