import * as Cesium from 'cesium'

type Point = [number, number, number]
interface Mesh {
  positions: number[]
  normals: number[]
  indices: number[]
}

/** Reusable 16 m palm with feather-shaped fronds; the scene batches its instances. */
export function createPalmGeometry(seed: number): {
  trunk: Cesium.Geometry
  foliage: Cesium.Geometry
  tips: Cesium.Geometry
} {
  const trunk: Mesh = { positions: [], normals: [], indices: [] }
  const foliage: Mesh = { positions: [], normals: [], indices: [] }
  const tips: Mesh = { positions: [], normals: [], indices: [] }
  const phase = seed * 1.37
  const center = (t: number): Point => [
    Math.sin(phase + t * 1.3) * t * 0.8,
    Math.cos(phase + t) * t * 0.65,
    t * 16,
  ]
  const top = center(1)
  function triangle(mesh: Mesh, a: Point, b: Point, c: Point): void {
    const ab = Cesium.Cartesian3.subtract(
      Cesium.Cartesian3.fromArray(b),
      Cesium.Cartesian3.fromArray(a),
      new Cesium.Cartesian3(),
    )
    const ac = Cesium.Cartesian3.subtract(
      Cesium.Cartesian3.fromArray(c),
      Cesium.Cartesian3.fromArray(a),
      new Cesium.Cartesian3(),
    )
    const n = Cesium.Cartesian3.normalize(
      Cesium.Cartesian3.cross(ab, ac, new Cesium.Cartesian3()),
      new Cesium.Cartesian3(),
    )
    const index = mesh.positions.length / 3
    mesh.positions.push(...a, ...b, ...c)
    for (let i = 0; i < 3; i++) mesh.normals.push(n.x, n.y, n.z)
    mesh.indices.push(index, index + 1, index + 2)
  }
  function quad(mesh: Mesh, a: Point, b: Point, c: Point, d: Point): void {
    triangle(mesh, a, b, c)
    triangle(mesh, a, c, d)
  }
  for (let ring = 0; ring < 10; ring++) {
    const t0 = ring / 10,
      t1 = (ring + 1) / 10
    const ca = center(t0),
      cb = center(t1)
    for (let side = 0; side < 9; side++) {
      const a = (side / 9) * Math.PI * 2
      const b = ((side + 1) / 9) * Math.PI * 2
      const ra = 0.36 - 0.19 * t0,
        rb = 0.36 - 0.19 * t1
      quad(
        trunk,
        [ca[0] + Math.cos(a) * ra, ca[1] + Math.sin(a) * ra, ca[2]],
        [ca[0] + Math.cos(b) * ra, ca[1] + Math.sin(b) * ra, ca[2]],
        [cb[0] + Math.cos(b) * rb, cb[1] + Math.sin(b) * rb, cb[2]],
        [cb[0] + Math.cos(a) * rb, cb[1] + Math.sin(a) * rb, cb[2]],
      )
    }
  }
  for (let frond = 0; frond < 15; frond++) {
    const angle = frond * 2.39996 + phase
    const dx = Math.cos(angle),
      dy = Math.sin(angle)
    const px = -dy,
      py = dx
    const length = 5.3 + ((frond * 7 + seed * 3) % 8) * 0.31
    const droop = 1.7 + (frond % 4) * 0.65
    const point = (t: number): Point => [
      top[0] + dx * length * t,
      top[1] + dy * length * t,
      top[2] + Math.sin(t * Math.PI) * 1.6 - droop * t * t,
    ]
    const mesh = frond % 3 ? foliage : tips
    for (let segment = 0; segment < 10; segment++) {
      const a = point(segment / 10),
        b = point((segment + 1) / 10)
      const wa = 0.075 * (1 - segment / 12),
        wb = 0.075 * (1 - (segment + 1) / 12)
      quad(
        mesh,
        [a[0] - px * wa, a[1] - py * wa, a[2]],
        [a[0] + px * wa, a[1] + py * wa, a[2]],
        [b[0] + px * wb, b[1] + py * wb, b[2]],
        [b[0] - px * wb, b[1] - py * wb, b[2]],
      )
    }
    for (let leaflet = 0; leaflet < 14; leaflet++) {
      const t = 0.12 + leaflet * 0.057
      const base = point(t)
      const reach =
        Math.pow(Math.sin(t * Math.PI), 0.8) * (1.35 + (frond % 3) * 0.11)
      for (const side of [-1, 1]) {
        const ax = px * side,
          ay = py * side
        const middle: Point = [
          base[0] + ax * reach * 0.58 + dx * 0.12,
          base[1] + ay * reach * 0.58 + dy * 0.12,
          base[2] - 0.08,
        ]
        const end: Point = [
          base[0] + ax * reach + dx * 0.5,
          base[1] + ay * reach + dy * 0.5,
          base[2] - 0.34 - t * 0.1,
        ]
        const width = 0.17 * (1 - t * 0.5)
        quad(
          mesh,
          [base[0] - dx * 0.055, base[1] - dy * 0.055, base[2]],
          [base[0] + dx * 0.055, base[1] + dy * 0.055, base[2]],
          [middle[0] + dx * width, middle[1] + dy * width, middle[2]],
          [middle[0] - dx * width, middle[1] - dy * width, middle[2]],
        )
        triangle(
          mesh,
          [middle[0] - dx * width, middle[1] - dy * width, middle[2]],
          [middle[0] + dx * width, middle[1] + dy * width, middle[2]],
          end,
        )
      }
    }
  }
  function geometry(mesh: Mesh): Cesium.Geometry {
    return new Cesium.Geometry({
      attributes: Object.assign(new Cesium.GeometryAttributes(), {
        position: new Cesium.GeometryAttribute({
          componentDatatype: Cesium.ComponentDatatype.DOUBLE,
          componentsPerAttribute: 3,
          values: new Float64Array(mesh.positions),
        }),
        normal: new Cesium.GeometryAttribute({
          componentDatatype: Cesium.ComponentDatatype.FLOAT,
          componentsPerAttribute: 3,
          values: new Float32Array(mesh.normals),
        }),
      }),
      indices: new Uint16Array(mesh.indices),
      primitiveType: Cesium.PrimitiveType.TRIANGLES,
      boundingSphere: Cesium.BoundingSphere.fromVertices(mesh.positions),
    })
  }
  return {
    trunk: geometry(trunk),
    foliage: geometry(foliage),
    tips: geometry(tips),
  }
}
