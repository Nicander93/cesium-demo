import { describe, expect, it } from 'vitest'
import { buildVegetationGlb, trianglesPerPlant } from './instancing'
import type { Plant, Species } from './planting'

interface Accessor {
  bufferView: number
  byteOffset?: number
  componentType: number
  count: number
  type: string
  min?: number[]
  max?: number[]
}

interface BufferView {
  buffer: number
  byteOffset: number
  byteLength: number
  target: number
}

interface GlbJson {
  extensionsUsed: string[]
  extensionsRequired: string[]
  scenes: { nodes: number[] }[]
  nodes: { mesh: number; extensions: { EXT_mesh_gpu_instancing: { attributes: Record<string, number> } } }[]
  meshes: { name: Species; primitives: { attributes: Record<string, number>; indices: number; material: number; mode: number }[] }[]
  images: { uri: string; mimeType: string }[]
  textures: { sampler: number; source: number }[]
  samplers: Record<string, number>[]
  materials: { name: string; alphaMode?: string; alphaCutoff?: number; doubleSided?: boolean; normalTexture?: { index: number }; pbrMetallicRoughness?: { baseColorFactor?: number[]; baseColorTexture?: { index: number }; metallicFactor?: number; roughnessFactor?: number } }[]
  accessors: Accessor[]
  bufferViews: BufferView[]
  buffers: { byteLength: number }[]
}

function parseGlb(bytes: Uint8Array): { json: GlbJson; binary: Uint8Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  expect(view.getUint32(0, true)).toBe(0x46546c67)
  expect(view.getUint32(4, true)).toBe(2)
  expect(view.getUint32(8, true)).toBe(bytes.byteLength)
  const jsonLength = view.getUint32(12, true)
  expect(view.getUint32(16, true)).toBe(0x4e4f534a)
  const jsonBytes = bytes.subarray(20, 20 + jsonLength)
  const json = JSON.parse(new TextDecoder().decode(jsonBytes).trim()) as GlbJson
  const binaryHeader = 20 + jsonLength
  const binaryLength = view.getUint32(binaryHeader, true)
  expect(view.getUint32(binaryHeader + 4, true)).toBe(0x004e4942)
  const binary = bytes.subarray(binaryHeader + 8, binaryHeader + 8 + binaryLength)
  expect(binary.byteLength).toBe(json.buffers[0]!.byteLength + ((4 - json.buffers[0]!.byteLength % 4) % 4))
  return { json, binary }
}

function plant(id: number, species: Species, x: number, y: number, z: number, yaw: number): Plant {
  return { id, species, x, y, z, scale: 1.2, yaw }
}

describe('vegetation GLB instancing', () => {
  it('writes aligned views and accessor ranges inside the BIN chunk', () => {
    const { json, binary } = parseGlb(buildVegetationGlb([
      plant(1, 'pine', 12, 24, 3.2, 0.4),
      plant(2, 'pine', 14, 27, 3.4, 1.1),
      plant(3, 'broadleaf', 9, 22, 3.1, 0),
      plant(4, 'birch', 8, 23, 3.2, 0.2),
      plant(5, 'shrub', 7, 25, 3.1, 0.4),
      plant(6, 'grass', 6, 26, 3.0, 0.6),
    ], 10, 20, 'near'))
    const byteSizes = new Map([[5123, 2], [5126, 4]])
    for (const bufferView of json.bufferViews) {
      expect(bufferView.buffer).toBe(0)
      expect(bufferView.byteOffset % 4).toBe(0)
      expect(bufferView.byteOffset + bufferView.byteLength).toBeLessThanOrEqual(json.buffers[0]!.byteLength)
      expect([34962, 34963]).toContain(bufferView.target)
    }
    for (const accessor of json.accessors) {
      const bufferView = json.bufferViews[accessor.bufferView]!
      const components = accessor.type === 'SCALAR' ? 1 : Number(accessor.type.slice(-1))
      const usedBytes = (accessor.byteOffset ?? 0) + accessor.count * components * byteSizes.get(accessor.componentType)!
      expect(usedBytes).toBeLessThanOrEqual(bufferView.byteLength)
      if (accessor.componentType === 5126) {
        const offset = bufferView.byteOffset + (accessor.byteOffset ?? 0)
        const values = new Float32Array(binary.buffer, binary.byteOffset + offset, accessor.count * components)
        expect([...values].every(Number.isFinite)).toBe(true)
      }
    }
    for (const mesh of json.meshes) {
      for (const primitive of mesh.primitives) {
        const positions = json.accessors[primitive.attributes.POSITION]!
        const uvs = json.accessors[primitive.attributes.TEXCOORD_0]!
        expect(uvs.type).toBe('VEC2')
        expect(uvs.count).toBe(positions.count)
      }
    }
    expect(binary.byteLength).toBeGreaterThan(0)
    expect(json.extensionsUsed).toContain('EXT_mesh_gpu_instancing')
  })

  it('keeps one shared mesh per species and the real instance transforms', () => {
    const { json, binary } = parseGlb(buildVegetationGlb([
      plant(1, 'pine', 12, 24, 3.2, 0),
      plant(2, 'pine', 14, 27, 3.4, Math.PI / 2),
      plant(3, 'broadleaf', 9, 22, 3.1, 0),
      plant(4, 'birch', 8, 23, 3.2, 0.2),
      plant(5, 'shrub', 7, 25, 3.1, 0.4),
      plant(6, 'grass', 6, 26, 3.0, 0.6),
    ], 10, 20, 'near'))
    expect(json.meshes.map(mesh => mesh.name).sort()).toEqual(['birch', 'broadleaf', 'grass', 'pine', 'shrub'])
    expect(json.scenes[0]!.nodes).toHaveLength(5)
    expect(json.extensionsRequired).toContain('EXT_mesh_gpu_instancing')
    for (const node of json.nodes) {
      const instanceAttributes = node.extensions.EXT_mesh_gpu_instancing.attributes
      const instanceCounts = ['TRANSLATION', 'ROTATION', 'SCALE'].map(name => json.accessors[instanceAttributes[name]!]!.count)
      expect(instanceCounts[0]).toBe(instanceCounts[1])
      expect(instanceCounts[0]).toBe(instanceCounts[2])
      expect(instanceCounts[0]).toBe(json.meshes[node.mesh]!.name === 'pine' ? 2 : 1)
    }
    const pineNode = json.nodes.find(node => json.meshes[node.mesh]!.name === 'pine')!
    const attributes = pineNode.extensions.EXT_mesh_gpu_instancing.attributes
    const translations = json.accessors[attributes.TRANSLATION]!
    expect(translations.count).toBe(2)
    const translationView = json.bufferViews[translations.bufferView]!
    const translationOffset = translationView.byteOffset + (translations.byteOffset ?? 0)
    const translationData = new Float32Array(binary.buffer, binary.byteOffset + translationOffset, translations.count * 3)
    expect(translationData[0]).toBeCloseTo(2)
    expect(translationData[1]).toBeCloseTo(3.2)
    expect(translationData[2]).toBeCloseTo(-4)
    translations.min?.forEach((value, index) => expect(value).toBeCloseTo([2, 3.2, -7][index]!))
    translations.max?.forEach((value, index) => expect(value).toBeCloseTo([4, 3.4, -4][index]!))
    const rotations = json.accessors[attributes.ROTATION]!
    const rotationView = json.bufferViews[rotations.bufferView]!
    const rotationOffset = rotationView.byteOffset + (rotations.byteOffset ?? 0)
    const rotationData = new Float32Array(binary.buffer, binary.byteOffset + rotationOffset, rotations.count * 4)
    expect(rotationData[5]).toBeCloseTo(Math.sin(Math.PI / 4))
    const pineMesh = json.meshes[pineNode.mesh]!
    const primitive = pineMesh.primitives[0]!
    expect(primitive.attributes).toHaveProperty('TEXCOORD_0')
    expect(primitive.attributes).toHaveProperty('NORMAL')
    expect(primitive.attributes).toHaveProperty('POSITION')
    const pineMaterials = pineMesh.primitives.map(value => json.materials[value.material]!)
    const foliage = pineMaterials.find(value => value.alphaMode === 'MASK')!
    const bark = pineMaterials.find(value => value.normalTexture)
    expect(foliage.alphaCutoff).toBeGreaterThan(0)
    expect(foliage.doubleSided).toBe(true)
    expect(bark?.normalTexture?.index).toBeDefined()
    expect(json.images.map(image => image.uri)).toHaveLength(3)
    expect(json.images[0]!.uri).toContain('twig_basecolor_alpha_1k.png')
    expect(json.textures.map(texture => texture.source)).toEqual([0, 1, 2])
  })

  it('applies rendered mesh heights without overwriting source plant elevations', () => {
    const source = plant(71, 'pine', 12, 24, 3.2, 0.4)
    const { json, binary } = parseGlb(buildVegetationGlb([source], 10, 20, 'near', new Map([[source.id, 8.75]])))
    const node = json.nodes.find(value => json.meshes[value.mesh]!.name === 'pine')!
    const translation = json.accessors[node.extensions.EXT_mesh_gpu_instancing.attributes.TRANSLATION]!
    const view = json.bufferViews[translation.bufferView]!
    const offset = view.byteOffset + (translation.byteOffset ?? 0)
    const values = new Float32Array(binary.buffer, binary.byteOffset + offset, 3)
    expect([...values]).toEqual([2, 8.75, -4])
    expect(source.z).toBe(3.2)
  })

  it('stores the tree mesh on the glTF Y-up height axis', () => {
    const { json, binary } = parseGlb(buildVegetationGlb([plant(1, 'pine', 0, 0, 3, 0)], 0, 0, 'near'))
    const pinePrimitive = json.meshes[0]!.primitives.find(value => json.materials[value.material]!.normalTexture)!
    const positionAccessor = json.accessors[pinePrimitive.attributes.POSITION]!
    expect(positionAccessor.min?.[1]).toBeCloseTo(0)
    expect(positionAccessor.max?.[1]).toBeGreaterThan(8)
    expect(positionAccessor.max?.[1]).toBeLessThan(9)
    const positionView = json.bufferViews[positionAccessor.bufferView]!
    const positionOffset = positionView.byteOffset + (positionAccessor.byteOffset ?? 0)
    const positions = new Float32Array(binary.buffer, binary.byteOffset + positionOffset, positionAccessor.count * 3)
    expect(Math.max(...positions.filter((_, index) => index % 3 === 1))).toBeCloseTo(positionAccessor.max![1]!)
  })

  it('keeps branch-cylinder normals facing away from the branch axis', () => {
    const { json, binary } = parseGlb(buildVegetationGlb([plant(1, 'shrub', 0, 0, 0, 0)], 0, 0, 'near'))
    const mesh = json.meshes.find(value => value.name === 'shrub')!
    const bark = mesh.primitives.find(value => !('COLOR_0' in value.attributes))!
    const read = (accessorIndex: number, components: number): Float32Array => {
      const accessor = json.accessors[accessorIndex]!
      const bufferView = json.bufferViews[accessor.bufferView]!
      return new Float32Array(binary.buffer, binary.byteOffset + bufferView.byteOffset + (accessor.byteOffset ?? 0), accessor.count * components)
    }
    const positions = read(bark.attributes.POSITION!, 3)
    const normals = read(bark.attributes.NORMAL!, 3)
    const accessor = json.accessors[bark.indices]!
    const bufferView = json.bufferViews[accessor.bufferView]!
    const indices = new Uint16Array(binary.buffer, binary.byteOffset + bufferView.byteOffset, accessor.count)
    const arms = Array.from({ length: 9 }, (_, index) => {
      const angle = index * 2.399963229728653
      const length = 0.7 + (index % 3) * 0.13
      return { start: [0, 0.18, 0], end: [Math.cos(angle) * length, 0.45 + (index % 3) * 0.12, Math.sin(angle) * length] }
    })
    let checked = 0, alignment = 0
    for (let index = 42; index < Math.min(indices.length, 72); index += 3) {
      const vertices = [indices[index]!, indices[index + 1]!, indices[index + 2]!]
      const center = [0, 1, 2].map(axis => vertices.reduce((sum, vertex) => sum + positions[vertex * 3 + axis]!, 0) / 3)
      let nearest = { distance: Infinity, radial: [0, 0, 0] }
      for (const arm of arms) {
        const axis = arm.end.map((value, component) => value - arm.start[component]!)
        const relative = center.map((value, component) => value - arm.start[component]!)
        const t = Math.max(0, Math.min(1, relative.reduce((sum, value, component) => sum + value * axis[component]!, 0) / axis.reduce((sum, value) => sum + value * value, 0)))
        const radial = relative.map((value, component) => value - axis[component]! * t)
        const distance = Math.hypot(...radial)
        if (distance < nearest.distance) nearest = { distance, radial }
      }
      if (nearest.distance > 0.02 && nearest.distance < 0.06) {
        const normal = [normals[vertices[0] * 3]!, normals[vertices[0] * 3 + 1]!, normals[vertices[0] * 3 + 2]!]
        alignment += normal.reduce((sum, value, component) => sum + value * nearest.radial[component]!, 0)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
    expect(alignment).toBeGreaterThan(0)
  })

  it('keeps needle cards in the atlas shoot island with finite, correctly wound normals', () => {
    const { json, binary } = parseGlb(buildVegetationGlb([plant(1, 'pine', 0, 0, 0, 0)], 0, 0, 'near'))
    const pineMesh = json.meshes.find(mesh => mesh.name === 'pine')!
    const canopy = pineMesh.primitives.find(value => json.materials[value.material]!.alphaMode === 'MASK')!
    const read = (accessorIndex: number): Float32Array => {
      const accessor = json.accessors[accessorIndex]!
      const bufferView = json.bufferViews[accessor.bufferView]!
      const offset = bufferView.byteOffset + (accessor.byteOffset ?? 0)
      return new Float32Array(binary.buffer, binary.byteOffset + offset, accessor.count * (accessor.type === 'VEC3' ? 3 : 2))
    }
    const positions = read(canopy.attributes.POSITION!)
    const normals = read(canopy.attributes.NORMAL!)
    const uvs = read(canopy.attributes.TEXCOORD_0!)
    const indexAccessor = json.accessors[canopy.indices]!
    const indexView = json.bufferViews[indexAccessor.bufferView]!
    const indices = new Uint16Array(binary.buffer, binary.byteOffset + indexView.byteOffset, indexAccessor.count)

    expect(Math.min(...uvs.filter((_, index) => index % 2 === 0))).toBeGreaterThanOrEqual(0.66)
    expect(Math.max(...uvs.filter((_, index) => index % 2 === 0))).toBeLessThanOrEqual(0.971)
    expect(Math.min(...uvs.filter((_, index) => index % 2 === 1))).toBeGreaterThanOrEqual(0.36)
    expect(Math.max(...uvs.filter((_, index) => index % 2 === 1))).toBeLessThanOrEqual(0.551)
    for (let index = 0; index < indices.length; index += 3) {
      const [a, b, c] = [indices[index]!, indices[index + 1]!, indices[index + 2]!]
      const pa = [positions[a * 3]!, positions[a * 3 + 1]!, positions[a * 3 + 2]!]
      const pb = [positions[b * 3]!, positions[b * 3 + 1]!, positions[b * 3 + 2]!]
      const pc = [positions[c * 3]!, positions[c * 3 + 1]!, positions[c * 3 + 2]!]
      const ab = pb.map((value, axis) => value - pa[axis]!)
      const ac = pc.map((value, axis) => value - pa[axis]!)
      const cross = [ab[1]! * ac[2]! - ab[2]! * ac[1]!, ab[2]! * ac[0]! - ab[0]! * ac[2]!, ab[0]! * ac[1]! - ab[1]! * ac[0]!]
      const crossLength = Math.hypot(...cross)
      expect(crossLength).toBeGreaterThan(1e-6)
      const expectedNormal = cross.map(value => value / crossLength)
      for (const vertex of [a, b, c]) {
        const normal = [normals[vertex * 3]!, normals[vertex * 3 + 1]!, normals[vertex * 3 + 2]!]
        expect(Math.hypot(...normal)).toBeCloseTo(1, 5)
        expect(normal.reduce((sum, value, axis) => sum + value * expectedNormal[axis]!, 0)).toBeGreaterThan(0.999)
      }
    }
  })


  it('builds five distinct species with bounded geometry and no empty primitives', () => {
    const species = ['pine', 'broadleaf', 'birch', 'shrub', 'grass'] as const
    const { json, binary } = parseGlb(buildVegetationGlb(species.map((name, index) => plant(index + 1, name, index, 0, 0, 0)), 0, 0, 'near'))
    expect(json.meshes.map(mesh => mesh.name).sort()).toEqual([...species].sort())
    for (const mesh of json.meshes) {
      expect(mesh.primitives.length).toBeGreaterThan(0)
      for (const primitive of mesh.primitives) {
        const position = json.accessors[primitive.attributes.POSITION]!
        expect(position.count).toBeGreaterThan(0)
        expect(position.min?.every(Number.isFinite)).toBe(true)
        expect(position.max?.every(Number.isFinite)).toBe(true)
        const marker = json.accessors[primitive.attributes._FOLIAGE!]!
        expect(marker.type).toBe('SCALAR')
        expect(marker.componentType).toBe(5126)
        expect(marker.count).toBe(position.count)
        const markerView = json.bufferViews[marker.bufferView]!
        const values = new Float32Array(binary.buffer, binary.byteOffset + markerView.byteOffset + (marker.byteOffset ?? 0), marker.count)
        const material = json.materials[primitive.material]!
        const expectedMarker = material.name === 'birch light bark' || material.normalTexture ? 0 : material.alphaMode === 'MASK' ? 2 : 1
        expect(new Set(values)).toEqual(new Set([expectedMarker]))
      }
    }
    for (const name of species) {
      expect(trianglesPerPlant(name, 'near')).toBeLessThan(6_000)
      expect(trianglesPerPlant(name, 'far')).toBeLessThan(trianglesPerPlant(name, 'near'))
    }
    const birch = json.meshes.find(mesh => mesh.name === 'birch')!
    const birchBark = birch.primitives.find(primitive => json.materials[primitive.material]!.name === 'birch light bark')!
    expect(birchBark.attributes).toHaveProperty('COLOR_0')
    expect(json.materials[birchBark.material]!.pbrMetallicRoughness!.baseColorFactor).toEqual([1, 1, 1, 1])
  })

  it('keeps every near and far primitive non-degenerate after Float32 GLB encoding', () => {
    const species = ['pine', 'broadleaf', 'birch', 'shrub', 'grass'] as const
    for (const detail of ['near', 'far'] as const) {
      const { json, binary } = parseGlb(buildVegetationGlb(species.map((name, index) => plant(index + 1, name, index, 0, 0, 0)), 0, 0, detail))
      for (const mesh of json.meshes) {
        for (const primitive of mesh.primitives) {
          const read = (accessorIndex: number, components: number): Float32Array => {
            const accessor = json.accessors[accessorIndex]!
            const view = json.bufferViews[accessor.bufferView]!
            return new Float32Array(binary.buffer, binary.byteOffset + view.byteOffset + (accessor.byteOffset ?? 0), accessor.count * components)
          }
          const positions = read(primitive.attributes.POSITION!, 3)
          const normals = read(primitive.attributes.NORMAL!, 3)
          const indexAccessor = json.accessors[primitive.indices]!
          const indexView = json.bufferViews[indexAccessor.bufferView]!
          const indices = new Uint16Array(binary.buffer, binary.byteOffset + indexView.byteOffset + (indexAccessor.byteOffset ?? 0), indexAccessor.count)
          for (let index = 0; index < indices.length; index += 3) {
            const vertices = [indices[index]!, indices[index + 1]!, indices[index + 2]!]
            const points = vertices.map(vertex => [positions[vertex * 3]!, positions[vertex * 3 + 1]!, positions[vertex * 3 + 2]!])
            const ab = points[1]!.map((value, axis) => value - points[0]![axis]!)
            const ac = points[2]!.map((value, axis) => value - points[0]![axis]!)
            const cross = [ab[1]! * ac[2]! - ab[2]! * ac[1]!, ab[2]! * ac[0]! - ab[0]! * ac[2]!, ab[0]! * ac[1]! - ab[1]! * ac[0]!]
            const area = Math.hypot(...cross) / 2
            expect(area, `${mesh.name}/${detail} triangle ${index / 3}`).toBeGreaterThan(1e-8)
            const faceNormal = cross.map(value => value / Math.hypot(...cross))
            for (const vertex of vertices) {
              const normal = [normals[vertex * 3]!, normals[vertex * 3 + 1]!, normals[vertex * 3 + 2]!]
              expect(Math.hypot(...normal)).toBeCloseTo(1, 4)
              expect(normal.reduce((sum, value, axis) => sum + value * faceNormal[axis]!, 0)).toBeGreaterThan(0.999)
            }
          }
        }
      }
    }
  })

  it('returns a valid empty GLB when no plants are present', () => {
    const { json, binary } = parseGlb(buildVegetationGlb([], 0, 0, 'far'))
    expect(json.nodes).toEqual([])
    expect(json.meshes).toEqual([])
    expect(json.scenes[0]!.nodes).toEqual([])
    expect(binary.byteLength).toBe(0)
  })

  it('grounds every species mesh at the Y-up planting plane in both LODs', () => {
    const species = ['pine', 'broadleaf', 'birch', 'shrub', 'grass'] as const
    for (const detail of ['near', 'far'] as const) {
      const { json } = parseGlb(buildVegetationGlb(species.map((name, index) => plant(index + 1, name, index, 0, 0, 0)), 0, 0, detail))
      for (const mesh of json.meshes) {
        const lowestY = Math.min(...mesh.primitives.map(primitive => json.accessors[primitive.attributes.POSITION]!.min![1]!))
        expect(lowestY, `${mesh.name}/${detail} root height`).toBeGreaterThanOrEqual(-0.001)
        expect(lowestY, `${mesh.name}/${detail} root height`).toBeLessThanOrEqual(0.001)
      }
    }
  })

  it('keeps exact near and far triangle budgets for all species', () => {
    const expected = {
      pine: [3494, 380],
      broadleaf: [1106, 224],
      birch: [1188, 224],
      shrub: [672, 170],
      grass: [54, 27],
    } as const
    for (const [species, [near, far]] of Object.entries(expected) as [Species, readonly [number, number]][]) {
      expect(trianglesPerPlant(species, 'near')).toBe(near)
      expect(trianglesPerPlant(species, 'far')).toBe(far)
    }
  })
})
