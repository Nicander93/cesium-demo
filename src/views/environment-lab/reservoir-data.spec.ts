import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  createReservoirSamplePoints,
  parseReservoirGeometry,
} from './reservoir-data'

describe('Gruyère reservoir geometry', () => {
  it('loads the official lake polygon with its three holes', () => {
    const source = JSON.parse(
      readFileSync('public/environment-lab/lac-de-la-gruyere.geojson', 'utf8'),
    )
    const geometry = parseReservoirGeometry(source)
    expect(geometry.polygons).toHaveLength(1)
    expect(geometry.polygons[0].hierarchy.holes).toHaveLength(3)
    expect(geometry.anchor[0]).toBeCloseTo(7.09894, 3)
    expect(geometry.anchor[1]).toBeCloseTo(46.6653, 3)
  })

  it('chooses distributed points away from the shore and holes', () => {
    const source = JSON.parse(
      readFileSync('public/environment-lab/lac-de-la-gruyere.geojson', 'utf8'),
    )
    const geometry = parseReservoirGeometry(source)
    const samples = createReservoirSamplePoints(geometry)
    expect(samples.length).toBeGreaterThanOrEqual(5)
    expect(samples.length).toBeLessThanOrEqual(48)
    expect(
      samples.every(
        ([longitude, latitude]) =>
          longitude >= 7.077457 &&
          longitude <= 7.121377 &&
          latitude >= 46.612687 &&
          latitude <= 46.719103,
      ),
    ).toBe(true)
  })

  it('keeps separate islands and holes as Cesium polygon hierarchies', () => {
    const source = {
      type: 'Feature',
      properties: { name: 'Lac de la Gruyère' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [7, 46],
              [7.01, 46],
              [7.01, 46.01],
              [7, 46.01],
              [7, 46],
            ],
            [
              [7.002, 46.002],
              [7.003, 46.002],
              [7.003, 46.003],
              [7.002, 46.003],
              [7.002, 46.002],
            ],
          ],
          [
            [
              [7.004, 46.004],
              [7.005, 46.004],
              [7.005, 46.005],
              [7.004, 46.005],
              [7.004, 46.004],
            ],
          ],
        ],
      },
    }
    const geometry = parseReservoirGeometry(source)
    expect(geometry.polygons).toHaveLength(2)
    expect(geometry.polygons[0].hierarchy.holes).toHaveLength(1)
    expect(geometry.polygons[1].hierarchy.holes).toHaveLength(0)
  })
})
