import * as Cesium from 'cesium'

/** The cloud buffer contains premultiplied radiance and cloud opacity only. */
export function createCloudComposite(cloudStage) {
  const merge = new Cesium.PostProcessStage({
    name: `${cloudStage.name}FullResolutionMerge`,
    textureScale: 1,
    pixelFormat: Cesium.PixelFormat.RGBA,
    pixelDatatype: cloudStage.pixelDatatype,
    sampleMode: Cesium.PostProcessStageSampleMode.LINEAR,
    fragmentShader: `uniform sampler2D colorTexture;
      uniform sampler2D cloudTexture;
      in vec2 v_textureCoordinates;
      void main() {
        vec4 sceneColor = texture(colorTexture, v_textureCoordinates);
        vec4 cloudColor = texture(cloudTexture, v_textureCoordinates);
        out_FragColor = vec4(
          sceneColor.rgb * (1.0 - cloudColor.a) + cloudColor.rgb,
          sceneColor.a
        );
      }`,
    uniforms: { cloudTexture: cloudStage.name },
  })
  return new Cesium.PostProcessStageComposite({
    name: `${cloudStage.name}Composite`,
    stages: [cloudStage, merge],
    // Both stages see the original full-resolution scene. The merge samples
    // the low-resolution cloud output explicitly via its stage name.
    inputPreviousStageTexture: false,
  })
}
