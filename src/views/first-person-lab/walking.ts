export interface Point2 {
  x: number
  y: number
}

export interface Rect {
  minX: number
  maxX: number
  minY: number
  maxY: number
  height: number
}

export interface Blocker extends Rect {
  color: string
}

export interface WalkingWorld {
  bounds: Rect
  walls: Rect[]
  blockers: Blocker[]
  platforms: Rect[]
  radius: number
  eyeHeight: number
  maxStepUp: number
  maxStepDown: number
}

export interface PlayerState extends Point2 {
  footHeight: number
  heading: number
  pitch: number
}

export const WALKING_WORLD: WalkingWorld = {
  bounds: { minX: -10, maxX: 10, minY: -9, maxY: 10, height: 0 },
  radius: 0.22,
  eyeHeight: 1.65,
  maxStepUp: 0.32,
  maxStepDown: 0.55,
  walls: [
    // House shell. The south wall is split around a 2 m doorway.
    { minX: -6.2, maxX: -6, minY: -5.2, maxY: 7.2, height: 3.2 },
    { minX: 6, maxX: 6.2, minY: -5.2, maxY: 7.2, height: 3.2 },
    { minX: -6.2, maxX: 6.2, minY: 7, maxY: 7.2, height: 3.2 },
    { minX: -6.2, maxX: -1, minY: -5.2, maxY: -5, height: 3.2 },
    { minX: 1, maxX: 6.2, minY: -5.2, maxY: -5, height: 3.2 },
    // Interior partition with a wide passage.
    { minX: -6, maxX: -1.25, minY: 0, maxY: 0.18, height: 2.8 },
    { minX: 1.25, maxX: 6, minY: 0, maxY: 0.18, height: 2.8 },
  ],
  blockers: [
    { minX: -4.95, maxX: -2.65, minY: 1.8, maxY: 3, height: 0.84, color: '#856746' },
    { minX: 3.15, maxX: 4.95, minY: -3.4, maxY: -2, height: 0.9, color: '#b87850' },
  ],
  platforms: [
    { minX: -1.5, maxX: 1.5, minY: -7.25, maxY: -5.1, height: 0.18 },
    { minX: 2.7, maxX: 5.4, minY: 2.3, maxY: 4.6, height: 0.22 },
  ],
}

function circleOverlapsRect(point: Point2, radius: number, rect: Rect): boolean {
  const x = Math.max(rect.minX, Math.min(point.x, rect.maxX))
  const y = Math.max(rect.minY, Math.min(point.y, rect.maxY))
  return Math.hypot(point.x - x, point.y - y) < radius - 1e-8
}

function groundHeight(point: Point2, world: WalkingWorld): number {
  let height = 0
  for (const platform of world.platforms) {
    if (
      point.x >= platform.minX && point.x <= platform.maxX &&
      point.y >= platform.minY && point.y <= platform.maxY
    ) height = Math.max(height, platform.height)
  }
  return height
}

function canStand(point: Point2, fromHeight: number, world: WalkingWorld): boolean {
  const radius = world.radius
  if (
    point.x - radius < world.bounds.minX || point.x + radius > world.bounds.maxX ||
    point.y - radius < world.bounds.minY || point.y + radius > world.bounds.maxY
  ) return false
  for (const wall of world.walls) {
    if (wall.height > fromHeight && circleOverlapsRect(point, radius, wall)) return false
  }
  for (const blocker of world.blockers) {
    if (blocker.height > fromHeight && circleOverlapsRect(point, radius, blocker)) return false
  }
  const nextHeight = groundHeight(point, world)
  return nextHeight - fromHeight <= world.maxStepUp && fromHeight - nextHeight <= world.maxStepDown
}

/** Resolve horizontal movement in small steps, checking each axis so the player slides along walls. */
export function movePlayer(
  player: PlayerState,
  delta: Point2,
  world: WalkingWorld = WALKING_WORLD,
): PlayerState {
  const distance = Math.hypot(delta.x, delta.y)
  if (!Number.isFinite(distance) || distance === 0) return { ...player }
  const steps = Math.min(128, Math.max(1, Math.ceil(distance / 0.08)))
  const scale = Math.min(1, (128 * 0.08) / distance)
  const stepX = delta.x * scale / steps
  const stepY = delta.y * scale / steps
  let { x, y, footHeight } = player
  for (let step = 0; step < steps; step++) {
    const nextX = { x: x + stepX, y }
    if (canStand(nextX, footHeight, world)) {
      x = nextX.x
      footHeight = groundHeight(nextX, world)
    }
    const nextY = { x, y: y + stepY }
    if (canStand(nextY, footHeight, world)) {
      y = nextY.y
      footHeight = groundHeight(nextY, world)
    }
  }
  return { ...player, x, y, footHeight }
}

export function walkingVelocity(keys: ReadonlySet<string>, speed: number): Point2 {
  const forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS'))
  const side = Number(keys.has('KeyD')) - Number(keys.has('KeyA'))
  const length = Math.hypot(forward, side) || 1
  return { x: side / length * speed, y: forward / length * speed }
}
