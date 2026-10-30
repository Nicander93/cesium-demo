import {
  Cartesian2,
  Cartesian3,
  ConeEmitter,
  JulianDate,
  Math as CesiumMath,
  Matrix4,
  ParticleSystem,
  Transforms,
  type Particle,
  type Viewer,
} from 'cesium'
import { createEffectHandle } from './runtime.js'
import {
  parseColor,
  validateKeys,
  validateNumber,
  validatePoint,
} from './validation.js'
import type { EffectHandle, FountainOptions } from './types.js'

const dynamicKeys = [
  'emissionRate',
  'lifetime',
  'minSpeed',
  'maxSpeed',
  'gravity',
  'particleSizePx',
  'color',
  'quality',
]

// Cesium 1.132's primitive update hook is internal and absent from its .d.ts.
// Keep this version-sensitive adapter here; never mutate the host frameState or Clock.
interface ParticleFrameState {
  time: JulianDate
}
interface TimedParticleSystem extends ParticleSystem {
  update(frameState: ParticleFrameState): void
  readonly _particles?: readonly Particle[]
}

function validateOptions(options: Required<FountainOptions>): void {
  validatePoint(options.position)
  validateNumber('emissionRate', options.emissionRate, 0, 2000)
  validateNumber('lifetime', options.lifetime, 0.05, 30)
  validateNumber('minSpeed', options.minSpeed, 0, 300)
  validateNumber('maxSpeed', options.maxSpeed, options.minSpeed, 300)
  validateNumber('gravity', options.gravity, 0, 100)
  validateNumber('particleSizePx', options.particleSizePx, 1, 64)
  parseColor(options.color)
  if (!['basic', 'standard'].includes(options.quality))
    throw new RangeError('quality must be basic or standard')
}

export function validateFountainInput(input: FountainOptions): void {
  validateKeys(input, ['position', ...dynamicKeys])
  validateOptions({
    emissionRate: 90,
    lifetime: 5,
    minSpeed: 22,
    maxSpeed: 28,
    gravity: 9.8,
    particleSizePx: 7,
    color: '#bcecff',
    quality: 'standard',
    ...input,
  })
}

function createDropletImage(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 32
  const context = canvas.getContext('2d')
  if (!context)
    throw new Error('A 2D canvas is required to create the droplet texture')
  const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 16)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.9)')
  gradient.addColorStop(0.7, 'rgba(255,255,255,0.3)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 32, 32)
  return canvas
}

/** Particle fountain in local ENU. Pause removes particles; resume starts a fresh system. */
export function createFountain(
  viewer: Viewer,
  input: FountainOptions,
): EffectHandle<FountainOptions> {
  if (viewer.isDestroyed())
    throw new Error('Cannot create an effect on a destroyed Viewer')
  validateKeys(input, ['position', ...dynamicKeys])
  let options: Required<FountainOptions> = {
    emissionRate: 90,
    lifetime: 5,
    minSpeed: 22,
    maxSpeed: 28,
    gravity: 9.8,
    particleSizePx: 7,
    color: '#bcecff',
    quality: 'standard',
    ...input,
    position: { ...input.position },
  }
  validateOptions(options)
  const origin = Cartesian3.fromDegrees(
    options.position.lon,
    options.position.lat,
    options.position.height ?? 0,
  )
  const frame = Transforms.eastNorthUpToFixedFrame(origin)
  const down = Matrix4.multiplyByPointAsVector(
    frame,
    new Cartesian3(0, 0, -1),
    new Cartesian3(),
  )
  const acceleration = new Cartesian3()
  const epoch = JulianDate.fromIso8601('2000-01-01T00:00:00Z')
  const localTime = new JulianDate()
  let timeSeconds = 0
  let particleStart = 0
  let image: HTMLCanvasElement | undefined
  let system: TimedParticleSystem | undefined
  let primitive:
    | {
        update(state: ParticleFrameState): void
        isDestroyed(): boolean
        destroy(): void
      }
    | undefined

  function applyOptions(): void {
    if (!system) return
    const color = parseColor(options.color)
    system.emissionRate =
      options.emissionRate * (options.quality === 'basic' ? 0.5 : 1)
    system.minimumParticleLife = system.maximumParticleLife = options.lifetime
    system.minimumSpeed = options.minSpeed
    system.maximumSpeed = options.maxSpeed
    system.minimumImageSize = new Cartesian2(
      options.particleSizePx,
      options.particleSizePx,
    )
    system.maximumImageSize = new Cartesian2(
      options.particleSizePx,
      options.particleSizePx,
    )
    system.startColor = color
    system.endColor = color.withAlpha(color.alpha * 0.08)
  }

  function disposeSystem(): void {
    if (!primitive) return
    if (!viewer.isDestroyed() && viewer.scene.primitives.contains(primitive))
      viewer.scene.primitives.remove(primitive)
    else if (!primitive.isDestroyed()) primitive.destroy()
    primitive = undefined
    system = undefined
  }

  return createEffectHandle<FountainOptions>(
    viewer,
    { seek: 'reset', pause: 'restart', reverse: false },
    {
      kind: 'fountain',
      setVisible(visible) {
        if (!visible) disposeSystem()
      },
      sample(time) {
        timeSeconds = time
      },
      start(time) {
        timeSeconds = particleStart = time
        image ??= createDropletImage()
        system = new ParticleSystem({
          image,
          modelMatrix: frame,
          emitter: new ConeEmitter(CesiumMath.toRadians(12)),
          lifetime: Number.MAX_VALUE,
          startScale: 1,
          endScale: 0.45,
          sizeInMeters: false,
          updateCallback(particle, dt) {
            Cartesian3.multiplyByScalar(
              down,
              options.gravity * dt,
              acceleration,
            )
            Cartesian3.add(particle.velocity, acceleration, particle.velocity)
          },
        }) as TimedParticleSystem
        applyOptions()
        const currentSystem = system
        let destroyed = false
        primitive = {
          update(frameState) {
            if (destroyed) return
            const localFrame = Object.create(frameState) as ParticleFrameState
            localFrame.time = JulianDate.addSeconds(
              epoch,
              timeSeconds - particleStart,
              localTime,
            )
            currentSystem.update(localFrame)
          },
          isDestroyed: () => destroyed,
          destroy() {
            if (destroyed) return
            destroyed = true
            if (!currentSystem.isDestroyed()) currentSystem.destroy()
          },
        }
        viewer.scene.primitives.add(primitive)
      },
      pause: disposeSystem,
      stop() {
        disposeSystem()
        timeSeconds = particleStart = 0
      },
      update(patch) {
        validateKeys(patch, dynamicKeys)
        const next = { ...options, ...patch }
        validateOptions(next)
        options = next
        applyOptions()
      },
      destroy() {
        disposeSystem()
        image = undefined
      },
      inspect: () => ({
        kind: 'fountain',
        // Private field used only for experimental diagnostics, never control or ownership.
        particleCount: system?._particles?.length ?? 0,
        effectiveEmissionRate: system?.emissionRate ?? 0,
        simulationTimeSeconds: timeSeconds - particleStart,
        gravityDirection: { x: down.x, y: down.y, z: down.z },
      }),
    },
  )
}
