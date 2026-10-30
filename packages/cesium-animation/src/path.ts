import { Material, PolylineCollection, type Viewer } from 'cesium'
import { createEffectHandle } from './runtime.js'
import {
  parseColor,
  validateKeys,
  validateNumber,
  validatePositions,
} from './validation.js'
import type { EffectHandle, FlowArrowOptions, FlyLineOptions } from './types.js'

const commonKeys = ['color', 'widthPx', 'speed', 'direction', 'opacity']
const flySource = `
czm_material czm_getMaterial(czm_materialInput inputValue) {
  czm_material material = czm_getDefaultMaterial(inputValue);
  float along = mix(inputValue.st.s, 1.0 - inputValue.st.s, reverse);
  float x = fract(along * repeatCount - phase);
  float trail = pow(smoothstep(0.0, 0.85, x), 2.0) * (1.0 - smoothstep(0.85, 1.0, x));
  float edge = 1.0 - smoothstep(0.18, 0.5, abs(inputValue.st.t - 0.5));
  material.diffuse = color.rgb;
  material.alpha = color.a * edge * (0.12 + 0.88 * trail);
  return material;
}`
const arrowSource = `
czm_material czm_getMaterial(czm_materialInput inputValue) {
  czm_material material = czm_getDefaultMaterial(inputValue);
  float along = mix(inputValue.st.s, 1.0 - inputValue.st.s, reverse);
  float x = fract(along * repeatCount - phase);
  float halfWidth = x < 0.48 ? 0.13 : 0.46 * (0.96 - x) / 0.48;
  float edge = 1.0 - smoothstep(halfWidth - 0.035, halfWidth + 0.035, abs(inputValue.st.t - 0.5));
  float arrow = edge * smoothstep(0.08, 0.13, x) * (1.0 - smoothstep(0.93, 0.97, x));
  material.diffuse = color.rgb;
  material.alpha = color.a * arrow;
  return material;
}`

function validatePathOptions(options: Required<FlowArrowOptions>): void {
  parseColor(options.color)
  validateNumber('widthPx', options.widthPx, 1, 64)
  validateNumber('speed', options.speed, 0, 20)
  validateNumber('opacity', options.opacity, 0, 1)
  validateNumber('spacing', options.spacing, 1, 200)
  if (!['forward', 'backward'].includes(options.direction))
    throw new RangeError('direction must be forward or backward')
}

export function validatePathInput(
  input: FlyLineOptions & { spacing?: number },
  kind: 'fly' | 'arrow',
): void {
  const keys = kind === 'arrow' ? [...commonKeys, 'spacing'] : commonKeys
  validateKeys(input, ['positions', ...keys])
  validatePositions(input.positions)
  validatePathOptions({
    color: '#49b7ff',
    widthPx: 6,
    speed: 0.35,
    direction: 'forward',
    opacity: 1,
    spacing: 10,
    ...input,
  })
}

function createPath<TOptions extends FlyLineOptions>(
  viewer: Viewer,
  input: TOptions & { spacing?: number },
  kind: 'fly' | 'arrow',
): EffectHandle<TOptions> {
  if (viewer.isDestroyed())
    throw new Error('Cannot create an effect on a destroyed Viewer')
  const dynamicKeys = kind === 'arrow' ? [...commonKeys, 'spacing'] : commonKeys
  validateKeys(input, ['positions', ...dynamicKeys])
  const positions = validatePositions(input.positions)
  let options: Required<FlowArrowOptions> = {
    color: kind === 'fly' ? '#49b7ff' : '#ffca70',
    widthPx: kind === 'fly' ? 6 : 20,
    speed: 0.35,
    direction: 'forward',
    opacity: 1,
    spacing: kind === 'fly' ? 3 : 10,
    ...input,
    positions: input.positions.map((point) => ({ ...point })),
  }
  validatePathOptions(options)
  const material = new Material({
    fabric: {
      type:
        kind === 'fly'
          ? 'GisAnimationFlyExperimental'
          : 'GisAnimationArrowExperimental',
      uniforms: {
        color: parseColor(options.color),
        phase: 0,
        repeatCount: options.spacing,
        reverse: 0,
      },
      source: kind === 'fly' ? flySource : arrowSource,
    },
    translucent: true,
  })
  const collection = new PolylineCollection()
  const line = collection.add({ positions, width: options.widthPx, material })
  try {
    viewer.scene.primitives.add(collection)
  } catch (error) {
    collection.destroy()
    throw error
  }
  let basePhase = 0
  let anchorTime = 0

  function phaseAt(time: number): number {
    return (basePhase + (time - anchorTime) * options.speed) % 1
  }
  function sample(time: number): void {
    material.uniforms.phase = phaseAt(time)
    material.uniforms.reverse = options.direction === 'backward' ? 1 : 0
    material.uniforms.repeatCount = options.spacing
    const color = parseColor(options.color)
    material.uniforms.color = color.withAlpha(color.alpha * options.opacity)
    line.width = options.widthPx
  }
  sample(0)

  return createEffectHandle<TOptions>(
    viewer,
    { seek: 'exact', pause: 'exact', reverse: false },
    {
      kind,
      setVisible(visible) {
        collection.show = visible
      },
      sample,
      start: sample,
      pause() {},
      stop() {
        basePhase = 0
        anchorTime = 0
        sample(0)
      },
      update(patch, time) {
        validateKeys(patch, dynamicKeys)
        const next = { ...options, ...patch }
        validatePathOptions(next)
        basePhase = phaseAt(time)
        anchorTime = time
        options = next
        sample(time)
      },
      destroy() {
        if (
          !viewer.isDestroyed() &&
          viewer.scene.primitives.contains(collection)
        )
          viewer.scene.primitives.remove(collection)
        else if (!collection.isDestroyed()) collection.destroy()
      },
      inspect: () => ({
        kind,
        phase: material.isDestroyed() ? null : material.uniforms.phase,
      }),
    },
  )
}

/** Animated pattern along WGS84 ellipsoid-height positions; geometry is immutable. */
export function createFlyLine(
  viewer: Viewer,
  options: FlyLineOptions,
): EffectHandle<FlyLineOptions> {
  return createPath<FlyLineOptions>(viewer, options, 'fly')
}

/** spacing is a dimensionless pattern count over the complete path. */
export function createFlowArrow(
  viewer: Viewer,
  options: FlowArrowOptions,
): EffectHandle<FlowArrowOptions> {
  return createPath<FlowArrowOptions>(viewer, options, 'arrow')
}
