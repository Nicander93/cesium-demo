import { describe, expect, it } from 'vitest'
import { createMeshWalkingWorld, spawnMeshPlayer } from './mesh-walking'
import { advanceToTarget, findWalkTarget } from './navigation'

const quad = (a: number[], b: number[], c: number[], d: number[]) => [...a, ...b, ...c, ...a, ...c, ...d]
const world = createMeshWalkingWorld(new Float32Array([
  ...quad([-5, -5, 0], [5, -5, 0], [5, 5, 0], [-5, 5, 0]),
  ...quad([-5, 2, 0], [5, 2, 0], [5, 2, 3], [-5, 2, 3]),
]))
describe('click navigation on a collision mesh', () => {
  it('accepts supported floor and rejects walls, void and nonfinite coordinates', () => {
    expect(findWalkTarget(world, [1, 0, 0])).toEqual({ x: 1, y: 0 })
    expect(findWalkTarget(world, [0, 2, 1])).toBeUndefined()
    expect(findWalkTarget(world, [10, 0, 0])).toBeUndefined()
    expect(findWalkTarget(world, [NaN, 0, 0])).toBeUndefined()
  })
  it('arrives without overshooting and stays grounded', () => {
    let player = spawnMeshPlayer(world, [0, 0, 0])
    for (let i = 0; i < 180; i++) player = advanceToTarget(player, { x: 1, y: 0 }, 1 / 60, world).player
    expect(player.x).toBeCloseTo(1, 1)
    expect(player.grounded).toBe(true)
  })
  it('stops before a wall instead of teleporting through it', () => {
    let player = spawnMeshPlayer(world, [0, 0, 0])
    let stopped: string | undefined
    for (let i = 0; i < 180 && !stopped; i++) {
      const next = advanceToTarget(player, { x: 0, y: 4 }, 1 / 60, world)
      player = next.player; stopped = next.stopped
    }
    expect(stopped).toBe('blocked')
    expect(player.y).toBeLessThan(1.78)
  })
})
