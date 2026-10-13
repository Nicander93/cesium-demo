import * as Cesium from 'cesium'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCityRain } from './rain'

const systems = vi.hoisted(
  () =>
    [] as {
      show: boolean
      emissionRate: number
      updateCallback: (particle: Cesium.Particle) => void
    }[],
)
vi.mock('cesium', async () => {
  const actual = await vi.importActual<typeof Cesium>('cesium')
  return {
    ...actual,
    ParticleSystem: class {
      show = true
      emissionRate = 0
      updateCallback: (particle: Cesium.Particle) => void
      constructor(options: {
        updateCallback: (particle: Cesium.Particle) => void
      }) {
        this.updateCallback = options.updateCallback
        systems.push(this)
      }
    },
  }
})

function scene(): Cesium.Scene {
  return {
    isDestroyed: () => false,
    primitives: { add: vi.fn(), remove: vi.fn() },
  } as unknown as Cesium.Scene
}
describe('rain lifecycle and roof collision', () => {
  beforeEach(() => {
    systems.length = 0
  })
  it('starts from a fresh particle clock when rain resumes after being hidden', () => {
    const rain = createCityRain(scene(), Cesium.Matrix4.IDENTITY, [])
    rain.apply(0.5, 8, 'balanced')
    expect(systems[systems.length - 1]?.emissionRate).toBe(850)
    rain.apply(0, 8, 'balanced')
    expect(systems[systems.length - 1]?.show).toBe(false)
    const previous = systems.length
    rain.apply(0.5, 8, 'balanced')
    expect(systems).toHaveLength(previous + 1)
  })
  it('resets particles for solar-time jumps and releases only its own system', () => {
    const host = scene()
    const rain = createCityRain(host, Cesium.Matrix4.IDENTITY, [])
    const initial = systems[0]
    rain.reset()
    expect(host.primitives.remove).toHaveBeenCalledWith(initial)
    rain.destroy()
    expect(host.primitives.remove).toHaveBeenLastCalledWith(
      systems[systems.length - 1],
    )
  })
  it('ends particles below roofs and makes surviving particles fall in world coordinates', () => {
    const rain = createCityRain(scene(), Cesium.Matrix4.IDENTITY, [
      { x: 100, y: 20, halfWidth: 15, halfLength: 15, roof: 50 },
    ])
    rain.apply(0.5, 10, 'balanced')
    const callback = systems[systems.length - 1]!.updateCallback
    const hit = new Cesium.Particle({
      position: new Cesium.Cartesian3(100, 20, 49),
      life: 3,
    })
    callback(hit)
    expect(hit.life).toBe(-1)
    const falling = new Cesium.Particle({
      position: new Cesium.Cartesian3(100, 20, 70),
      life: 3,
    })
    callback(falling)
    expect(falling.velocity.z).toBe(-65)
    expect(falling.velocity.x).toBe(4)
  })
})

it('expires roof collisions at zero elapsed time without NaN particle bounds', () => {
  const rain = createCityRain(scene(), Cesium.Matrix4.IDENTITY, [])
  rain.apply(0.5, 6, 'balanced')
  const particle = new Cesium.Particle({
    position: new Cesium.Cartesian3(120, 50, 1),
    life: 3,
  })
  const step = particle as Cesium.Particle & {
    update: (
      dt: number,
      callback: (particle: Cesium.Particle) => void,
    ) => boolean
  }
  expect(step.update(0, systems[systems.length - 1]!.updateCallback)).toBe(
    false,
  )
  expect(Number.isFinite(particle.normalizedAge)).toBe(true)
})
