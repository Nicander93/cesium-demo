/** Share the trace/reconstruction lattice between rendering and shader warmup. */
export function buildCloudResolveLayout(width: number, height: number, traceDivisor: 1 | 2 | 4, outputDivisor: 1 | 2 = 1) {
  const traceWidth = Math.ceil(width / traceDivisor)
  const traceHeight = Math.ceil(height / traceDivisor)
  // An exact 2x lattice also aligns jitter on odd scene dimensions. The overlay
  // samples this intermediate texture in normalized UV at the final scene size.
  const intermediate = traceDivisor === 4 && outputDivisor === 2
  return {
    width: intermediate ? traceWidth * 2 : width,
    height: intermediate ? traceHeight * 2 : height,
    upscaleDivisor: intermediate ? 2 as const : traceDivisor,
  }
}
