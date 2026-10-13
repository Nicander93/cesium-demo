import type { FloodFrame, FloodGrid } from '../core/dataset'
import type { FloodBarriers } from '../core/hydraulics'
import { getBreachFace, type DamBreachState } from '../core/breach'

interface FlowSample { east: number; north: number; height: number; depth: number }
export interface FlowParticle { x: number; y: number; z: number; age: number; lifetime: number; opacity: number }

// Screen-sized foam flecks follow the supplied field. They never feed back into hydraulics.
export class FlowParticles {
  readonly particles: FlowParticle[]
  private frame: FloodFrame | undefined
  private breach: DamBreachState | undefined
  private seeds: number[] = []
  private seed = 48271

  constructor(private readonly grid: FloodGrid, private readonly barriers?: FloodBarriers, count = 384) {
    this.particles = Array.from({ length: count }, () => ({ x: 0, y: 0, z: 0, age: 0, lifetime: 0, opacity: 0 }))
  }

  reset(): void {
    this.seed = 48271
    for (const particle of this.particles) { particle.lifetime = 0; particle.opacity = 0 }
  }

  setFrame(frame: FloodFrame, breach?: DamBreachState): void {
    if (!this.frame || frame.time < this.frame.time || frame.time - this.frame.time > 30) this.reset()
    this.frame = frame
    this.breach = breach
    this.seeds = []
    if (!frame.velocityEast || !frame.velocityNorth) { this.reset(); return }
    for (let i = 0; i < frame.depth.length; i++) {
      if (this.grid.active?.[i] !== false && frame.depth[i] > 0.04 && Math.hypot(frame.velocityEast[i], frame.velocityNorth[i]) > 0.25) this.seeds.push(i)
    }
  }

  advance(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds <= 0 || !this.frame) return
    // Tab suspension does not fast-forward preview particles.
    let remaining = Math.min(seconds, 0.25)
    while (remaining > 1e-6) {
      const dt = Math.min(remaining, 0.025)
      remaining -= dt
      for (const particle of this.particles) {
        if (particle.age >= particle.lifetime && !this.spawn(particle)) continue
        const sample = this.sample(particle.x, particle.y)
        if (!sample) { particle.lifetime = 0; particle.opacity = 0; continue }
        const dx = sample.east * dt
        const dy = sample.north * dt
        const x = particle.x + dx
        const y = particle.y + dy
        const next = this.sample(x, y)
        // Avoid tunnelling through multiple cells for extreme external velocities.
        if (!next || Math.max(Math.abs(dx), Math.abs(dy)) > this.grid.cellSize * 0.4 || !this.canCross(particle.x, particle.y, x, y, Math.max(sample.height, next.height))) {
          particle.lifetime = 0; particle.opacity = 0; continue
        }
        particle.x = x; particle.y = y; particle.z = next.height + 0.18
        particle.age += dt
        const fade = Math.min(1, particle.age / 0.6, (particle.lifetime - particle.age) / 2)
        particle.opacity = Math.max(0, fade) * Math.min(1, Math.hypot(next.east, next.north) / 0.8)
      }
    }
  }

  sample(x: number, y: number): FlowSample | undefined {
    const frame = this.frame
    if (!frame?.velocityEast || !frame.velocityNorth) return
    const velocityEast = frame.velocityEast
    const velocityNorth = frame.velocityNorth
    const gx = x / this.grid.cellSize - 0.5
    const gy = y / this.grid.cellSize - 0.5
    const column = Math.floor(gx)
    const row = Math.floor(gy)
    const { columns, rows, elevation, active } = this.grid
    if (column < 0 || column >= columns - 1 || row < 0 || row >= rows - 1) return
    const a = row * columns + column
    const fx = gx - column
    const fy = gy - row
    // Match the rendered water triangles rather than bilinear height interpolation.
    const indices = fx + fy <= 1 ? [a, a + 1, a + columns] : [a + 1, a + columns + 1, a + columns]
    const weights = fx + fy <= 1 ? [1 - fx - fy, fx, fy] : [1 - fy, fx + fy - 1, 1 - fx]
    if (indices.some(i => active?.[i] === false)) return
    let depth = 0, height = 0, east = 0, north = 0
    indices.forEach((i, k) => {
      depth += frame.depth[i] * weights[k]
      height += (elevation[i] + frame.depth[i]) * weights[k]
      east += velocityEast[i] * weights[k]
      north += velocityNorth[i] * weights[k]
    })
    return depth >= 0.04 ? { depth, height, east, north } : undefined
  }

  private canCross(x0: number, y0: number, x1: number, y1: number, stage: number): boolean {
    if (!this.barriers) return true
    const { cellSize: dx, columns } = this.grid
    const a = Math.floor(x0 / dx), b = Math.floor(x1 / dx)
    const c = Math.floor(y0 / dx), d = Math.floor(y1 / dx)
    if (a !== b) {
      const face = Math.max(a, b)
      for (const row of [c, d]) {
        const crest = this.barriers.east[row * (columns + 1) + face]
        if (crest != null && stage <= crest) return false
      }
    }
    if (c !== d) {
      const row = Math.max(c, d)
      for (const column of [a, b]) {
        let crest = this.barriers.north[row * columns + column]
        if (this.breach?.row === row) {
          const opening = getBreachFace(this.grid, this.barriers, this.breach, column)
          if (x1 >= opening.left && x1 <= opening.right && opening.fraction > 0) crest = opening.crest
        }
        if (crest != null && stage <= crest) return false
      }
    }
    return true
  }

  private spawn(particle: FlowParticle): boolean {
    particle.opacity = 0
    for (let attempt = 0; attempt < 8 && this.seeds.length; attempt++) {
      const cell = this.seeds[Math.floor(this.random() * this.seeds.length)]
      const angle = this.random() * Math.PI * 2
      const radius = Math.sqrt(this.random()) * this.grid.cellSize * 1.4
      const x = (cell % this.grid.columns + 0.5) * this.grid.cellSize + Math.cos(angle) * radius
      const y = (Math.floor(cell / this.grid.columns) + 0.5) * this.grid.cellSize + Math.sin(angle) * radius
      const sample = this.sample(x, y)
      if (!sample || Math.hypot(sample.east, sample.north) < 0.25) continue
      particle.x = x; particle.y = y; particle.z = sample.height + 0.18
      particle.age = 0; particle.lifetime = 6 + this.random() * 10
      return true
    }
    particle.lifetime = 0
    return false
  }

  private random(): number { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647 }
}
