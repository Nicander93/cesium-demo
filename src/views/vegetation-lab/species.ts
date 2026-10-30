/** Stable IDs are shared by the brush, persisted plants and instanced meshes. */
export const SPECIES = [
  { id: 'pine', label: '松树', description: '针叶乔木 · 塔形树冠', color: '#4f743b', path: 'M16 2 7 15h5L5 24h9v6h4v-6h9l-7-9h5Z' },
  { id: 'broadleaf', label: '阔叶乔木', description: '展开树冠 · 分枝叶簇', color: '#628845', path: 'M14 30V20C3 23 1 15 6 11 3 5 12 1 16 5c6-6 14 1 10 6 8 5 1 13-8 9v10Z' },
  { id: 'birch', label: '白桦', description: '白色树干 · 疏朗树冠', color: '#849a4c', path: 'M14 30V14h4v16ZM16 2C8 4 5 9 8 13c-5 7 2 11 8 8 7 3 13-2 8-8 3-5-1-10-8-11Z' },
  { id: 'shrub', label: '灌木', description: '低矮多枝 · 圆展叶丛', color: '#6f9349', path: 'M4 25c-4-5 1-10 6-9-2-8 10-11 12-3 8-2 11 8 5 12ZM14 30v-7h4v7Z' },
  { id: 'grass', label: '草丛', description: '成簇叶片 · 低矮地被', color: '#99a94f', path: 'M14 30C13 19 9 12 3 9c7 0 11 6 13 12C15 10 18 4 22 2c-4 10-3 18-3 23 3-8 6-12 11-13-5 6-8 12-9 18Z' },
] as const

export type Species = typeof SPECIES[number]['id']
export const SPECIES_IDS: readonly Species[] = SPECIES.map(item => item.id)
const supported = new Set<string>(SPECIES_IDS)
export function isSpecies(value: unknown): value is Species { return typeof value === 'string' && supported.has(value) }
