import * as Cesium from 'cesium'

export type DemoScene = 'city' | 'reservoir' | 'flood'
export const sceneDefinitions = {
  city: {
    name: '滨水城市',
    description: '建筑、道路与河岸的光照关系',
    origin: [119.0317, 33.5921, 30] as [number, number, number],
    extent: 2300,
    range: 1050,
    pitch: -0.14,
    target: [0, 0, 35],
  },
  reservoir: {
    name: '真实水库',
    description: '真实库区地形、影像与官方水域边界',
    origin: [118.975, 33.54, 30] as [number, number, number],
    extent: 5600,
    range: 1750,
    pitch: -0.12,
    target: [0, 100, 60],
  },
  flood: {
    name: '倾斜模型',
    description: '真实地形、倾斜摄影与给定水位展示',
    origin: [119.02, 33.51, 30] as [number, number, number],
    extent: 4600,
    range: 1700,
    pitch: -0.15,
    target: [0, 50, 30],
  },
} satisfies Record<
  DemoScene,
  {
    name: string
    description: string
    origin: number[]
    extent: number
    range: number
    pitch: number
    target: number[]
  }
>

const LANDSCAPE_DIVISIONS = 96
const BACKDROP_SIDE_DIVISIONS = 192
const BACKDROP_MAX_EXTENT = 128_000
const BACKDROP_RING_STEP = 8_000

/** Prepared display terrain, in local ENU metres; these fixtures are not surveyed DEMs. */
export function landscapeHeight(
  scene: DemoScene,
  x: number,
  y: number,
): number {
  if (scene === 'city') return -0.5
  const basin = scene === 'reservoir'
  const cx = x + Math.sin(y / 620) * (basin ? 110 : 170)
  const radial = basin ? Math.hypot(cx / 620, y / 1130) : Math.abs(cx) / 230
  const bank = Math.max(0, radial - 0.82)
  const hill =
    Math.sin(x / 530 + y / 720) + Math.sin(x / 290 - y / 590) * 0.35 + 1.8
  const base = basin ? 4 : 1
  const lift = Math.pow(bank, 1.28) * (basin ? 62 : 18) * hill
  const maximumRelief = basin ? 420 : 250
  const boundedLift =
    lift >= 0
      ? maximumRelief * Math.tanh(lift / maximumRelief)
      : Math.max(-40, lift)
  return base + boundedLift + Math.sin(y / 360) * 2
}

function landscapeMaterial(extent: number): Cesium.Material {
  return new Cesium.Material({
    fabric: {
      type: 'EnvironmentLandscape',
      uniforms: { u_extent: extent, u_wetness: 0 },
      source: `
float landNoise(vec2 p) { return fract(sin(dot(floor(p),vec2(127.1,311.7)))*43758.5453); }
czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material material = czm_getDefaultMaterial(materialInput);
  vec2 p=materialInput.st*u_extent;
  float broad=sin(p.x*0.006+sin(p.y*0.004))*sin(p.y*0.007-p.x*0.002)*0.5+0.5;
  float fine=sin(p.x*0.018)*sin(p.y*0.023)*0.025;
  vec3 color=mix(vec3(0.16,0.22,0.105),vec3(0.38,0.40,0.22),broad);
  material.diffuse=(color+fine)*mix(1.0,0.68,u_wetness);
  material.specular=u_wetness*0.12;
  material.shininess=28.0;
  return material;
}`,
    },
  })
}

function landPrimitive(
  positions: Float64Array,
  normals: Float32Array,
  st: Float32Array,
  indices: number[],
  extent: number,
  shadows: Cesium.ShadowMode,
): Cesium.Primitive {
  const attributes = new Cesium.GeometryAttributes()
  Object.assign(attributes, {
    position: new Cesium.GeometryAttribute({
      componentDatatype: Cesium.ComponentDatatype.DOUBLE,
      componentsPerAttribute: 3,
      values: positions,
    }),
    normal: new Cesium.GeometryAttribute({
      componentDatatype: Cesium.ComponentDatatype.FLOAT,
      componentsPerAttribute: 3,
      values: normals,
    }),
    st: new Cesium.GeometryAttribute({
      componentDatatype: Cesium.ComponentDatatype.FLOAT,
      componentsPerAttribute: 2,
      values: st,
    }),
  })
  const geometry = new Cesium.Geometry({
    attributes,
    indices: new Uint16Array(indices),
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere: Cesium.BoundingSphere.fromVertices(Array.from(positions)),
  })
  return new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({ geometry }),
    appearance: new Cesium.MaterialAppearance({
      material: landscapeMaterial(extent),
      translucent: false,
      closed: false,
      faceForward: true,
    }),
    asynchronous: false,
    shadows,
  })
}

function setSurfaceVertex(
  frame: Cesium.Matrix4,
  kind: DemoScene,
  extent: number,
  x: number,
  y: number,
  index: number,
  positions: Float64Array,
  normals: Float32Array,
  st: Float32Array,
): void {
  const point = Cesium.Matrix4.multiplyByPoint(
    frame,
    new Cesium.Cartesian3(x, y, landscapeHeight(kind, x, y)),
    new Cesium.Cartesian3(),
  )
  positions.set([point.x, point.y, point.z], index * 3)
  const dx =
    (landscapeHeight(kind, x + 2, y) - landscapeHeight(kind, x - 2, y)) / 4
  const dy =
    (landscapeHeight(kind, x, y + 2) - landscapeHeight(kind, x, y - 2)) / 4
  const normal = Cesium.Matrix4.multiplyByPointAsVector(
    frame,
    new Cesium.Cartesian3(-dx, -dy, 1),
    new Cesium.Cartesian3(),
  )
  Cesium.Cartesian3.normalize(normal, normal)
  normals.set([normal.x, normal.y, normal.z], index * 3)
  st.set([x / extent + 0.5, y / extent + 0.5], index * 2)
}

export function createLandscape(
  frame: Cesium.Matrix4,
  kind: DemoScene,
): Cesium.Primitive {
  const extent = sceneDefinitions[kind].extent
  const divisions = LANDSCAPE_DIVISIONS
  const size = divisions + 1
  const positions = new Float64Array(size * size * 3)
  const normals = new Float32Array(size * size * 3)
  const st = new Float32Array(size * size * 2)
  const indices: number[] = []
  for (let row = 0; row < size; row++)
    for (let column = 0; column < size; column++) {
      const x = (column / divisions - 0.5) * extent,
        y = (row / divisions - 0.5) * extent,
        i = row * size + column
      setSurfaceVertex(frame, kind, extent, x, y, i, positions, normals, st)
      if (row < divisions && column < divisions)
        indices.push(i, i + 1, i + size, i + 1, i + size + 1, i + size)
    }
  return landPrimitive(
    positions,
    normals,
    st,
    indices,
    extent,
    Cesium.ShadowMode.RECEIVE_ONLY,
  )
}

function squarePerimeterPoint(extent: number, index: number): [number, number] {
  const side = Math.floor(index / BACKDROP_SIDE_DIVISIONS)
  const t = (index % BACKDROP_SIDE_DIVISIONS) / BACKDROP_SIDE_DIVISIONS
  const half = extent / 2
  if (side === 0) return [-half + extent * t, -half]
  if (side === 1) return [half, -half + extent * t]
  if (side === 2) return [half - extent * t, half]
  return [-half, half - extent * t]
}

function boundaryHeight(
  kind: DemoScene,
  extent: number,
  index: number,
): number {
  const [x, y] = squarePerimeterPoint(extent, index)
  const gridPosition = (index / BACKDROP_SIDE_DIVISIONS) * LANDSCAPE_DIVISIONS
  const lower = Math.floor(gridPosition)
  const blend = gridPosition - lower
  const side = Math.floor(index / BACKDROP_SIDE_DIVISIONS)
  const sample = (segment: number): number => {
    const t = segment / LANDSCAPE_DIVISIONS
    if (side === 0)
      return landscapeHeight(kind, (t - 0.5) * extent, -extent / 2)
    if (side === 1) return landscapeHeight(kind, extent / 2, (t - 0.5) * extent)
    if (side === 2) return landscapeHeight(kind, (0.5 - t) * extent, extent / 2)
    return landscapeHeight(kind, -extent / 2, (0.5 - t) * extent)
  }
  if (lower >= LANDSCAPE_DIVISIONS) return landscapeHeight(kind, x, y)
  return sample(lower) * (1 - blend) + sample(lower + 1) * blend
}

function backdropRingExtents(innerExtent: number): number[] {
  const extents = [innerExtent]
  let extent = innerExtent
  while (extent < BACKDROP_MAX_EXTENT) {
    extent =
      extent < 16_000
        ? extent * 1.5
        : Math.min(BACKDROP_MAX_EXTENT, extent + BACKDROP_RING_STEP)
    extents.push(extent)
  }
  return extents
}

/** Adds a continuous local backdrop beyond the detailed 96x96 foreground mesh. */
export function createLandscapeBackdrop(
  frame: Cesium.Matrix4,
  kind: DemoScene,
): Cesium.Primitive {
  const innerExtent = sceneDefinitions[kind].extent
  const extents = backdropRingExtents(innerExtent)
  const perimeterSize = BACKDROP_SIDE_DIVISIONS * 4
  const vertexCount = extents.length * perimeterSize
  const positions = new Float64Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const st = new Float32Array(vertexCount * 2)
  const indices: number[] = []

  for (let ring = 0; ring < extents.length; ring++) {
    const extent = extents[ring]!
    for (let pointIndex = 0; pointIndex < perimeterSize; pointIndex++) {
      const [x, y] = squarePerimeterPoint(extent, pointIndex)
      const index = ring * perimeterSize + pointIndex
      if (ring === 0) {
        const z = boundaryHeight(kind, innerExtent, pointIndex)
        const point = Cesium.Matrix4.multiplyByPoint(
          frame,
          new Cesium.Cartesian3(x, y, z),
          new Cesium.Cartesian3(),
        )
        positions.set([point.x, point.y, point.z], index * 3)
        const gridPosition =
          (pointIndex / BACKDROP_SIDE_DIVISIONS) * LANDSCAPE_DIVISIONS
        const lower = Math.floor(gridPosition)
        const blend = gridPosition - lower
        const side = Math.floor(pointIndex / BACKDROP_SIDE_DIVISIONS)
        const normalAt = (segment: number): Cesium.Cartesian3 => {
          const t = segment / LANDSCAPE_DIVISIONS
          const px =
            side === 0
              ? (t - 0.5) * innerExtent
              : side === 1
                ? innerExtent / 2
                : side === 2
                  ? (0.5 - t) * innerExtent
                  : -innerExtent / 2
          const py =
            side === 0
              ? -innerExtent / 2
              : side === 1
                ? (t - 0.5) * innerExtent
                : side === 2
                  ? innerExtent / 2
                  : (0.5 - t) * innerExtent
          const dx =
            (landscapeHeight(kind, px + 2, py) -
              landscapeHeight(kind, px - 2, py)) /
            4
          const dy =
            (landscapeHeight(kind, px, py + 2) -
              landscapeHeight(kind, px, py - 2)) /
            4
          const n = Cesium.Matrix4.multiplyByPointAsVector(
            frame,
            new Cesium.Cartesian3(-dx, -dy, 1),
            new Cesium.Cartesian3(),
          )
          return Cesium.Cartesian3.normalize(n, n)
        }
        const n0 = normalAt(Math.min(lower, LANDSCAPE_DIVISIONS))
        const n1 = normalAt(Math.min(lower + 1, LANDSCAPE_DIVISIONS))
        const normal = Cesium.Cartesian3.normalize(
          Cesium.Cartesian3.lerp(n0, n1, blend, new Cesium.Cartesian3()),
          new Cesium.Cartesian3(),
        )
        normals.set([normal.x, normal.y, normal.z], index * 3)
        st.set([x / innerExtent + 0.5, y / innerExtent + 0.5], index * 2)
      } else {
        setSurfaceVertex(
          frame,
          kind,
          innerExtent,
          x,
          y,
          index,
          positions,
          normals,
          st,
        )
      }
    }
  }

  for (let ring = 0; ring < extents.length - 1; ring++) {
    const inner = ring * perimeterSize
    const outer = (ring + 1) * perimeterSize
    for (let pointIndex = 0; pointIndex < perimeterSize; pointIndex++) {
      const next = (pointIndex + 1) % perimeterSize
      const innerA = inner + pointIndex,
        innerB = inner + next,
        outerA = outer + pointIndex,
        outerB = outer + next
      indices.push(innerA, outerA, innerB, innerB, outerA, outerB)
    }
  }
  return landPrimitive(
    positions,
    normals,
    st,
    indices,
    innerExtent,
    Cesium.ShadowMode.DISABLED,
  )
}
