import type { FloodFrame, FloodGrid } from '../core/dataset'

/** Extend only the visual surface to adjacent dry samples; hydraulic arrays remain untouched. */
export function createFloodSurfaceState(
  grid: FloodGrid,
  frame: FloodFrame,
  extendShore = true,
) {
  const heights = grid.elevation.map((z, i) => z + frame.depth[i] + 0.035)
  const depths = frame.depth.slice()
  if (!extendShore) return { heights, depths }
  const { columns, rows, elevation, active } = grid
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      const i = y * columns + x
      if (frame.depth[i] > 0 || active?.[i] === false) continue
      let stage = 0,
        count = 0
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (x + dx < 0 || x + dx >= columns || y + dy < 0 || y + dy >= rows)
            continue
          const j = (y + dy) * columns + x + dx
          if (frame.depth[j] < 0.02 || active?.[j] === false) continue
          stage += elevation[j] + frame.depth[j]
          count++
        }
      if (!count) continue
      stage /= count
      heights[i] = stage + 0.035
      // Negative signed depth locates the bed/stage intersection within a shoreline triangle.
      depths[i] = Math.min(0, stage - elevation[i])
    }
  return { heights, depths }
}
