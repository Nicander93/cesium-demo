import { describe, expect, it } from 'vitest'
import { createPalmGeometry } from './palm-geometry'

describe('coastal palm geometry', () => {
  it('keeps reusable fronds within a finite tree and triangle budget', () => {
    for (const seed of [0, 3, 5]) {
      const groups = createPalmGeometry(seed)
      let triangles = 0
      for (const geometry of Object.values(groups)) {
        const positions = geometry.attributes.position!.values!
        const normals = geometry.attributes.normal!.values!
        const indices = geometry.indices!
        expect(positions.length).toEqual(normals.length)
        expect(geometry.boundingSphere!.radius).toBeLessThan(15)
        for (let i = 0; i < positions.length; i += 3) {
          expect(Number.isFinite(positions[i])).toBe(true)
          expect(Number.isFinite(positions[i + 1])).toBe(true)
          expect(positions[i + 2]).toBeGreaterThanOrEqual(0)
          expect(positions[i + 2]).toBeLessThan(19)
          expect(
            Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!),
          ).toBeCloseTo(1, 5)
        }
        for (const index of indices)
          expect(index).toBeLessThan(positions.length / 3)
        triangles += indices.length / 3
      }
      expect(triangles).toBeGreaterThan(1000)
      expect(triangles).toBeLessThan(2500)
    }
  })
})
