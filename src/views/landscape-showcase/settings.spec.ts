import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { defaultShowcaseOptions, normalizeShowcaseOptions } from './settings'
import {
  createReservoirSamplePoints,
  parseReservoirGeometry,
} from '../environment-lab/reservoir-data'

describe('landscape showcase inputs', () => {
  it('keeps scene options independent and round-trips the complete look', () => {
    const mountain = defaultShowcaseOptions('mountain')
    const coast = defaultShowcaseOptions('coast')
    mountain.waveStrength = 1.4
    expect(coast.waveStrength).toBe(0.95)
    for (const scene of ['mountain', 'coast'] as const) {
      const config = defaultShowcaseOptions(scene)
      expect(
        normalizeShowcaseOptions(scene, JSON.parse(JSON.stringify(config))),
      ).toEqual(config)
    }
  })
  it('bounds shared URLs and controls before reaching water uniforms', () => {
    const result = normalizeShowcaseOptions('coast', {
      waveStrength: Infinity,
      waveLength: -2,
      roughness: 9,
      exposure: NaN,
      reflectionStrength: 100,
      foamWidth: -2,
      waterColor: 'red',
    })
    expect(result).toMatchObject({
      waveStrength: 0.95,
      waveLength: 4,
      roughness: 0.6,
      exposure: 1,
      reflectionStrength: 1.5,
      foamWidth: 1,
      waterColor: '#176b7b',
    })
  })
  it('checks the explicit public lake identity without weakening the existing default', () => {
    const source = JSON.parse(
      readFileSync('public/landscape-showcase/mauvoisin.geojson', 'utf8'),
    )
    expect(() => parseReservoirGeometry(source)).toThrow('Lac de la Gruyère')
    const lake = parseReservoirGeometry(source, 'Lac de Mauvoisin')
    expect(lake.polygons).toHaveLength(1)
    expect(lake.polygons[0]!.rings).toHaveLength(1)
    expect(lake.polygons[0]!.rings[0]!.length).toBeGreaterThan(500)
    const samples = createReservoirSamplePoints(lake)
    expect(samples.length).toBeGreaterThanOrEqual(5)
    expect(samples.length).toBeLessThanOrEqual(48)
    expect(
      samples.every(
        ([longitude, latitude]) =>
          longitude > 7.3 &&
          longitude < 7.4 &&
          latitude > 45.9 &&
          latitude < 46.04,
      ),
    ).toBe(true)
  })
})
