import * as Cesium from 'cesium'
import { river } from './layout'

export interface RainObstacle {
  x: number
  y: number
  halfWidth: number
  halfLength: number
  roof: number
}

export function collisionHeight(
  x: number,
  y: number,
  obstacles: readonly RainObstacle[],
): number {
  let height =
    Math.abs(x) < river.halfWidth && Math.abs(y) < river.halfLength
      ? river.height
      : 2.3
  if (
    Math.abs(x) < 53 &&
    [-220, 0, 220].some((bridge) => Math.abs(y - bridge) < 13)
  )
    height = 3.8
  for (const obstacle of obstacles)
    if (
      Math.abs(x - obstacle.x) <= obstacle.halfWidth &&
      Math.abs(y - obstacle.y) <= obstacle.halfLength
    )
      height = Math.max(height, obstacle.roof)
  return height
}

export function createCityRain(
  scene: Cesium.Scene,
  frame: Cesium.Matrix4,
  obstacles: readonly RainObstacle[],
) {
  const inverse = Cesium.Matrix4.inverseTransformation(
    frame,
    new Cesium.Matrix4(),
  )
  const point = new Cesium.Cartesian3()
  const velocity = new Cesium.Cartesian3()
  let wind = 6
  let currentAmount = 0
  function build(): Cesium.ParticleSystem {
    return new Cesium.ParticleSystem({
      image: `${import.meta.env.BASE_URL}city-rendering/rain.svg`,
      modelMatrix: Cesium.Matrix4.multiplyByTranslation(
        frame,
        new Cesium.Cartesian3(0, 0, 115),
        new Cesium.Matrix4(),
      ),
      emitter: new Cesium.BoxEmitter(new Cesium.Cartesian3(630, 650, 180)),
      minimumParticleLife: 2.2,
      maximumParticleLife: 3.5,
      minimumSpeed: 0,
      maximumSpeed: 0,
      emissionRate: 0,
      imageSize: new Cesium.Cartesian2(1.8, 15),
      sizeInMeters: false,
      startColor: new Cesium.Color(0.74, 0.84, 0.95, 0.55),
      endColor: new Cesium.Color(0.74, 0.84, 0.95, 0.1),
      startScale: 1,
      endScale: 0.65,
      lifetime: Number.MAX_VALUE,
      updateCallback: (particle) => {
        Cesium.Matrix4.multiplyByPoint(inverse, particle.position, point)
        // A zero lifetime at dt=0 yields 0/0 normalized age and NaN billboard bounds.
        // Mark the particle as already expired, including mirror passes at the same time.
        if (point.z < collisionHeight(point.x, point.y, obstacles)) {
          particle.life = -1
          return
        }
        Cesium.Matrix4.multiplyByPointAsVector(
          frame,
          new Cesium.Cartesian3(wind * 0.4, wind * 0.12, -65),
          velocity,
        )
        Cesium.Cartesian3.clone(velocity, particle.velocity)
      },
    })
  }
  let rain = build()
  rain.show = false
  scene.primitives.add(rain)
  function reset(): void {
    scene.primitives.remove(rain)
    rain = build()
    rain.show = false
    scene.primitives.add(rain)
  }
  function apply(amount: number, windSpeed: number, quality: string): void {
    if (amount > 0 && currentAmount === 0) reset()
    currentAmount = amount
    wind = windSpeed
    rain.show = amount > 0
    rain.emissionRate =
      amount * (quality === 'low' ? 900 : quality === 'high' ? 2600 : 1700)
  }
  return {
    apply,
    reset,
    destroy: () => {
      if (!scene.isDestroyed()) scene.primitives.remove(rain)
    },
  }
}
