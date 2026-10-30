import type { Plant } from './planting'
import type { Species } from './species'

type Detail = 'near' | 'far'
type Vec3 = [number, number, number]
type Rgb = [number, number, number]
type Uv = [number, number]

interface MeshGeometry {
  positions: number[]
  normals: number[]
  uvs: number[]
  colors?: number[]
  indices: number[]
}

interface PineMeshes {
  bark: MeshGeometry
  foliage: MeshGeometry
}

const speciesNames: readonly Species[] = ['pine', 'broadleaf', 'birch', 'shrub', 'grass']
const leaves: readonly Rgb[] = [
  [0.13, 0.34, 0.18],
  [0.18, 0.42, 0.21],
  [0.24, 0.46, 0.23],
  [0.12, 0.29, 0.17],
]

export interface PineTextureUris {
  canopy: string
  bark: string
  barkNormal: string
}

const initialAssetBase = typeof location === 'undefined'
  ? 'http://localhost/cesium-demo/'
  : new URL(import.meta.env.BASE_URL, location.href).href
let pineTextureUris: PineTextureUris = {
  canopy: new URL('vegetation-lab/pine_tree_01/twig_basecolor_alpha_1k.png', initialAssetBase).href,
  bark: new URL('vegetation-lab/pine_tree_01/bark_diff_1k.jpg', initialAssetBase).href,
  barkNormal: new URL('vegetation-lab/pine_tree_01/bark_nor_gl_1k.jpg', initialAssetBase).href,
}

export function setPineTextureUris(uris: PineTextureUris): void {
  pineTextureUris = { ...uris }
}

function addTriangle(geometry: MeshGeometry, a: Vec3, b: Vec3, c: Vec3, uv: [Uv, Uv, Uv], color?: Rgb): void {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const cross: Vec3 = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ]
  const length = Math.hypot(...cross) || 1
  const normal: Vec3 = [cross[0] / length, cross[1] / length, cross[2] / length]
  const vertex = geometry.positions.length / 3
  const points = [a, b, c]
  points.forEach((point, index) => {
    geometry.positions.push(...point)
    geometry.normals.push(...normal)
    geometry.uvs.push(...uv[index]!)
    if (color) {
      geometry.colors ??= []
      geometry.colors.push(...color)
    }
  })
  geometry.indices.push(vertex, vertex + 1, vertex + 2)
}

function emptyMesh(): MeshGeometry {
  return { positions: [], normals: [], uvs: [], indices: [] }
}

function addCylinder(geometry: MeshGeometry, start: Vec3, end: Vec3, radius: number, segments: number): void {
  const axis: Vec3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]]
  const length = Math.hypot(...axis) || 1
  const direction: Vec3 = axis.map(value => value / length) as Vec3
  const helper: Vec3 = Math.abs(direction[1]) > 0.92 ? [1, 0, 0] : [0, 1, 0]
  const tangent: Vec3 = [direction[1] * helper[2] - direction[2] * helper[1], direction[2] * helper[0] - direction[0] * helper[2], direction[0] * helper[1] - direction[1] * helper[0]]
  const tangentLength = Math.hypot(...tangent) || 1
  tangent.forEach((value, index) => { tangent[index] = value / tangentLength })
  const bitangent: Vec3 = [direction[1] * tangent[2] - direction[2] * tangent[1], direction[2] * tangent[0] - direction[0] * tangent[2], direction[0] * tangent[1] - direction[1] * tangent[0]]
  for (let index = 0; index < segments; index++) {
    const a = index / segments * Math.PI * 2
    const b = (index + 1) / segments * Math.PI * 2
    const ringPoint = (center: Vec3, angle: number): Vec3 => [center[0] + radius * (tangent[0] * Math.cos(angle) + bitangent[0] * Math.sin(angle)), center[1] + radius * (tangent[1] * Math.cos(angle) + bitangent[1] * Math.sin(angle)), center[2] + radius * (tangent[2] * Math.cos(angle) + bitangent[2] * Math.sin(angle))]
    const p0 = ringPoint(start, a), p1 = ringPoint(start, b), p2 = ringPoint(end, a), p3 = ringPoint(end, b)
    const u0 = index / segments, u1 = (index + 1) / segments
    // The ordering follows the cylinder's local tangent frame and points side normals outward.
    addTriangle(geometry, p0, p2, p3, [[u0, 0], [u0, 1], [u1, 1]])
    addTriangle(geometry, p0, p3, p1, [[u0, 0], [u1, 1], [u1, 0]])
  }
}

function addPineTrunk(geometry: MeshGeometry, height: number, segments: number): void {
  for (let index = 0; index < segments; index++) {
    const angle = index / segments * Math.PI * 2
    const next = (index + 1) / segments * Math.PI * 2
    const bottomRadius = 0.27, topRadius = 0.075
    const bottomA: Vec3 = [Math.cos(angle) * bottomRadius, 0, Math.sin(angle) * bottomRadius]
    const bottomB: Vec3 = [Math.cos(next) * bottomRadius, 0, Math.sin(next) * bottomRadius]
    const topA: Vec3 = [Math.cos(angle) * topRadius, height, Math.sin(angle) * topRadius]
    const topB: Vec3 = [Math.cos(next) * topRadius, height, Math.sin(next) * topRadius]
    addTriangle(geometry, bottomA, topA, topB, [[index / segments, 0], [index / segments, 1], [(index + 1) / segments, 1]])
    addTriangle(geometry, bottomA, topB, bottomB, [[index / segments, 0], [(index + 1) / segments, 1], [(index + 1) / segments, 0]])
  }
}

// The source atlas contains the needle shoot at right-center; stay inside its UV island.
const TWIG_ATLAS_U: [number, number] = [0.66, 0.97]
const TWIG_ATLAS_V: [number, number] = [0.36, 0.55]

function addTwigCard(geometry: MeshGeometry, center: Vec3, direction: Vec3, width: number, height: number, segments: number): void {
  const [uMin, uMax] = TWIG_ATLAS_U
  const [vMin, vMax] = TWIG_ATLAS_V
  for (let segment = 0; segment < segments; segment++) {
    const left = (segment / segments - 0.5) * width
    const right = ((segment + 1) / segments - 0.5) * width
    const point = (along: number, up: number): Vec3 => [center[0] + direction[0] * along, center[1] + up, center[2] + direction[2] * along]
    const lowerLeft = point(left, -height / 2), lowerRight = point(right, -height / 2)
    const upperRight = point(right, height / 2), upperLeft = point(left, height / 2)
    const u0 = uMin + (uMax - uMin) * segment / segments
    const u1 = uMin + (uMax - uMin) * (segment + 1) / segments
    addTriangle(geometry, lowerLeft, lowerRight, upperRight, [[u0, vMin], [u1, vMin], [u1, vMax]])
    addTriangle(geometry, lowerLeft, upperRight, upperLeft, [[u0, vMin], [u1, vMax], [u0, vMax]])
  }
}

function createPine(detail: Detail): PineMeshes {
  const height = 8.5
  const near = detail === 'near'
  const trunk = emptyMesh()
  const foliage = emptyMesh()
  addPineTrunk(trunk, height, near ? 12 : 6)
  const tiers = near ? 12 : 5
  const shoots = near ? 12 : 6
  for (let layer = 0; layer < tiers; layer++) {
    const t = (layer + 0.55) / tiers
    const y = height * (0.24 + t * 0.71)
    const crownRadius = height * (0.3 * (1 - t) + 0.025)
    for (let branch = 0; branch < shoots; branch++) {
      const angle = branch * 2.399963229728653 + layer * 1.341
      const random = Math.sin((layer + 1) * 91.7 + (branch + 3) * 17.3) * 0.5 + 0.5
      const length = crownRadius * (0.72 + random * 0.45)
      const radial: Vec3 = [Math.cos(angle), 0, Math.sin(angle)]
      const tangent: Vec3 = [-Math.sin(angle), 0, Math.cos(angle)]
      const start: Vec3 = [radial[0] * 0.075, y, radial[2] * 0.075]
      const end: Vec3 = [radial[0] * length, y + length * 0.12, radial[2] * length]
      addCylinder(trunk, start, end, near ? 0.045 - t * 0.022 : 0.035 - t * 0.015, near ? 6 : 4)
      const card: Vec3 = [radial[0] * length * 0.76, y + length * 0.16, radial[2] * length * 0.76]
      const cardWidth = length * (near ? 1.05 : 0.84)
      const cardHeight = length * (near ? 0.46 : 0.38)
      addTwigCard(foliage, card, radial, cardWidth, cardHeight, near ? 3 : 1)
      addTwigCard(foliage, card, tangent, cardWidth, cardHeight, near ? 3 : 1)
    }
  }
  // A slender leader and several alternating branch whorls keep the crown legible in silhouette.
  const leader = emptyMesh()
  addCylinder(leader, [0, height * 0.48, 0], [0, height, 0], 0.055, near ? 7 : 4)
  trunk.positions.push(...leader.positions)
  trunk.normals.push(...leader.normals)
  trunk.uvs.push(...leader.uvs)
  const indexOffset = trunk.indices.length ? Math.max(...trunk.indices) + 1 : 0
  trunk.indices.push(...leader.indices.map(index => index + indexOffset))
  return { bark: trunk, foliage }
}

function addLegacyTriangle(geometry: MeshGeometry, a: Vec3, b: Vec3, c: Vec3, color: Rgb): void {
  addTriangle(geometry, a, b, c, [[0, 0], [1, 0], [1, 1]], color)
}

function addLeafCluster(geometry: MeshGeometry, center: Vec3, radii: Vec3, color: Rgb, longitudeSegments: number, latitudeSegments: number): void {
  const point = (latitude: number, longitude: number): Vec3 => [
    center[0] + radii[0] * Math.cos(latitude) * Math.cos(longitude),
    center[1] + radii[1] * Math.sin(latitude),
    center[2] + radii[2] * Math.cos(latitude) * Math.sin(longitude),
  ]
  const bottomPole: Vec3 = [center[0], center[1] - radii[1], center[2]]
  const topPole: Vec3 = [center[0], center[1] + radii[1], center[2]]
  for (let lat = 0; lat < latitudeSegments; lat++) {
    const low = -Math.PI / 2 + lat / latitudeSegments * Math.PI
    const high = -Math.PI / 2 + (lat + 1) / latitudeSegments * Math.PI
    for (let lon = 0; lon < longitudeSegments; lon++) {
      const a = lon / longitudeSegments * Math.PI * 2
      const b = (lon + 1) / longitudeSegments * Math.PI * 2
      if (lat === 0) {
        // One non-degenerate fan triangle per wedge at the south pole.
        addLegacyTriangle(geometry, bottomPole, point(high, a), point(high, b), color)
      } else if (lat === latitudeSegments - 1) {
        // One non-degenerate fan triangle per wedge at the north pole.
        addLegacyTriangle(geometry, point(low, a), topPole, point(low, b), color)
      } else {
        const p0 = point(low, a), p1 = point(high, a), p2 = point(high, b), p3 = point(low, b)
        addLegacyTriangle(geometry, p0, p1, p2, color)
        addLegacyTriangle(geometry, p0, p2, p3, color)
      }
    }
  }
}

function addBranchingTrunk(trunk: MeshGeometry, height: number, branches: number, segments: number, radius: number): void {
  addCylinder(trunk, [0, 0, 0], [0, height, 0], radius, segments)
  for (let index = 0; index < branches; index++) {
    const angle = index * 2.399963229728653
    const y = height * (0.34 + (index % 3) * 0.16)
    const length = height * (0.2 + (index % 2) * 0.035)
    const start: Vec3 = [0, y, 0]
    const end: Vec3 = [Math.cos(angle) * length, y + length * 0.56, Math.sin(angle) * length]
    addCylinder(trunk, start, end, radius * (0.34 + (1 - y / height) * 0.2), Math.max(4, segments - 2))
  }
}

function createBroadleaf(detail: Detail): PineMeshes {
  const near = detail === 'near', height = 7.4
  const trunk = emptyMesh(), crown = emptyMesh()
  addBranchingTrunk(trunk, height * 0.78, near ? 7 : 4, near ? 9 : 6, 0.2)
  const clusters = near ? 11 : 5
  for (let index = 0; index < clusters; index++) {
    const angle = index * 2.399963229728653
    const ring = index === 0 ? 0 : 0.62 + (index % 3) * 0.17
    const y = height * (0.69 + (index % 3) * 0.035)
    const radius = near ? 0.76 : 0.82
    addLeafCluster(crown, [Math.cos(angle) * ring, y, Math.sin(angle) * ring], [radius, radius * 0.78, radius * 0.9], leaves[index % leaves.length]!, near ? 9 : 6, near ? 6 : 4)
  }
  return { bark: trunk, foliage: crown }
}

function createBirch(detail: Detail): PineMeshes {
  const near = detail === 'near', height = 8.2
  const trunk = emptyMesh(), crown = emptyMesh()
  addBranchingTrunk(trunk, height * 0.81, near ? 8 : 4, near ? 10 : 6, 0.17)
  // Birch bark is light, with sparse dark lenticel bands on the main stem.
  for (let vertex = 0; vertex < trunk.positions.length / 3; vertex++) {
    const y = trunk.positions[vertex * 3 + 1]!
    const onMainStem = Math.hypot(trunk.positions[vertex * 3]!, trunk.positions[vertex * 3 + 2]!) < 0.18
    const band = onMainStem && Math.floor(y * 7) % 9 === 0
    trunk.colors ??= []
    trunk.colors.push(...(band ? [0.28, 0.27, 0.23] as Rgb : [0.78, 0.79, 0.72] as Rgb))
  }
  const clusters = near ? 13 : 6
  for (let index = 0; index < clusters; index++) {
    const angle = index * 2.399963229728653
    const ring = index === 0 ? 0 : 0.55 + (index % 4) * 0.14
    const y = height * (0.7 + (index % 4) * 0.035)
    addLeafCluster(crown, [Math.cos(angle) * ring, y, Math.sin(angle) * ring], [0.57, 0.82, 0.55], leaves[(index + 1) % leaves.length]!, near ? 8 : 5, near ? 6 : 4)
  }
  return { bark: trunk, foliage: crown }
}

function createShrub(detail: Detail): PineMeshes {
  const near = detail === 'near', trunk = emptyMesh(), foliage = emptyMesh()
  // Short central stem reaches the planting plane, so the shrub has visible contact with terrain.
  addCylinder(trunk, [0, 0, 0], [0, 0.18, 0], 0.055, near ? 7 : 5)
  const arms = near ? 9 : 5
  for (let index = 0; index < arms; index++) {
    const angle = index * 2.399963229728653
    const length = 0.7 + (index % 3) * 0.13
    const center: Vec3 = [Math.cos(angle) * length * 0.48, 0.45 + (index % 3) * 0.12, Math.sin(angle) * length * 0.48]
    addCylinder(trunk, [0, 0.18, 0], [center[0], center[1], center[2]], 0.035, near ? 5 : 4)
    addLeafCluster(foliage, center, [0.4, 0.38, 0.4], leaves[index % leaves.length]!, near ? 7 : 5, near ? 5 : 3)
  }
  addLeafCluster(foliage, [0, 0.82, 0], [0.52, 0.43, 0.5], leaves[1]!, near ? 8 : 5, near ? 5 : 3)
  return { bark: trunk, foliage }
}

function createGrass(detail: Detail): PineMeshes {
  const foliage = emptyMesh()
  const blades = detail === 'near' ? 18 : 9
  for (let index = 0; index < blades; index++) {
    const angle = index * 2.399963229728653
    const radial = 0.08 + (index % 4) * 0.045
    const height = 0.58 + (index % 5) * 0.12
    const width = 0.075 + (index % 3) * 0.018
    const base: Vec3 = [Math.cos(angle) * radial, 0, Math.sin(angle) * radial]
    const tip: Vec3 = [Math.cos(angle) * (radial + 0.16), height, Math.sin(angle) * (radial + 0.16)]
    const side: Vec3 = [-Math.sin(angle) * width, 0, Math.cos(angle) * width]
    const left: Vec3 = [base[0] - side[0], 0, base[2] - side[2]]
    const right: Vec3 = [base[0] + side[0], 0, base[2] + side[2]]
    const color = leaves[(index + 2) % leaves.length]!
    // Narrow bent blade, two triangles, with crossed orientation coverage and no degenerate stem mesh.
    const mid: Vec3 = [(base[0] + tip[0]) * 0.56, height * 0.56, (base[2] + tip[2]) * 0.56]
    const ml: Vec3 = [mid[0] - side[0] * 0.55, mid[1], mid[2] - side[2] * 0.55]
    const mr: Vec3 = [mid[0] + side[0] * 0.55, mid[1], mid[2] + side[2] * 0.55]
    addLegacyTriangle(foliage, left, ml, mr, color)
    addLegacyTriangle(foliage, left, mr, right, color)
    addLegacyTriangle(foliage, ml, tip, mr, color)
  }
  return { bark: emptyMesh(), foliage }
}

function createTree(species: Species, detail: Detail): PineMeshes {
  if (species === 'pine') return createPine(detail)
  if (species === 'birch') return createBirch(detail)
  if (species === 'shrub') return createShrub(detail)
  if (species === 'grass') return createGrass(detail)
  return createBroadleaf(detail)
}

const geometryCache = new Map<string, PineMeshes>()

function treeGeometry(species: Species, detail: Detail): PineMeshes {
  const key = `${species}:${detail}`
  let geometry = geometryCache.get(key)
  if (!geometry) {
    geometry = createTree(species, detail)
    geometryCache.set(key, geometry)
  }
  return geometry
}

export function trianglesPerPlant(species: Species, detail: Detail): number {
  const geometry = treeGeometry(species, detail)
  return (geometry.bark.indices.length + geometry.foliage.indices.length) / 3
}

function bytesOf(values: Float32Array | Uint16Array): Uint8Array {
  return new Uint8Array(values.buffer, values.byteOffset, values.byteLength)
}

export function buildVegetationGlb(
  plants: readonly Plant[],
  centerX: number,
  centerY: number,
  detail: Detail,
  renderHeights?: ReadonlyMap<number, number>,
): Uint8Array {
  if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) throw new Error('Tile center must be finite.')
  for (const plant of plants) {
    if (![plant.x, plant.y, plant.z, plant.scale, plant.yaw].every(Number.isFinite) || plant.scale <= 0 || !speciesNames.includes(plant.species)) {
      throw new Error('Plant instances need finite transforms and a supported species.')
    }
  }

  const binaryParts: Uint8Array[] = []
  const bufferViews: Record<string, number>[] = []
  const accessors: Record<string, unknown>[] = []
  let byteOffset = 0
  const append = (bytes: Uint8Array, target: number): number => {
    const padding = (4 - byteOffset % 4) % 4
    if (padding) {
      binaryParts.push(new Uint8Array(padding))
      byteOffset += padding
    }
    const index = bufferViews.length
    bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.byteLength, target })
    binaryParts.push(bytes)
    byteOffset += bytes.byteLength
    return index
  }
  const addAccessor = (
    values: Float32Array | Uint16Array,
    target: number,
    componentType: number,
    type: string,
    count: number,
    bounds?: { min: number[]; max: number[] },
  ): number => {
    const view = append(bytesOf(values), target)
    const accessor: Record<string, unknown> = { bufferView: view, componentType, count, type }
    if (bounds) { accessor.min = bounds.min; accessor.max = bounds.max }
    accessors.push(accessor)
    return accessors.length - 1
  }
  const meshes: Record<string, unknown>[] = []
  const nodes: Record<string, unknown>[] = []
  const materials: Record<string, unknown>[] = []
  const images: Record<string, string>[] = []
  const textures: Record<string, number>[] = []
  const samplers: Record<string, number>[] = []
  const sceneNodes: number[] = []
  const arrayBufferTarget = 34962
  const elementArrayBufferTarget = 34963

  samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 })
  const hasPine = plants.some(plant => plant.species === 'pine')
  if (hasPine) {
    images.push(
      { uri: pineTextureUris.canopy, mimeType: 'image/png' },
      { uri: pineTextureUris.bark, mimeType: 'image/jpeg' },
      { uri: pineTextureUris.barkNormal, mimeType: 'image/jpeg' },
    )
    images.forEach((_, index) => textures.push({ sampler: 0, source: index }))
    materials.push({
      name: 'Poly Haven Pine Tree 01 twig atlas, alpha cutout',
      pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.9 },
      alphaMode: 'MASK',
      alphaCutoff: 0.34,
      doubleSided: true,
    })
    materials.push({
      name: 'Poly Haven Pine Tree 01 bark',
      pbrMetallicRoughness: { baseColorTexture: { index: 1 }, metallicFactor: 0, roughnessFactor: 0.94 },
      normalTexture: { index: 2, scale: 0.72 },
    })
  }
  const barkMaterial = hasPine ? 1 : materials.length
  if (!hasPine && plants.length) {
    images.push({ uri: pineTextureUris.bark, mimeType: 'image/jpeg' })
    textures.push({ sampler: 0, source: 0 })
    materials.push({ name: 'Pine Tree 01 bark', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.94 } })
  }
  const broadleafMaterial = materials.length
  if (plants.some(plant => plant.species !== 'pine')) {
    materials.push({ name: 'vertex-colored leaves and understory', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.9 }, doubleSided: true })
  }
  const birchBarkMaterial = materials.length
  if (plants.some(plant => plant.species === 'birch')) {
    materials.push({ name: 'birch light bark', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.94 } })
  }

  for (const species of speciesNames) {
    const instances = plants.filter(plant => plant.species === species)
    if (!instances.length) continue
    const geometry = treeGeometry(species, detail)
    const materialsForSpecies = species === 'pine'
      ? [{ mesh: geometry.foliage, material: 0, foliage: 2 }, { mesh: geometry.bark, material: barkMaterial, foliage: 0 }]
      : [{ mesh: geometry.foliage, material: broadleafMaterial, foliage: 1 }, { mesh: geometry.bark, material: species === 'birch' ? birchBarkMaterial : barkMaterial, foliage: 0 }]
    const primitives = materialsForSpecies.filter(({ mesh }) => mesh.indices.length > 0).map(({ mesh, material, foliage }) => {
      const positions = new Float32Array(mesh.positions)
      const positionMin: number[] = [Infinity, Infinity, Infinity]
      const positionMax: number[] = [-Infinity, -Infinity, -Infinity]
      for (let index = 0; index < positions.length; index += 3) {
        for (let axis = 0; axis < 3; axis++) {
          positionMin[axis] = Math.min(positionMin[axis]!, positions[index + axis]!)
          positionMax[axis] = Math.max(positionMax[axis]!, positions[index + axis]!)
        }
      }
      const attributes: Record<string, number> = {
        POSITION: addAccessor(positions, arrayBufferTarget, 5126, 'VEC3', positions.length / 3, { min: positionMin, max: positionMax }),
        NORMAL: addAccessor(new Float32Array(mesh.normals), arrayBufferTarget, 5126, 'VEC3', mesh.normals.length / 3),
        TEXCOORD_0: addAccessor(new Float32Array(mesh.uvs), arrayBufferTarget, 5126, 'VEC2', mesh.uvs.length / 2),
        _FOLIAGE: addAccessor(new Float32Array(mesh.positions.length / 3).fill(foliage), arrayBufferTarget, 5126, 'SCALAR', mesh.positions.length / 3),
      }
      if (mesh.colors) attributes.COLOR_0 = addAccessor(new Float32Array(mesh.colors), arrayBufferTarget, 5126, 'VEC3', mesh.colors.length / 3)
      const indices = new Uint16Array(mesh.indices)
      return {
        attributes,
        indices: addAccessor(indices, elementArrayBufferTarget, 5123, 'SCALAR', indices.length),
        material,
        mode: 4,
      }
    })
    const translations = new Float32Array(instances.length * 3)
    const rotations = new Float32Array(instances.length * 4)
    const scales = new Float32Array(instances.length * 3)
    const translationMin: number[] = [Infinity, Infinity, Infinity]
    const translationMax: number[] = [-Infinity, -Infinity, -Infinity]
    instances.forEach((plant, index) => {
      const renderHeight = renderHeights?.get(plant.id) ?? plant.z
      if (!Number.isFinite(renderHeight)) throw new Error('Rendered plant root height must be finite.')
      const translation: Vec3 = [plant.x - centerX, renderHeight, -(plant.y - centerY)]
      const halfYaw = plant.yaw / 2
      const rotation: [number, number, number, number] = [0, Math.sin(halfYaw), 0, Math.cos(halfYaw)]
      translations.set(translation, index * 3)
      rotations.set(rotation, index * 4)
      scales.set([plant.scale, plant.scale, plant.scale], index * 3)
      for (let axis = 0; axis < 3; axis++) {
        const stored = translations[index * 3 + axis]!
        translationMin[axis] = Math.min(translationMin[axis]!, stored)
        translationMax[axis] = Math.max(translationMax[axis]!, stored)
      }
    })
    const translationAccessor = addAccessor(translations, arrayBufferTarget, 5126, 'VEC3', instances.length, { min: translationMin, max: translationMax })
    const rotationAccessor = addAccessor(rotations, arrayBufferTarget, 5126, 'VEC4', instances.length)
    const scaleAccessor = addAccessor(scales, arrayBufferTarget, 5126, 'VEC3', instances.length)
    if (!primitives.length) continue
    const mesh = meshes.length
    meshes.push({
      name: species,
      primitives,
    })
    const node = nodes.length
    nodes.push({
      name: `${species}-instances`,
      mesh,
      extensions: {
        EXT_mesh_gpu_instancing: {
          attributes: { TRANSLATION: translationAccessor, ROTATION: rotationAccessor, SCALE: scaleAccessor },
        },
      },
    })
    sceneNodes.push(node)
  }

  const json: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'cesium-demo vegetation-lab' },
    extensionsUsed: ['EXT_mesh_gpu_instancing'],
    extensionsRequired: ['EXT_mesh_gpu_instancing'],
    scene: 0,
    scenes: [{ nodes: sceneNodes }],
    nodes,
    meshes,
    materials,
    images,
    textures,
    samplers,
    accessors,
    bufferViews,
    buffers: [{ byteLength: byteOffset }],
  }
  const jsonRaw = new TextEncoder().encode(JSON.stringify(json))
  const jsonChunkLength = Math.ceil(jsonRaw.length / 4) * 4
  const jsonChunk = new Uint8Array(jsonChunkLength).fill(0x20)
  jsonChunk.set(jsonRaw)
  const binaryRaw = new Uint8Array(byteOffset)
  let cursor = 0
  for (const part of binaryParts) { binaryRaw.set(part, cursor); cursor += part.byteLength }
  const binaryChunkLength = Math.ceil(binaryRaw.length / 4) * 4
  const binaryChunk = new Uint8Array(binaryChunkLength)
  binaryChunk.set(binaryRaw)

  const jsonChunkHeaderBytes = 8
  const binaryChunkHeaderBytes = 8
  const headerBytes = 12
  const totalBytes = headerBytes + jsonChunkHeaderBytes + jsonChunkLength + binaryChunkHeaderBytes + binaryChunkLength
  const glb = new Uint8Array(totalBytes)
  const view = new DataView(glb.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, totalBytes, true)
  view.setUint32(12, jsonChunkLength, true)
  view.setUint32(16, 0x4e4f534a, true)
  glb.set(jsonChunk, 20)
  const binHeaderOffset = 20 + jsonChunkLength
  view.setUint32(binHeaderOffset, binaryChunkLength, true)
  view.setUint32(binHeaderOffset + 4, 0x004e4942, true)
  glb.set(binaryChunk, binHeaderOffset + binaryChunkHeaderBytes)
  return glb
}
