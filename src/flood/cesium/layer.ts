import type { Viewer } from 'cesium'
import type { FloodGrid, FloodBarriers } from '../core'
import { FloodRenderer } from './renderer'
import type { FloodVisualOptions } from './foam'

export interface CesiumFloodLayerOptions {
  viewer: Viewer
  grid: FloodGrid
  barriers?: FloodBarriers
  /** false uses the viewer's terrain instead of drawing the frozen ground mesh. */
  showGround?: boolean
  visuals?: FloodVisualOptions
}

export function createCesiumFloodLayer(options: CesiumFloodLayerOptions): FloodRenderer {
  return new FloodRenderer(options.viewer, options.grid, options.barriers, options.showGround ?? true, options.visuals)
}
