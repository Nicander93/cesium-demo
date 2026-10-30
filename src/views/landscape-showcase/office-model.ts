import { srgbToLinearColor } from './gltf-color.ts'
type Vec3 = [number, number, number]
type Color = [number, number, number, number]
type OfficeType = 'brick-midrise' | 'glass-office' | 'stepped-tower'
type FacadeStyle = 'brick' | 'curtain-wall'

interface MeshData {
  positions: number[]
  normals: number[]
  indices: number[]
}

interface FaceFrame {
  center: Vec3
  tangent: Vec3
  normal: Vec3
  width: number
}

interface FacadeStyleOptions {
  paneWidth: number
  paneHeight: number
  sillRatio: number
  bayWidth: number
  finEvery: number
  finWidth: number
  finDepth: number
  bandHeight: number
  bandDepth: number
}

const FLOAT_COMPONENT = 5126
const UNSIGNED_SHORT_COMPONENT = 5123
const ARRAY_BUFFER = 34962
const ELEMENT_ARRAY_BUFFER = 34963
const PARAPET_HEIGHT = 1.1

function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x6d2b79f5
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function emptyMesh(): MeshData {
  return { positions: [], normals: [], indices: [] }
}

function addQuad(
  mesh: MeshData,
  a: Vec3,
  b: Vec3,
  c: Vec3,
  d: Vec3,
  normal: Vec3,
): void {
  const start = mesh.positions.length / 3
  for (const point of [a, b, c, d]) {
    mesh.positions.push(...point)
    mesh.normals.push(...normal)
  }
  mesh.indices.push(start, start + 1, start + 2, start, start + 2, start + 3)
}

function facePoint(frame: FaceFrame, u: number, y: number, offset = 0): Vec3 {
  return [
    frame.center[0] + frame.tangent[0] * u + frame.normal[0] * offset,
    y,
    frame.center[2] + frame.tangent[2] * u + frame.normal[2] * offset,
  ]
}

function addFacadePrism(
  mesh: MeshData,
  frame: FaceFrame,
  uMin: number,
  uMax: number,
  yMin: number,
  yMax: number,
  front: number,
  depth: number,
): void {
  if (uMax <= uMin || yMax <= yMin || depth <= 0) return
  const back = front - depth
  const p = (u: number, y: number, offset: number) =>
    facePoint(frame, u, y, offset)
  const u0 = uMin,
    u1 = uMax,
    y0 = yMin,
    y1 = yMax,
    d0 = back,
    d1 = front
  // Thin extruded bands and fins cast a small but legible self-shadow on the wall.
  addQuad(
    mesh,
    p(u0, y0, d1),
    p(u1, y0, d1),
    p(u1, y1, d1),
    p(u0, y1, d1),
    frame.normal,
  )
  addQuad(mesh, p(u0, y0, d0), p(u0, y1, d0), p(u1, y1, d0), p(u1, y0, d0), [
    -frame.normal[0],
    0,
    -frame.normal[2],
  ])
  addQuad(mesh, p(u0, y0, d0), p(u0, y0, d1), p(u0, y1, d1), p(u0, y1, d0), [
    -frame.tangent[0],
    0,
    -frame.tangent[2],
  ])
  addQuad(
    mesh,
    p(u1, y0, d0),
    p(u1, y1, d0),
    p(u1, y1, d1),
    p(u1, y0, d1),
    frame.tangent,
  )
  addQuad(
    mesh,
    p(u0, y0, d0),
    p(u1, y0, d0),
    p(u1, y0, d1),
    p(u0, y0, d1),
    [0, -1, 0],
  )
  addQuad(
    mesh,
    p(u0, y1, d0),
    p(u0, y1, d1),
    p(u1, y1, d1),
    p(u1, y1, d0),
    [0, 1, 0],
  )
}

function addBox(
  mesh: MeshData,
  xMin: number,
  yMin: number,
  zMin: number,
  xMax: number,
  yMax: number,
  zMax: number,
): void {
  if (xMax <= xMin || yMax <= yMin || zMax <= zMin) return
  addQuad(
    mesh,
    [xMin, yMin, zMin],
    [xMax, yMin, zMin],
    [xMax, yMin, zMax],
    [xMin, yMin, zMax],
    [0, -1, 0],
  )
  addQuad(
    mesh,
    [xMin, yMax, zMin],
    [xMin, yMax, zMax],
    [xMax, yMax, zMax],
    [xMax, yMax, zMin],
    [0, 1, 0],
  )
  addQuad(
    mesh,
    [xMin, yMin, zMin],
    [xMin, yMax, zMin],
    [xMax, yMax, zMin],
    [xMax, yMin, zMin],
    [0, 0, -1],
  )
  addQuad(
    mesh,
    [xMax, yMin, zMax],
    [xMax, yMax, zMax],
    [xMin, yMax, zMax],
    [xMin, yMin, zMax],
    [0, 0, 1],
  )
  addQuad(
    mesh,
    [xMin, yMin, zMax],
    [xMin, yMax, zMax],
    [xMin, yMax, zMin],
    [xMin, yMin, zMin],
    [-1, 0, 0],
  )
  addQuad(
    mesh,
    [xMax, yMin, zMin],
    [xMax, yMax, zMin],
    [xMax, yMax, zMax],
    [xMax, yMin, zMax],
    [1, 0, 0],
  )
}

function addRoof(
  mesh: MeshData,
  width: number,
  depth: number,
  height: number,
): void {
  const x = width / 2,
    z = depth / 2,
    parapet = PARAPET_HEIGHT
  addQuad(
    mesh,
    [-x, height, -z],
    [-x, height, z],
    [x, height, z],
    [x, height, -z],
    [0, 1, 0],
  )
  addQuad(
    mesh,
    [-x, height, -z],
    [-x, height + parapet, -z],
    [x, height + parapet, -z],
    [x, height, -z],
    [0, 0, -1],
  )
  addQuad(
    mesh,
    [x, height, z],
    [x, height + parapet, z],
    [-x, height + parapet, z],
    [-x, height, z],
    [0, 0, 1],
  )
  addQuad(
    mesh,
    [-x, height, z],
    [-x, height + parapet, z],
    [-x, height + parapet, -z],
    [-x, height, -z],
    [-1, 0, 0],
  )
  addQuad(
    mesh,
    [x, height, -z],
    [x, height + parapet, -z],
    [x, height + parapet, z],
    [x, height, z],
    [1, 0, 0],
  )
}

function addFlatRoof(
  mesh: MeshData,
  width: number,
  depth: number,
  height: number,
): void {
  const x = width / 2,
    z = depth / 2
  addQuad(
    mesh,
    [-x, height, -z],
    [-x, height, z],
    [x, height, z],
    [x, height, -z],
    [0, 1, 0],
  )
}

function frameForSide(side: number, width: number, depth: number): FaceFrame {
  const halfWidth = width / 2,
    halfDepth = depth / 2
  const faces: FaceFrame[] = [
    {
      center: [0, 0, -halfDepth],
      tangent: [-1, 0, 0],
      normal: [0, 0, -1],
      width,
    },
    {
      center: [halfWidth, 0, 0],
      tangent: [0, 0, -1],
      normal: [1, 0, 0],
      width: depth,
    },
    { center: [0, 0, halfDepth], tangent: [1, 0, 0], normal: [0, 0, 1], width },
    {
      center: [-halfWidth, 0, 0],
      tangent: [0, 0, 1],
      normal: [-1, 0, 0],
      width: depth,
    },
  ]
  return faces[side]!
}

const facadeStyles: Record<FacadeStyle, FacadeStyleOptions> = {
  brick: {
    bayWidth: 5.6,
    paneWidth: 0.54,
    paneHeight: 0.56,
    sillRatio: 0.24,
    finEvery: 2,
    finWidth: 0.38,
    finDepth: 0.32,
    bandHeight: 0.24,
    bandDepth: 0.38,
  },
  'curtain-wall': {
    bayWidth: 5.2,
    paneWidth: 0.88,
    paneHeight: 0.76,
    sillRatio: 0.14,
    finEvery: 1,
    finWidth: 0.16,
    finDepth: 0.22,
    bandHeight: 0.14,
    bandDepth: 0.28,
  },
}

function addFacade(
  meshes: { facade: MeshData; glass: MeshData; trim: MeshData },
  width: number,
  depth: number,
  yStart: number,
  floors: number,
  floorHeight: number,
  styleName: FacadeStyle,
  styleColor: OfficeType,
): void {
  const style = facadeStyles[styleName]
  const height = yStart + floors * floorHeight
  const sideFrames = Array.from({ length: 4 }, (_, side) =>
    frameForSide(side, width, depth),
  )

  for (const frame of sideFrames) {
    const bays = Math.max(4, Math.round(frame.width / style.bayWidth))
    const bayWidth = frame.width / bays
    const paneWidth = bayWidth * style.paneWidth
    const paneHeight = floorHeight * style.paneHeight
    for (let floor = 0; floor < floors; floor++) {
      const bottom = yStart + floor * floorHeight
      const top = bottom + floorHeight
      // A continuous warm wall behind the recessed-looking panes keeps the mass solid.
      addQuad(
        meshes.facade,
        facePoint(frame, -frame.width / 2, bottom),
        facePoint(frame, frame.width / 2, bottom),
        facePoint(frame, frame.width / 2, top),
        facePoint(frame, -frame.width / 2, top),
        frame.normal,
      )
      const windowBottom = bottom + (floorHeight - paneHeight) * style.sillRatio
      const windowTop = windowBottom + paneHeight
      for (let bay = 0; bay < bays; bay++) {
        const centerU = -frame.width / 2 + (bay + 0.5) * bayWidth
        addQuad(
          meshes.glass,
          facePoint(frame, centerU - paneWidth / 2, windowBottom, 0.035),
          facePoint(frame, centerU + paneWidth / 2, windowBottom, 0.035),
          facePoint(frame, centerU + paneWidth / 2, windowTop, 0.035),
          facePoint(frame, centerU - paneWidth / 2, windowTop, 0.035),
          frame.normal,
        )
      }
      if (floor > 0) {
        const bandY = bottom - style.bandHeight * 0.5
        addFacadePrism(
          meshes.trim,
          frame,
          -frame.width / 2,
          frame.width / 2,
          bandY,
          bandY + style.bandHeight,
          style.bandDepth,
          style.bandDepth,
        )
      }
    }

    // Full-height pilasters/fins create depth without a separate draw call per window.
    for (let bay = 0; bay <= bays; bay++) {
      const isCorner = bay === 0 || bay === bays
      const emphasized = styleColor === 'brick-midrise' || styleName === 'brick'
      if (!isCorner && !emphasized && bay % style.finEvery !== 0) continue
      const centerU = -frame.width / 2 + bay * (frame.width / bays)
      const finWidth = isCorner ? style.finWidth * 1.3 : style.finWidth
      addFacadePrism(
        meshes.trim,
        frame,
        centerU - finWidth / 2,
        centerU + finWidth / 2,
        yStart,
        height,
        style.finDepth,
        style.finDepth,
      )
    }
  }
}

function bytesOf(values: Float32Array | Uint16Array): Uint8Array {
  return new Uint8Array(values.buffer, values.byteOffset, values.byteLength)
}

function addPrimitive(
  mesh: MeshData,
  material: number,
  addAccessor: (
    values: Float32Array | Uint16Array,
    target: number,
    componentType: number,
    type: string,
    count: number,
    min?: number[],
    max?: number[],
  ) => number,
): Record<string, unknown> {
  const positions = new Float32Array(mesh.positions)
  const normals = new Float32Array(mesh.normals)
  const indices = new Uint16Array(mesh.indices)
  const minimum: number[] = [Infinity, Infinity, Infinity]
  const maximum: number[] = [-Infinity, -Infinity, -Infinity]
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[index + axis]!
      minimum[axis] = Math.min(minimum[axis]!, value)
      maximum[axis] = Math.max(maximum[axis]!, value)
    }
  }
  return {
    attributes: {
      POSITION: addAccessor(
        positions,
        ARRAY_BUFFER,
        FLOAT_COMPONENT,
        'VEC3',
        positions.length / 3,
        minimum,
        maximum,
      ),
      NORMAL: addAccessor(
        normals,
        ARRAY_BUFFER,
        FLOAT_COMPONENT,
        'VEC3',
        normals.length / 3,
      ),
    },
    indices: addAccessor(
      indices,
      ELEMENT_ARRAY_BUFFER,
      UNSIGNED_SHORT_COMPONENT,
      'SCALAR',
      indices.length,
    ),
    material,
    mode: 4,
  }
}

/** Builds one deterministic, meter-scale office massing as a compact Y-up GLB. */
export function createOfficeGlb(seed: number): Uint8Array {
  if (!Number.isFinite(seed))
    throw new Error('Office building seed must be finite.')
  const random = seededRandom(seed)
  const buildingType = (
    ['brick-midrise', 'glass-office', 'stepped-tower'] as const
  )[Math.floor(random() * 3)]!
  const totalWidth = 33 + random() * 20
  const totalDepth = 27 + random() * 17
  const floorHeight =
    buildingType === 'brick-midrise'
      ? 3.65 + random() * 0.25
      : 3.75 + random() * 0.25
  const floors =
    buildingType === 'brick-midrise'
      ? 11 + Math.floor(random() * 7)
      : buildingType === 'glass-office'
        ? 16 + Math.floor(random() * 8)
        : 20 + Math.floor(random() * 6)
  const bodyHeight = 2.6 + (floors - 1) * floorHeight
  const facadeWidth = totalWidth - 1.8
  const facadeDepth = totalDepth - 1.8
  const facade = emptyMesh(),
    glass = emptyMesh(),
    trim = emptyMesh(),
    roof = emptyMesh()
  const trimColor: Color =
    buildingType === 'brick-midrise'
      ? [0.58, 0.45, 0.35, 1]
      : buildingType === 'glass-office'
        ? [0.16, 0.2, 0.23, 1]
        : [0.43, 0.42, 0.39, 1]
  const facadeColor: Color =
    buildingType === 'brick-midrise'
      ? [
          0.43 + random() * 0.07,
          0.24 + random() * 0.06,
          0.18 + random() * 0.05,
          1,
        ]
      : buildingType === 'glass-office'
        ? [0.39, 0.39, 0.37, 1]
        : [0.49, 0.45, 0.39, 1]
  const glassColor: Color =
    buildingType === 'brick-midrise'
      ? [0.12, 0.18, 0.22, 1]
      : [0.15, 0.23, 0.29, 1]
  const roofColor: Color = [0.085, 0.095, 0.1, 1]

  // A broad, darker ground-floor plinth gives the towers a visible street datum.
  addBox(
    roof,
    -totalWidth / 2,
    0,
    -totalDepth / 2,
    totalWidth / 2,
    1.15,
    totalDepth / 2,
  )
  addBox(
    facade,
    -facadeWidth / 2,
    1.15,
    -facadeDepth / 2,
    facadeWidth / 2,
    2.6,
    facadeDepth / 2,
  )

  if (buildingType === 'stepped-tower') {
    const lowerFloors = floors - 7
    const lowerHeight = 2.6 + (lowerFloors - 1) * floorHeight
    const upperWidth = facadeWidth * 0.74
    const upperDepth = facadeDepth * 0.76
    addFacade(
      facadeMeshes(),
      facadeWidth,
      facadeDepth,
      2.6,
      lowerFloors - 1,
      floorHeight,
      'brick',
      buildingType,
    )
    addFlatRoof(roof, facadeWidth, facadeDepth, lowerHeight)
    addFacade(
      facadeMeshes(),
      upperWidth,
      upperDepth,
      lowerHeight,
      7,
      floorHeight,
      'curtain-wall',
      buildingType,
    )
    addRoof(roof, upperWidth, upperDepth, bodyHeight)
    addBox(
      roof,
      -upperWidth * 0.18,
      bodyHeight + 1.1,
      -upperDepth * 0.18,
      upperWidth * 0.18,
      bodyHeight + 2.2,
      upperDepth * 0.18,
    )
    addBox(roof, -0.32, bodyHeight + 2.2, -0.32, 0.32, bodyHeight + 3.25, 0.32)
  } else {
    const style: FacadeStyle =
      buildingType === 'brick-midrise' ? 'brick' : 'curtain-wall'
    addFacade(
      facadeMeshes(),
      facadeWidth,
      facadeDepth,
      2.6,
      floors - 1,
      floorHeight,
      style,
      buildingType,
    )
    addRoof(roof, facadeWidth, facadeDepth, bodyHeight)
    if (buildingType === 'brick-midrise') {
      const penthouseWidth = facadeWidth * 0.28,
        penthouseDepth = facadeDepth * 0.3
      addBox(
        roof,
        -penthouseWidth / 2,
        bodyHeight + 1.1,
        -penthouseDepth / 2,
        penthouseWidth / 2,
        bodyHeight + 2.2,
        penthouseDepth / 2,
      )
    } else {
      const ventSize = 2.4
      addBox(
        roof,
        -facadeWidth * 0.24,
        bodyHeight + 1.1,
        -facadeDepth * 0.2,
        -facadeWidth * 0.24 + ventSize,
        bodyHeight + 2.2,
        -facadeDepth * 0.2 + ventSize,
      )
      addBox(
        roof,
        facadeWidth * 0.16,
        bodyHeight + 1.1,
        facadeDepth * 0.12,
        facadeWidth * 0.16 + ventSize,
        bodyHeight + 2.2,
        facadeDepth * 0.12 + ventSize,
      )
    }
  }

  function facadeMeshes(): {
    facade: MeshData
    glass: MeshData
    trim: MeshData
  } {
    return { facade, glass, trim }
  }

  const materials = [
    {
      name:
        buildingType === 'brick-midrise'
          ? 'Warm brick and stone facade'
          : 'Warm gray concrete facade',
      pbrMetallicRoughness: {
        baseColorFactor: srgbToLinearColor(facadeColor),
        metallicFactor: 0,
        roughnessFactor: 0.84,
      },
    },
    {
      name: 'Deep blue gray architectural glass',
      pbrMetallicRoughness: {
        baseColorFactor: srgbToLinearColor(glassColor),
        metallicFactor: 0.3,
        roughnessFactor: 0.18,
      },
    },
    {
      name: 'Charcoal roof and mechanical equipment',
      pbrMetallicRoughness: {
        baseColorFactor: srgbToLinearColor(roofColor),
        metallicFactor: 0.08,
        roughnessFactor: 0.7,
      },
    },
    {
      name:
        buildingType === 'glass-office'
          ? 'Dark metal mullions'
          : 'Contrasting facade reveals',
      pbrMetallicRoughness: {
        baseColorFactor: srgbToLinearColor(trimColor),
        metallicFactor: buildingType === 'glass-office' ? 0.28 : 0,
        roughnessFactor: 0.62,
      },
    },
  ]

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
    const viewIndex = bufferViews.length
    bufferViews.push({
      buffer: 0,
      byteOffset: binaryLength,
      byteLength: bytes.byteLength,
      target,
    })
    binaryParts.push(bytes)
    binaryLength += bytes.byteLength
    return viewIndex
  }
  const addAccessor = (
    values: Float32Array | Uint16Array,
    target: number,
    componentType: number,
    type: string,
    count: number,
    min?: number[],
    max?: number[],
  ): number => {
    const view = append(bytesOf(values), target)
    const accessor: Record<string, unknown> = {
      bufferView: view,
      componentType,
      count,
      type,
    }
    if (min) accessor.min = min
    if (max) accessor.max = max
    accessors.push(accessor)
    return accessors.length - 1
  }

  const primitives = [facade, glass, roof, trim].map((mesh, material) =>
    addPrimitive(mesh, material, addAccessor),
  )
  const json = {
    asset: {
      version: '2.0',
      generator: 'cesium-demo procedural office asset',
      extras: { buildingType },
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: buildingType, mesh: 0 }],
    meshes: [{ name: 'Office facade and roof', primitives }],
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
