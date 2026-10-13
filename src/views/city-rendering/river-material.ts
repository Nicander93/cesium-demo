import type * as Cesium from 'cesium'

/** City-specific shading; the shared WaterSurface still owns reflection and time. */
export function applyRiverMaterial(
  material: Cesium.Material,
  halfWidth: number,
  halfLength: number,
): void {
  const shader = material as unknown as { shaderSource: string }
  let source = shader.shaderSource
  const name = (uniform: string): string =>
    source.match(new RegExp(`\\b${uniform}(?:_\\d+)?\\b`))?.[0] ?? uniform
  const texture = name('normalTexture'),
    time = name('time')
  source = source.replace(
    /\(materialInput\.st \* 2\.0 - 1\.0\) \* size(?:_\d+)?/,
    `(materialInput.st * 2.0 - 1.0) * vec2(${halfWidth.toFixed(1)}, ${halfLength.toFixed(1)})`,
  )
  source = source.replace(
    /vec3 waterNormal\(vec2 uv\) \{[\s\S]*?\n\}/,
    `vec3 waterNormal(vec2 uv) {
    vec2 a = uv / 40.0 + vec2(${time} * 0.022, ${time} * 0.009);
    vec2 b = mat2(0.8, -0.6, 0.6, 0.8) * uv / 19.0 + vec2(-${time} * 0.013, ${time} * 0.019);
    vec2 c = uv / 8.0 + vec2(${time} * 0.031, -${time} * 0.024);
    vec3 n0 = texture(${texture}, fract(a)).xyz * 2.0 - 1.0;
    vec3 n1 = texture(${texture}, fract(b)).xyz * 2.0 - 1.0;
    vec3 n2 = texture(${texture}, fract(c)).xyz * 2.0 - 1.0;
    float footprint = max(length(dFdx(uv)), length(dFdy(uv)));
    vec2 slope = (n0.xy * 0.45 + mat2(0.8, 0.6, -0.6, 0.8) * n1.xy * 0.28 + n2.xy * 0.12)
      / (1.0 + footprint * 0.8);
    // Analytic gradients of three travelling height waves, in world metres.
    // Keep broad wave fronts independent of the scrolling fine normal map.
    vec2 d0 = normalize(vec2(0.28, 0.96));
    vec2 d1 = normalize(vec2(-0.62, 0.78));
    vec2 d2 = normalize(vec2(0.91, 0.41));
    float k0 = 6.28318530718 / 14.0;
    float k1 = 6.28318530718 / 7.0;
    float k2 = 6.28318530718 / 3.2;
    vec2 broad = d0 * (0.24 * k0) * cos(dot(uv, d0) * k0 + 0.4 * sin(dot(uv, vec2(-0.04, 0.07))) - ${time} * sqrt(9.81 * k0))
      + d1 * (0.045 * k1) * cos(dot(uv, d1) * k1 - ${time} * sqrt(9.81 * k1) + 1.7)
      + d2 * (0.018 * k2) * cos(dot(uv, d2) * k2 - ${time} * sqrt(9.81 * k2) + 3.1);
    slope -= broad / (1.0 + footprint * 0.16);
    return normalize(vec3(slope.x, 1.0, slope.y));
  }`,
  )
  const reflection = name('reflexTexture'),
    color = name('waterColor')
  source = source.replace(
    /vec3 reflected = .*?;/,
    `vec2 blur = vec2(0.0018);
    vec3 reflectionSample = (
      texture(${reflection}, clamp(reflectionUV + vec2(blur.x, 0.0), 0.001, 0.999)).rgb +
      texture(${reflection}, clamp(reflectionUV - vec2(blur.x, 0.0), 0.001, 0.999)).rgb +
      texture(${reflection}, clamp(reflectionUV + vec2(0.0, blur.y), 0.001, 0.999)).rgb +
      texture(${reflection}, clamp(reflectionUV - vec2(0.0, blur.y), 0.001, 0.999)).rgb) * 0.25;
    // The reflection pass renders to an LDR sRGB target; the city composes in HDR.
    vec3 reflected = mix(vec3(0.10, 0.18, 0.25), pow(max(reflectionSample, vec3(0.0)), vec3(2.2)), ${name('reflectionReady')} * inBounds);`,
  )
  source = source.replace(
    /material\.diffuse = .*?;/,
    `vec3 body = ${color}.rgb * (0.65 + diffuse * 0.3);
    vec3 waterLight = mix(body, reflected, fresnel) + vec3(1.0, 0.94, 0.82) * specular * 0.20;
    material.diffuse = vec3(0.0);
    material.emission = waterLight;`,
  )
  shader.shaderSource = source
}
