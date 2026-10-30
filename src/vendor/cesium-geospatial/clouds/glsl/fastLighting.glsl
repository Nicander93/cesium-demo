// Integrate a height-exponential profile along a linear endpoint-height model.
float cloudHeightDensityIntegral(float distance, float height0, float height1, float scaleHeight) {
  float low = max(0.0, min(height0, height1));
  float difference = abs(max(height0, 0.0) - max(height1, 0.0));
  float averageDensity = difference < 1.0
    ? exp(-(max(height0, 0.0) + max(height1, 0.0)) * 0.5 / scaleHeight)
    : exp(-low / scaleHeight) * (1.0 - exp(-difference / scaleHeight)) * scaleHeight / difference;
  return max(distance, 0.0) * averageDensity;
}

vec3 cloudAerialTransmittance(float distance, float cameraHeight, float cloudHeight) {
  float rayleigh = cloudHeightDensityIntegral(distance, cameraHeight, cloudHeight, 8000.0);
  float mie = cloudHeightDensityIntegral(distance, cameraHeight, cloudHeight, 1200.0);
  vec3 opticalDepth = vec3(5.8e-6, 13.5e-6, 33.1e-6) * rayleigh + vec3(4.44e-6) * mie;
  return exp(-min(opticalDepth, vec3(50.0)));
}

