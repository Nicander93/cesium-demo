import * as Cesium from 'cesium'

/** Surface coordinates are local ENU metres, shared by adjacent polygons. */
export function createCoastGroundAppearance({
  haze = false,
  sand = false,
}: { haze?: boolean; sand?: boolean } = {}): Cesium.PerInstanceColorAppearance {
  return new Cesium.PerInstanceColorAppearance({
    flat: false,
    closed: false,
    translucent: false,
    faceForward: true,
    vertexShaderSource: `
in vec3 position3DHigh;
in vec3 position3DLow;
in vec3 normal;
in vec2 st;
in vec4 color;
in float batchId;
out vec3 v_positionEC;
out vec3 v_normalEC;
out vec4 v_color;
out vec2 v_surfaceST;
void main() {
  vec4 p = czm_computePosition();
  v_positionEC = (czm_modelViewRelativeToEye * p).xyz;
  v_normalEC = czm_normal * normal;
  v_color = color;
  v_surfaceST = st;
  gl_Position = czm_modelViewProjectionRelativeToEye * p;
}`,
    fragmentShaderSource: `
${haze ? '#define DISTANT_GROUND' : ''}
${sand ? '#define BEACH_SAND' : ''}
in vec3 v_positionEC;
in vec3 v_normalEC;
in vec4 v_color;
in vec2 v_surfaceST;
float groundHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float groundNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(groundHash(i), groundHash(i + vec2(1,0)), f.x),
             mix(groundHash(i + vec2(0,1)), groundHash(i + vec2(1,1)), f.x), f.y);
}
void main() {
  vec3 normalEC = normalize(v_normalEC);
  normalEC = faceforward(normalEC, vec3(0,0,1), -normalEC);
  vec2 uv = v_surfaceST;
  float footprint = max(length(dFdx(uv)), length(dFdy(uv)));
  float fine = 1.0 - smoothstep(0.08, 0.45, footprint);
  float macro = groundNoise(uv * 0.065);
  float grain = (groundNoise(uv * 4.0) - 0.5) * fine;
  vec3 base = v_color.rgb;
#ifdef BEACH_SAND
  float coastY = clamp(uv.y, -1600.0, 1600.0);
  float coastX = 26.0 * sin(coastY / 510.0) + 0.00019 * coastY * coastY - 18.0;
  float dry = smoothstep(0.0, 11.0, coastX - uv.x);
  base *= mix(0.62, 1.0, dry) * (0.93 + macro * 0.10 + grain * 0.035);
#else
  float grass = step(base.r * 1.10, base.g) * step(base.b * 1.12, base.g);
  float paving = (1.0 - grass) * step(0.58, base.r);
  base *= mix(0.97 + grain * 0.035, 0.83 + macro * 0.23 + grain * 0.045, grass);
  vec2 tile = abs(fract(uv / 2.4) - 0.5);
  float edge = max(tile.x, tile.y);
  float line = smoothstep(0.475 - min(0.06, footprint * 0.3), 0.495, edge);
  float seams = paving * (1.0 - smoothstep(0.35, 1.3, footprint)) * line;
  base *= 1.0 - seams * 0.10;
#endif
  czm_materialInput materialInput;
  materialInput.normalEC = normalEC;
  materialInput.positionToEyeEC = -v_positionEC;
  czm_material material = czm_getDefaultMaterial(materialInput);
  material.diffuse = czm_gammaCorrect(vec4(base, 1.0)).rgb;
  material.alpha = 1.0;
  material.specular = 0.015;
  material.shininess = 5.0;
  out_FragColor = czm_phong(normalize(-v_positionEC), material, czm_lightDirectionEC);
#ifdef DISTANT_GROUND
  float warm = clamp((1.0 - czm_lightColor.b / max(czm_lightColor.r, 0.01)) * 2.0, 0.0, 1.0);
  vec3 hazeColor = mix(vec3(0.71,0.77,0.83), vec3(0.78,0.64,0.52), warm);
  float aerial = smoothstep(1200.0, 6500.0, length(v_positionEC)) * 0.985;
  out_FragColor.rgb = mix(out_FragColor.rgb, czm_gammaCorrect(vec4(hazeColor,1.0)).rgb, aerial);
#endif
}`,
  })
}
