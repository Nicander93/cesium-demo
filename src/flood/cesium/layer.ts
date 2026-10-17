import type { Viewer } from 'cesium'
import type { FloodGrid, FloodBarriers } from '../core'
import { FloodRenderer, type FloodSurfaceBackend } from './renderer'
import type { FloodVisualOptions } from './foam'
import type { FloodAppearanceOptions } from './appearance'
import type { FloodLightingOptions } from './lighting'

export interface CesiumFloodLayerOptions {
  viewer: Viewer
  grid: FloodGrid
  barriers?: FloodBarriers
  /** false uses the viewer's terrain instead of drawing the frozen ground mesh. */
  showGround?: boolean
  visuals?: FloodVisualOptions
  lighting?: FloodLightingOptions
  appearance?: FloodAppearanceOptions
  /** Opt-in dynamic GPU surface; unsupported capabilities/structures fall back safely. */
  surfaceBackend?: FloodSurfaceBackend
}

export function createCesiumFloodLayer(options: CesiumFloodLayerOptions): FloodRenderer {
  return new FloodRenderer(options.viewer, options.grid, options.barriers, options.showGround ?? true, options.visuals, options.surfaceBackend, options.lighting, options.appearance)
}
