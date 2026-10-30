import { describe, expect, it } from 'vitest'
import { PlantingStore, groundHeight, tileKey, type PlantingOptions, type PlantingSurface } from './planting'
import { SPECIES_IDS } from './species'

const options: PlantingOptions = { species: 'pine', spacing: 2, scaleMin: 0.75, scaleMax: 1.3 }
const bounds = { minX: -20, minY: -20, maxX: 20, maxY: 20 }

describe('planting editing and spatial sampling', () => {
  it('randomizes only among selected species and reproduces the mixture from a seed', () => {
    const first = new PlantingStore(), second = new PlantingStore()
    const mixed: PlantingOptions = { ...options, speciesPool: ['birch', 'shrub', 'grass'] }
    for (const store of [first, second]) { store.setSeed(712); store.scatter(bounds, 100, mixed) }
    expect(first.values()).toEqual(second.values())
    expect(new Set(first.values().map(plant => plant.species))).toEqual(new Set(mixed.speciesPool))
    expect(first.values().every(plant => plant.species !== 'pine' && plant.species !== 'broadleaf')).toBe(true)
  })
  it('keeps a single choice deterministic, and an empty pool creates no edits', () => {
    const selected = new PlantingStore(), legacy = new PlantingStore()
    selected.scatter(bounds, 20, { ...options, speciesPool: ['pine'] })
    legacy.scatter(bounds, 20, options)
    expect(selected.exportJson()).toBe(legacy.exportJson())
    const empty = new PlantingStore()
    expect(empty.add(0, 0, { ...options, speciesPool: [] })).toBeUndefined()
    expect(empty.scatter(bounds, 100, { ...options, speciesPool: [] })).toBe(0)
    expect(empty.canUndo).toBe(false)
  })
  it('preserves all five species through grouped undo, redo and JSON round trips', () => {
    const store = new PlantingStore()
    store.begin()
    SPECIES_IDS.forEach((species, index) => store.add(index * 4, 0, { ...options, species }))
    store.end()
    const json = store.exportJson()
    store.undo(); expect(store.size).toBe(0)
    store.redo(); expect(store.exportJson()).toBe(json)
    const restored = new PlantingStore()
    restored.importJson(json)
    expect(restored.exportJson()).toBe(json)
    const bad = JSON.parse(json)
    bad.plants[0].species = 'unknown-tree'
    expect(() => restored.importJson(JSON.stringify(bad))).toThrow()
    expect(restored.exportJson()).toBe(json)
  })
  it('uses the selected real surface, filters slopes, and never falls back to synthetic heights', () => {
    const surface: PlantingSurface = { id: 'terrain-test', heightAt: (x, y) => x < -5 ? undefined : x + y * 0.5, slopeAt: x => x > 10 ? 60 : 20 }
    const store = new PlantingStore(undefined, surface)
    expect(store.add(-10, 0, options)).toBeUndefined()
    expect(store.add(12, 0, { ...options, maxSlope: 35 })).toBeUndefined()
    expect(store.add(2, 3, { ...options, maxSlope: 35 })?.z).toBe(3.5)
  })
  it('keeps exact root refinements with undo and ignores stale asynchronous height results', () => {
    const surface: PlantingSurface = { id: 'terrain-test', heightAt: (x, y) => x + y, maxHeightError: 10 }
    const store = new PlantingStore(undefined, surface)
    const plant = store.add(2, 4, options)!
    store.updateHeights([{ plant, height: 6.35 }])
    store.undo(); expect(store.size).toBe(0)
    store.redo(); expect(store.get(plant.id)?.z).toBe(6.35)
    const exported = store.exportJson()
    store.importJson(exported)
    store.updateHeights([{ plant, height: 9 }])
    expect(store.get(plant.id)?.z).toBe(6.35)
  })
  it('exports terrain reference and rebases local z while refusing a different region', () => {
    const reference = { longitude: 8.034, latitude: 46.638, height: 1500, terrainUrl: 'https://example.com/terrain/' }
    const oldStore = new PlantingStore(undefined, { id: 'terrain-test', heightAt: () => 5, reference })
    oldStore.add(0, 0, options)
    const imported = oldStore.exportJson()
    expect(JSON.parse(imported).version).toBe(2)
    const newStore = new PlantingStore(undefined, { id: 'terrain-test', heightAt: () => 3, reference: { ...reference, height: 1502 } })
    newStore.importJson(imported)
    expect(newStore.values()[0]?.z).toBe(3)
    const bad = JSON.parse(imported)
    bad.reference.longitude = 10
    const before = newStore.exportJson()
    expect(() => newStore.importJson(JSON.stringify(bad))).toThrow()
    expect(newStore.exportJson()).toBe(before)
  })
  it('places roots on the shared surface and rejects close neighbours and invalid positions', () => {
    const store = new PlantingStore()
    const plant = store.add(4, 5, options)
    expect(plant?.z).toBe(groundHeight(4, 5))
    expect(plant?.scale).toBeGreaterThanOrEqual(0.75)
    expect(store.add(4.8, 5.8, options)).toBeUndefined()
    expect(store.add(241, 0, options)).toBeUndefined()
    expect(store.add(NaN, 0, options)).toBeUndefined()
    expect(store.add(0, 0, { ...options, spacing: -2 })).toBeUndefined()
    expect(store.size).toBe(1)
  })
  it('uses deterministic randomness and preserves minimum distance across scatter calls', () => {
    const first = new PlantingStore(), second = new PlantingStore()
    for (const store of [first, second]) {
      store.setSeed(85); store.scatter(bounds, 100, options); store.scatter(bounds, 40, options)
    }
    expect(first.values()).toEqual(second.values())
    const plants = first.values()
    for (let i = 0; i < plants.length; i++) for (let j = i + 1; j < plants.length; j++) {
      expect(Math.hypot(plants[i]!.x - plants[j]!.x, plants[i]!.y - plants[j]!.y)).toBeGreaterThanOrEqual(2)
    }
  })
  it('clips brush samples to a circle and stops at a saturated region', () => {
    const store = new PlantingStore()
    const added = store.scatter({ minX: -4, minY: -4, maxX: 4, maxY: 4 }, 1000, options, { x: 0, y: 0, radius: 4 })
    expect(added).toBeGreaterThan(0)
    expect(added).toBeLessThan(1000)
    expect(store.values().every(plant => Math.hypot(plant.x, plant.y) <= 4)).toBe(true)
  })
  it('treats a stroke as one command and supports erase undo/redo', () => {
    const store = new PlantingStore()
    store.begin(); store.add(-3, 0, options); store.add(3, 0, options); store.end()
    expect(store.size).toBe(2)
    store.undo(); expect(store.size).toBe(0)
    store.redo(); expect(store.size).toBe(2)
    expect(store.erase(-3, 0, 1)).toBe(1)
    store.undo(); expect(store.size).toBe(2)
    store.redo(); expect(store.size).toBe(1)
    store.add(12, 0, options); expect(store.canRedo).toBe(false)
  })
  it('cancels newly added plants erased within the same command', () => {
    const store = new PlantingStore()
    store.add(-10, 0, options)
    store.begin(); store.add(0, 0, options); store.erase(0, 0, 1); store.end()
    store.undo(); expect(store.size).toBe(0)
    store.redo(); expect(store.size).toBe(1)
  })
  it('imports transactionally and restores both sides of replacement with overlapping IDs', () => {
    const store = new PlantingStore(), replacement = new PlantingStore()
    store.add(0, 0, options); replacement.add(12, 0, { ...options, species: 'broadleaf' })
    const before = store.exportJson(), after = replacement.exportJson()
    store.importJson(after); expect(store.exportJson()).toBe(after)
    store.undo(); expect(store.exportJson()).toBe(before)
    store.redo(); expect(store.exportJson()).toBe(after)
    expect(() => store.importJson('{"version":1,"plants":[{}]}')).toThrow()
    expect(store.exportJson()).toBe(after)
    const bad = JSON.parse(after)
    bad.plants[0].z = 900
    expect(() => store.importJson(JSON.stringify(bad))).toThrow()
    expect(store.exportJson()).toBe(after)
  })
  it('restores clear and maps negative coordinates to stable spatial chunks', () => {
    const changed: number[] = []
    const store = new PlantingStore(plants => { changed.push(plants.length) })
    store.scatter(bounds, 20, options)
    const before = store.exportJson()
    store.clear(); expect(store.size).toBe(0)
    store.undo(); expect(store.exportJson()).toBe(before)
    expect(tileKey(-0.1, 48)).toBe('-1,1')
    expect(tileKey(0, 0)).toBe('0,0')
    expect(changed.length).toBeGreaterThan(0)
  })
})
