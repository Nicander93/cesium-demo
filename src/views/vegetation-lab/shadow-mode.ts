import * as Cesium from 'cesium'

export type VegetationShadowMode = 'disabled' | 'cast-only' | 'enabled'

export function resolveVegetationShadowMode(mode: VegetationShadowMode): Cesium.ShadowMode {
  if (mode === 'enabled') return Cesium.ShadowMode.ENABLED
  if (mode === 'cast-only') return Cesium.ShadowMode.CAST_ONLY
  return Cesium.ShadowMode.DISABLED
}
