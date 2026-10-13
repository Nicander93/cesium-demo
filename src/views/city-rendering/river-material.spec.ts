import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createWaterMaterial } from '../../water/material'
import { applyRiverMaterial } from './river-material'

beforeAll(() => {
  vi.stubGlobal('ImageBitmap', class {})
  vi.stubGlobal('OffscreenCanvas', class {})
})
afterAll(() => {
  vi.unstubAllGlobals()
})

it('adapts actual Cesium Fabric uniforms without leaving suffixed GLSL fragments', () => {
  const material = createWaterMaterial({ normalMapUrl: 'waves.png' })
  applyRiverMaterial(material, 48, 3300)
  const shader = (material as unknown as { shaderSource: string }).shaderSource
  expect(shader).toContain('vec2(48.0, 3300.0)')
  expect(shader).not.toMatch(/\)_\d+/)
  expect(shader).toMatch(/texture\(normalTexture_\d+, fract\(a\)\)/)
  expect(shader).toContain('dFdx(uv)')
  expect(shader).toContain('material.emission = waterLight')
  expect(shader).not.toContain('vec3(0.1) + reflected')
  material.destroy()
})
