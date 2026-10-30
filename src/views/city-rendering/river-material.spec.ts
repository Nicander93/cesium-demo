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


it('keeps diagnostic returns independent of the later river lighting variables', () => {
  const material = createWaterMaterial({ normalMapUrl: 'waves.png' })
  try {
    applyRiverMaterial(material, 48, 3300)
    const shader = material.shaderSource
    const diagnostic = shader.match(/if \(waveDiagnostic(?:_\d+)? > 0\.5\) \{([\s\S]*?)return material;\s*\}/)?.[1]
    expect(diagnostic).toBeDefined()
    expect(diagnostic).toContain('material.diffuse = vec3(0.0)')
    expect(diagnostic).not.toContain('waterLight')
    expect(diagnostic).not.toContain('reflected')
    const riverLighting = shader.indexOf('vec3 body =')
    for (const declaration of ['float diffuse =', 'float specular =', 'vec3 reflected =', 'float fresnel =']) {
      const offset = shader.indexOf(declaration)
      expect(offset).toBeGreaterThanOrEqual(0)
      expect(offset).toBeLessThan(riverLighting)
    }
  } finally { material.destroy() }
})
