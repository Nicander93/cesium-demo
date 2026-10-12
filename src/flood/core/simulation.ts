import { createDataset, parseFloodDataset, type FloodDataset, type FloodFrame, type FloodGrid } from './dataset'
import type { FloodBarriers, FloodOutlet } from './hydraulics'
import { FloodSolver } from './solver'
import { sampleDamBreach, validateDamBreach, type DamBreachOptions, type DamBreachState } from './breach'

export interface FloodInflow {
  discharge: number
  /** Absolute simulation cutoff time in seconds, rather than remaining duration. */
  until?: number
}

export interface FloodSimulationOptions {
  grid: FloodGrid
  roughness?: number
  barriers?: FloodBarriers
  sourceCells?: readonly number[]
  inflow?: FloodInflow
  initialDepth?: readonly number[]
  damBreach?: DamBreachOptions
  outlet?: FloodOutlet
}

export interface FloodBalance {
  initialVolume: number
  injectedVolume: number
  storedVolume: number
  dischargedVolume: number
  balanceError: number
  wallDischarge: number
}

// Owns calculation state, but no viewer, UI, timer or animation loop.
export class FloodSimulation {
  private readonly domain: FloodGrid
  private readonly barriers: FloodBarriers | undefined
  private readonly sourceCells: number[] | undefined
  private readonly roughness: number
  private readonly initialDepth: number[] | undefined
  private readonly damBreach: DamBreachOptions | undefined
  private readonly outlet: FloodOutlet
  private inflow: FloodInflow = { discharge: 0 }
  private solver: FloodSolver

  constructor(options: FloodSimulationOptions) {
    const count = options.grid.columns * options.grid.rows
    if (!Number.isInteger(count) || count < 4 || count > 20000) throw new Error('计算网格大小无效')
    this.domain = parseFloodDataset(createDataset(options.grid, [{ time: 0, depth: new Array<number>(count).fill(0) }])).grid
    // Own domain values at the API boundary so caller mutations cannot change the run.
    this.domain = { ...this.domain, origin: [...this.domain.origin], elevation: [...this.domain.elevation], ...(this.domain.active ? { active: [...this.domain.active] } : {}) }
    this.roughness = options.roughness ?? 0.035
    this.outlet = options.outlet ?? 'north'
    if (!Number.isFinite(this.roughness) || this.roughness < 0) throw new Error('Manning 摩阻必须非负且有限')
    this.barriers = options.barriers ? { east: [...options.barriers.east], north: [...options.barriers.north] } : undefined
    this.sourceCells = options.sourceCells ? [...options.sourceCells] : undefined
    if (this.sourceCells && new Set(this.sourceCells).size !== this.sourceCells.length) throw new Error('泄洪单元不能重复')
    this.initialDepth = options.initialDepth ? [...options.initialDepth] : undefined
    this.damBreach = options.damBreach ? { ...options.damBreach } : undefined
    if (this.damBreach) {
      if (!this.barriers) throw new Error('溃坝推演需要已有坝段')
      validateDamBreach(this.domain, this.barriers, this.damBreach)
    }
    this.solver = this.createSolver()
    if (options.inflow) this.setInflow(options.inflow)
  }

  setInflow(inflow: FloodInflow): void {
    if (!Number.isFinite(inflow.discharge) || inflow.discharge < 0 || (inflow.until !== undefined && (!Number.isFinite(inflow.until) || inflow.until < 0))) throw new Error('入流或停止时刻无效')
    this.inflow = { ...inflow }
  }

  advance(seconds: number): FloodFrame {
    this.solver.advance(seconds, this.inflow.discharge, this.inflow.until)
    return this.snapshot()
  }

  snapshot(): FloodFrame { return this.solver.snapshot() }

  reset(): FloodFrame {
    this.solver = this.createSolver()
    return this.snapshot()
  }

  get time(): number { return this.solver.time }

  get breachState(): DamBreachState | undefined { return this.damBreach ? sampleDamBreach(this.damBreach, this.time) : undefined }

  private createSolver(): FloodSolver {
    return new FloodSolver(this.domain, this.roughness, this.barriers, this.sourceCells, this.initialDepth, this.damBreach, this.outlet)
  }

  get balance(): FloodBalance {
    return { initialVolume: this.solver.initialVolume, injectedVolume: this.solver.injectedVolume, storedVolume: this.solver.storedVolume,
      dischargedVolume: this.solver.dischargedVolume, balanceError: this.solver.balanceError, wallDischarge: this.solver.wallDischarge }
  }

  toDataset(frames: FloodFrame[], name = '洪水推演成果'): FloodDataset {
    const result = parseFloodDataset({ ...createDataset(this.domain, frames), name,
      ...(this.barriers ? { structures: { barriers: this.barriers, ...(this.damBreach ? { damBreach: this.damBreach } : {}) } } : {}) })
    return structuredClone(result)
  }
}

export function createFloodSimulation(options: FloodSimulationOptions): FloodSimulation { return new FloodSimulation(options) }
