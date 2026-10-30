import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createOfficeGlb } from './office-model'
import { createCoastPalmPlacements } from './coast-layout'
import { createPalmGeometry } from './palm-geometry'
import { buildCoastPalmGlb, readPalmGeometry } from './palm-model'

interface OfficeManifest {
  generatorSha256: string
  assets: Array<{
    filename: string
    seed: number
    bytes: number
    triangles: number
    type: string
  }>
}
const hash = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex')
const assetRoot = 'public/landscape-showcase/offices/'

describe('prebuilt coastal scenery', () => {
  it('ships the current generator output with all three building types', () => {
    const manifest: OfficeManifest = JSON.parse(
      readFileSync(assetRoot + 'manifest.json', 'utf8'),
    )
    expect(manifest.generatorSha256).toBe(
      hash(
        readFileSync(
          'src/views/landscape-showcase/office-model.ts',
          'utf8',
        ).replace(/\r\n/g, '\n'),
      ),
    )
    expect(manifest.assets).toHaveLength(12)
    expect(new Set(manifest.assets.map((asset) => asset.type))).toEqual(
      new Set(['brick-midrise', 'glass-office', 'stepped-tower']),
    )
    let totalBytes = 0
    for (const asset of manifest.assets) {
      const bytes = readFileSync(assetRoot + asset.filename)
      expect(bytes.byteLength).toBe(asset.bytes)
      expect(hash(bytes)).toBe(hash(createOfficeGlb(asset.seed)))
      expect(asset.triangles).toBeLessThan(3000)
      totalBytes += bytes.byteLength
    }
    expect(totalBytes).toBeLessThan(2 * 1024 * 1024)
  })
  it('ships the current instanced palm geometry and material palette', () => {
    const prototypes = Array.from({ length: 6 }, (_, seed) => {
      const geometry = createPalmGeometry(seed)
      return {
        trunk: readPalmGeometry(geometry.trunk),
        foliage: readPalmGeometry(geometry.foliage),
        tips: readPalmGeometry(geometry.tips),
      }
    })
    const expected = buildCoastPalmGlb(createCoastPalmPlacements(), prototypes)
    const actual = readFileSync('public/landscape-showcase/palms.glb')
    expect(hash(actual)).toBe(hash(expected))
    expect(actual.byteLength).toBeLessThan(1024 * 1024)
  })
})
