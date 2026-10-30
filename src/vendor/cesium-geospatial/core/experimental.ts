// Minimal application entry for the cloud-atmosphere lab. Keep upstream modules intact.
export { resolveIncludes } from './resolveIncludes'
export { unrollLoops } from './unrollLoops'
export { glslIndex } from './glslIndex'
export {
  ATMOSPHERE_DEFAULT_GLSL,
  ATMOSPHERE_BOTTOM_RADIUS_M,
  ATMOSPHERE_TOP_RADIUS_M,
  SUN_ANGULAR_RADIUS,
} from './math/atmosphereParameters'
export { getAltitudeCorrectionOffset } from './math/altitudeCorrection'
export {
  computeMoonDirectionECEF,
  computeMoonIlluminatedFractionFromDirections,
} from './celestial/celestialDirections'
export { LOG_DEPTH_GLSL } from './cesium/logDepth'
export { loadAtmosphereLUTs } from './cesium/lutLoader'
export type { AtmosphereLUTs } from './cesium/lutLoader'
export { createAtmosphereStage } from './cesium/AtmosphereStage'
export type { AtmosphereStageHandle, AtmosphereStageOptions, CloudsShadowBridgeData } from './cesium/AtmosphereStage'
export { FullscreenPass, createVolumetricPrimitive, createMRTFramebuffer } from './cesium/platform'
export type { VolumetricPrimitive } from './cesium/platform'
