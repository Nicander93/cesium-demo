import { describe, expect, it } from 'vitest'
import { createOfficeGlb } from './office-model'

interface Accessor {
  bufferView: number
  componentType: number
  count: number
  type: string
  min?: number[]
  max?: number[]
}

interface GlbJson {
  asset: { extras: { buildingType: string } }
  materials: Array<{
    name: string
    pbrMetallicRoughness: {
      metallicFactor: number
      roughnessFactor: number
      baseColorFactor: number[]
    }
  }>
  meshes: Array<{
    primitives: Array<{
      attributes: { POSITION: number; NORMAL: number }
      indices: number
      material: number
    }>
  }>
  accessors: Accessor[]
  bufferViews: Array<{ byteOffset?: number; byteLength: number }>
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
  const binaryHeader = 20 + jsonLength
  const binaryLength = view.getUint32(binaryHeader, true)
  expect(view.getUint32(binaryHeader + 4, true)).toBe(0x004e4942)
  return {
    json,
    binary: new DataView(
      bytes.buffer,
      bytes.byteOffset + binaryHeader + 8,
      binaryLength,
    ),
  }
}

function accessorValues(
  json: GlbJson,
  binary: DataView,
  accessorIndex: number,
): number[] {
  const accessor = json.accessors[accessorIndex]!
  const bufferView = json.bufferViews[accessor.bufferView]!
  const start = bufferView.byteOffset ?? 0
  const componentCount = accessor.type === 'VEC3' ? 3 : 1
  const values: number[] = []
  for (let index = 0; index < accessor.count * componentCount; index++) {
    values.push(
      accessor.componentType === 5126
        ? binary.getFloat32(start + index * 4, true)
        : binary.getUint16(start + index * 2, true),
    )
  }
  return values
}

function crossDotNormal(
  a: number[],
  b: number[],
  c: number[],
  n: number[],
): number {
  const ab = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!]
  const ac = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!]
  const cross = [
    ab[1]! * ac[2]! - ab[2]! * ac[1]!,
    ab[2]! * ac[0]! - ab[0]! * ac[2]!,
    ab[0]! * ac[1]! - ab[1]! * ac[0]!,
  ]
  return cross[0]! * n[0]! + cross[1]! * n[1]! + cross[2]! * n[2]!
}

function triangleAreaSum(positions: number[], indices: number[]): number {
  let area = 0
  for (let index = 0; index < indices.length; index += 3) {
    const a = positions.slice(indices[index]! * 3, indices[index]! * 3 + 3)
    const b = positions.slice(
      indices[index + 1]! * 3,
      indices[index + 1]! * 3 + 3,
    )
    const c = positions.slice(
      indices[index + 2]! * 3,
      indices[index + 2]! * 3 + 3,
    )
    const ab = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!]
    const ac = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!]
    area +=
      Math.hypot(
        ab[1]! * ac[2]! - ab[2]! * ac[1]!,
        ab[2]! * ac[0]! - ab[0]! * ac[2]!,
        ab[0]! * ac[1]! - ab[1]! * ac[0]!,
      ) / 2
  }
  return area
}

function getPrimitives(json: GlbJson, binary: DataView) {
  return json.meshes[0]!.primitives.map((primitive) => ({
    primitive,
    positions: accessorValues(json, binary, primitive.attributes.POSITION),
    normals: accessorValues(json, binary, primitive.attributes.NORMAL),
    indices: accessorValues(json, binary, primitive.indices),
  }))
}

describe('createOfficeGlb', () => {
  it('creates bounded, outward-facing four-material office geometry', () => {
    const seenTypes = new Set<string>()
    for (let seed = 1; seed <= 36; seed++) {
      const { json, binary } = decodeGlb(createOfficeGlb(seed))
      seenTypes.add(json.asset.extras.buildingType)
      expect(json.materials).toHaveLength(4)
      expect(json.meshes[0]!.primitives).toHaveLength(4)
      expect(
        json.meshes[0]!.primitives.map((primitive) => primitive.material),
      ).toEqual([0, 1, 2, 3])
      expect(json.materials[1]!.pbrMetallicRoughness).toMatchObject({
        metallicFactor: 0.3,
        roughnessFactor: 0.18,
      })

      const primitives = getPrimitives(json, binary)
      let triangleCount = 0
      for (const { positions, normals, indices, primitive } of primitives) {
        const positionAccessor = json.accessors[primitive.attributes.POSITION]!
        expect(positionAccessor.min).toHaveLength(3)
        expect(positionAccessor.max).toHaveLength(3)
        expect(positions.every(Number.isFinite)).toBe(true)
        expect(normals.every(Number.isFinite)).toBe(true)
        triangleCount += indices.length / 3
        for (let index = 0; index < indices.length; index += 3) {
          const vertexIndices = [
            indices[index]!,
            indices[index + 1]!,
            indices[index + 2]!,
          ]
          const points = vertexIndices.map((vertex) =>
            positions.slice(vertex * 3, vertex * 3 + 3),
          )
          const normal = normals.slice(
            vertexIndices[0]! * 3,
            vertexIndices[0]! * 3 + 3,
          )
          expect(
            crossDotNormal(points[0]!, points[1]!, points[2]!, normal),
          ).toBeGreaterThan(1e-5)
        }
      }
      expect(triangleCount).toBeGreaterThan(250)
      expect(triangleCount).toBeLessThan(15_000)

      const bounds = primitives.map(
        ({ primitive }) => json.accessors[primitive.attributes.POSITION]!,
      )
      const min = [0, 0, 0],
        max = [0, 0, 0]
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(...bounds.map((bound) => bound.min![axis]!))
        max[axis] = Math.max(...bounds.map((bound) => bound.max![axis]!))
      }
      expect(max[0]! - min[0]!).toBeGreaterThanOrEqual(33)
      expect(max[0]! - min[0]!).toBeLessThanOrEqual(53)
      expect(max[2]! - min[2]!).toBeGreaterThanOrEqual(27)
      expect(max[2]! - min[2]!).toBeLessThanOrEqual(44)
      expect(min[1]).toBe(0)
      expect(max[1]!).toBeGreaterThanOrEqual(35)
      expect(max[1]!).toBeLessThanOrEqual(105)
    }
    expect(seenTypes).toEqual(
      new Set(['brick-midrise', 'glass-office', 'stepped-tower']),
    )
  })

  it('gives brick and curtain-wall designs visibly different glazing proportions', () => {
    const glazingRatios = new Map<string, number[]>()
    for (let seed = 1; seed <= 60; seed++) {
      const { json, binary } = decodeGlb(createOfficeGlb(seed))
      const primitives = getPrimitives(json, binary)
      const facadeArea = triangleAreaSum(
        primitives[0]!.positions,
        primitives[0]!.indices,
      )
      const glazingArea = triangleAreaSum(
        primitives[1]!.positions,
        primitives[1]!.indices,
      )
      const ratio = glazingArea / facadeArea
      const type = json.asset.extras.buildingType
      const values = glazingRatios.get(type) ?? []
      values.push(ratio)
      glazingRatios.set(type, values)
      if (type === 'brick-midrise') expect(ratio).toBeLessThan(0.42)
      if (type === 'glass-office') expect(ratio).toBeGreaterThan(0.48)
      if (type === 'stepped-tower') expect(ratio).toBeGreaterThan(0.27)
    }
    expect(glazingRatios.size).toBe(3)
    const mean = (type: string) => {
      const values = glazingRatios.get(type)!
      return values.reduce((sum, value) => sum + value, 0) / values.length
    }
    expect(mean('glass-office')).toBeGreaterThan(mean('brick-midrise') + 0.2)
    expect(mean('stepped-tower')).toBeLessThan(mean('glass-office'))
  })

  it('sets back the upper mass of stepped towers', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { json, binary } = decodeGlb(createOfficeGlb(seed))
      if (json.asset.extras.buildingType !== 'stepped-tower') continue
      const facade = getPrimitives(json, binary)[0]!.positions
      const span = (low: number, high: number) => {
        let min = Infinity,
          max = -Infinity
        for (let index = 0; index < facade.length; index += 3) {
          if (facade[index + 1]! < low || facade[index + 1]! > high) continue
          min = Math.min(min, facade[index]!)
          max = Math.max(max, facade[index]!)
        }
        return max - min
      }
      const bounds = json.meshes[0]!.primitives.map(
        (primitive) => json.accessors[primitive.attributes.POSITION]!,
      )
      const top = Math.max(...bounds.map((bound) => bound.max![1]!))
      const lowerSpan = span(5, 12)
      const upperSpan = span(top - 24, top - 4)
      expect(upperSpan).toBeGreaterThan(0)
      expect(upperSpan).toBeLessThan(lowerSpan * 0.85)
      return
    }
    throw new Error('The seed sample did not contain a stepped tower.')
  })
  it('is deterministic for the same seed and changes massing between seeds', () => {
    expect(createOfficeGlb(104)).toEqual(createOfficeGlb(104))
    expect(createOfficeGlb(104)).not.toEqual(createOfficeGlb(105))
  })
})
