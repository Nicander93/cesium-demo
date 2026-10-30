import * as Cesium from 'cesium'
import { createCoastGroundAppearance } from './coast-ground'
import type { EnvironmentController } from '../../environment'
import {
  COAST_BUILDING_ROWS,
  COAST_BUILDINGS_PER_ROW,
  COAST_PALM_INSTANCE_COUNT,
  coastShoreX,
} from './coast-layout'

export interface CoastScene {
  anchor: Cesium.Cartesian3
  waterPositions: Cesium.Cartographic[]
  shoreline: Cesium.Cartographic[]
  shorelineExtent?: Cesium.Cartographic[]
  waterHeight: number
  focus(view: 'hero' | 'shore' | 'overview'): void
  update(seconds: number): void
  dispose(): void
  modelCount: number
  treeCount: number
}

interface CoastOptions {
  viewer: Cesium.Viewer
  environment: EnvironmentController
  collection: Cesium.PrimitiveCollection
  isCancelled: () => boolean
  onProgress: (loaded: number, total: number) => void
}

interface XY {
  x: number
  y: number
}

interface BuildingPlacement extends XY {
  seed: number
  heading: number
}

interface VehiclePlacement {
  model: Cesium.Model
  route: XY[]
  distance: number
  speed: number
  lane: number
  matrix: Cesium.Matrix4
}

const BASE = `${import.meta.env.BASE_URL}city-rendering/kenney/`
const OFFICE_BASE = `${import.meta.env.BASE_URL}landscape-showcase/offices/`
const ANCHOR = Cesium.Cartesian3.fromDegrees(119.0317, 33.5921, 0)
const WATER_HEIGHT = 1
const LAND_HEIGHT = 7
const BEACH_WIDTH = 40
const ROAD_WIDTH = 25
const TOTAL_ASSETS = 57

/** Synthetic presentation set only; local ENU x points east toward the sea. */
export async function createCoastScene({
  viewer,
  environment,
  collection,
  isCancelled,
  onProgress,
}: CoastOptions): Promise<CoastScene> {
  const frame = Cesium.Transforms.eastNorthUpToFixedFrame(ANCHOR)
  const models: Cesium.Model[] = []
  const detachModels: Array<() => void> = []
  const vehicles: VehiclePlacement[] = []
  let loaded = 0
  let disposed = false
  let cancelledCleanup = false
  onProgress(0, TOTAL_ASSETS)

  const world = (x: number, y: number, z = LAND_HEIGHT) =>
    Cesium.Matrix4.multiplyByPoint(
      frame,
      new Cesium.Cartesian3(x, y, z),
      new Cesium.Cartesian3(),
    )
  const geo = (x: number, y: number) =>
    Cesium.Cartographic.fromCartesian(world(x, y, WATER_HEIGHT))
  const shoreX = coastShoreX

  function modelMatrix(
    x: number,
    y: number,
    z: number,
    heading: number,
    scale: number,
  ): Cesium.Matrix4 {
    const rotation = Cesium.Matrix3.fromRotationZ(heading)
    const local = Cesium.Matrix4.fromRotationTranslation(
      rotation,
      new Cesium.Cartesian3(x, y, z),
    )
    Cesium.Matrix4.multiplyByUniformScale(local, scale, local)
    return Cesium.Matrix4.multiplyTransformation(
      frame,
      local,
      new Cesium.Matrix4(),
    )
  }

  function addPrimitive(primitive: Cesium.Primitive): void {
    if (isCancelled() || disposed) {
      primitive.destroy()
      return
    }
    collection.add(primitive)
  }

  function polygonPrimitive(
    polygons: Array<{ ring: XY[]; color: string; z?: number }>,
    shadows = Cesium.ShadowMode.DISABLED,
    haze = false,
  ): Cesium.Primitive {
    return new Cesium.Primitive({
      geometryInstances: polygons.map(
        ({ ring, color, z = LAND_HEIGHT }) =>
          new Cesium.GeometryInstance({
            geometry: new Cesium.PolygonGeometry({
              polygonHierarchy: new Cesium.PolygonHierarchy(
                ring.map(({ x, y }) => world(x, y, z)),
              ),
              textureCoordinates: new Cesium.PolygonHierarchy(
                ring.map(({ x, y }) => new Cesium.Cartesian3(x, y, 0)),
              ),
              perPositionHeight: true,
              vertexFormat: Cesium.VertexFormat.POSITION_NORMAL_AND_ST,
            }),
            attributes: {
              color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                Cesium.Color.fromCssColorString(color)!,
              ),
            },
          }),
      ),
      appearance: createCoastGroundAppearance({ haze }),
      asynchronous: false,
      releaseGeometryInstances: true,
      shadows,
    })
  }

  function stripPolygon(
    yValues: number[],
    west: (y: number) => number,
    east: (y: number) => number,
  ): XY[] {
    return [
      ...yValues.map((y) => ({ x: west(y), y })),
      ...[...yValues].reverse().map((y) => ({ x: east(y), y })),
    ]
  }

  function addGroundSurfaces(): void {
    const nearY = Array.from({ length: 81 }, (_, index) => -1600 + index * 40)
    const far = 100_000
    const northInner = shoreX(1600) - BEACH_WIDTH
    const southInner = shoreX(-1600) - BEACH_WIDTH
    const landRing: XY[] = [
      { x: -far, y: -far },
      { x: -far, y: far },
      { x: northInner, y: far },
      { x: northInner, y: 1600 },
      ...nearY
        .slice(0, -1)
        .reverse()
        .map((northing) => ({
          x: shoreX(northing) - BEACH_WIDTH,
          y: northing,
        })),
      { x: southInner, y: -far },
    ]
    addPrimitive(
      polygonPrimitive(
        [{ ring: landRing, color: '#668354' }],
        Cesium.ShadowMode.DISABLED,
        true,
      ),
    )

    // Sand slope continues at fixed end-of-coast X into the far background.
    const beachStations = [
      { y: -far, coast: shoreX(-1600) },
      ...nearY.map((northing) => ({ y: northing, coast: shoreX(northing) })),
      { y: far, coast: shoreX(1600) },
    ]
    const beachRows = beachStations.map(({ y: northing, coast }) => [
      { x: coast - BEACH_WIDTH, y: northing, z: LAND_HEIGHT },
      { x: coast, y: northing, z: 0.4 },
    ])
    const beachPositions: number[] = []
    const beachNormals: number[] = []
    const beachST: number[] = []
    const beachIndices: number[] = []
    for (let row = 0; row < beachRows.length; row++) {
      const northing = beachStations[row]!.y
      const coastSlope =
        Math.abs(northing) >= 1600
          ? 0
          : (shoreX(northing + 1) - shoreX(northing - 1)) / 2
      for (const vertex of beachRows[row]!) {
        const point = world(vertex.x, vertex.y, vertex.z)
        beachPositions.push(point.x, point.y, point.z)
        beachST.push(vertex.x, vertex.y)
        const localNormal = new Cesium.Cartesian3(
          6.6 / BEACH_WIDTH,
          -(6.6 / BEACH_WIDTH) * coastSlope,
          1,
        )
        const normal = Cesium.Matrix4.multiplyByPointAsVector(
          frame,
          localNormal,
          new Cesium.Cartesian3(),
        )
        Cesium.Cartesian3.normalize(normal, normal)
        beachNormals.push(normal.x, normal.y, normal.z)
      }
      if (row + 1 < beachRows.length) {
        const inner = row * 2
        beachIndices.push(
          inner,
          inner + 1,
          inner + 2,
          inner + 1,
          inner + 3,
          inner + 2,
        )
      }
    }
    const beachAttributes = new Cesium.GeometryAttributes()
    Object.assign(beachAttributes, {
      position: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.DOUBLE,
        componentsPerAttribute: 3,
        values: new Float64Array(beachPositions),
      }),
      normal: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 3,
        values: new Float32Array(beachNormals),
      }),
    })
    Object.assign(beachAttributes, {
      st: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.FLOAT,
        componentsPerAttribute: 2,
        values: new Float32Array(beachST),
      }),
    })
    const beachGeometry = new Cesium.Geometry({
      attributes: beachAttributes,
      indices: new Uint16Array(beachIndices),
      primitiveType: Cesium.PrimitiveType.TRIANGLES,
      boundingSphere: Cesium.BoundingSphere.fromVertices(beachPositions),
    })
    addPrimitive(
      new Cesium.Primitive({
        geometryInstances: new Cesium.GeometryInstance({
          geometry: beachGeometry,
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(
              Cesium.Color.fromCssColorString('#d7c7a1')!,
            ),
          },
        }),
        appearance: createCoastGroundAppearance({ sand: true }),
        asynchronous: false,
        releaseGeometryInstances: true,
        shadows: Cesium.ShadowMode.DISABLED,
      }),
    )

    const cityNorthings = Array.from(
      { length: 19 },
      (_, index) => -800 + index * 100,
    )
    const cityEastEdge = (northing: number) =>
      shoreX(northing) - BEACH_WIDTH - 66
    addPrimitive(
      polygonPrimitive(
        [
          {
            ring: stripPolygon(cityNorthings, () => -1100, cityEastEdge),
            color: '#718653',
            z: LAND_HEIGHT + 0.16,
          },
        ],
        Cesium.ShadowMode.RECEIVE_ONLY,
      ),
    )
    const crossStreets = [-700, -450, -200, 50, 300, 550, 800]
    const streetSurfaces = crossStreets.flatMap((northing) => {
      const west = -1100
      const east = cityEastEdge(northing) + 45
      return [
        {
          color: '#3c474a',
          z: LAND_HEIGHT + 0.42,
          ring: [
            { x: west, y: northing - 9 },
            { x: east, y: northing - 9 },
            { x: east, y: northing + 9 },
            { x: west, y: northing + 9 },
          ],
        },
        {
          color: '#d0c8b2',
          z: LAND_HEIGHT + 0.5,
          ring: [
            { x: west, y: northing - 14 },
            { x: east, y: northing - 14 },
            { x: east, y: northing - 9 },
            { x: west, y: northing - 9 },
          ],
        },
        {
          color: '#d0c8b2',
          z: LAND_HEIGHT + 0.5,
          ring: [
            { x: west, y: northing + 9 },
            { x: east, y: northing + 9 },
            { x: east, y: northing + 14 },
            { x: west, y: northing + 14 },
          ],
        },
      ]
    })
    // Connect the cross streets through the gaps between the building rows.
    for (let row = 0; row + 1 < COAST_BUILDING_ROWS.length; row++) {
      const offset =
        (COAST_BUILDING_ROWS[row]! + COAST_BUILDING_ROWS[row + 1]!) / 2
      const center = (y: number) =>
        shoreX(y) - BEACH_WIDTH - ROAD_WIDTH - 26 - offset
      streetSurfaces.push(
        {
          color: '#394348',
          z: LAND_HEIGHT + 0.42,
          ring: stripPolygon(
            cityNorthings,
            (y) => center(y) - 8,
            (y) => center(y) + 8,
          ),
        },
        {
          color: '#b6b2a1',
          z: LAND_HEIGHT + 0.49,
          ring: stripPolygon(
            cityNorthings,
            (y) => center(y) - 12,
            (y) => center(y) - 8,
          ),
        },
        {
          color: '#b6b2a1',
          z: LAND_HEIGHT + 0.49,
          ring: stripPolygon(
            cityNorthings,
            (y) => center(y) + 8,
            (y) => center(y) + 12,
          ),
        },
      )
    }
    // Paved forecourts keep buildings grounded while retaining planted block interiors.
    for (const building of createBuildings()) {
      streetSurfaces.push({
        color: '#b7b3a5',
        z: LAND_HEIGHT + 0.28,
        ring: [
          { x: building.x - 33, y: building.y - 35 },
          { x: building.x + 33, y: building.y - 35 },
          { x: building.x + 33, y: building.y + 35 },
          { x: building.x - 33, y: building.y + 35 },
        ],
      })
    }
    for (const y of crossStreets) {
      const cx = shoreX(y) - BEACH_WIDTH - 31
      for (let stripe = 0; stripe < 8; stripe++) {
        const cy = y + 14 + stripe * 1.3
        streetSurfaces.push({
          color: '#e4e1d1',
          z: LAND_HEIGHT + 0.59,
          ring: [
            { x: cx - 11, y: cy },
            { x: cx + 11, y: cy },
            { x: cx + 11, y: cy + 0.65 },
            { x: cx - 11, y: cy + 0.65 },
          ],
        })
      }
    }
    addPrimitive(
      polygonPrimitive(streetSurfaces, Cesium.ShadowMode.RECEIVE_ONLY),
    )
    const parkCenters = [-587.5, -87.5, 412.5]
    addPrimitive(
      polygonPrimitive(
        parkCenters.map((northing) => ({
          color: '#789064',
          z: LAND_HEIGHT + 0.3,
          ring: [
            { x: shoreX(northing) - 191, y: northing - 30 },
            { x: shoreX(northing) - 115, y: northing - 30 },
            { x: shoreX(northing) - 115, y: northing + 30 },
            { x: shoreX(northing) - 191, y: northing + 30 },
          ],
        })),
      ),
    )

    // Broad coastal promenade with a smooth, repeated curve.
    const roadY = Array.from({ length: 101 }, (_, i) => -1500 + i * 30)
    const roadCenter = (v: number) => shoreX(v) - BEACH_WIDTH - 31
    const road = stripPolygon(
      roadY,
      (v) => roadCenter(v) - ROAD_WIDTH / 2,
      (v) => roadCenter(v) + ROAD_WIDTH / 2,
    )
    addPrimitive(
      polygonPrimitive([
        { ring: road, color: '#343f43', z: LAND_HEIGHT + 0.35 },
        {
          ring: stripPolygon(
            roadY,
            (v) => roadCenter(v) - ROAD_WIDTH / 2 - 7,
            (v) => roadCenter(v) - ROAD_WIDTH / 2,
          ),
          color: '#c9c0a9',
          z: LAND_HEIGHT + 0.5,
        },
        {
          ring: stripPolygon(
            roadY,
            (v) => roadCenter(v) + ROAD_WIDTH / 2,
            (v) => roadCenter(v) + ROAD_WIDTH / 2 + 7,
          ),
          color: '#c9c0a9',
          z: LAND_HEIGHT + 0.5,
        },
        ...Array.from({ length: 58 }, (_, index) => {
          const ya = -1410 + index * 49
          const yb = ya + 22
          return {
            color: '#d5c9a8',
            z: LAND_HEIGHT + 0.56,
            ring: [
              { x: roadCenter(ya) - 0.38, y: ya },
              { x: roadCenter(yb) - 0.38, y: yb },
              { x: roadCenter(yb) + 0.38, y: yb },
              { x: roadCenter(ya) + 0.38, y: ya },
            ],
          }
        }),
      ]),
    )
  }

  function addParkTrees(): number {
    const instances: Cesium.GeometryInstance[] = []
    const addTreePart = (
      geometry: Cesium.Geometry,
      matrix: Cesium.Matrix4,
      color: string,
    ) => {
      instances.push(
        new Cesium.GeometryInstance({
          geometry,
          modelMatrix: matrix,
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(
              Cesium.Color.fromCssColorString(color)!,
            ),
          },
        }),
      )
    }
    const trunk = Cesium.CylinderGeometry.createGeometry(
      new Cesium.CylinderGeometry({
        length: 9,
        topRadius: 0.22,
        bottomRadius: 0.45,
        slices: 7,
        vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
      }),
    )!
    const crown = Cesium.EllipsoidGeometry.createGeometry(
      new Cesium.EllipsoidGeometry({
        radii: new Cesium.Cartesian3(3.5, 3.1, 4.2),
        stackPartitions: 7,
        slicePartitions: 10,
        vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
      }),
    )!
    let parkCount = 0
    for (const [parkIndex, northing] of [-587.5, -87.5, 412.5].entries()) {
      for (let index = 0; index < 6; index++) {
        const x = shoreX(northing) - 178 + (index % 3) * 22
        const y = northing - 15 + Math.floor(index / 3) * 30
        addTreePart(
          trunk,
          modelMatrix(x, y, LAND_HEIGHT + 4.5, 0, 1),
          '#786750',
        )
        for (let lobe = 0; lobe < 4; lobe++) {
          const angle = lobe * 2.399 + index
          addTreePart(
            crown,
            modelMatrix(
              x + Math.cos(angle) * 2.3,
              y + Math.sin(angle) * 2.3,
              LAND_HEIGHT + 10.5 + lobe * 0.9,
              angle,
              1,
            ),
            ['#496a3f', '#587346', '#3c603b'][(lobe + index + parkIndex) % 3]!,
          )
        }
        parkCount++
      }
    }
    addPrimitive(
      new Cesium.Primitive({
        geometryInstances: instances,
        appearance: new Cesium.PerInstanceColorAppearance({
          flat: false,
          closed: false,
          faceForward: true,
          renderState: { cull: { enabled: false } },
        }),
        asynchronous: false,
        releaseGeometryInstances: true,
        shadows: Cesium.ShadowMode.CAST_ONLY,
      }),
    )
    return COAST_PALM_INSTANCE_COUNT + parkCount
  }

  function createBuildings(): BuildingPlacement[] {
    const placements: BuildingPlacement[] = []
    // Keep the waterfront lower; reuse twelve prebuilt resources across the district.
    const assetRows = [
      [7, 8, 9, 12],
      [1, 6, 10, 11],
      [2, 3, 4, 5],
      [7, 1, 9, 4],
    ]
    for (let row = 0; row < COAST_BUILDING_ROWS.length; row++) {
      for (let column = 0; column < COAST_BUILDINGS_PER_ROW; column++) {
        const y = -650 + column * 125 + (row % 2) * 14
        placements.push({
          x:
            shoreX(y) -
            BEACH_WIDTH -
            ROAD_WIDTH -
            26 -
            COAST_BUILDING_ROWS[row]!,
          y,
          seed: assetRows[row]![column % 4]!,
          heading: Math.PI / 2 + Math.sin(y / 360) * 0.09,
        })
      }
    }
    return placements
  }

  function route(points: XY[]): XY[] {
    return points
  }
  const routes = [
    route(
      Array.from({ length: 71 }, (_, i) => {
        const y = -1400 + i * 40
        return { x: shoreX(y) - BEACH_WIDTH - 31, y }
      }),
    ),
    [
      { x: -300, y: -1150 },
      { x: -360, y: -640 },
      { x: -335, y: 0 },
      { x: -400, y: 600 },
      { x: -375, y: 1120 },
    ],
  ]

  function pose(
    points: XY[],
    distance: number,
    lane: number,
  ): XY & { heading: number } {
    const lengths = points
      .slice(1)
      .map((point, index) =>
        Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y),
      )
    const total = lengths.reduce((sum, length) => sum + length, 0)
    let remaining = ((distance % total) + total) % total
    for (let index = 0; index < lengths.length; index++) {
      const length = lengths[index]!
      if (remaining <= length || index === lengths.length - 1) {
        const a = points[index]!
        const b = points[index + 1]!
        const dx = (b.x - a.x) / length
        const dy = (b.y - a.y) / length
        return {
          x: a.x + dx * remaining - dy * lane,
          y: a.y + dy * remaining + dx * lane,
          heading: Math.atan2(dy, dx) - Math.PI / 2,
        }
      }
      remaining -= length
    }
    return { ...points[0]!, heading: 0 }
  }

  function applyVehiclePose(vehicle: VehiclePlacement): void {
    const current = pose(vehicle.route, vehicle.distance, vehicle.lane)
    vehicle.model.modelMatrix = modelMatrix(
      current.x,
      current.y,
      LAND_HEIGHT + 1.1,
      current.heading + (vehicle.speed < 0 ? Math.PI : 0),
      2.35,
    )
  }

  function cleanupCancelled(): void {
    if (cancelledCleanup) return
    cancelledCleanup = true
    for (const detach of detachModels.splice(0)) detach()
    // Models and primitives belong to the caller collection, cleared on teardown.
    models.length = 0
  }

  const assetNames = createBuildings()
  const vehicleCount = 4
  const tasks: Array<() => Promise<void>> = assetNames.map(
    (building) => async () => {
      const model = await Cesium.Model.fromGltfAsync({
        url:
          OFFICE_BASE +
          'office-' +
          String(building.seed).padStart(2, '0') +
          '.glb',
        modelMatrix: modelMatrix(
          building.x,
          building.y,
          LAND_HEIGHT,
          building.heading,
          1,
        ),
        upAxis: Cesium.Axis.Y,
        forwardAxis: Cesium.Axis.X,
        enableVerticalExaggeration: false,
        shadows: Cesium.ShadowMode.CAST_ONLY,
        allowPicking: false,
      })
      if (isCancelled() || disposed) {
        model.destroy()
        return
      }
      models.push(model)
      collection.add(model)
      detachModels.push(environment.attachModel(model))
      loaded++
      onProgress(loaded, TOTAL_ASSETS)
    },
  )
  const carNames = ['sedan-sports', 'suv', 'taxi', 'sedan']
  for (let index = 0; index < vehicleCount; index++) {
    tasks.push(async () => {
      const model = await Cesium.Model.fromGltfAsync({
        url: `${BASE}cars/${carNames[index % carNames.length]}.glb`,
        modelMatrix: Cesium.Matrix4.clone(Cesium.Matrix4.IDENTITY),
        upAxis: Cesium.Axis.Y,
        forwardAxis: Cesium.Axis.X,
        enableVerticalExaggeration: false,
        shadows: Cesium.ShadowMode.CAST_ONLY,
        allowPicking: false,
      })
      if (isCancelled() || disposed) {
        model.destroy()
        return
      }
      models.push(model)
      collection.add(model)
      detachModels.push(environment.attachModel(model))
      const placement = {
        model,
        route: routes[0]!,
        distance: 450 + index * 650,
        speed: index % 2 ? -8 : 11,
        lane: index % 2 ? -3.2 : 3.2,
        matrix: new Cesium.Matrix4(),
      }
      vehicles.push(placement)
      applyVehiclePose(placement)
      loaded++
      onProgress(loaded, TOTAL_ASSETS)
    })
  }

  tasks.push(async () => {
    const palm = await Cesium.Model.fromGltfAsync({
      url: import.meta.env.BASE_URL + 'landscape-showcase/palms.glb',
      modelMatrix: Cesium.Matrix4.clone(frame),
      upAxis: Cesium.Axis.Y,
      forwardAxis: Cesium.Axis.X,
      enableVerticalExaggeration: false,
      shadows: Cesium.ShadowMode.CAST_ONLY,
      allowPicking: false,
    })
    if (isCancelled() || disposed) {
      palm.destroy()
      return
    }
    collection.add(palm)
    detachModels.push(environment.attachModel(palm))
    loaded++
    onProgress(loaded, TOTAL_ASSETS)
  })
  const allTasks = [...tasks]
  const assetErrors: unknown[] = []
  let nextTask = 0
  async function worker(): Promise<void> {
    while (!isCancelled() && !disposed && nextTask < allTasks.length) {
      const task = allTasks[nextTask++]!
      try {
        await task()
      } catch (error) {
        if (!isCancelled() && !disposed) assetErrors.push(error)
      }
    }
  }

  try {
    addGroundSurfaces()
    const treeCount = addParkTrees()
    await Promise.all(Array.from({ length: 4 }, () => worker()))
    if (isCancelled() || disposed) {
      cleanupCancelled()
      return {
        anchor: Cesium.Cartesian3.clone(ANCHOR),
        waterPositions: [],
        shoreline: [],
        waterHeight: WATER_HEIGHT,
        focus: () => {},
        update: () => {},
        dispose: cleanupCancelled,
        modelCount: models.length,
        treeCount,
      }
    }
    if (assetErrors.length) {
      throw new Error('滨海模型加载失败：' + String(assetErrors[0]))
    }
    const alongShore = Array.from({ length: 81 }, (_, index) => {
      const y = -1600 + index * 40
      return geo(shoreX(y), y)
    })
    // Continue the water ring well beyond the horizon; only the curved near shore is foam-facing.
    const southShoreX = shoreX(-1600) - 3
    const northShoreX = shoreX(1600) - 3
    const farOcean = 100_000
    const waterXY: XY[] = [
      ...Array.from({ length: 81 }, (_, index) => {
        const y = -1600 + index * 40
        return { x: shoreX(y) - 3, y }
      }),
      // Run the coast end points to the distant rectangle while holding x at each
      // end of the surveyed-style shoreline curve, so no diagonal edge cuts inland.
      { x: northShoreX, y: farOcean },
      { x: farOcean, y: farOcean },
      { x: farOcean, y: -farOcean },
      { x: southShoreX, y: -farOcean },
    ]
    const waterPositions = waterXY.map(({ x, y }) => geo(x, y))
    const shoreline = [
      ...alongShore,
      geo(northShoreX, farOcean),
      geo(farOcean, farOcean),
      geo(farOcean, -farOcean),
      geo(southShoreX, -farOcean),
    ]
    const shorelineExtent = [
      geo(-800, -1800),
      geo(1200, -1800),
      geo(1200, 1800),
      geo(-800, 1800),
    ]
    const focus = (view: 'hero' | 'shore' | 'overview') => {
      if (isCancelled() || disposed) return
      const position =
        view === 'hero'
          ? new Cesium.Cartesian3(-155, -760, 48)
          : view === 'shore'
            ? new Cesium.Cartesian3(-190, -220, 32)
            : new Cesium.Cartesian3(-1850, -2500, 1450)
      const target =
        view === 'hero'
          ? new Cesium.Cartesian3(80, 380, 9)
          : view === 'shore'
            ? new Cesium.Cartesian3(-100, 380, 8)
            : new Cesium.Cartesian3(-120, 180, 20)
      const eye = Cesium.Matrix4.multiplyByPoint(
        frame,
        position,
        new Cesium.Cartesian3(),
      )
      const aim = Cesium.Matrix4.multiplyByPoint(
        frame,
        target,
        new Cesium.Cartesian3(),
      )
      const direction = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.subtract(aim, eye, new Cesium.Cartesian3()),
        new Cesium.Cartesian3(),
      )
      const enuUp = Cesium.Matrix4.multiplyByPointAsVector(
        frame,
        Cesium.Cartesian3.UNIT_Z,
        new Cesium.Cartesian3(),
      )
      const right = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.cross(direction, enuUp, new Cesium.Cartesian3()),
        new Cesium.Cartesian3(),
      )
      const up = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.cross(right, direction, new Cesium.Cartesian3()),
        new Cesium.Cartesian3(),
      )
      viewer.camera.setView({
        destination: eye,
        orientation: { direction, up },
      })
    }
    let elapsed = 0
    let last = 0
    return {
      anchor: Cesium.Cartesian3.clone(ANCHOR),
      waterPositions,
      shoreline,
      shorelineExtent,
      waterHeight: WATER_HEIGHT,
      focus,
      update(seconds: number) {
        if (isCancelled() || disposed) return
        const dt = Math.min(0.1, Math.max(0, seconds - last))
        last = seconds
        elapsed += dt
        if (elapsed < 1 / 12) return
        const step = elapsed
        elapsed = 0
        for (const vehicle of vehicles) {
          vehicle.distance += step * vehicle.speed
          applyVehiclePose(vehicle)
        }
      },
      dispose() {
        if (disposed) return
        disposed = true
        for (const detach of detachModels.splice(0)) detach()
        // The collection owns these models and all other primitives.
        models.length = 0
      },
      modelCount: models.length,
      treeCount,
    }
  } catch (error) {
    cleanupCancelled()
    throw error
  }
}
