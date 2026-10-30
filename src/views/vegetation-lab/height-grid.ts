export interface HeightGrid {
  halfSize: number
  divisions: number
  heights: Float64Array
}

/** Bilinear interpolation is a fast placement preview; final roots use direct terrain sampling. */
export function sampleHeightGrid(grid: HeightGrid, x: number, y: number): number | undefined {
  if (![x, y].every(Number.isFinite) || Math.abs(x) > grid.halfSize || Math.abs(y) > grid.halfSize) return
  const side = grid.divisions + 1
  const gx = (x + grid.halfSize) / (grid.halfSize * 2) * grid.divisions
  const gy = (y + grid.halfSize) / (grid.halfSize * 2) * grid.divisions
  const col = Math.min(grid.divisions - 1, Math.floor(gx))
  const row = Math.min(grid.divisions - 1, Math.floor(gy))
  const tx = gx - col, ty = gy - row
  const a = grid.heights[row * side + col]
  const b = grid.heights[row * side + col + 1]
  const c = grid.heights[(row + 1) * side + col]
  const d = grid.heights[(row + 1) * side + col + 1]
  if ([a, b, c, d].some(value => value === undefined || !Number.isFinite(value))) return
  return (a! * (1 - tx) + b! * tx) * (1 - ty) + (c! * (1 - tx) + d! * tx) * ty
}

export function sampleSlopeGrid(grid: HeightGrid, x: number, y: number): number | undefined {
  const step = grid.halfSize * 2 / grid.divisions
  const leftX = Math.max(-grid.halfSize, x - step), rightX = Math.min(grid.halfSize, x + step)
  const downY = Math.max(-grid.halfSize, y - step), upY = Math.min(grid.halfSize, y + step)
  const a = sampleHeightGrid(grid, leftX, y), b = sampleHeightGrid(grid, rightX, y)
  const c = sampleHeightGrid(grid, x, downY), d = sampleHeightGrid(grid, x, upY)
  if (a === undefined || b === undefined || c === undefined || d === undefined) return
  return Math.atan(Math.hypot((b - a) / (rightX - leftX), (d - c) / (upY - downY))) * 180 / Math.PI
}
