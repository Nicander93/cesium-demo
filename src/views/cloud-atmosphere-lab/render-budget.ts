/** Bound GPU work by rendered pixels, including high-DPI touch displays. */
export const MAX_SCENE_PIXELS = 1600 * 900
export function sceneResolutionScale(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 1
  return Math.min(1, Math.sqrt(MAX_SCENE_PIXELS / (width * height)))
}
