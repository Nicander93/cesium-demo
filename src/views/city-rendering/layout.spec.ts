import { describe, expect, it } from 'vitest'
import {
  cityBuildings,
  routeLength,
  trafficRoutes,
  vehiclePose,
} from './layout'
import { collisionHeight } from './rain'

describe('city traffic and rain collision', () => {
  it('wraps full laps in both travel directions without a position jump', () => {
    for (const route of trafficRoutes) {
      const length = routeLength(route)
      expect(vehiclePose(route, 35)).toEqual(vehiclePose(route, length + 35))
      const negative = vehiclePose(route, -35),
        wrapped = vehiclePose(route, length - 35)
      expect(negative.x).toBeCloseTo(wrapped.x)
      expect(negative.y).toBeCloseTo(wrapped.y)
    }
  })
  it('uses traveled meters for motion and keeps opposite lanes distinct', () => {
    const route = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]
    expect(
      vehiclePose(route, 25, 4).x - vehiclePose(route, 10, 4).x,
    ).toBeCloseTo(15)
    expect(vehiclePose(route, 25, 4).y).toBe(-4)
    expect(vehiclePose(route, 25, -4).y).toBe(4)
  })
  it('keeps building centers off the river and cross streets', () => {
    const buildings = cityBuildings()
    expect(buildings).toHaveLength(24)
    expect(
      buildings.every(
        (building) =>
          Math.abs(building.x) > 90 &&
          [-220, -110, 0, 110, 220].every((y) => Math.abs(y - building.y) > 25),
      ),
    ).toBe(true)
  })
  it('stops rain at water, bridge decks and building roofs', () => {
    const obstacles = [
      { x: 125, y: -55, halfWidth: 20, halfLength: 25, roof: 95 },
    ]
    expect(collisionHeight(0, 60, obstacles)).toBe(1)
    expect(collisionHeight(0, 0, obstacles)).toBe(3.8)
    expect(collisionHeight(125, -55, obstacles)).toBe(95)
    expect(collisionHeight(200, -55, obstacles)).toBe(2.3)
  })
})
