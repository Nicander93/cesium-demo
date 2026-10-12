// Original procedural shading. These details do not modify hydraulic depths.
export const waterShaderFunctions = `
float waterNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  vec4 corners = vec4(dot(i, vec2(127.1, 311.7)), dot(i + vec2(1,0), vec2(127.1,311.7)), dot(i + vec2(0,1), vec2(127.1,311.7)), dot(i + vec2(1,1), vec2(127.1,311.7)));
  vec4 values = fract(sin(corners) * 43758.5453);
  return mix(mix(values.x, values.y, f.x), mix(values.z, values.w, f.x), f.y);
}
vec2 rippleSlope(vec2 p, float time) {
  vec2 slope = vec2(0.0);
  for (int i = 0; i < 6; i++) {
    float f = float(i);
    vec2 direction = vec2(cos(f * 2.399 + 0.4), sin(f * 2.399 + 0.4));
    float k = 0.38 * pow(1.7, f);
    float amplitude = 0.12 / pow(1.9, f);
    float phase = dot(p, direction) * k - time * sqrt(9.81 * k) + f * 1.72;
    float filtering = 1.0 - smoothstep(0.5, 2.0, fwidth(phase));
    slope += direction * k * amplitude * cos(phase) * filtering;
  }
  return slope;
}
vec3 reflectedSky(vec3 ray, vec3 east, vec3 north, vec3 up) {
  float altitude = clamp(dot(ray, up), 0.0, 1.0);
  vec3 sky = mix(vec3(0.62, 0.72, 0.75), vec3(0.18, 0.37, 0.52), pow(altitude, 0.45));
  vec2 cloudPosition = vec2(dot(ray, east), dot(ray, north)) / (0.25 + altitude);
  float cloud = waterNoise(cloudPosition * 3.0) * 0.65 + waterNoise(cloudPosition * 7.0) * 0.35;
  sky = mix(sky, vec3(0.86, 0.89, 0.88), smoothstep(0.54, 0.8, cloud) * smoothstep(0.02, 0.25, altitude));
  return mix(vec3(0.13, 0.20, 0.16), sky, smoothstep(-0.12, 0.02, dot(ray, up)));
}
`

export const detailedWaterBody = `
  float h = v_state.r;
  if (h < 0.02) discard;
  float time = floodVisualTime();
  vec2 velocity = v_state.gb;
  float speed = length(velocity);
  // Two advection phases avoid unlimited stretching in a varying flow field.
  float phaseA = mod(time, 6.0);
  float phaseB = mod(time + 3.0, 6.0);
  float blend = abs(phaseA - 3.0) / 3.0;
  vec2 pA = v_st - velocity * phaseA;
  vec2 pB = v_st - velocity * phaseB;
  vec2 slope = mix(rippleSlope(pA, time), rippleSlope(pB, time), blend);
  float shoreDamping = smoothstep(0.02, 0.6, h);
  vec3 east = normalize(v_eastEC);
  vec3 north = normalize(v_northEC);
  vec3 up = normalize(v_upEC);
  n = normalize(n - (east * slope.x + north * slope.y) * shoreDamping * (1.0 + min(speed, 4.0) * 0.1));
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
  float noiseA = waterNoise(pA * 0.15) * 0.65 + waterNoise(pA * 0.45) * 0.35;
  float noiseB = waterNoise(pB * 0.15) * 0.65 + waterNoise(pB * 0.45) * 0.35;
  float foamNoise = mix(noiseA, noiseB, blend);
  float shoreline = 1.0 - smoothstep(0.025, 0.32, h);
  float fastFlow = smoothstep(1.4, 4.0, speed) * smoothstep(0.6, 0.85, foamNoise);
  float foam = clamp(shoreline * smoothstep(0.35, 0.72, foamNoise) + fastFlow * 0.45, 0.0, 0.8);
  rgb = mix(rgb, vec3(0.82, 0.88, 0.83), foam);
  float alpha = mix(0.4, 0.98, smoothstep(0.02, 1.8, h));
  alpha = max(alpha, foam * 0.95);
`
