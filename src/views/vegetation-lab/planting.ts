import { isSpecies, type Species } from './species'
export type { Species } from './species'
export interface Plant {
  id: number
  species: Species
  x: number
  y: number
  z: number
  scale: number
  yaw: number
}
export interface PlantingOptions {
  species: Species
  speciesPool?: readonly Species[]
  spacing: number
  scaleMin: number
  scaleMax: number
  maxSlope?: number
}
export interface TerrainReference { longitude: number; latitude: number; height: number; terrainUrl: string }
export interface PlantingSurface {
  id: string
  heightAt(x: number, y: number): number | undefined
  slopeAt?(x: number, y: number): number | undefined
  maxHeightError?: number
  reference?: TerrainReference
}
export interface Rectangle { minX: number; minY: number; maxX: number; maxY: number }
interface Edit { added: Plant[]; removed: Plant[] }
export const FIELD_HALF_SIZE = 240
export const TILE_SIZE = 48
export const MAX_PLANTS = 50_000

/** Synthetic planting surface in local ENU metres, shared by geometry and placement. */
export function groundHeight(x: number, y: number): number {
  return 3 + 2.4 * Math.sin(x / 65) * Math.cos(y / 75)
}
export function tileKey(x: number, y: number): string {
  return `${Math.floor(x / TILE_SIZE)},${Math.floor(y / TILE_SIZE)}`
}
export function seededRandom(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let t = Math.imul(value ^ (value >>> 15), 1 | value)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** CPU editing state; a spatial index avoids scanning every existing plant per sample. */
export class PlantingStore {
  private plants = new Map<number, Plant>()
  private cells = new Map<string, Set<number>>()
  private undoStack: Edit[] = []
  private redoStack: Edit[] = []
  private edit: Edit | undefined
  private nextId = 1
  private random = seededRandom(42)
  constructor(
    private changed: (plants: readonly Plant[]) => void = () => {},
    private surface: PlantingSurface = { id: 'synthetic-enu-v1', heightAt: groundHeight },
  ) {}
  get size(): number { return this.plants.size }
  get canUndo(): boolean { return this.undoStack.length > 0 }
  get canRedo(): boolean { return this.redoStack.length > 0 }
  values(): Plant[] { return [...this.plants.values()] }
  get(id: number): Plant | undefined { return this.plants.get(id) }
  setSeed(seed: number): void { this.random = seededRandom(seed) }
  begin(): void { if (!this.edit) this.edit = { added: [], removed: [] } }
  end(): void {
    if (this.edit && (this.edit.added.length || this.edit.removed.length)) {
      this.undoStack.push(this.edit)
      if (this.undoStack.length > 20) this.undoStack.shift()
      this.redoStack = []
    }
    this.edit = undefined
  }
  private cellKey(x: number, y: number): string { return `${Math.floor(x / 3)},${Math.floor(y / 3)}` }
  private insert(plant: Plant): void {
    this.plants.set(plant.id, plant)
    const key = this.cellKey(plant.x, plant.y)
    let cell = this.cells.get(key)
    if (!cell) { cell = new Set(); this.cells.set(key, cell) }
    cell.add(plant.id)
  }
  private remove(plant: Plant): void {
    this.plants.delete(plant.id)
    const key = this.cellKey(plant.x, plant.y)
    const cell = this.cells.get(key)
    cell?.delete(plant.id)
    if (!cell?.size) this.cells.delete(key)
  }
  private nearby(x: number, y: number, radius: number): Plant[] {
    const found: Plant[] = []
    for (let cx = Math.floor((x - radius) / 3); cx <= Math.floor((x + radius) / 3); cx++) {
      for (let cy = Math.floor((y - radius) / 3); cy <= Math.floor((y + radius) / 3); cy++) {
        for (const id of this.cells.get(`${cx},${cy}`) ?? []) {
          const plant = this.plants.get(id)
          if (plant && Math.hypot(plant.x - x, plant.y - y) < radius) found.push(plant)
        }
      }
    }
    return found
  }
  add(x: number, y: number, options: PlantingOptions): Plant | undefined {
    if (![x, y, options.spacing, options.scaleMin, options.scaleMax].every(Number.isFinite)) return
    if (Math.abs(x) > FIELD_HALF_SIZE || Math.abs(y) > FIELD_HALF_SIZE || this.size >= MAX_PLANTS) return
    if (options.spacing < 0.25 || options.spacing > 20 || options.scaleMin < 0.25 || options.scaleMax > 3 || options.scaleMin > options.scaleMax) return
    const pool = options.speciesPool
    if (pool ? !pool.length || !pool.every(isSpecies) : !isSpecies(options.species)) return
    if (this.nearby(x, y, options.spacing).length) return
    const height = this.surface.heightAt(x, y)
    const slope = this.surface.slopeAt?.(x, y) ?? 0
    if (height === undefined || !Number.isFinite(height) || slope > (options.maxSlope ?? 90)) return
    const automatic = !this.edit
    this.begin()
    const plant: Plant = {
      id: this.nextId++, species: pool ? pool[pool.length === 1 ? 0 : Math.floor(this.random() * pool.length)]! : options.species, x, y, z: height,
      scale: options.scaleMin + this.random() * (options.scaleMax - options.scaleMin),
      yaw: this.random() * Math.PI * 2,
    }
    this.insert(plant)
    this.edit?.added.push(plant)
    this.changed([plant])
    if (automatic) this.end()
    return plant
  }
  scatter(bounds: Rectangle, count: number, options: PlantingOptions, circle?: { x: number; y: number; radius: number }): number {
    if (!Object.values(bounds).every(Number.isFinite) || !Number.isFinite(count) || count < 1) return 0
    if (options.speciesPool && (!options.speciesPool.length || !options.speciesPool.every(isSpecies))) return 0
    const automatic = !this.edit
    this.begin()
    let added = 0
    const requested = Math.min(MAX_PLANTS - this.size, Math.floor(count))
    for (let attempt = 0; attempt < requested * 24 && added < requested; attempt++) {
      const x = bounds.minX + this.random() * (bounds.maxX - bounds.minX)
      const y = bounds.minY + this.random() * (bounds.maxY - bounds.minY)
      if (circle && Math.hypot(x - circle.x, y - circle.y) > circle.radius) continue
      if (this.add(x, y, options)) added++
    }
    if (automatic) this.end()
    return added
  }
  erase(x: number, y: number, radius: number): number {
    if (![x, y, radius].every(Number.isFinite) || radius <= 0 || radius > 500) return 0
    const removed = this.nearby(x, y, radius)
    const automatic = !this.edit
    this.begin()
    for (const plant of removed) this.remove(plant)
    if (this.edit) {
      const addedIds = new Set(this.edit.added.map(plant => plant.id))
      const removedIds = new Set(removed.map(plant => plant.id))
      this.edit.added = this.edit.added.filter(plant => !removedIds.has(plant.id))
      this.edit.removed.push(...removed.filter(plant => !addedIds.has(plant.id)))
    }
    this.changed(removed)
    if (automatic) this.end()
    return removed.length
  }
  clear(): void {
    this.end()
    const removed = this.values()
    this.begin()
    this.plants.clear(); this.cells.clear()
    if (this.edit) this.edit.removed = removed
    this.changed(removed)
    this.end()
  }
  undo(): void {
    this.end()
    const edit = this.undoStack.pop()
    if (!edit) return
    for (const plant of edit.added) this.remove(plant)
    for (const plant of edit.removed) this.insert(plant)
    this.redoStack.push(edit)
    this.changed([...edit.added, ...edit.removed])
  }
  redo(): void {
    const edit = this.redoStack.pop()
    if (!edit) return
    for (const plant of edit.removed) this.remove(plant)
    for (const plant of edit.added) this.insert(plant)
    this.undoStack.push(edit)
    this.changed([...edit.added, ...edit.removed])
  }
  /** Height refinements belong to the original edit, so undo/redo keep the corrected root height. */
  updateHeights(updates: readonly { plant: Plant; height: number }[]): void {
    const changed: Plant[] = []
    for (const { plant, height } of updates) {
      if (this.plants.get(plant.id) !== plant || !Number.isFinite(height) || Math.abs(height - plant.z) < 0.001) continue
      plant.z = height
      changed.push(plant)
    }
    this.changed(changed)
  }
  exportJson(): string {
    return JSON.stringify({
      version: this.surface.id === 'synthetic-enu-v1' ? 1 : 2,
      surface: this.surface.id,
      ...(this.surface.reference && this.surface.id !== 'synthetic-enu-v1' ? { reference: this.surface.reference } : {}),
      plants: this.values(),
    }, null, 2)
  }
  importJson(json: string): void {
    const input: unknown = JSON.parse(json)
    const version = this.surface.id === 'synthetic-enu-v1' ? 1 : 2
    if (!input || typeof input !== 'object' || !('version' in input) || input.version !== version || !('surface' in input) || input.surface !== this.surface.id || !('plants' in input) || !Array.isArray(input.plants) || input.plants.length > MAX_PLANTS) throw new Error('植被 JSON 必须属于当前地形和区域，最多 50000 株。')
    let heightOffset = 0
    if (this.surface.reference && version === 2) {
      if (!('reference' in input) || !input.reference || typeof input.reference !== 'object') throw new Error('真实地形 JSON 缺少坐标参考。')
      const ref = input.reference as Record<string, unknown>
      if (ref.longitude !== this.surface.reference.longitude || ref.latitude !== this.surface.reference.latitude || ref.terrainUrl !== this.surface.reference.terrainUrl || typeof ref.height !== 'number' || !Number.isFinite(ref.height)) throw new Error('JSON 的坐标或地形服务与当前区域不一致。')
      heightOffset = ref.height - this.surface.reference.height
    }
    const ids = new Set<number>()
    const plants: Plant[] = input.plants.map((value: unknown) => {
      if (!value || typeof value !== 'object') throw new Error('植被记录格式错误。')
      const p = value as Record<string, unknown>
      if (!['id', 'x', 'y', 'z', 'scale', 'yaw'].every(key => typeof p[key] === 'number' && Number.isFinite(p[key]))) throw new Error('植被数值必须有限。')
      const plant = p as unknown as Plant
      const expected = this.surface.heightAt(plant.x, plant.y)
      const height = plant.z + heightOffset
      if (!Number.isSafeInteger(plant.id) || plant.id < 1 || plant.id > Number.MAX_SAFE_INTEGER - MAX_PLANTS || ids.has(plant.id) || !isSpecies(plant.species) || Math.abs(plant.x) > FIELD_HALF_SIZE || Math.abs(plant.y) > FIELD_HALF_SIZE || plant.scale < 0.25 || plant.scale > 3 || expected === undefined || Math.abs(height - expected) > (this.surface.maxHeightError ?? 0.01)) throw new Error('植被记录超出范围、重复或不在当前地形上。')
      ids.add(plant.id)
      return { id: plant.id, species: plant.species, x: plant.x, y: plant.y, z: height, scale: plant.scale, yaw: plant.yaw }
    })
    this.end()
    const removed = this.values()
    this.plants.clear(); this.cells.clear()
    for (const plant of plants) this.insert(plant)
    this.nextId = plants.reduce((maximum, plant) => Math.max(maximum, plant.id), 0) + 1
    this.undoStack.push({ added: plants, removed })
    if (this.undoStack.length > 20) this.undoStack.shift()
    this.redoStack = []
    this.changed([...removed, ...plants])
  }
}
