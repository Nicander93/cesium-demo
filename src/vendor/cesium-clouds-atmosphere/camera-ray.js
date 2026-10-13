import * as Cesium from "cesium";

// Sky directions must not depend on Cesium's last geometry frustum or an offscreen viewport.
export const cameraRayShader = /* glsl */ `
uniform mat4 u_rayInverseProjection;
uniform mat4 u_rayInverseView;
vec3 getCameraRay(vec2 uv) {
  vec4 eye = u_rayInverseProjection * vec4(uv * 2.0 - 1.0, 0.0, 1.0);
  return normalize((u_rayInverseView * vec4(normalize(eye.xyz), 0.0)).xyz);
}
vec4 getSceneEyePosition(vec2 uv, float rawDepth) {
  // This entry name also triggers Cesium's built-in dependency injection.
  return czm_windowToEyeCoordinates(czm_viewport.xy + uv * czm_viewport.zw, rawDepth);
}
`;

export function createCameraRayUniforms(viewer) {
  const inverseProjection = new Cesium.Matrix4();
  return {
    u_rayInverseProjection: () => Cesium.Matrix4.inverse(viewer.camera.frustum.projectionMatrix, inverseProjection),
    u_rayInverseView: () => viewer.camera.inverseViewMatrix,
  };
}
