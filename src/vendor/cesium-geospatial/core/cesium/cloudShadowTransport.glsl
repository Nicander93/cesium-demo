// Attenuate only the estimated direct-light fraction of an already lit scene.
// The sky term survives cloud shadow; no incident light means an identity ratio.
vec3 getCloudShadowRatio(vec3 sunIrradiance, vec3 skyIrradiance,
  float sunTransmittance, float strength) {
  vec3 direct = max(sunIrradiance, vec3(0.0));
  vec3 total = direct + max(skyIrradiance, vec3(0.0));
  vec3 directFraction = direct / max(total, vec3(1e-6));
  return vec3(1.0) - directFraction * (1.0 - clamp(sunTransmittance, 0.0, 1.0))
    * clamp(strength, 0.0, 1.0);
}
