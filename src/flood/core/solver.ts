import type { FloodFrame, FloodGrid } from './dataset'
import { overflowFlux, upstreamSourceCells, type FloodBarriers, type FloodOutlet } from './hydraulics'
import { getBreachFace, sampleDamBreach, type DamBreachOptions } from './breach'

const gravity = 9.81
const dryDepth = 0.001

// Local-inertial shallow-water approximation: continuity + pressure acceleration
// + Manning friction. Convective momentum is omitted; this is not a full SWE solver.
export class FloodSolver {
  readonly depth: Float64Array
  time = 0
  injectedVolume = 0
  dischargedVolume = 0
  readonly initialVolume: number
  private readonly eastFlux: Float64Array
  private readonly northFlux: Float64Array
  private readonly outgoing: Float64Array
  private readonly sourceCells: number[]

  constructor(readonly grid: FloodGrid, readonly roughness = 0.035, readonly barriers?: FloodBarriers, sourceCells?: number[], initialDepth?: number[], private readonly damBreach?: DamBreachOptions, private readonly outlet: FloodOutlet = 'north') {
    if (outlet !== 'north' && outlet !== 'south') throw new Error('开放出口必须是 north 或 south')
    this.depth = new Float64Array(grid.columns * grid.rows)
    if (initialDepth && (initialDepth.length !== this.depth.length || initialDepth.some(h => !Number.isFinite(h) || h < 0))) throw new Error('初始水深无效')
    if (initialDepth) this.depth.set(initialDepth)
    this.initialVolume = this.depth.reduce((sum, h) => sum + h, 0) * grid.cellSize ** 2
    this.eastFlux = new Float64Array((grid.columns + 1) * grid.rows)
    this.northFlux = new Float64Array(grid.columns * (grid.rows + 1))
    this.outgoing = new Float64Array(this.depth.length)
    if (grid.active?.some(active => !active)) throw new Error('内置推演要求完整地形；缺失单元不能当作实体障碍')
    if (barriers && (barriers.east.length !== this.eastFlux.length || barriers.north.length !== this.northFlux.length || [...barriers.east, ...barriers.north].some(v => v !== null && !Number.isFinite(v)))) throw new Error('挡墙数组无效')
    this.sourceCells = sourceCells ?? upstreamSourceCells(grid, outlet)
    if (!this.sourceCells.length || this.sourceCells.some(i => !Number.isInteger(i) || i < 0 || i >= this.depth.length)) throw new Error('泄洪单元无效')
  }

  advance(seconds: number, discharge: number, releaseUntil = Infinity): void {
    if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(discharge) || discharge < 0) throw new Error('时长和流量必须非负且有限')
    let remaining = seconds
    while (remaining > 1e-8) {
      let maxDepth = 0.1
      for (const h of this.depth) maxDepth = Math.max(maxDepth, h)
      const dt = Math.min(remaining, 0.5, 0.3 * this.grid.cellSize / Math.sqrt(gravity * maxDepth), this.time < releaseUntil ? releaseUntil - this.time : Infinity)
      this.step(dt, this.time < releaseUntil ? discharge : 0)
      this.time += dt
      remaining -= dt
    }
  }

  private step(dt: number, discharge: number): void {
    const { columns: width, rows: height, cellSize: dx, elevation: z } = this.grid
    const h = this.depth
    const qx = this.eastFlux
    const qy = this.northFlux
    const area = dx * dx
    const sourceVolume = discharge * dt
    const breach = this.damBreach ? sampleDamBreach(this.damBreach, this.time + dt / 2) : undefined
    for (const i of this.sourceCells) h[i] += sourceVolume / this.sourceCells.length / area
    this.injectedVolume += sourceVolume
    const updateFlux = (a: number, b: number, old: number, crest: number | null | undefined) => {
      const surfaceA = z[a] + h[a]
      const surfaceB = z[b] + h[b]
      if (crest !== null && crest !== undefined) return overflowFlux(surfaceA, surfaceB, Math.max(crest, z[a], z[b]))
      const faceDepth = Math.max(surfaceA, surfaceB) - Math.max(z[a], z[b])
      if (faceDepth < dryDepth) return 0
      const friction = 1 + gravity * dt * this.roughness ** 2 * Math.abs(old) / faceDepth ** (7 / 3)
      return (old - gravity * faceDepth * dt * (surfaceB - surfaceA) / dx) / friction
    }
    for (let y = 0; y < height; y++) {
      for (let x = 1; x < width; x++) {
        const face = y * (width + 1) + x
        const b = y * width + x
        qx[face] = updateFlux(b - 1, b, qx[face], this.barriers?.east[face])
      }
    }
    for (let y = 1; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const face = y * width + x
        const intact = updateFlux(face - width, face, qy[face], this.barriers?.north[face])
        if (breach && this.barriers && y === breach.row) {
          const opening = getBreachFace(this.grid, this.barriers, breach, x)
          const notch = updateFlux(face - width, face, 0, opening.crest)
          qy[face] = intact * (1 - opening.fraction) + notch * opening.fraction
        } else qy[face] = intact
      }
    }
    // Zero-gradient, outflow-only drainage on the selected edge.
    for (let x = 0; x < width; x++) {
      const i = (height - 1) * width + x
      qy[height * width + x] = this.outlet === 'north' && h[i] > dryDepth ? Math.max(0, qy[i]) : 0
      qy[x] = this.outlet === 'south' && h[x] > dryDepth ? Math.min(0, qy[width + x]) : 0
    }
    // Scale each donor cell's outgoing fluxes together, conserving volume while
    // preventing negative water depths at the advancing wet/dry front.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        const west = y * (width + 1) + x
        const south = y * width + x
        const outgoing = Math.max(0, -qx[west]) + Math.max(0, qx[west + 1]) + Math.max(0, -qy[south]) + Math.max(0, qy[south + width])
        this.outgoing[i] = outgoing > 0 ? Math.min(1, h[i] * dx / (dt * outgoing)) : 1
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 1; x < width; x++) {
        const face = y * (width + 1) + x
        const b = y * width + x
        qx[face] *= this.outgoing[qx[face] >= 0 ? b - 1 : b]
      }
    }
    for (let y = 1; y <= height; y++) {
      for (let x = 0; x < width; x++) {
        const face = y * width + x
        qy[face] *= this.outgoing[qy[face] >= 0 ? face - width : face]
      }
    }
    for (let x = 0; x < width; x++) qy[x] *= this.outgoing[x]
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        const west = y * (width + 1) + x
        h[i] = Math.max(0, h[i] + dt / dx * (qx[west] - qx[west + 1] + qy[i] - qy[i + width]))
      }
    }
    for (let x = 0; x < width; x++) this.dischargedVolume += (qy[height * width + x] - qy[x]) * dx * dt
  }

  snapshot(): FloodFrame {
    const { columns: width, rows: height } = this.grid
    const velocityEast = new Array<number>(this.depth.length).fill(0)
    const velocityNorth = new Array<number>(this.depth.length).fill(0)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        if (this.depth[i] < 0.02) continue
        const face = y * (width + 1) + x
        velocityEast[i] = (this.eastFlux[face] + this.eastFlux[face + 1]) / (2 * this.depth[i])
        velocityNorth[i] = (this.northFlux[i] + this.northFlux[i + width]) / (2 * this.depth[i])
      }
    }
    return { time: this.time, depth: Array.from(this.depth), velocityEast, velocityNorth }
  }

  get wallDischarge(): number {
    if (!this.barriers) return 0
    return this.northFlux.reduce((sum, q, i) => sum + (this.barriers?.north[i] != null ? q : 0), 0) * this.grid.cellSize
  }

  get storedVolume(): number {
    return this.depth.reduce((sum, h) => sum + h, 0) * this.grid.cellSize ** 2
  }

  get balanceError(): number {
    return this.storedVolume + this.dischargedVolume - this.initialVolume - this.injectedVolume
  }
}
