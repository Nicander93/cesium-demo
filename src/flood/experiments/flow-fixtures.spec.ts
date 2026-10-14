import { describe, expect, it } from 'vitest'
import { createDataset, parseFloodDataset } from '../core/dataset'
import { computeFloodFoamSources, FloodFoam } from '../cesium/foam'
import { createFlowFixture, createFixtureFrame, flowFixtureIds } from './flow-fixtures'

describe('synthetic renderer inputs', () => {
  it.each(flowFixtureIds)('validates %s with the external-result contract', id => {
    const fixture = createFlowFixture(id)
    expect(parseFloodDataset(createDataset(fixture.grid, [createFixtureFrame(fixture, 0)])).grid.origin).toEqual([119, 33, 100])
  })
  it('distinguishes slow and rapid sources, with no invented missing velocity', () => {
    const slow = createFlowFixture('slow'), rapid = createFlowFixture('rapid')
    expect(Math.max(...computeFloodFoamSources(slow.grid, slow.frame))).toBe(0)
    expect(Math.max(...computeFloodFoamSources(rapid.grid, rapid.frame))).toBeGreaterThan(0.1)
    const missing = createFixtureFrame(rapid, 0, false)
    expect(missing.velocityEast).toBeUndefined()
    expect(computeFloodFoamSources(rapid.grid, missing).every(v => v === 0)).toBe(true)
  })
  it('uses both directions in a bend and leaves the obstacle dry', () => {
    const bend = createFlowFixture('bend')
    expect(bend.frame.velocityEast.some(v => v > 0.2)).toBe(true)
    expect(bend.frame.velocityEast.some(v => v < -0.2)).toBe(true)
    const obstacle = createFlowFixture('obstacle')
    expect(obstacle.frame.depth[32 * 40 + 20]).toBe(0)
  })
  it('keeps source diagnostics available on the first frame and frozen time without altering inputs', () => {
    const fixture = createFlowFixture('rapid'), foam = new FloodFoam(fixture.grid)
    const original = JSON.stringify(fixture)
    foam.update(createFixtureFrame(fixture, 0), 18)
    expect(foam.sources.some(v => v > 0)).toBe(true)
    expect(foam.coverage.every(v => v === 0)).toBe(true)
    foam.update(createFixtureFrame(fixture, 1), 18)
    const coverage = Array.from(foam.coverage)
    foam.update(createFixtureFrame(fixture, 1), 18)
    expect(Array.from(foam.coverage)).toEqual(coverage)
    expect(JSON.stringify(fixture)).toBe(original)
  })
})
