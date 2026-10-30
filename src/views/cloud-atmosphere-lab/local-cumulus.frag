precision highp float;
precision highp sampler3D;

uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform sampler3D u_shapeTexture;
uniform sampler3D u_detailTexture;
uniform mat4 u_worldToEnu;
uniform vec3 u_cameraPosition;
uniform vec2 u_windOffset;
uniform float u_cloudBaseM;
uniform float u_cloudThicknessM;
uniform float u_coverage;
uniform float u_viewSteps;

in vec2 v_textureCoordinates;

const float HALF_EXTENT_M = 10000.0;
const float EXTINCTION_PER_M = 0.0018;
const int SUN_STEPS = 8;

vec3 reconstructWorldRay(vec2 uv) {
  vec2 ndc = uv * 2.0 - 1.0;
  vec4 eye = czm_inverseProjection * vec4(ndc, 0.0, 1.0);
  return normalize((czm_inverseView * vec4(normalize(eye.xyz), 0.0)).xyz);
}

float sceneDistance(vec2 uv, float rawDepth, vec3 worldRay) {
  if (rawDepth >= 1.0) return 1.0e20;
  vec2 windowXY = czm_viewport.xy + uv * czm_viewport.zw;
  vec4 eye = czm_windowToEyeCoordinates(windowXY, rawDepth);
  vec3 eyePosition = eye.xyz / eye.w;
  vec3 worldPosition = (czm_inverseView * vec4(eyePosition, 1.0)).xyz;
  return max(dot(worldPosition - u_cameraPosition, worldRay), 0.0);
}

float ellipsoidLobe(vec3 p, vec3 center, vec3 radii, float broadNoise, float scallopNoise, float fineNoise) {
  float distance = length((p - center) / radii);
  // Keep the coarse envelope while the mid/fine scales break its silhouette into visible billows.
  distance -= (broadNoise - 0.5) * 0.22;
  distance -= (scallopNoise - 0.5) * 0.32;
  distance -= (fineNoise - 0.5) * 0.14;
  return 1.0 - smoothstep(0.82, 1.08, distance);
}

float smoothUnion(float a, float b, float width) {
  float blend = max(width - abs(a - b), 0.0) / width;
  return max(a, b) + blend * blend * width * 0.25;
}

bool intersectBox(vec3 origin, vec3 direction, out float enter, out float leave) {
  vec3 lower = vec3(-HALF_EXTENT_M, -HALF_EXTENT_M, u_cloudBaseM);
  vec3 upper = vec3(HALF_EXTENT_M, HALF_EXTENT_M, u_cloudBaseM + u_cloudThicknessM);
  enter = -1.0e20;
  leave = 1.0e20;
  for (int axis = 0; axis < 3; ++axis) {
    if (abs(direction[axis]) < 1.0e-7) {
      if (origin[axis] < lower[axis] || origin[axis] > upper[axis]) return false;
    } else {
      float a = (lower[axis] - origin[axis]) / direction[axis];
      float b = (upper[axis] - origin[axis]) / direction[axis];
      enter = max(enter, min(a, b));
      leave = min(leave, max(a, b));
    }
  }
  return leave > max(enter, 0.0);
}

float densityAt(vec3 p) {
  if (u_coverage <= 0.0) return 0.0;
  float height = clamp((p.z - u_cloudBaseM) / max(u_cloudThicknessM, 1.0), 0.0, 1.0);
  vec3 anchoredPosition = p + vec3(u_windOffset, 0.0);
  vec3 broadUv = vec3(anchoredPosition.xy * 0.000075, height * 0.72);
  vec3 scallopUv = anchoredPosition * 0.00072;
  vec3 detailUv = anchoredPosition * 0.0018;
  float broadNoise = texture(u_shapeTexture, broadUv).r;
  float scallopNoise = texture(u_shapeTexture, scallopUv).r;
  float fineNoise = texture(u_detailTexture, detailUv).r;
  float size = mix(0.72, 1.18, clamp(u_coverage, 0.0, 1.0));

  // Three staggered levels give the formation a broad base, rising body and separate cauliflower caps.
  // Smaller upper lobes keep the cloud top from becoming one wide elliptical plate.
  float mass = 0.0;
  mass = smoothUnion(mass, ellipsoidLobe(p, vec3(-2300.0, -900.0, u_cloudBaseM + u_cloudThicknessM * 0.25), vec3(1850.0, 1500.0, u_cloudThicknessM * 0.22) * size, broadNoise, scallopNoise, fineNoise), 0.16);
  mass = smoothUnion(mass, ellipsoidLobe(p, vec3(-2100.0, -850.0, u_cloudBaseM + u_cloudThicknessM * 0.52), vec3(950.0, 850.0, u_cloudThicknessM * 0.28) * size, broadNoise, scallopNoise, fineNoise), 0.12);
  mass = smoothUnion(mass, ellipsoidLobe(p, vec3(-2570.0, -1030.0, u_cloudBaseM + u_cloudThicknessM * 0.79), vec3(690.0, 650.0, u_cloudThicknessM * 0.20) * size, broadNoise, scallopNoise, fineNoise), 0.10);
  mass = smoothUnion(mass, ellipsoidLobe(p, vec3(-1450.0, -640.0, u_cloudBaseM + u_cloudThicknessM * 0.82), vec3(620.0, 610.0, u_cloudThicknessM * 0.18) * size, broadNoise, scallopNoise, fineNoise), 0.10);
  mass = smoothUnion(mass, ellipsoidLobe(p, vec3(-3550.0, -600.0, u_cloudBaseM + u_cloudThicknessM * 0.42), vec3(800.0, 780.0, u_cloudThicknessM * 0.23) * size, scallopNoise, fineNoise, broadNoise), 0.12);
  mass = smoothUnion(mass, ellipsoidLobe(p, vec3(1050.0, -650.0, u_cloudBaseM + u_cloudThicknessM * 0.26), vec3(1900.0, 1550.0, u_cloudThicknessM * 0.23) * size, broadNoise, scallopNoise, fineNoise), 0.16);
  mass = smoothUnion(mass, ellipsoidLobe(p, vec3(1100.0, -600.0, u_cloudBaseM + u_cloudThicknessM * 0.53), vec3(900.0, 850.0, u_cloudThicknessM * 0.26) * size, broadNoise, scallopNoise, fineNoise), 0.12);
  mass = smoothUnion(mass, ellipsoidLobe(p, vec3(720.0, -780.0, u_cloudBaseM + u_cloudThicknessM * 0.81), vec3(640.0, 620.0, u_cloudThicknessM * 0.19) * size, broadNoise, scallopNoise, fineNoise), 0.10);
  mass = smoothUnion(mass, ellipsoidLobe(p, vec3(1740.0, -360.0, u_cloudBaseM + u_cloudThicknessM * 0.79), vec3(640.0, 620.0, u_cloudThicknessM * 0.20) * size, broadNoise, scallopNoise, fineNoise), 0.10);
  mass = smoothUnion(mass, ellipsoidLobe(p, vec3(2550.0, 1350.0, u_cloudBaseM + u_cloudThicknessM * 0.28), vec3(1650.0, 1750.0, u_cloudThicknessM * 0.23) * size, broadNoise, scallopNoise, fineNoise), 0.16);
  mass = smoothUnion(mass, ellipsoidLobe(p, vec3(2800.0, 1550.0, u_cloudBaseM + u_cloudThicknessM * 0.54), vec3(930.0, 940.0, u_cloudThicknessM * 0.27) * size, broadNoise, scallopNoise, fineNoise), 0.12);
  mass = smoothUnion(mass, ellipsoidLobe(p, vec3(2400.0, 1320.0, u_cloudBaseM + u_cloudThicknessM * 0.81), vec3(660.0, 660.0, u_cloudThicknessM * 0.19) * size, broadNoise, scallopNoise, fineNoise), 0.10);
  mass = smoothUnion(mass, ellipsoidLobe(p, vec3(3300.0, 1770.0, u_cloudBaseM + u_cloudThicknessM * 0.79), vec3(620.0, 620.0, u_cloudThicknessM * 0.18) * size, broadNoise, scallopNoise, fineNoise), 0.10);
  mass = smoothUnion(mass, ellipsoidLobe(p, vec3(-900.0, 3250.0, u_cloudBaseM + u_cloudThicknessM * 0.27), vec3(1750.0, 1350.0, u_cloudThicknessM * 0.24) * size, broadNoise, scallopNoise, fineNoise), 0.16);
  mass = smoothUnion(mass, ellipsoidLobe(p, vec3(-950.0, 3200.0, u_cloudBaseM + u_cloudThicknessM * 0.53), vec3(880.0, 900.0, u_cloudThicknessM * 0.27) * size, broadNoise, scallopNoise, fineNoise), 0.12);
  mass = smoothUnion(mass, ellipsoidLobe(p, vec3(-1390.0, 3060.0, u_cloudBaseM + u_cloudThicknessM * 0.80), vec3(620.0, 620.0, u_cloudThicknessM * 0.19) * size, broadNoise, scallopNoise, fineNoise), 0.10);
  mass = smoothUnion(mass, ellipsoidLobe(p, vec3(-450.0, 3500.0, u_cloudBaseM + u_cloudThicknessM * 0.81), vec3(610.0, 620.0, u_cloudThicknessM * 0.18) * size, broadNoise, scallopNoise, fineNoise), 0.10);

  // Remap the cloud envelope through the 3D shape field as the repository pipeline does:
  // the macro texture decides where mass survives, while fine erosion stays on the lit upper rim.
  float shapeThreshold = 1.0 - broadNoise * 0.72;
  float structuredMass = smoothstep(shapeThreshold - 0.10, shapeThreshold + 0.15, mass);
  float fineErosion = mix(0.035, 0.12, smoothstep(0.25, 0.9, height)) * (1.0 - fineNoise);
  float erodedMass = max(structuredMass - fineErosion, 0.0);
  float bottomFade = smoothstep(0.025, 0.14, height);
  float edge = max(abs(p.x), abs(p.y)) / HALF_EXTENT_M;
  float boundaryFade = 1.0 - smoothstep(0.84, 1.0, edge);
  return smoothstep(0.04, 0.34, erodedMass) * bottomFade * boundaryFade;
}

float sunOpticalDepth(vec3 position, vec3 sunEnu) {
  float enter;
  float leave;
  if (!intersectBox(position + sunEnu * 2.0, sunEnu, enter, leave)) return 0.0;
  float distance = min(max(leave, 0.0), 12000.0);
  if (distance <= 0.0) return 0.0;
  float opticalDepth = 0.0;
  for (int i = 0; i < SUN_STEPS; ++i) {
    float t0 = distance * pow(float(i) / float(SUN_STEPS), 2.0);
    float t1 = distance * pow(float(i + 1) / float(SUN_STEPS), 2.0);
    float segment = t1 - t0;
    vec3 samplePosition = position + sunEnu * (t0 + 0.5 * segment);
    opticalDepth += densityAt(samplePosition) * segment * EXTINCTION_PER_M;
  }
  return opticalDepth;
}

float henyeyGreenstein(float cosineTheta, float g) {
  float g2 = g * g;
  return (1.0 - g2) /
    (4.0 * czm_pi * pow(max(1.0 + g2 - 2.0 * g * cosineTheta, 0.001), 1.5));
}

void main() {
  vec4 original = texture(colorTexture, v_textureCoordinates);
  float rawDepth = texture(depthTexture, v_textureCoordinates).r;
  vec3 worldRay = reconstructWorldRay(v_textureCoordinates);
  vec3 enuOrigin = (u_worldToEnu * vec4(u_cameraPosition, 1.0)).xyz;
  vec3 enuRay = normalize((u_worldToEnu * vec4(worldRay, 0.0)).xyz);
  float enter;
  float leave;
  if (!intersectBox(enuOrigin, enuRay, enter, leave)) {
    out_FragColor = original;
    return;
  }
  float startDistance = max(enter, 0.0);
  float endDistance = min(leave, sceneDistance(v_textureCoordinates, rawDepth, worldRay));
  if (endDistance <= startDistance) {
    out_FragColor = original;
    return;
  }

  float segmentLength = endDistance - startDistance;
  float stepLength = segmentLength / float(u_viewSteps);
  vec3 sunWorld = normalize(czm_sunDirectionWC);
  vec3 sunEnu = normalize((u_worldToEnu * vec4(sunWorld, 0.0)).xyz);
  float sunElevation = max(dot(sunEnu, vec3(0.0, 0.0, 1.0)), 0.0);
  // enuRay points camera-to-sample and sunEnu points sample-to-sun, so their dot is HG cosine.
  float viewSun = dot(enuRay, sunEnu);
  float phase = mix(henyeyGreenstein(viewSun, -0.22), henyeyGreenstein(viewSun, 0.68), 0.72);
  float phaseRelative = clamp(phase / 0.07957747, 0.18, 7.0);
  vec3 sunColor = mix(vec3(1.0, 0.72, 0.48), vec3(1.0, 0.96, 0.86), smoothstep(0.0, 0.35, sunElevation));
  vec3 skyColor = mix(vec3(0.085, 0.12, 0.19), vec3(0.32, 0.43, 0.58), smoothstep(0.0, 0.7, sunElevation));
  float transmittance = 1.0;
  vec3 radiance = vec3(0.0);

  for (int i = 0; i < 256; ++i) {
    if (float(i) >= u_viewSteps || transmittance < 0.012) break;
    float distanceAlongRay = startDistance + (float(i) + 0.5) * stepLength;
    vec3 localPosition = enuOrigin + enuRay * distanceAlongRay;
    float density = densityAt(localPosition);
    if (density > 0.012) {
      float lightTransmittance = exp(-sunOpticalDepth(localPosition, sunEnu));
      float height = clamp((localPosition.z - u_cloudBaseM) / max(u_cloudThicknessM, 1.0), 0.0, 1.0);
      vec3 ambient = skyColor * mix(0.24, 0.46, height);
      float topLighting = mix(0.78, 1.32, smoothstep(0.34, 0.92, height));
      vec3 direct = sunColor * sunElevation * (0.24 + 0.52 * phaseRelative) * topLighting * lightTransmittance;
      vec3 groundBounce = vec3(0.16, 0.13, 0.10) * (1.0 - lightTransmittance) * (1.0 - height) * 0.18;
      vec3 lighting = ambient + direct + groundBounce;
      float alpha = 1.0 - exp(-density * stepLength * EXTINCTION_PER_M);
      radiance += transmittance * alpha * lighting;
      transmittance *= 1.0 - alpha;
    }
  }

  out_FragColor = vec4(radiance + original.rgb * transmittance, original.a);
}
