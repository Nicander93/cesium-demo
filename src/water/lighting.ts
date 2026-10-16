// GGX/Smith dielectric surface reflection. References and approximations: LIGHTING.md.
export const microfacetLighting = `
uniform float microfacetEnabled;
uniform float indexOfRefraction;
uniform float environmentIntensity;
uniform samplerCube waterEnvironmentMap;
uniform float waterEnvironmentReady;
uniform float waterEnvironmentMaxLod;
uniform float waterBrdfReady;
uniform sampler2D waterBrdfLut;
uniform float lightingDebug;
uniform vec3 waterSH0;
uniform vec3 waterSH1;
uniform vec3 waterSH2;
uniform vec3 waterSH3;
uniform vec3 waterSH4;
uniform vec3 waterSH5;
uniform vec3 waterSH6;
uniform vec3 waterSH7;
uniform vec3 waterSH8;

vec3 waterLinear(vec3 c) {
  return mix(c / 12.92, pow((max(c, vec3(0.0)) + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 waterDisplay(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(vec3(0.0031308), c));
}
float waterFresnel(float f0, float cosine) {
  if (f0 <= 0.0) return 0.0;
  return f0 + (1.0-f0)*pow(1.0-clamp(cosine,0.0,1.0),5.0);
}
vec3 waterDirect(vec3 N, vec3 V, vec3 L, float alpha, float f0) {
  float nv=max(dot(N,V),0.0), nl=max(dot(N,L),0.0);
  if (nv<=0.0 || nl<=0.0) return vec3(0.0);
  vec3 H=normalize(V+L);
  float nh=max(dot(N,H),0.0), vh=max(dot(V,H),0.0), a2=alpha*alpha;
  float denominator=nh*nh*(a2-1.0)+1.0;
  float D=a2 / max(3.14159265359*denominator*denominator,0.00000000000001);
  float visibility=0.5/max(nl*sqrt(nv*nv*(1.0-a2)+a2)+nv*sqrt(nl*nl*(1.0-a2)+a2),0.000001);
  // BRDF * NdotL; incident light comes from the host, never from reflected scene color.
  return czm_lightColorHdr * (D*visibility*nl*waterFresnel(f0,vh)) * specularIntensity;
}
vec3 waterMicrofacet(vec3 N, vec3 V, vec3 localLight, vec3 sceneReflection, float coverage, float surfaceRoughness) {
  float nv=clamp(dot(N,V),0.0,1.0);
  float f0=pow((indexOfRefraction-1.0)/(indexOfRefraction+1.0),2.0);
  float alpha=max(surfaceRoughness*surfaceRoughness,0.0025);
  vec3 direct=waterDirect(N,V,localLight,alpha,f0);
  vec3 R=reflect(-V,N);
  vec3 sky=waterLinear(environmentColor.rgb);
  vec3 irradiance=sky;
  if (waterEnvironmentReady>0.5) {
    // Cesium's generated cubemap uses the same E,Up,-North frame as the water normal.
    // Its mip convolution parameter is alpha; see ConvolveSpecularMapFS.glsl.
    sky=czm_textureCube(waterEnvironmentMap,R,alpha*waterEnvironmentMaxLod).rgb;
    vec3 coefficients[9];
    coefficients[0]=waterSH0;coefficients[1]=waterSH1;coefficients[2]=waterSH2;
    coefficients[3]=waterSH3;coefficients[4]=waterSH4;coefficients[5]=waterSH5;
    coefficients[6]=waterSH6;coefficients[7]=waterSH7;coefficients[8]=waterSH8;
    irradiance=czm_sphericalHarmonics(N,coefficients);
  }
  // Planar LDR reflection replaces the environment sample where available; it is not added twice.
  vec3 reflected=mix(sky,waterLinear(sceneReflection),coverage);
  float envWeight=waterFresnel(f0,nv);
  if (waterBrdfReady>0.5) {
    vec2 dfg=texture(waterBrdfLut,vec2(max(nv,0.0001),surfaceRoughness)).rg;
    envWeight=clamp(f0*dfg.x+dfg.y,0.0,1.0);
  }
  if (indexOfRefraction <= 1.0) envWeight=0.0;
  vec3 indirect=reflected*envWeight*environmentIntensity*reflectionStrength;
  // Tinted body is an explicit diffuse proxy until underwater depth/color are available.
  vec3 body=waterLinear(waterColor.rgb)*(1.0-envWeight)*max(irradiance,vec3(0.0))*environmentIntensity;
  vec3 result=direct+indirect+body;
  if (lightingDebug>0.5 && lightingDebug<1.5) result=direct;
  else if (lightingDebug<2.5 && lightingDebug>1.5) result=indirect;
  else if (lightingDebug<3.5 && lightingDebug>2.5) result=vec3(coverage);
  else if (lightingDebug<4.5 && lightingDebug>3.5) result=vec3(envWeight);
  else if (lightingDebug>4.5) result=body;
  return result;
}
`
