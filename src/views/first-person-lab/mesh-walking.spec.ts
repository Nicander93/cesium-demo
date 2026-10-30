import { describe, expect, it } from 'vitest'
import { createMeshWalkingWorld, moveMeshPlayer, spawnMeshPlayer } from './mesh-walking'

function quad(a: number[], b: number[], c: number[], d: number[]): number[] { return [...a, ...b, ...c, ...a, ...c, ...d] }
function fixture() {
  return createMeshWalkingWorld(new Float32Array([
    ...quad([-8, -8, 0], [8, -8, 0], [8, 8, 0], [-8, 8, 0]),
    ...quad([-8, 2, 0], [-1, 2, 0], [-1, 2, 3], [-8, 2, 3]),
    ...quad([1, 2, 0], [8, 2, 0], [8, 2, 3], [1, 2, 3]),
    ...quad([3, -2, 0], [3, 0, 0], [3, 0, 1], [3, -2, 1]),
  ]))
}
function travel(x: number, y: number, vx: number, vy: number, time: number) {
  const world = fixture()
  let player = spawnMeshPlayer(world, [x, y, 0])
  for (let i = 0; i < time * 60; i++) player = moveMeshPlayer(player, { x: vx, y: vy }, 1 / 60, world)
  return player
}
describe('triangle mesh walking', () => {
  it('walks through a real mesh doorway and stays supported by the floor', () => {
    const player = travel(0, 0, 0, 2, 2)
    expect(player.y).toBeGreaterThan(3.8)
    expect(Math.abs(player.footHeight)).toBeLessThan(0.002)
    expect(player.grounded).toBe(true)
  })
  it('blocks thin mesh walls from both sides and slides along them', () => {
    const inside = travel(-3, 0, 1, 2, 2)
    expect(inside.y).toBeLessThanOrEqual(1.78)
    expect(inside.x).toBeGreaterThan(-1.1)
    const outside = travel(-3, 4, 0, -2, 2)
    expect(outside.y).toBeGreaterThanOrEqual(2.22)
  })
  it('does not tunnel on a long frame or walk through furniture', () => {
    const world = fixture()
    let player = spawnMeshPlayer(world, [-3, 1.5, 0])
    player = moveMeshPlayer(player, { x: 0, y: 15 }, 4, world)
    expect(player.y).toBeLessThan(1.78)
    const furniture = travel(2, -1, 2, 0, 1)
    expect(furniture.x).toBeLessThan(2.78)
  })
  it('falls under gravity and rejects invalid or intersecting spawn data', () => {
    const world = fixture()
    const falling = moveMeshPlayer({ x: 0, y: 0, footHeight: 1, heading: 0, pitch: 0, verticalVelocity: 0, grounded: false }, { x: 0, y: 0 }, 0.1, world)
    expect(falling.footHeight).toBeLessThan(1)
    expect(() => spawnMeshPlayer(world, [-3, 2, 0])).toThrow()
    expect(() => createMeshWalkingWorld(new Float32Array([1, NaN, 0]))).toThrow()
  })
  it('climbs a low mesh step and returns to the lower floor', () => {
    const world = createMeshWalkingWorld(new Float32Array([
      ...quad([-4, -4, 0], [4, -4, 0], [4, 4, 0], [-4, 4, 0]),
      ...quad([-1, -1, 0.18], [1, -1, 0.18], [1, 0, 0.18], [-1, 0, 0.18]),
      ...quad([-1, -1, 0], [1, -1, 0], [1, -1, 0.18], [-1, -1, 0.18]),
    ]))
    let player = spawnMeshPlayer(world, [0, -2, 0])
    for (let i = 0; i < 90; i++) player = moveMeshPlayer(player, { x: 0, y: 1 }, 1 / 60, world)
    expect(player.y).toBeGreaterThan(-0.7)
    expect(player.footHeight).toBeCloseTo(0.18, 2)
    for (let i = 0; i < 90; i++) player = moveMeshPlayer(player, { x: 0, y: 1 }, 1 / 60, world)
    expect(player.footHeight).toBeCloseTo(0, 2)
  })
})
