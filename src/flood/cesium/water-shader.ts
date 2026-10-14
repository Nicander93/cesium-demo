// Original procedural shading. These details do not modify hydraulic depths.
export const waterShaderFunctions = `
float waterNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  vec4 corners = vec4(dot(i, vec2(127.1, 311.7)), dot(i + vec2(1,0), vec2(127.1,311.7)), dot(i + vec2(0,1), vec2(127.1,311.7)), dot(i + vec2(1,1), vec2(127.1,311.7)));
  vec4 values = fract(sin(corners) * 43758.5453);
  float value = mix(mix(values.x, values.y, f.x), mix(values.z, values.w, f.x), f.y);
  float footprint = max(length(dFdx(p)), length(dFdy(p)));
  return mix(value, 0.5, smoothstep(0.35, 1.2, footprint));
}
// Analytic gradient of smooth value noise in fixed ENU coordinates. No velocity-basis rotation.
vec2 flowNoiseGradient(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
  vec4 h = fract(sin(vec4(dot(i, vec2(127.1,311.7)), dot(i+vec2(1,0), vec2(127.1,311.7)),
    dot(i+vec2(0,1), vec2(127.1,311.7)), dot(i+1.0, vec2(127.1,311.7)))) * 43758.5453);
  vec2 gradient = vec2(mix(h.y-h.x, h.w-h.z, u.y) * du.x,
    (mix(h.z,h.w,u.x)-mix(h.x,h.y,u.x)) * du.y);
  float footprint = max(length(dFdx(p)), length(dFdy(p)));
  return gradient * (1.0 - smoothstep(0.35, 1.2, footprint));
}
vec2 advectedSlope(vec2 p) {
  return flowNoiseGradient(p * 0.42) * 0.62
    + flowNoiseGradient(p * 0.97 + vec2(19.3, 7.7)) * 0.27
    + flowNoiseGradient(p * 1.83 + vec2(3.1, 51.2)) * 0.11;
}
vec2 rippleSlope(vec2 p, float time) {
  vec2 slope = vec2(0.0);
  for (int i = 0; i < 6; i++) {
    float f = float(i);
    vec2 direction = vec2(cos(f * 2.399 + 0.4), sin(f * 2.399 + 0.4));
    float k = 0.16 * pow(1.6, f);
    float amplitude = 0.07 / pow(1.9, f);
    float phase = dot(p, direction) * k - time * sqrt(9.81 * k) + f * 1.72;
    float filtering = 1.0 - smoothstep(0.5, 2.0, fwidth(phase));
    slope += direction * k * amplitude * cos(phase) * filtering;
  }
  return slope;
}
vec3 reflectedSky(vec3 ray, vec3 east, vec3 north, vec3 up) {
  float altitude = clamp(dot(ray, up), 0.0, 1.0);
  vec3 sky = mix(vec3(0.62, 0.72, 0.75), vec3(0.18, 0.37, 0.52), pow(altitude, 0.45));
  return mix(vec3(0.13, 0.20, 0.16), sky, smoothstep(-0.12, 0.02, dot(ray, up)));
}
`

export const detailedWaterBody = `
  float h = v_state.r;
  if (h < 0.02) discard;
  float time = floodVisualTime();
  vec2 velocity = v_state.gb * floodFlowEnabled();
  float speed = length(velocity);
  // Two advection phases avoid unlimited stretching in a varying flow field.
  float period = floodSurfaceStyle() > 0.5 ? 1.9 : 4.7;
  float halfPeriod = period * 0.5;
  float phaseA = mod(time, period);
  float phaseB = mod(time + halfPeriod, period);
  float blend = abs(phaseA - halfPeriod) / halfPeriod;
  // Bound visual stretching; particles still follow the unmodified supplied velocity.
  vec2 drift = velocity * min(1.0, 6.0 / max(speed, 0.001));
  vec2 pA = v_st - drift * phaseA;
  vec2 pB = v_st - drift * phaseB;
  // Spatial wave coordinates stay fixed. Rotating a world position by a varying
  // velocity basis produces angular contours at triangle boundaries.
  vec2 slope = rippleSlope(v_st, time * 0.65);
  float flowStyle = floodSurfaceStyle();
  if (flowStyle > 0.5) {
    // Each phase resets only when its weight is zero. The experiment limits drift to 1.9 seconds to reduce local shear stretching.
    vec2 flowing = mix(advectedSlope(pA), advectedSlope(pB), blend);
    float roughness = mix(0.1, 0.65, smoothstep(0.15, 3.5, speed));
    slope = slope * 0.8 + flowing * roughness * smoothstep(0.02, 0.25, speed);
  }
  float shoreDamping = smoothstep(0.02, 0.6, h);
  vec3 east = normalize(v_eastEC);
  vec3 north = normalize(v_northEC);
  vec3 up = normalize(v_upEC);
  n = normalize(n - (east * slope.x + north * slope.y) * shoreDamping);
  vec3 view = normalize(-v_positionEC);
  vec3 light = normalize(czm_lightDirectionEC);
  float facing = clamp(dot(n, view), 0.0, 1.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);
  vec3 reflected = reflectedSky(reflect(-view, n), east, north, up);
  vec3 absorption = exp(-vec3(0.42, 0.18, 0.12) * h);
  vec3 shallow = vec3(0.24, 0.42, 0.36);
  vec3 deep = vec3(0.035, 0.16, 0.19);
  vec3 body = deep + (shallow - deep) * absorption;
  vec3 rgb = mix(body, reflected, fresnel);
  float specular = pow(max(dot(n, normalize(view + light)), 0.0), 80.0);
  rgb += vec3(1.0, 0.94, 0.78) * specular * 0.65;
  float noiseA = waterNoise(pA * 0.045) * 0.65 + waterNoise(pA * 0.12) * 0.35;
  float noiseB = waterNoise(pB * 0.045) * 0.65 + waterNoise(pB * 0.12) * 0.35;
  float foamNoise = mix(noiseA, noiseB, blend);
  rgb += vec3(0.05, 0.075, 0.065) * (foamNoise - 0.5) * min(speed * 0.5, 1.0);
  // Coverage is transported and decayed between result frames on the CPU.
  float coverage = clamp(v_state.a, 0.0, 1.0);
  float breakup = smoothstep(0.64, 0.83, foamNoise);
  float foam = clamp(coverage * breakup * floodFoamOpacity() * 0.07, 0.0, 0.06);
  if (flowStyle > 0.5) {
    // Transported coverage determines where whitewater exists; noise only breaks up that coverage.
    float fragments = smoothstep(0.48, 0.72, mix(waterNoise(pA * 0.72), waterNoise(pB * 0.72), blend));
    foam = clamp(coverage * fragments * floodFoamOpacity() * 1.2, 0.0, 0.85);
  }
  rgb = mix(rgb, vec3(0.82, 0.88, 0.83), foam);
  float alpha = mix(0.4, 0.98, smoothstep(0.02, 1.8, h));
  alpha = max(alpha, foam * 0.95);
`
