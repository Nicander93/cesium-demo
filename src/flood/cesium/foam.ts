import type { FloodFrame, FloodGrid } from '../core/dataset'
import type { FloodBarriers } from '../core/hydraulics'
import { getBreachFace, type DamBreachState } from '../core/breach'

export interface FloodVisualOptions {
  flow?: boolean
  /** Opt-in flow experiment; the existing shader/source behavior remains the default. */
  surfaceStyle?: 'baseline' | 'flow'
  /** Separate tracer particles from foam shading for comparisons. */
  particles?: boolean
  foam?: boolean
  /** Visual coverage, 0–1. Does not affect hydraulic water volume. */
  foamIntensity?: number
  /** Decay time in simulation seconds. */
  foamLifetime?: number
}

export function resolveFloodVisualOptions(options: FloodVisualOptions, current: Required<FloodVisualOptions> = { flow: true, foam: true, foamIntensity: 0.75, foamLifetime: 18, surfaceStyle: 'baseline', particles: true }): Required<FloodVisualOptions> {
  const next = { ...current, ...options }
  if (next.surfaceStyle !== 'baseline' && next.surfaceStyle !== 'flow') throw new Error('未知水面实验算法')
  if (typeof next.particles !== 'boolean') throw new Error('粒子开关必须是布尔值')
  if (typeof next.flow !== 'boolean' || typeof next.foam !== 'boolean') throw new Error('流动与泡沫开关必须是布尔值')
  if (!Number.isFinite(next.foamIntensity) || next.foamIntensity < 0 || next.foamIntensity > 1) throw new Error('泡沫强度必须在 0–1 之间')
  if (!Number.isFinite(next.foamLifetime) || next.foamLifetime < 1 || next.foamLifetime > 120) throw new Error('泡沫消散时间必须在 1–120 秒之间')
  return next
}

/** Existing shallow/Froude source rate, in coverage per simulation second. */
export function computeFloodFoamSources(grid: FloodGrid, frame: FloodFrame, output = new Float32Array(frame.depth.length)): Float32Array {
  output.fill(0)
  if (!frame.velocityEast || !frame.velocityNorth) return output
  for (let i = 0; i < output.length; i++) {
    if (grid.active?.[i] === false || frame.depth[i] < 0.02) continue
    const speed = Math.hypot(frame.velocityEast[i], frame.velocityNorth[i])
    const froude = speed / Math.sqrt(9.81 * Math.max(frame.depth[i], 0.05))
    const shallow = Math.max(0, 1 - frame.depth[i] / 0.8) * Math.min(1, speed / 1.5)
    const rapid = Math.min(1, Math.max(0, froude - 0.6))
    output[i] = shallow * 0.12 + rapid * 0.3
  }
  return output
}

/** Local aeration cues from a supplied field, not a turbulence or obstacle solver. */
export function computeFloodLocalFoamSources(grid: FloodGrid, frame: FloodFrame, output = new Float32Array(frame.depth.length)): Float32Array {
  output.fill(0)
  const east = frame.velocityEast, north = frame.velocityNorth
  if (!east || !north) return output
  const { columns, rows, cellSize: dx, elevation, active } = grid
  const wet = (i: number) => active?.[i] !== false && frame.depth[i] >= 0.02
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const i = y * columns + x
    if (!wet(i)) continue
    const speed = Math.hypot(east[i], north[i])
    if (speed < 0.15) continue
    // A dry cell supplies no velocity sample. Do not invent a zero-velocity wall.
    const left = x > 0 && wet(i - 1) ? i - 1 : i
    const right = x + 1 < columns && wet(i + 1) ? i + 1 : i
    const down = y > 0 && wet(i - columns) ? i - columns : i
    const up = y + 1 < rows && wet(i + columns) ? i + columns : i
    const spanX = Math.max(1, (right - left)) * dx
    const spanY = Math.max(1, (up - down) / columns) * dx
    const duDx = (east[right] - east[left]) / spanX
    const dvDx = (north[right] - north[left]) / spanX
    const duDy = (east[up] - east[down]) / spanY
    const dvDy = (north[up] - north[down]) / spanY
    const gradient = Math.hypot(duDx, dvDx, duDy, dvDy)
    const shear = Math.min(1, Math.max(0, gradient - 0.16) / 0.7)
    const compression = Math.min(1, Math.max(0, -duDx - dvDy - 0.03) / 0.5)
    const stage = (j: number) => elevation[j] + frame.depth[j]
    const slopeX = (stage(right) - stage(left)) / spanX
    const slopeY = (stage(up) - stage(down)) / spanY
    const drop = Math.min(1, Math.max(0, -(slopeX * east[i] + slopeY * north[i]) / speed - 0.015) / 0.15)
    const moving = Math.min(1, (speed - 0.15) / 1.5)
    const froude = speed / Math.sqrt(9.81 * Math.max(frame.depth[i], 0.05))
    const aeration = 0.3 + 0.7 * Math.min(1, Math.max(0, froude - 0.4))
    output[i] = Math.min(0.42, moving * (shear * 0.28 * aeration + compression * 0.18 + drop * 0.35))
  }
  return output
}

// A bounded visual tracer, not another hydraulic solver. No input frame is mutated.
export class FloodFoam {
  readonly coverage: Float32Array
  readonly sources: Float32Array
  private readonly next: Float32Array
  private previousTime: number | undefined

  constructor(private readonly grid: FloodGrid, private readonly barriers?: FloodBarriers) {
    this.coverage = new Float32Array(grid.columns * grid.rows)
    this.next = new Float32Array(this.coverage.length)
    this.sources = new Float32Array(this.coverage.length)
  }

  reset(): void { this.coverage.fill(0); this.sources.fill(0); this.previousTime = undefined }

  update(frame: FloodFrame, lifetime: number, breach?: DamBreachState, surfaceStyle: 'baseline' | 'flow' = 'baseline'): void {
    if (surfaceStyle === 'flow') computeFloodLocalFoamSources(this.grid, frame, this.sources)
    else computeFloodFoamSources(this.grid, frame, this.sources)
    const previous = this.previousTime
    this.previousTime = frame.time
    const east = frame.velocityEast
    const north = frame.velocityNorth
    if (!east || !north || previous === undefined || frame.time < previous || frame.time - previous > 30) {
      this.coverage.fill(0)
      return
    }
    if (frame.time === previous) return
    const { columns, rows, cellSize: dx, elevation, active } = this.grid
    const wet = (i: number) => active?.[i] !== false && frame.depth[i] >= 0.02
    let maxSpeed = 0
    for (let i = 0; i < east.length; i++) {
      if (wet(i)) maxSpeed = Math.max(maxSpeed, Math.abs(east[i]) + Math.abs(north[i]))
      else this.coverage[i] = 0
    }
    const duration = frame.time - previous
    const steps = Math.ceil(duration / Math.min(0.5, 0.4 * dx / Math.max(maxSpeed, 0.01)))
    // A pathological external frame must not block the UI with unbounded work.
    if (steps > 512) { this.coverage.fill(0); return }
    const dt = duration / steps
    const decay = Math.exp(-dt / lifetime)
    const transfer = (a: number, b: number, velocity: number, crest: number | null | undefined) => {
      if (!wet(a) || !wet(b)) return
      if (crest != null && Math.max(elevation[a] + frame.depth[a], elevation[b] + frame.depth[b]) <= crest) return
      const donor = velocity >= 0 ? a : b
      const receiver = velocity >= 0 ? b : a
      const amount = this.coverage[donor] * Math.abs(velocity) * dt / dx
      this.next[donor] -= amount
      this.next[receiver] += amount
    }
    for (let step = 0; step < steps; step++) {
      this.next.set(this.coverage)
      for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
        const i = y * columns + x
        if (x + 1 < columns) transfer(i, i + 1, (east[i] + east[i + 1]) / 2, this.barriers?.east[y * (columns + 1) + x + 1])
        if (y + 1 < rows) {
          let crest = this.barriers?.north[i + columns]
          if (breach && this.barriers && y + 1 === breach.row) {
            const opening = getBreachFace(this.grid, this.barriers, breach, x)
            if (opening.fraction > 0) crest = opening.crest
          }
          transfer(i, i + columns, (north[i] + north[i + columns]) / 2, crest)
        }
      }
      for (let i = 0; i < this.coverage.length; i++) {
        if (!wet(i)) { this.coverage[i] = 0; continue }
        const source = this.sources[i] * dt
        this.coverage[i] = Math.min(1, Math.max(0, this.next[i]) * decay + source)
      }
    }
  }
}
