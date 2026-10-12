import type { FloodGrid } from './dataset'
import type { FloodBarriers } from './hydraulics'

export interface DamBreachOptions {
  row: number
  center: number
  finalWidth: number
  finalBottomElevation: number
  startTime: number
  formationTime: number
}

export interface DamBreachState {
  row: number
  progress: number
  width: number
  left: number
  right: number
  finalBottomElevation: number
}

export function validateDamBreach(grid: FloodGrid, barriers: FloodBarriers, options: DamBreachOptions): void {
  const { row, center, finalWidth, finalBottomElevation, startTime, formationTime } = options
  if (![center, finalWidth, finalBottomElevation, startTime, formationTime].every(Number.isFinite)
    || !Number.isInteger(row) || row < 1 || row >= grid.rows || finalWidth <= 0
    || center - finalWidth / 2 < 0 || center + finalWidth / 2 > grid.columns * grid.cellSize
    || startTime < 0 || formationTime <= 0) throw new Error('溃口位置、宽度或形成时间无效')
  for (let x = 0; x < grid.columns; x++) {
    if ((x + 1) * grid.cellSize <= center - finalWidth / 2 || x * grid.cellSize >= center + finalWidth / 2) continue
    const crest = barriers.north[row * grid.columns + x]
    if (crest == null || !Number.isFinite(crest) || finalBottomElevation > crest) throw new Error('溃口必须位于已有坝段，最终底高程不能高于坝顶')
  }
}

// Prescribed linear erosion: animation and the hydraulic opening share this state.
export function sampleDamBreach(options: DamBreachOptions, time: number): DamBreachState {
  if (!Number.isFinite(time) || time < 0) throw new Error('溃坝时间无效')
  if (![options.center, options.finalWidth, options.finalBottomElevation, options.startTime, options.formationTime].every(Number.isFinite)
    || options.finalWidth <= 0 || options.startTime < 0 || options.formationTime <= 0) throw new Error('溃口参数无效')
  const progress = Math.max(0, Math.min(1, (time - options.startTime) / options.formationTime))
  const width = options.finalWidth * progress
  return { row: options.row, progress, width, left: options.center - width / 2,
    right: options.center + width / 2, finalBottomElevation: options.finalBottomElevation }
}

export function validateDamBreachState(grid: FloodGrid, barriers: FloodBarriers | undefined, state: DamBreachState): void {
  if (!barriers || !Number.isInteger(state.row) || state.row < 1 || state.row >= grid.rows
    || ![state.progress, state.width, state.left, state.right, state.finalBottomElevation].every(Number.isFinite)
    || state.progress < 0 || state.progress > 1 || state.left < 0 || state.right > grid.columns * grid.cellSize
    || state.right < state.left || Math.abs(state.width - (state.right - state.left)) > 1e-6) throw new Error('溃口状态无效')
}

export function getBreachFace(grid: FloodGrid, barriers: FloodBarriers, state: DamBreachState, column: number): { fraction: number; crest: number; left: number; right: number } {
  const i = state.row * grid.columns + column
  const original = barriers.north[i]
  const left = Math.max(column * grid.cellSize, state.left)
  const right = Math.min((column + 1) * grid.cellSize, state.right)
  const fraction = Math.max(0, right - left) / grid.cellSize
  const ground = Math.max(grid.elevation[i], grid.elevation[i - grid.columns])
  const top = original ?? ground
  // Excavation below the sampled ground is outside this model.
  const bottom = Math.min(top, Math.max(ground, state.finalBottomElevation))
  return { fraction, crest: top + (bottom - top) * state.progress, left, right }
}
