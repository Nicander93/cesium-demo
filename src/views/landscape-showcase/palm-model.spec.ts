import { describe, expect, it } from 'vitest'
import { createPalmGeometry } from './palm-geometry'
import { buildCoastPalmGlb, readPalmGeometry } from './palm-model'
import { createCoastPalmPlacements } from './coast-layout'

interface Accessor {
  bufferView: number
  componentType: number
  count: number
  type: string
  min?: number[]
  max?: number[]
}

interface GlbJson {
  asset: {
    extras: {
      instanceCount: number
      prototypeCount: number
      geometryTriangles: number
      drawTriangles: number
    }
  }
  extensionsUsed: string[]
  extensionsRequired: string[]
  scenes: Array<{ nodes: number[] }>
  nodes: Array<{
    mesh: number
    extensions: {
      EXT_mesh_gpu_instancing: { attributes: Record<string, number> }
    }
  }>
  meshes: Array<{
    primitives: Array<{
      attributes: { POSITION: number; NORMAL: number }
      indices: number
      material: number
    }>
  }>
  materials: Array<{
    name: string
    doubleSided?: boolean
    pbrMetallicRoughness: {
      baseColorFactor: number[]
      metallicFactor: number
      roughnessFactor: number
    }
  }>
  accessors: Accessor[]
  bufferViews: Array<{
    byteOffset?: number
    byteLength: number
    target: number
  }>
}

function decodeGlb(bytes: Uint8Array): { json: GlbJson; binary: DataView } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  expect(view.getUint32(0, true)).toBe(0x46546c67)
  expect(view.getUint32(4, true)).toBe(2)
  expect(view.getUint32(8, true)).toBe(bytes.byteLength)
  const jsonLength = view.getUint32(12, true)
  expect(view.getUint32(16, true)).toBe(0x4e4f534a)
  const json = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trim(),
  ) as GlbJson
  const binaryOffset = 20 + jsonLength
  const binaryLength = view.getUint32(binaryOffset, true)
  expect(view.getUint32(binaryOffset + 4, true)).toBe(0x004e4942)
  return {
    json,
    binary: new DataView(
      bytes.buffer,
      bytes.byteOffset + binaryOffset + 8,
      binaryLength,
    ),
  }
}

function values(
  json: GlbJson,
  binary: DataView,
  accessorIndex: number,
): number[] {
  const accessor = json.accessors[accessorIndex]!
  const bufferView = json.bufferViews[accessor.bufferView]!
  const count = accessor.type === 'VEC4' ? 4 : accessor.type === 'VEC3' ? 3 : 1
  const componentBytes = accessor.componentType === 5126 ? 4 : 2
  const result: number[] = []
  for (let index = 0; index < accessor.count * count; index++) {
    result.push(
      accessor.componentType === 5126
        ? binary.getFloat32(
            (bufferView.byteOffset ?? 0) + index * componentBytes,
            true,
          )
        : binary.getUint16(
            (bufferView.byteOffset ?? 0) + index * componentBytes,
            true,
          ),
    )
  }
  return result
}

function expectClose(actual: number[], expected: number[]): void {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((value, index) =>
    expect(value).toBeCloseTo(expected[index]!, 5),
  )
}
function crossDotNormal(
  a: number[],
  b: number[],
  c: number[],
  n: number[],
): number {
  const ab = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!]
  const ac = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!]
  return (
    (ab[1]! * ac[2]! - ab[2]! * ac[1]!) * n[0]! +
    (ab[2]! * ac[0]! - ab[0]! * ac[2]!) * n[1]! +
    (ab[0]! * ac[1]! - ab[1]! * ac[0]!) * n[2]!
  )
}

function build(): {
  bytes: Uint8Array
  placements: ReturnType<typeof createCoastPalmPlacements>
} {
  const placements = createCoastPalmPlacements()
  const prototypes = Array.from({ length: 6 }, (_, seed) => {
    const geometry = createPalmGeometry(seed)
    return {
      trunk: readPalmGeometry(geometry.trunk),
      foliage: readPalmGeometry(geometry.foliage),
      tips: readPalmGeometry(geometry.tips),
    }
  })
  return { bytes: buildCoastPalmGlb(placements, prototypes), placements }
}

describe('coastal palm instancing GLB', () => {
  it('packs 123 instances over six three-material Y-up prototypes within the GLB budget', () => {
    const { bytes, placements } = build()
    const { json, binary } = decodeGlb(bytes)
    expect(placements).toHaveLength(123)
    expect(json.asset.extras.instanceCount).toBe(123)
    expect(json.asset.extras.prototypeCount).toBe(6)
    expect(json.extensionsUsed).toContain('EXT_mesh_gpu_instancing')
    expect(json.extensionsRequired).toContain('EXT_mesh_gpu_instancing')
    expect(json.scenes[0]!.nodes).toHaveLength(6)
    expect(json.meshes).toHaveLength(6)
    expect(json.meshes.every((mesh) => mesh.primitives.length === 3)).toBe(true)
    expect(json.materials).toHaveLength(3)
    expect(json.materials.map((material) => material.name)).toEqual([
      'Warm palm trunk',
      'Deep green palm fronds',
      'Light green frond tips',
    ])
    expect(json.materials[1]!.doubleSided).toBe(true)
    expect(json.materials[2]!.doubleSided).toBe(true)

    let geometryTriangles = 0
    let drawTriangles = 0
    for (let prototype = 0; prototype < 6; prototype++) {
      const node = json.nodes[prototype]!
      const mesh = json.meshes[node.mesh]!
      const attributes = node.extensions.EXT_mesh_gpu_instancing.attributes
      const instanceCount = placements.filter(
        (placement) => placement.prototype === prototype,
      ).length
      for (const key of ['TRANSLATION', 'ROTATION', 'SCALE']) {
        expect(json.accessors[attributes[key]!]!.count).toBe(instanceCount)
      }
      for (const primitive of mesh.primitives) {
        const positionAccessor = json.accessors[primitive.attributes.POSITION]!
        const normalAccessor = json.accessors[primitive.attributes.NORMAL]!
        const positions = values(json, binary, primitive.attributes.POSITION)
        const normals = values(json, binary, primitive.attributes.NORMAL)
        const indices = values(json, binary, primitive.indices)
        expect(positionAccessor.type).toBe('VEC3')
        expect(normalAccessor.count).toBe(positionAccessor.count)
        expect(positions.every(Number.isFinite)).toBe(true)
        expect(normals.every(Number.isFinite)).toBe(true)
        expect(indices.every((index) => index < positionAccessor.count)).toBe(
          true,
        )
        for (let index = 0; index < indices.length; index += 3) {
          const vertices = [
            indices[index]!,
            indices[index + 1]!,
            indices[index + 2]!,
          ]
          const points = vertices.map((vertex) =>
            positions.slice(vertex * 3, vertex * 3 + 3),
          )
          const normal = normals.slice(vertices[0]! * 3, vertices[0]! * 3 + 3)
          expect(
            crossDotNormal(points[0]!, points[1]!, points[2]!, normal),
          ).toBeGreaterThan(1e-8)
        }
        geometryTriangles += indices.length / 3
        drawTriangles += (indices.length / 3) * instanceCount
      }
    }
    expect(json.asset.extras.geometryTriangles).toBe(geometryTriangles)
    expect(json.asset.extras.drawTriangles).toBe(drawTriangles)
    expect(geometryTriangles).toBe(10_440)
    expect(drawTriangles).toBe(214_020)
    expect(bytes.byteLength).toBeLessThan(1_500_000)
  })

  it('converts z-up prototype vertices and keeps ENU placement transforms', () => {
    const { bytes, placements } = build()
    const { json, binary } = decodeGlb(bytes)
    const source = readPalmGeometry(createPalmGeometry(0).trunk)
    const trunkPositions = values(
      json,
      binary,
      json.meshes[0]!.primitives[0]!.attributes.POSITION,
    )
    const trunkNormals = values(
      json,
      binary,
      json.meshes[0]!.primitives[0]!.attributes.NORMAL,
    )
    expectClose(trunkPositions.slice(0, 3), [
      source.positions[0]!,
      source.positions[2]!,
      -source.positions[1]!,
    ])
    expectClose(trunkNormals.slice(0, 3), [
      source.normals[0]!,
      source.normals[2]!,
      -source.normals[1]!,
    ])

    const first = placements.find((placement) => placement.prototype === 0)!
    const node = json.nodes[0]!
    const attributes = node.extensions.EXT_mesh_gpu_instancing.attributes
    const translation = values(json, binary, attributes.TRANSLATION)
    const rotation = values(json, binary, attributes.ROTATION)
    const scale = values(json, binary, attributes.SCALE)
    const instanceIndex = placements
      .filter((placement) => placement.prototype === 0)
      .indexOf(first)
    expectClose(translation.slice(instanceIndex * 3, instanceIndex * 3 + 3), [
      first.x,
      first.groundHeight,
      -first.y,
    ])
    expectClose(rotation.slice(instanceIndex * 4, instanceIndex * 4 + 4), [
      0,
      Math.sin(first.heading / 2),
      0,
      Math.cos(first.heading / 2),
    ])
    expectClose(scale.slice(instanceIndex * 3, instanceIndex * 3 + 3), [
      first.crown,
      first.height / 16,
      first.crown,
    ])
  })
})
