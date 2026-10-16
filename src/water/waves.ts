export interface WaveSpectrumOptions {
  waveLength: number
  direction: number
  spread: number
  irregularity: number
}

/** Five bands of four deterministic wave vectors: kEast, kNorth, omega, phase. */
export function createWaveBands(
  options: WaveSpectrumOptions,
): Record<string, number[]> {
  const bands: Record<string, number[]> = {}
  for (let band = 0; band < 5; band++) {
    const values: number[] = []
    const baseLength = options.waveLength * (band === 4 ? 0.08 : 0.48 ** band)
    for (let component = 0; component < 4; component++) {
      const index = band * 4 + component
      const ratio =
        0.82 +
        component * 0.13 +
        (random(index, 1) - 0.5) * 0.2 * options.irregularity
      const offset =
        (component + 0.5) * 0.5 -
        1 +
        (random(index, 2) - 0.5) * 0.35 * options.irregularity
      const direction = options.direction + options.spread * offset
      const k = (2 * Math.PI) / (baseLength * ratio)
      // Shader normalization squares k; reject overflow/underflow before uploading a matrix.
      if (!Number.isFinite(Math.fround(k * k)) || Math.fround(k * k) === 0)
        throw new RangeError('Wave coefficients exceed floating-point range')
      values.push(
        Math.sin(direction) * k,
        Math.cos(direction) * k,
        Math.sqrt(9.81 * k),
        random(index, 3) * 2 * Math.PI,
      )
    }
    bands['waveBand' + band] = values
  }
  return bands
}

function random(index: number, salt: number): number {
  let value = Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d)
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b)
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296
}

// Finite directional waves and slope-variance filtering, not a calibrated ocean spectrum.
// Derivation, filtering limits and references are recorded in WAVES.md.
export const spectralWaves = `
uniform mat4 waveBand0;
uniform mat4 waveBand1;
uniform mat4 waveBand2;
uniform mat4 waveBand3;
uniform mat4 waveBand4;
uniform float waveDiagnostic;
uniform vec4 waveProbe;

void accumulateWaterWave(vec4 wave, float amplitude, vec2 p, vec2 dpdx, vec2 dpdy, inout vec2 slope, inout float variance) {
  float phaseX = dot(wave.xy, dpdx), phaseY = dot(wave.xy, dpdy);
  // Gaussian approximation to the pixel box, with a smooth Nyquist guard.
  float footprint = max(abs(phaseX), abs(phaseY));
  float resolved = exp(-(phaseX*phaseX+phaseY*phaseY)/24.0)
    * (1.0-smoothstep(1.57079632679,3.14159265359,footprint));
  variance += 0.5*amplitude*amplitude*(1.0-resolved*resolved);
  if (resolved > 0.0001) {
    float phase = dot(wave.xy,p)-time*wave.z+wave.w;
    slope += normalize(wave.xy)*amplitude*cos(phase)*resolved;
  }
}

vec3 spectralWaterNormal(vec2 p, vec2 dpdx, vec2 dpdy, out float variance) {
  variance = 0.0;
  if (waveStrength <= 0.0) return vec3(0.0,1.0,0.0);
  vec2 slope = vec2(0.0);
  ${Array.from({ length: 5 }, (_, band) =>
    band === 4
      ? `
  // No texture sampling or detail-wave evaluation when this raw parameter is zero.
  if (detailStrength > 0.0) {
    for (int component=0;component<4;component++) {
      accumulateWaterWave(waveBand4[component],0.025*detailStrength,p,dpdx,dpdy,slope,variance);
    }
  }`
      : `
  for (int component=0;component<4;component++) {
    accumulateWaterWave(waveBand${band}[component],${(0.05 / 1.35 ** band).toPrecision(10)},p,dpdx,dpdy,slope,variance);
  }`,
  ).join('\n')}
  variance *= waveStrength*waveStrength;
  slope *= waveStrength;
  return normalize(vec3(-slope.x,1.0,slope.y));
}

float waterFilteredRoughness(float variance) {
  // Isotropic approximation from discarded wave slopes to GGX alpha, not an exact convolution.
  return pow(clamp(pow(roughness,4.0)+0.5*variance,0.0,1.0),0.25);
}
`
