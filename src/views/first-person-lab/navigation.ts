import { moveMeshPlayer, spawnMeshPlayer, type MeshPlayerState, type MeshWalkingWorld } from './mesh-walking'
import type { Point2 } from './walking'

/** A depth-picked floor point must support the complete capsule, not just the camera. */
export function findWalkTarget(world: MeshWalkingWorld, point: readonly number[]): Point2 | undefined {
  if (point.length !== 3 || !point.every(Number.isFinite)) return undefined
  try {
    const candidate = spawnMeshPlayer(world, point)
    if (Math.abs(candidate.footHeight - point[2]!) > 0.2) return undefined
    return { x: candidate.x, y: candidate.y }
  } catch { return undefined }
}

/** Click navigation follows a straight segment and stops on obstruction; it is not path finding. */
export function advanceToTarget(player: MeshPlayerState, target: Point2, seconds: number, world: MeshWalkingWorld) {
  const dx = target.x - player.x, dy = target.y - player.y
  const distance = Math.hypot(dx, dy)
  if (distance < 0.025) return { player, stopped: 'arrived' as const }
  const speed = Math.min(1.8, distance / Math.max(seconds, 0.001))
  const next = moveMeshPlayer(player, { x: dx / distance * speed, y: dy / distance * speed }, seconds, world)
  const progress = Math.hypot(next.x - player.x, next.y - player.y)
  const along = ((next.x - player.x) * dx + (next.y - player.y) * dy) / distance
  const stopped = along < speed * Math.min(seconds, 0.2) * 0.2 && progress < 0.01 ? 'blocked' as const : undefined
  return { player: next, stopped }
}

