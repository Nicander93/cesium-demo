import { readFile, access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../public/city-rendering',
)
const sources = JSON.parse(
  await readFile(resolve(root, 'sources.json'), 'utf8'),
)
let models = 0,
  externalResources = 0
for (const source of sources.sources) {
  await access(resolve(root, 'kenney', source.category, 'LICENSE.txt'))
  for (const name of source.files) {
    const path = resolve(root, 'kenney', source.category, name)
    const binary = await readFile(path)
    if (
      binary.readUInt32LE(0) !== 0x46546c67 ||
      binary.readUInt32LE(8) !== binary.length
    )
      throw new Error(`Invalid GLB: ${name}`)
    const document = JSON.parse(
      binary.subarray(20, 20 + binary.readUInt32LE(12)).toString('utf8'),
    )
    for (const resource of [...document.buffers, ...(document.images ?? [])]) {
      if (!resource.uri || resource.uri.startsWith('data:')) continue
      if (/^[a-z]+:/i.test(resource.uri))
        throw new Error(`Unexpected remote model resource: ${resource.uri}`)
      await access(resolve(dirname(path), resource.uri))
      externalResources++
    }
    models++
  }
}
const sizes = {
  'lut/transmittance.bin': 131072,
  'lut/irradiance.bin': 8192,
  'lut/scattering.bin': 8388608,
  'lut/single_mie_scattering.bin': 8388608,
  'lut/higher_order_scattering.bin': 8388608,
  'clouds-assets/shape.bin': 2097152,
  'clouds-assets/shape_detail.bin': 32768,
  'clouds-assets/stbn.bin': 1048576,
}
for (const [name, size] of Object.entries(sizes)) {
  const binary = await readFile(resolve(root, 'atmosphere', name))
  if (binary.byteLength !== size)
    throw new Error(`Truncated atmospheric resource: ${name}`)
}
const ground = await readFile(resolve(root, 'riverside-ground.glb'))
const document = JSON.parse(
  ground.subarray(20, 20 + ground.readUInt32LE(12)).toString('utf8'),
)
if (
  !document.nodes.some((node) => node.name === 'Bridge road') ||
  !document.nodes.some((node) => node.name === 'Quay wall')
)
  throw new Error('Ground scene is incomplete')
console.log(
  `Validated ${models} GLBs, ${externalResources} local resource references, ${Object.keys(sizes).length} volumetric data files, and ${document.nodes.length} ground nodes.`,
)

const site = await readFile(resolve(root, 'riverside-site.glb'))
if (site.readUInt32LE(0) !== 0x46546c67 || site.readUInt32LE(8) !== site.length)
  throw new Error('Invalid geographic city site GLB')
const siteDocument = JSON.parse(
  site.subarray(20, 20 + site.readUInt32LE(12)).toString('utf8'),
)
if (
  !siteDocument.nodes.some((node) => node.name === 'Bridge road') ||
  !siteDocument.nodes.some((node) => node.name === 'Quay wall') ||
  siteDocument.nodes.some((node) => node.name === 'Surrounding landscape') ||
  siteDocument.nodes.some(
    (node) =>
      Math.abs(node.translation[0]) + node.scale[0] / 2 > 320 ||
      Math.abs(node.translation[2]) + node.scale[2] / 2 > 320,
  )
)
  throw new Error(
    'Geographic city site must retain streets within a 640m footprint',
  )
console.log(
  `Validated ${siteDocument.nodes.length} geographic city site nodes.`,
)
