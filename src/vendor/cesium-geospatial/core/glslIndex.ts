import { normalizeShaderSource } from './normalizeShaderSource'
import _raySphereIntersection from './glsl/raySphereIntersection.glsl?raw'
import _math from './glsl/math.glsl?raw'
import _transform from './glsl/transform.glsl?raw'
import _packing from './glsl/packing.glsl?raw'
import _depth from './glsl/depth.glsl?raw'
import _generators from './glsl/generators.glsl?raw'
import _interleavedGradientNoise from './glsl/interleavedGradientNoise.glsl?raw'
import _cascadedShadowMaps from './glsl/cascadedShadowMaps.glsl?raw'
import _turbo from './glsl/turbo.glsl?raw'
import _vogelDisk from './glsl/vogelDisk.glsl?raw'
import _definitions from './glsl/bruneton/definitions.glsl?raw'
import _common from './glsl/bruneton/common.glsl?raw'
import _runtime from './glsl/bruneton/runtime.glsl?raw'
import _precompute from './glsl/bruneton/precompute.glsl?raw'

export const glslIndex = {
  core: {
    raySphereIntersection: normalizeShaderSource(_raySphereIntersection),
    math: normalizeShaderSource(_math),
    transform: normalizeShaderSource(_transform),
    packing: normalizeShaderSource(_packing),
    depth: normalizeShaderSource(_depth),
    generators: normalizeShaderSource(_generators),
    interleavedGradientNoise: normalizeShaderSource(_interleavedGradientNoise),
    cascadedShadowMaps: normalizeShaderSource(_cascadedShadowMaps),
    turbo: normalizeShaderSource(_turbo),
    vogelDisk: normalizeShaderSource(_vogelDisk)
  },
  bruneton: {
    definitions: normalizeShaderSource(_definitions),
    common: normalizeShaderSource(_common),
    runtime: normalizeShaderSource(_runtime),
    precompute: normalizeShaderSource(_precompute)
  }
} as const

