// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createSceneConfiguration } from './configuration'
import { useSceneConfiguration } from './useSceneConfiguration'

function setUrl(query = ''): void {
  history.replaceState({}, '', '/cesium-demo/environment-lab' + query)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

describe('environment lab scene configuration', () => {
  beforeEach(() => {
    localStorage.clear()
    setUrl()
  })

  it('keeps independent settings for each scene in local storage', () => {
    const state = useSceneConfiguration()
    const city = clone(state.configuration.value)
    city.environment.exposure = 1.37
    state.replace('city', city)

    const flood = createSceneConfiguration('flood', 'rain')
    flood.environment.exposure = 0.62
    flood.water.level = 8.5
    state.replace('flood', flood)
    state.setScene('flood')
    expect(state.configuration.value.environment.exposure).toBe(0.62)
    expect(state.configuration.value.water.level).toBe(8.5)

    const restored = useSceneConfiguration()
    restored.setScene('city')
    expect(restored.configuration.value.environment.exposure).toBe(1.37)
    restored.setScene('flood')
    expect(restored.configuration.value.environment.exposure).toBe(0.62)
  })

  it('round-trips a complete scene configuration through the share URL', () => {
    const state = useSceneConfiguration()
    const reservoir = createSceneConfiguration('reservoir', 'sunset')
    reservoir.environment.exposure = 0.73
    reservoir.environment.sunHeading = 218
    reservoir.shadows.size = 4096
    reservoir.water.level = 5.5
    reservoir.source.imagerySaturation = 1.23
    reservoir.presentation.vignette = 0.41
    state.replace('reservoir', reservoir)
    state.setScene('reservoir')
    state.updateUrl(true)

    const query = new URLSearchParams(location.search)
    expect(query.get('exposure')).toBe('0.73')
    expect(query.get('water')).toBe('5.5')
    expect(query.get('waterReference')).toBe('offset')
    expect(query.get('presentation')).toBe('screen')

    const restored = useSceneConfiguration().configuration.value
    expect(restored.weather).toBe('sunset')
    expect(restored.environment.exposure).toBe(0.73)
    expect(restored.environment.sunHeading).toBe(218)
    expect(restored.shadows.size).toBe(4096)
    expect(restored.water.level).toBe(5.5)
    expect(restored.source.imagerySaturation).toBe(1.23)
    expect(restored.presentation.vignette).toBe(0.41)
  })

  it('rejects an invalid import without partially replacing any scene', () => {
    const state = useSceneConfiguration()
    const original = state.exportProfiles()
    const city = createSceneConfiguration('city', 'sunset')
    city.environment.exposure = 1.8
    const flood = createSceneConfiguration('flood')
    flood.source.modelUrl = 'file:///private/tileset.json'

    expect(() =>
      state.importProfiles(
        JSON.stringify({
          version: 1,
          profiles: { city, flood },
        }),
      ),
    ).toThrow(/HTTP\(S\)/)
    expect(state.exportProfiles()).toBe(original)

    for (const profiles of [
      null,
      [],
      { city: null },
      { city: [] },
      { unknown: city },
    ]) {
      expect(() =>
        state.importProfiles(JSON.stringify({ version: 1, profiles })),
      ).toThrow()
      expect(state.exportProfiles()).toBe(original)
    }

    expect(() => state.importProfiles('{broken json')).toThrow()
    expect(state.exportProfiles()).toBe(original)
  })

  it('does not replace a saved profile when the URL has no environment settings', () => {
    const first = useSceneConfiguration()
    const saved = clone(first.configuration.value)
    saved.environment.exposure = 1.41
    saved.water.level = 12
    first.replace('city', saved)

    setUrl('?scene=city')
    const restored = useSceneConfiguration()
    expect(restored.configuration.value.environment.exposure).toBe(1.41)
    expect(restored.configuration.value.water.level).toBe(12)
  })

  it('keeps real-scene shadow defaults disabled for legacy weather links', () => {
    setUrl('?scene=reservoir&weather=sunset')
    expect(
      useSceneConfiguration().configuration.value.environment.shadows,
    ).toBe(false)

    setUrl('?scene=flood&weather=day')
    expect(
      useSceneConfiguration().configuration.value.environment.shadows,
    ).toBe(false)
  })

  it('migrates the old sunny fog value and ignores unmarked real-scene water values', () => {
    setUrl('?scene=city&weather=day&fog=0.32')
    expect(useSceneConfiguration().configuration.value.environment.fog).toBe(
      0.16,
    )

    setUrl('?scene=flood&water=13')
    expect(useSceneConfiguration().configuration.value.water.level).toBe(0)

    setUrl('?scene=city&water=0')
    expect(useSceneConfiguration().configuration.value.water.level).toBe(0)
  })
})
