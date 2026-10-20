import * as Cesium from 'cesium'
import { describe, expect, it, vi } from 'vitest'
import { sampleTerrainGrid } from '../terrain'

vi.mock('cesium', async importOriginal => {
  const original = await importOriginal<typeof import('cesium')>()
  return { ...original, sampleTerrain: vi.fn(), sampleTerrainMostDetailed: vi.fn() }
})

const layout = { columns: 2, rows: 2, cellSize: 12, origin: [119, 33, 50] as [number, number, number], elevation: [0, 0, 0, 0] }

describe('Cesium terrain domain adapter', () => {
  it('samples available detail and transforms ellipsoid heights into local ENU', async () => {
    vi.mocked(Cesium.sampleTerrainMostDetailed).mockImplementation(async (_, points) => points.map(point => new Cesium.Cartographic(point.longitude, point.latitude, 75)))
    const provider = { availability: {} } as Cesium.TerrainProvider
    const sampled = await sampleTerrainGrid(provider, layout)
    expect(sampled.elevation.every(z => Math.abs(z - 25) < 0.001)).toBe(true)
    expect(sampled.origin).toEqual(layout.origin)
    expect(layout.elevation).toEqual([0, 0, 0, 0])
    const calls = vi.mocked(Cesium.sampleTerrainMostDetailed).mock.calls
    expect(calls[calls.length - 1]?.[1]).toHaveLength(4)
  })

  it('requires an explicit level when availability is missing', async () => {
    const provider = {} as Cesium.TerrainProvider
    await expect(sampleTerrainGrid(provider, layout)).rejects.toThrow('指定采样层级')
    vi.mocked(Cesium.sampleTerrain).mockImplementation(async (_, __, points) => points.map(point => new Cesium.Cartographic(point.longitude, point.latitude, 75)))
    const sampled = await sampleTerrainGrid(provider, layout, { level: 12 })
    expect(sampled.elevation).toHaveLength(4)
    const calls = vi.mocked(Cesium.sampleTerrain).mock.calls
    expect(calls[calls.length - 1]?.[1]).toBe(12)
  })

  it('rejects missing terrain heights and ignores a cancelled response', async () => {
    const provider = { availability: {} } as Cesium.TerrainProvider
    vi.mocked(Cesium.sampleTerrainMostDetailed).mockImplementation(async (_, points) => points.map(point => new Cesium.Cartographic(point.longitude, point.latitude, NaN)))
    await expect(sampleTerrainGrid(provider, layout)).rejects.toThrow('缺失高程')
    const controller = new AbortController()
    vi.mocked(Cesium.sampleTerrainMostDetailed).mockImplementation(async (_, points) => { controller.abort(); return points })
    await expect(sampleTerrainGrid(provider, layout, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
