import { Box3, Ray, Triangle, Vector3 } from 'three'
import { Octree } from 'three/addons/math/Octree.js'
import { Capsule } from 'three/addons/math/Capsule.js'
import type { PlayerState, Point2 } from './walking'

export interface MeshPlayerState extends PlayerState {
  verticalVelocity: number
  grounded: boolean
}
export interface MeshWalkingWorld {
  octree: Octree
  bounds: Box3
  triangleCount: number
  radius: number
  bodyHeight: number
  eyeHeight: number
}
const UP = new Vector3(0, 0, 1)
const DOWN = new Vector3(0, 0, -1)
const STEP_HEIGHT = 0.28

/** Three's default split creates children with default limits; keep room limits at every level. */
class RoomOctree extends Octree {
  constructor(box?: Box3) {
    super(box)
    this.trianglesPerLeaf = 64
    this.maxLevel = 6
  }
  override split(level: number): this {
    if (!this.box) return this
    const half = this.box.max.clone().sub(this.box.min).multiplyScalar(0.5)
    const children: RoomOctree[] = []
    for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) {
      const min = this.box.min.clone().add(new Vector3(x * half.x, y * half.y, z * half.z))
      children.push(new RoomOctree(new Box3(min, min.clone().add(half))))
    }
    for (const triangle of this.triangles) for (const child of children) {
      if (child.box?.intersectsTriangle(triangle)) child.triangles.push(triangle)
    }
    this.triangles.length = 0
    for (const child of children) {
      if (!child.triangles.length) continue
      if (child.triangles.length > this.trianglesPerLeaf && level < this.maxLevel) child.split(level + 1)
      this.subTrees.push(child)
    }
    return this
  }
  override getCapsuleTriangles(capsule: Capsule, triangles: Triangle[]): Triangle[] {
    const seen = new Set(triangles)
    const pending: Octree[] = [this]
    while (pending.length) {
      const node = pending.pop()!
      for (const child of node.subTrees) {
        if (!child.box || !capsule.intersectsBox(child.box)) continue
        if (!child.triangles.length) { pending.push(child); continue }
        for (const triangle of child.triangles) if (!seen.has(triangle)) {
          seen.add(triangle); triangles.push(triangle)
        }
      }
    }
    return triangles
  }
}

/** Build collision from the exact normalized model triangles; Three is used only for spatial math. */
export function createMeshWalkingWorld(positions: Float32Array): MeshWalkingWorld {
  if (positions.length < 9 || positions.length % 9 !== 0 || !positions.every(Number.isFinite)) throw new Error('室内碰撞网格无效')
  const octree = new RoomOctree()
  const bounds = new Box3()
  for (let index = 0; index < positions.length; index += 9) {
    const a = new Vector3().fromArray(positions, index)
    const b = new Vector3().fromArray(positions, index + 3)
    const c = new Vector3().fromArray(positions, index + 6)
    bounds.expandByPoint(a); bounds.expandByPoint(b); bounds.expandByPoint(c)
    const triangle = new Triangle(a, b, c)
    if (triangle.getArea() < 1e-9) continue
    octree.addTriangle(triangle)
    // Render materials can be double-sided. Collision must also block from either side.
    octree.addTriangle(new Triangle(a.clone(), c.clone(), b.clone()))
  }
  octree.build()
  return { octree, bounds, triangleCount: positions.length / 9, radius: 0.23, bodyHeight: 1.72, eyeHeight: 1.62 }
}

function capsuleAt(player: Pick<PlayerState, 'x' | 'y' | 'footHeight'>, world: MeshWalkingWorld): Capsule {
  return new Capsule(new Vector3(player.x, player.y, player.footHeight + world.radius), new Vector3(player.x, player.y, player.footHeight + world.bodyHeight - world.radius), world.radius)
}
function floorBelow(world: MeshWalkingWorld, x: number, y: number, from: number) {
  const hit = world.octree.rayIntersect(new Ray(new Vector3(x, y, from), DOWN))
  if (!hit || Math.abs(hit.triangle.getNormal(new Vector3()).z) < 0.55) return undefined
  return hit.position.z
}
function resolve(world: MeshWalkingWorld, capsule: Capsule) {
  let grounded = false, ceiling = false, contacts = 0
  for (let iteration = 0; iteration < 5; iteration++) {
    const contact = world.octree.capsuleIntersect(capsule)
    if (!contact || contact.depth < 1e-7) break
    capsule.translate(contact.normal.clone().multiplyScalar(contact.depth + 0.00001))
    grounded ||= contact.normal.z > 0.55
    ceiling ||= contact.normal.z < -0.55
    contacts++
  }
  return { grounded, ceiling, contacts }
}

export function spawnMeshPlayer(world: MeshWalkingWorld, position: readonly number[], heading = 0, pitch = 0): MeshPlayerState {
  const x = position[0] ?? 0, y = position[1] ?? 0, hint = position[2] ?? 0
  const floor = floorBelow(world, x, y, hint + 0.5)
  if (floor === undefined || floor < hint - 2) throw new Error('模型出生点下方没有可站立地面')
  const player: MeshPlayerState = { x, y, footHeight: floor + 0.0001, heading, pitch, verticalVelocity: 0, grounded: true }
  const capsule = capsuleAt(player, world)
  resolve(world, capsule)
  if (Math.hypot(capsule.start.x - x, capsule.start.y - y) > 0.15 || Math.abs(capsule.start.z - world.radius - player.footHeight) > 0.15) throw new Error('模型出生点与墙或家具相交')
  return player
}

/** Capsule motion uses bounded substeps, wall sliding, gravity, low-step climbing and floor support. */
export function moveMeshPlayer(player: MeshPlayerState, velocity: Point2, seconds: number, world: MeshWalkingWorld): MeshPlayerState {
  if (![seconds, velocity.x, velocity.y].every(Number.isFinite) || seconds <= 0) return { ...player }
  if (player.grounded && Math.hypot(velocity.x, velocity.y) < 1e-8 && Math.abs(player.verticalVelocity) < 1e-8) return { ...player }
  const dt = Math.min(seconds, 0.2)
  const steps = Math.max(1, Math.ceil(Math.max(Math.hypot(velocity.x, velocity.y) * dt / 0.06, dt / 0.012)))
  const stepTime = dt / steps
  const capsule = capsuleAt(player, world)
  let vertical = player.verticalVelocity, grounded = player.grounded
  for (let step = 0; step < steps; step++) {
    const before = capsule.clone()
    const dx = velocity.x * stepTime, dy = velocity.y * stepTime
    capsule.translate(new Vector3(dx, dy, 0))
    const horizontal = resolve(world, capsule)
    const blocked = Math.hypot(capsule.start.x - before.start.x - dx, capsule.start.y - before.start.y - dy) > 0.003
    if (blocked && grounded) {
      const lifted = before.clone().translate(new Vector3(dx, dy, STEP_HEIGHT))
      resolve(world, lifted)
      const directionLength = Math.hypot(dx, dy) || 1
      const aheadX = lifted.start.x + dx / directionLength * (world.radius + 0.02)
      const aheadY = lifted.start.y + dy / directionLength * (world.radius + 0.02)
      const floor = floorBelow(world, aheadX, aheadY, lifted.start.z - world.radius + 0.03)
      const reached = Math.hypot(lifted.start.x - before.start.x - dx, lifted.start.y - before.start.y - dy) < 0.003
      const rise = floor === undefined ? Infinity : floor - (before.start.z - world.radius)
      if (reached && rise >= -0.03 && rise <= STEP_HEIGHT + 0.01) {
        lifted.translate(UP.clone().multiplyScalar(floor! + world.radius - lifted.start.z + 0.0001))
        const checked = resolve(world, lifted)
        if (!checked.ceiling && Math.hypot(lifted.start.x - before.start.x - dx, lifted.start.y - before.start.y - dy) < 0.003) capsule.copy(lifted)
      }
    }
    vertical -= 15 * stepTime
    capsule.translate(UP.clone().multiplyScalar(vertical * stepTime))
    const collision = resolve(world, capsule)
    grounded = collision.grounded || horizontal.grounded
    if ((collision.grounded && vertical < 0) || (collision.ceiling && vertical > 0)) vertical = 0
    if (vertical <= 0 && (grounded || player.grounded)) {
      const foot = capsule.start.z - world.radius
      const floor = floorBelow(world, capsule.start.x, capsule.start.y, foot + 0.04)
      if (floor !== undefined && foot - floor >= -0.01 && foot - floor <= 0.03) {
        capsule.translate(UP.clone().multiplyScalar(floor - foot + 0.0001))
        grounded = true; vertical = 0
      }
    }
  }
  return { ...player, x: capsule.start.x, y: capsule.start.y, footHeight: capsule.start.z - world.radius, verticalVelocity: vertical, grounded }
}
