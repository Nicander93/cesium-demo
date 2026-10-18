/** Artistic surface controls; independent of hydraulic depth, velocity and sediment. */
export interface FloodAppearanceOptions {
  /** sRGB colors in #RRGGBB form. */
  shallowColor?: string
  deepColor?: string
  foamColor?: string
  /** Depth-color transition scale in meters; not measured optical attenuation. */
  colorDepth?: number
  /** Overall water opacity multiplier, including foam, 0–1. */
  opacity?: number
  /** Vertical water depth at 1-exp(-1) coverage, in meters; a transmission proxy. */
  opacityDepth?: number
  /** Direct-light diffuse body proxy weight, 0–1; not a sediment concentration. */
  bodyScattering?: number
  /** Fine wave normal strength, 0–3. Does not displace the computed water surface. */
  waveStrength?: number
  /** Velocity-driven normal detail strength, 0–3. Does not scale supplied velocity. */
  flowStrength?: number
}

const presets: Record<
  'clear' | 'muddy',
  Readonly<Required<FloodAppearanceOptions>>
> = {
  clear: Object.freeze({
    shallowColor: '#3d6b5c',
    deepColor: '#092931',
    foamColor: '#d1e0d4',
    colorDepth: 1 / 0.12,
    opacity: 1,
    opacityDepth: 0.5,
    bodyScattering: 0,
    waveStrength: 1,
    flowStrength: 1,
  }),
  muddy: Object.freeze({
    shallowColor: '#a18758',
    deepColor: '#5c5038',
    foamColor: '#d9d4bf',
    colorDepth: 0.7,
    opacity: 1,
    opacityDepth: 0.04,
    bodyScattering: 1,
    waveStrength: 0.65,
    flowStrength: 0.7,
  }),
}

/** Returns editable values, so callers never share mutable preset state. */
export function getFloodAppearancePreset(
  name: 'clear' | 'muddy',
): Required<FloodAppearanceOptions> {
  if (!Object.prototype.hasOwnProperty.call(presets, name))
    throw new RangeError('Unknown flood appearance preset')
  return { ...presets[name] }
}

export function resolveFloodAppearance(
  options: FloodAppearanceOptions,
  current = getFloodAppearancePreset('clear'),
): Required<FloodAppearanceOptions> {
  const next = { ...current, ...options }
  for (const key of ['shallowColor', 'deepColor', 'foamColor'] as const)
    if (typeof next[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(next[key]))
      throw new TypeError(key + ' must be #RRGGBB')
  if (
    !Number.isFinite(next.colorDepth) ||
    next.colorDepth < 0.01 ||
    next.colorDepth > 100
  )
    throw new RangeError('colorDepth must be 0.01–100 m')
  if (!Number.isFinite(next.opacity) || next.opacity < 0 || next.opacity > 1)
    throw new RangeError('opacity must be 0–1')
  if (
    !Number.isFinite(next.opacityDepth) ||
    next.opacityDepth < 0.001 ||
    next.opacityDepth > 100
  )
    throw new RangeError('opacityDepth must be 0.001–100 m')
  if (
    !Number.isFinite(next.bodyScattering) ||
    next.bodyScattering < 0 ||
    next.bodyScattering > 1
  )
    throw new RangeError('bodyScattering must be 0–1')
  for (const key of ['waveStrength', 'flowStrength'] as const)
    if (!Number.isFinite(next[key]) || next[key] < 0 || next[key] > 3)
      throw new RangeError(key + ' must be 0–3')
  return next
}
