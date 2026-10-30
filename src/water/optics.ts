export interface WaterOpticsCoefficients {
  absorption: readonly [number, number, number]
  scattering: readonly [number, number, number]
}
export interface WaterOpticsResult {
  transmission: [number, number, number]
  scatteringWeight: [number, number, number]
}

/** Beer-Lambert transport from vertical terrain depth and an oblique view ray. */
export function evaluateWaterOptics(depthM: number, viewCosine: number, coefficients: WaterOpticsCoefficients, depthScale = 1): WaterOpticsResult {
  if (!Number.isFinite(depthM) || depthM < 0) throw new RangeError("depthM must be finite and nonnegative")
  if (!Number.isFinite(viewCosine) || viewCosine < 0 || viewCosine > 1) throw new RangeError("viewCosine must be in [0, 1]")
  if (!Number.isFinite(depthScale) || depthScale < 0 || depthScale > 4) throw new RangeError("depthScale must be in [0, 4]")
  if ([...coefficients.absorption, ...coefficients.scattering].some(value => !Number.isFinite(value) || value < 0))
    throw new RangeError("optical coefficients must be finite and nonnegative")
  const pathLength = depthM / Math.max(viewCosine, 0.15) * depthScale
  const transmission = [0, 1, 2].map(index =>
    Math.exp(-(coefficients.absorption[index]! + coefficients.scattering[index]!) * pathLength),
  ) as [number, number, number]
  const scatteringWeight = [0, 1, 2].map(index => {
    const extinction = coefficients.absorption[index]! + coefficients.scattering[index]!
    return extinction >= 1e-12 ? coefficients.scattering[index]! / extinction * (1 - transmission[index]!) : 0
  }) as [number, number, number]
  return { transmission, scatteringWeight }
}

/** Shared shader helper attenuates the bottom proxy and adds single-scattering radiance. */
export const waterTransportGLSL = [
  'vec3 waterDepthTransport(vec3 substrate, vec3 scatteringRadiance, vec3 absorption, vec3 scattering, float verticalDepth, float viewCosine, float depthScale) {',
  '  float pathLength = max(verticalDepth, 0.0) / max(viewCosine, 0.15) * depthScale;',
  '  vec3 extinction = max(absorption, vec3(0.0)) + max(scattering, vec3(0.0));',
  '  vec3 transmission = exp(-extinction * pathLength);',
  '  vec3 scatteringFraction = mix(vec3(0.0), scattering / max(extinction, vec3(0.000000000001)), step(vec3(0.000000000001), extinction));',
  '  return substrate * transmission + scatteringRadiance * scatteringFraction * (1.0 - transmission);',
  '}',
].join('\n')
