import { describe, expect, it } from 'vitest'
import { movePlayer, walkingVelocity, WALKING_WORLD, type PlayerState } from './walking'

const player = (x: number, y: number): PlayerState => ({ x, y, footHeight: 0, heading: 0, pitch: 0 })

describe('first-person walking', () => {
  it('passes through the doorway cut into the south wall', () => {
    const moved = movePlayer(player(0, -5.8), { x: 0, y: 1.6 })
    expect(moved.y).toBeGreaterThan(-4.5)
  })

  it('stops at a solid wall while keeping the player outside its footprint', () => {
    const moved = movePlayer(player(-3.5, -6.2), { x: 0, y: 2 })
    expect(moved.y).toBeLessThan(-5.2)
  })

  it('does not let the capsule pass through the visible furniture footprint', () => {
    const moved = movePlayer(player(2.4, -2.7), { x: 2, y: 0 })
    expect(moved.x).toBeLessThan(3.15 - WALKING_WORLD.radius)
  })

  it('slides along a wall when the requested path has a blocked axis', () => {
    const moved = movePlayer(player(-7.4, -4), { x: 3, y: 3 })
    expect(moved.x).toBeLessThan(-6.1)
    expect(moved.y).toBeGreaterThan(-2)
  })

  it('supports the low entry step and bounded long-frame movement', () => {
    const stair = movePlayer(player(0, -7.5), { x: 0, y: 0.8 })
    expect(stair.footHeight).toBeCloseTo(0.18)
    const wall = movePlayer(player(-3.5, -2), { x: 0, y: 12 })
    expect(wall.y).toBeLessThan(0)
  })

  it('normalizes diagonal input so it has the same speed as straight input', () => {
    const straight = walkingVelocity(new Set(['KeyW']), 3)
    const diagonal = walkingVelocity(new Set(['KeyW', 'KeyD']), 3)
    expect(Math.hypot(straight.x, straight.y)).toBeCloseTo(3)
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(3)
  })

  it('keeps the player inside the configured exterior bounds', () => {
    const moved = movePlayer(player(0, 0), { x: 100, y: 100 })
    expect(moved.x).toBeLessThanOrEqual(WALKING_WORLD.bounds.maxX - WALKING_WORLD.radius)
    expect(moved.y).toBeLessThanOrEqual(WALKING_WORLD.bounds.maxY - WALKING_WORLD.radius)
  })
})
