import * as Cesium from 'cesium'
import type { EnvironmentController } from './index'
import { panoramaSampling } from './sky'

export interface EnvironmentWaterOptions {
  color: string
  waveStrength: number
  waveScale: number
  waveSpeed: number
  reflection: number
  flow: number
}

/** A single-pass water surface reflecting the shared HDRI; it does not re-render the scene. */
export function createEnvironmentWater(
  environment: EnvironmentController,
  color: Cesium.Color,
  initial: Partial<EnvironmentWaterOptions> = {},
) {
  let settings: EnvironmentWaterOptions = {
    color: color.toCssHexString(),
    waveStrength: 1,
    waveScale: 1,
    waveSpeed: 1,
    reflection: 1,
    flow: 0,
  }
  const material = new Cesium.Material({
    fabric: {
      type: 'EnvironmentPanoramaWater',
      uniforms: {
        u_panorama: Cesium.Material.DefaultImageId,
        u_environmentEast: new Cesium.Cartesian3(1, 0, 0),
        u_environmentUp: new Cesium.Cartesian3(0, 1, 0),
        u_environmentSouth: new Cesium.Cartesian3(0, 0, 1),
        u_waterColor: color,
        u_time: 0,
        u_rain: 0,
        u_flow: 0,
        u_hdr: 1,
        u_waveStrength: 1,
        u_waveScale: 1,
        u_reflection: 1,
        u_skyIntensity: 1,
      },
      source: `
${panoramaSampling}
czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material result = czm_getDefaultMaterial(materialInput);
  vec2 p = materialInput.st * vec2(42.0,64.0) * u_waveScale;
  float time = u_time * 0.7;
  vec2 slope = vec2(sin(p.x * 2.1 + p.y * 0.7 + time), cos(p.y * 2.5 - p.x * 0.4 + time * 1.2));
  slope += vec2(sin(p.y * 7.0 + time * 2.0),cos(p.x * 6.0 - time * 1.7)) * (0.22 + u_rain * 0.22);
  vec3 normalEC = normalize(materialInput.normalEC + czm_viewRotation * (u_environmentEast * slope.x - u_environmentSouth * slope.y) * (0.004 + u_rain * 0.003) * u_waveStrength);
  vec3 view = normalize(materialInput.positionToEyeEC);
  vec3 reflection = czm_inverseViewRotation * reflect(-view,normalEC);
  vec3 reflectedSky = environmentColor(u_panorama,vec3(dot(u_environmentEast,reflection),dot(u_environmentUp,reflection),dot(u_environmentSouth,reflection)));
  float fresnel = 0.025 + 0.975 * pow(1.0-max(dot(normalEC,view),0.0),5.0);
  float crest = smoothstep(0.86,1.0,sin((p.y-p.x*0.18)*5.0-u_time*1.7));
  vec3 body = pow(u_waterColor.rgb,vec3(2.2)) * (0.7 + 0.3 * max(dot(normalEC,normalize(czm_lightDirectionEC)),0.0));
  result.diffuse = vec3(0.0);
  result.emission = mix(body,reflectedSky * u_skyIntensity,clamp(fresnel,0.04,0.94) * u_reflection) + vec3(0.18,0.16,0.12)*crest*u_flow*0.16;
  if (u_hdr < 0.5) result.emission = pow(result.emission / (1.0 + result.emission), vec3(1.0 / 2.2));
  result.normal = normalEC;
  result.specular = 0.5;
  result.shininess = 110.0;
  result.alpha = 1.0;
  return result;
}`,
    },
    translucent: false,
  })
  function update(time: number, flow = settings.flow): void {
    const lighting = environment.getLighting()
    if (lighting.panoramaUrl)
      material.uniforms.u_panorama = lighting.panoramaUrl
    Cesium.Matrix3.getRow(
      lighting.worldToEnvironment,
      0,
      material.uniforms.u_environmentEast,
    )
    Cesium.Matrix3.getRow(
      lighting.worldToEnvironment,
      1,
      material.uniforms.u_environmentUp,
    )
    Cesium.Matrix3.getRow(
      lighting.worldToEnvironment,
      2,
      material.uniforms.u_environmentSouth,
    )
    material.uniforms.u_skyIntensity = lighting.skyIntensity
    material.uniforms.u_time = time * settings.waveSpeed
    material.uniforms.u_rain = lighting.rain
    material.uniforms.u_hdr = lighting.highDynamicRange ? 1 : 0
    material.uniforms.u_flow = Number.isFinite(flow)
      ? Cesium.Math.clamp(flow, 0, 1)
      : settings.flow
  }
  function setOptions(next: Partial<EnvironmentWaterOptions>): void {
    const bound = (
      value: number | undefined,
      fallback: number,
      low: number,
      high: number,
    ) =>
      typeof value === 'number' && Number.isFinite(value)
        ? Cesium.Math.clamp(value, low, high)
        : fallback
    settings = {
      color:
        typeof next.color === 'string' && /^#[0-9a-f]{6}$/i.test(next.color)
          ? next.color
          : settings.color,
      waveStrength: bound(next.waveStrength, settings.waveStrength, 0, 4),
      waveScale: bound(next.waveScale, settings.waveScale, 0.25, 4),
      waveSpeed: bound(next.waveSpeed, settings.waveSpeed, 0, 4),
      reflection: bound(next.reflection, settings.reflection, 0, 1),
      flow: bound(next.flow, settings.flow, 0, 1),
    }
    Cesium.Color.fromCssColorString(
      settings.color,
      material.uniforms.u_waterColor,
    )
    material.uniforms.u_waveStrength = settings.waveStrength
    material.uniforms.u_waveScale = settings.waveScale
    material.uniforms.u_reflection = settings.reflection
  }
  setOptions(initial)
  return { material, update, setOptions }
}
