import { describe, expect, it } from 'vitest'
import {
  createSceneConfiguration,
  createSceneConfigurations,
  normalizeSceneConfiguration,
} from './configuration'

describe('environment scene configuration', () => {
  it('keeps defaults independent and matches the scene data', () => {
    const profiles = createSceneConfigurations()
    profiles.city.environment.exposure = 0.5
    profiles.city.shadows.size = 4096
    expect(profiles.reservoir.environment.exposure).toBe(1)
    expect(profiles.flood.shadows.size).toBe(2048)
    expect(profiles.city.environment.shadows).toBe(true)
    expect(profiles.city.environment).toMatchObject({
      modelLighting: 'studio',
      diffuseIntensity: 0.8,
      specularIntensity: 0.8,
      tonemapper: 'neutral',
      sunIntensity: 1.8,
    })
    expect(profiles.city.shadows.buildingShadows).toBe('cast')
    expect(profiles.reservoir.environment.shadows).toBe(false)
    expect(profiles.flood.water.level).toBe(0)
    const rainyCity = createSceneConfiguration('city', 'rain')
    expect(rainyCity.environment.sunIntensity).toBe(0.45)
    expect(rainyCity.environment.modelLighting).toBe('studio')
    expect(
      createSceneConfiguration('city', 'sunset').environment.sunIntensity,
    ).toBe(2.2)
  })

  it('round-trips every preset and scene without dropping configuration', () => {
    for (const scene of ['city', 'reservoir', 'flood'] as const)
      for (const weather of ['day', 'sunset', 'rain'] as const) {
        const config = createSceneConfiguration(scene, weather)
        expect(
          normalizeSceneConfiguration(
            scene,
            JSON.parse(JSON.stringify(config)),
          ),
        ).toEqual(config)
      }
  })

  it('bounds untrusted imported parameters before reaching renderer uniforms', () => {
    const config = normalizeSceneConfiguration('flood', {
      weather: 'unknown',
      view: 'unknown',
      environment: {
        exposure: Infinity,
        skyIntensity: 900,
        diffuseIntensity: 9,
        specularIntensity: 9,
        sunColor: 'red',
        sunAuto: 'false',
        rainLength: 0,
        hdr: null,
        tonemapper: 'unknown',
      },
      shadows: {
        size: 8192,
        distance: -20,
        depthBias: NaN,
        normalOffset: 9,
        buildingShadows: 'invalid',
      },
      water: { level: -4, visible: 'yes', color: 'url(x)', waveScale: -1 },
      quality: { pixelBudget: '8k', resolutionScale: 5, cacheMB: 2000 },
      source: {
        modelHeightOffset: Infinity,
        imagerySaturation: -2,
        modelShadows: 'unknown',
      },
      presentation: { vignette: 1, showLabels: 'no' },
    })
    expect(config.weather).toBe('day')
    expect(config.environment).toMatchObject({
      exposure: 1,
      skyIntensity: 3,
      diffuseIntensity: 1,
      specularIntensity: 1,
      sunAuto: true,
      rainLength: 0.25,
      hdr: true,
      tonemapper: 'aces',
    })
    expect(config.shadows).toMatchObject({
      size: 2048,
      distance: 200,
      depthBias: 0.00015,
      normalOffset: 3,
      buildingShadows: 'cast',
    })
    expect(config.water).toMatchObject({
      level: 0,
      visible: true,
      color: '#397e83',
      waveScale: 0.25,
    })
    expect(config.quality).toMatchObject({
      pixelBudget: '1080',
      resolutionScale: 1,
      cacheMB: 512,
    })
    expect(config.source).toMatchObject({
      modelHeightOffset: 0,
      imagerySaturation: 0,
      modelShadows: 'off',
    })
    expect(config.presentation).toMatchObject({
      vignette: 0.7,
      showLabels: true,
    })
  })

  it('accepts only known groups and handles non-object input', () => {
    expect(normalizeSceneConfiguration('city', null)).toEqual(
      createSceneConfiguration('city'),
    )
    expect(
      normalizeSceneConfiguration('city', { unexpected: 1 }),
    ).not.toHaveProperty('unexpected')
    expect(
      normalizeSceneConfiguration('city', { water: { level: 100 } }).water
        .level,
    ).toBe(42)
    expect(
      normalizeSceneConfiguration('reservoir', { water: { level: 100 } }).water
        .level,
    ).toBe(20)
  })
})
