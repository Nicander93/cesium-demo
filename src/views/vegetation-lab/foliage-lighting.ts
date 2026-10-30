import * as Cesium from 'cesium'

/** Thin-leaf approximation on top of PBR, restricted to the GLB's foliage vertices. */
export function createFoliageLighting(): Cesium.CustomShader {
  return new Cesium.CustomShader({
    mode: Cesium.CustomShaderMode.MODIFY_MATERIAL,
    lightingModel: Cesium.LightingModel.PBR,
    uniforms: { u_foliageStrength: { type: Cesium.UniformType.FLOAT, value: 1 } },
    fragmentShaderText: `
void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
    if (fsInput.attributes.foliage < 0.5 || u_foliageStrength <= 0.0) return;
    // The photographic pine atlas is substantially darker than the linear
    // vertex-coloured plants. Calibrate only that material, retaining its detail.
    if (fsInput.attributes.foliage > 1.5) {
        material.diffuse = min(material.diffuse * vec3(2.8, 3.024, 2.66), vec3(0.85));
    }
    vec3 normal = normalize(material.normalEC);
    float nDotL = dot(normal, normalize(czm_lightDirectionEC));
    float backLighting = max(-nDotL, 0.0);
    float wrapped = max((nDotL + 0.5) / 1.5, 0.0);
    float wrapFill = max(wrapped - max(nDotL, 0.0), 0.0);
    // No emission in the absence of incident direct light. The bounded term
    // represents unresolved leaf transmission; texture, PBR and normals remain.
    float fill = 0.10 + 0.42 * backLighting + 0.20 * wrapFill;
    material.emissive += material.diffuse * czm_lightColorHdr * fill * u_foliageStrength;
}
`,
  })
}
