import { describe, expect, it } from 'vitest'
import { FlowParticles } from '../flow-particles'
import type { FloodFrame, FloodGrid } from '../../core/dataset'

const grid: FloodGrid = { columns: 6, rows: 4, cellSize: 10, origin: [0, 0, 0], elevation: new Array(24).fill(0) }
function frame(time: number, east = 2, north = -1): FloodFrame {
  return { time, depth: new Array(24).fill(2), velocityEast: new Array(24).fill(east), velocityNorth: new Array(24).fill(north) }
}
function tracked(field: FlowParticles) {
  const particle = field.particles[0]
  Object.assign(particle, { x: 25, y: 25, z: 2.18, age: 1, lifetime: 10, opacity: 1 })
  return particle
}

describe('visible foam tracers', () => {
  it('moves along both signed velocity components without advancing the input frame', () => {
    const field = new FlowParticles(grid, undefined, 1)
    const input = frame(100)
    const original = JSON.stringify(input)
    field.setFrame(input)
    const particle = tracked(field)
    field.advance(0.2)
    expect(particle.x).toBeCloseTo(25.4, 5)
    expect(particle.y).toBeCloseTo(24.8, 5)
    expect(particle.z).toBeCloseTo(2.18, 5)
    expect(JSON.stringify(input)).toBe(original)
  })

  it('freezes at zero elapsed time and clears for reset or missing velocity', () => {
    const field = new FlowParticles(grid, undefined, 1)
    field.setFrame(frame(100))
    const particle = tracked(field)
    field.advance(0)
    expect(particle.x).toBe(25)
    field.setFrame({ time: 101, depth: new Array(24).fill(2) })
    field.advance(0.2)
    expect(particle.opacity).toBe(0)
    field.reset()
    expect(particle.lifetime).toBe(0)
  })

  it('samples the same triangles as the water mesh and rejects dry ground', () => {
    const field = new FlowParticles(grid, undefined, 1)
    const input = frame(0)
    input.depth[14] = 10
    field.setFrame(input)
    expect(field.sample(22.5, 22.5)?.height).toBeCloseTo(6)
    input.depth.fill(0)
    field.setFrame(input)
    expect(field.sample(25, 25)).toBeUndefined()
  })

  it('kills a tracer at a closed wall and permits overtopping', () => {
    const barriers = { east: new Array(28).fill(null), north: new Array(30).fill(null) }
    barriers.east[9] = 3 // row 1, face x=20m
    const field = new FlowParticles(grid, barriers, 1)
    field.setFrame(frame(0, 10, 0))
    const particle = tracked(field)
    particle.x = 19.9; particle.y = 15
    field.advance(0.05)
    expect(particle.age).toBeLessThan(0.1)
    const high = frame(1, 10, 0)
    high.depth.fill(4)
    field.setFrame(high)
    tracked(field); particle.x = 19.9; particle.y = 15
    field.advance(0.05)
    expect(particle.x).toBeCloseTo(20.4)
    expect(particle.age).toBeCloseTo(1.05)
  })
})
