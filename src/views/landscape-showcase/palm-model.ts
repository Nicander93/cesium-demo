import { srgbToLinearColor } from './gltf-color.ts'
import type { CoastPalmPlacement } from './coast-layout'

interface PalmMeshData {
  positions: ArrayLike<number>
  normals: ArrayLike<number>
  indices: ArrayLike<number>
}

export interface PalmPrototypeGeometry {
  trunk: PalmMeshData
  foliage: PalmMeshData
  tips: PalmMeshData
}

interface CesiumGeometryLike {
  attributes: {
    position?: { values: ArrayLike<number> }
    normal?: { values: ArrayLike<number> }
  }
  indices?: ArrayLike<number>
}

const FLOAT = 5126
const UNSIGNED_SHORT = 5123
const ARRAY_BUFFER = 34962
const ELEMENT_ARRAY_BUFFER = 34963
const MATERIAL_COLORS = [
  [141 / 255, 120 / 255, 92 / 255, 1],
  [62 / 255, 113 / 255, 59 / 255, 1],
  [102 / 255, 131 / 255, 74 / 255, 1],
] as const

/** Copies Cesium's z-up palm geometry into plain array data for GLB packing. */
export function readPalmGeometry(geometry: CesiumGeometryLike): PalmMeshData {
  const positions = geometry.attributes.position?.values
  const normals = geometry.attributes.normal?.values
  const indices = geometry.indices
  if (!positions || !normals || !indices)
    throw new Error('Palm prototype geometry is incomplete.')
  return { positions, normals, indices }
}

function bytesOf(values: Float32Array | Uint16Array): Uint8Array {
  return new Uint8Array(values.buffer, values.byteOffset, values.byteLength)
}

/** Packs six reusable palm meshes and all fixed coast placements into one Y-up instanced GLB. */
export function buildCoastPalmGlb(
  placements: readonly CoastPalmPlacement[],
  prototypes: readonly PalmPrototypeGeometry[],
): Uint8Array {
  if (prototypes.length !== 6)
    throw new Error('The coastal palm GLB expects six geometry prototypes.')
  for (const placement of placements) {
    if (
      ![
        placement.x,
        placement.y,
        placement.height,
        placement.crown,
        placement.heading,
        placement.groundHeight,
      ].every(Number.isFinite) ||
      placement.height <= 0 ||
      placement.crown <= 0 ||
      !Number.isInteger(placement.prototype) ||
      placement.prototype < 0 ||
      placement.prototype >= prototypes.length
    )
      throw new Error('Palm placement contains invalid instance data.')
  }

  const binaryParts: Uint8Array[] = []
  const bufferViews: Record<string, number>[] = []
  const accessors: Record<string, unknown>[] = []
  let binaryLength = 0
  const append = (bytes: Uint8Array, target: number): number => {
    const padding = (4 - (binaryLength % 4)) % 4
    if (padding) {
      binaryParts.push(new Uint8Array(padding))
      binaryLength += padding
    }
    const index = bufferViews.length
    bufferViews.push({
      buffer: 0,
      byteOffset: binaryLength,
      byteLength: bytes.byteLength,
      target,
    })
    binaryParts.push(bytes)
    binaryLength += bytes.byteLength
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
    const bufferView = append(bytesOf(values), target)
    const accessor: Record<string, unknown> = {
      bufferView,
      componentType,
      count,
      type,
    }
    if (bounds) {
      accessor.min = bounds.min
      accessor.max = bounds.max
    }
    accessors.push(accessor)
    return accessors.length - 1
  }

  let geometryTriangles = 0
  let drawTriangles = 0
  const meshes = prototypes.map((prototype, prototypeIndex) => {
    const partGeometries = [prototype.trunk, prototype.foliage, prototype.tips]
    const primitives = partGeometries.map((part, material) => {
      if (
        part.positions.length % 3 ||
        part.normals.length !== part.positions.length ||
        part.indices.length % 3
      ) {
        throw new Error(
          `Palm prototype ${prototypeIndex} has malformed ${material} geometry.`,
        )
      }
      if (part.positions.length / 3 > 65535)
        throw new Error('Palm prototype exceeds the 16-bit vertex budget.')
      const positions = new Float32Array(part.positions.length)
      const normals = new Float32Array(part.normals.length)
      const vertexMin = [Infinity, Infinity, Infinity]
      const vertexMax = [-Infinity, -Infinity, -Infinity]
      for (let index = 0; index < part.positions.length; index += 3) {
        const x = part.positions[index]!
        const y = part.positions[index + 1]!
        const z = part.positions[index + 2]!
        const nx = part.normals[index]!
        const ny = part.normals[index + 1]!
        const nz = part.normals[index + 2]!
        const convertedPosition = [x, z, -y]
        const convertedNormal = [nx, nz, -ny]
        for (let axis = 0; axis < 3; axis++) {
          const position = convertedPosition[axis]!
          const normal = convertedNormal[axis]!
          if (!Number.isFinite(position) || !Number.isFinite(normal))
            throw new Error('Palm prototype has non-finite vertex data.')
          positions[index + axis] = position
          normals[index + axis] = normal
          vertexMin[axis] = Math.min(vertexMin[axis]!, position)
          vertexMax[axis] = Math.max(vertexMax[axis]!, position)
        }
      }
      const indices = new Uint16Array(part.indices.length)
      for (let index = 0; index < part.indices.length; index++) {
        const vertex = part.indices[index]!
        if (
          !Number.isInteger(vertex) ||
          vertex < 0 ||
          vertex >= positions.length / 3
        ) {
          throw new Error(
            `Palm prototype ${prototypeIndex} has an invalid index.`,
          )
        }
        indices[index] = vertex
      }
      const triangles = indices.length / 3
      geometryTriangles += triangles
      drawTriangles +=
        triangles *
        placements.filter((item) => item.prototype === prototypeIndex).length
      const attributes = {
        POSITION: addAccessor(
          positions,
          ARRAY_BUFFER,
          FLOAT,
          'VEC3',
          positions.length / 3,
          { min: vertexMin, max: vertexMax },
        ),
        NORMAL: addAccessor(
          normals,
          ARRAY_BUFFER,
          FLOAT,
          'VEC3',
          normals.length / 3,
        ),
      }
      return {
        attributes,
        indices: addAccessor(
          indices,
          ELEMENT_ARRAY_BUFFER,
          UNSIGNED_SHORT,
          'SCALAR',
          indices.length,
        ),
        material,
        mode: 4,
      }
    })
    return { name: `palm-prototype-${prototypeIndex}`, primitives }
  })

  const nodes = prototypes.map((_prototype, prototypeIndex) => {
    const instances = placements.filter(
      (placement) => placement.prototype === prototypeIndex,
    )
    const translations = new Float32Array(instances.length * 3)
    const rotations = new Float32Array(instances.length * 4)
    const scales = new Float32Array(instances.length * 3)
    const translationMin = [Infinity, Infinity, Infinity]
    const translationMax = [-Infinity, -Infinity, -Infinity]
    instances.forEach((placement, index) => {
      const translation = [placement.x, placement.groundHeight, -placement.y]
      const halfHeading = placement.heading / 2
      const rotation = [0, Math.sin(halfHeading), 0, Math.cos(halfHeading)]
      const scale = [placement.crown, placement.height / 16, placement.crown]
      translations.set(translation, index * 3)
      rotations.set(rotation, index * 4)
      scales.set(scale, index * 3)
      for (let axis = 0; axis < 3; axis++) {
        translationMin[axis] = Math.min(
          translationMin[axis]!,
          translation[axis]!,
        )
        translationMax[axis] = Math.max(
          translationMax[axis]!,
          translation[axis]!,
        )
      }
    })
    const attributes: Record<string, number> = {
      ROTATION: addAccessor(
        rotations,
        ARRAY_BUFFER,
        FLOAT,
        'VEC4',
        instances.length,
      ),
      SCALE: addAccessor(scales, ARRAY_BUFFER, FLOAT, 'VEC3', instances.length),
    }
    if (instances.length) {
      attributes.TRANSLATION = addAccessor(
        translations,
        ARRAY_BUFFER,
        FLOAT,
        'VEC3',
        instances.length,
        { min: translationMin, max: translationMax },
      )
    } else {
      throw new Error(`Palm prototype ${prototypeIndex} has no placements.`)
    }
    return {
      name: `palm-instances-${prototypeIndex}`,
      mesh: prototypeIndex,
      extensions: { EXT_mesh_gpu_instancing: { attributes } },
    }
  })

  const materials = [
    {
      name: 'Warm palm trunk',
      pbrMetallicRoughness: {
        baseColorFactor: srgbToLinearColor(MATERIAL_COLORS[0]),
        metallicFactor: 0,
        roughnessFactor: 0.88,
      },
    },
    {
      name: 'Deep green palm fronds',
      pbrMetallicRoughness: {
        baseColorFactor: srgbToLinearColor(MATERIAL_COLORS[1]),
        metallicFactor: 0,
        roughnessFactor: 0.84,
      },
      doubleSided: true,
    },
    {
      name: 'Light green frond tips',
      pbrMetallicRoughness: {
        baseColorFactor: srgbToLinearColor(MATERIAL_COLORS[2]),
        metallicFactor: 0,
        roughnessFactor: 0.84,
      },
      doubleSided: true,
    },
  ]
  const json = {
    asset: {
      version: '2.0',
      generator: 'cesium-demo coastal palm instancing',
      extras: {
        instanceCount: placements.length,
        prototypeCount: prototypes.length,
        geometryTriangles,
        drawTriangles,
      },
    },
    extensionsUsed: ['EXT_mesh_gpu_instancing'],
    extensionsRequired: ['EXT_mesh_gpu_instancing'],
    scene: 0,
    scenes: [{ nodes: nodes.map((_node, index) => index) }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binaryLength }],
  }
  const jsonRaw = new TextEncoder().encode(JSON.stringify(json))
  const jsonLength = Math.ceil(jsonRaw.length / 4) * 4
  const jsonChunk = new Uint8Array(jsonLength).fill(0x20)
  jsonChunk.set(jsonRaw)
  const binaryRaw = new Uint8Array(binaryLength)
  let cursor = 0
  for (const part of binaryParts) {
    binaryRaw.set(part, cursor)
    cursor += part.byteLength
  }
  const binaryChunk = new Uint8Array(Math.ceil(binaryRaw.length / 4) * 4)
  binaryChunk.set(binaryRaw)

  const totalLength = 12 + 8 + jsonChunk.length + 8 + binaryChunk.length
  const glb = new Uint8Array(totalLength)
  const view = new DataView(glb.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, totalLength, true)
  view.setUint32(12, jsonChunk.length, true)
  view.setUint32(16, 0x4e4f534a, true)
  glb.set(jsonChunk, 20)
  const binaryHeader = 20 + jsonChunk.length
  view.setUint32(binaryHeader, binaryChunk.length, true)
  view.setUint32(binaryHeader + 4, 0x004e4942, true)
  glb.set(binaryChunk, binaryHeader + 8)
  return glb
}
