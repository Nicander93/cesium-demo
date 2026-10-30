import { describe, expect, it } from 'vitest'
import { parseInteriorManifest } from './interior-source'
const manifest = {
  schemaVersion: 1, name: 'Test', author: 'Author', sourceUrl: 'https://example.com/model', license: 'CC0',
  model: 'models/building.glb', collision: 'collision.bin', triangleCount: 2,
  bounds: { min: [-5, -5, 0], max: [5, 5, 3] },
  spawns: [{ id: 'entry', label: 'Entry', position: [0, 0, 0], heading: 0, pitch: 0 }],
}
describe('interior asset contract', () => {
  it('allows other scenes with relative model paths and their own viewpoints', () => {
    expect(parseInteriorManifest(manifest).model).toBe('models/building.glb')
  })
  it('rejects malformed bounds, unsafe allocations and invalid or duplicate viewpoints', () => {
    for (const input of [null, { ...manifest, bounds: { min: [0, 0, 0], max: [NaN, 2, 3] } }, { ...manifest, triangleCount: 1e9 }, { ...manifest, spawns: [] }, { ...manifest, spawns: [manifest.spawns[0], manifest.spawns[0]] }, { ...manifest, spawns: [{ ...manifest.spawns[0], position: [1, 2] }] }]) expect(() => parseInteriorManifest(input)).toThrow()
  })
})
