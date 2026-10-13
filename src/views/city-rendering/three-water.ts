import * as THREE from 'three'
import { Reflector } from 'three/addons/objects/Reflector.js'

export function createThreeWater(
  width: number,
  length: number,
  normals: THREE.Texture,
) {
  const surface = new Reflector(new THREE.PlaneGeometry(width, length), {
    textureWidth: 1024,
    textureHeight: 1024,
    multisample: 0,
    color: '#155767',
    shader: {
      name: 'CityRiver',
      uniforms: {
        color: { value: new THREE.Color('#155767') },
        tDiffuse: { value: null },
        textureMatrix: { value: new THREE.Matrix4() },
        normalMap: { value: normals },
        time: { value: 0 },
        sunDirection: { value: new THREE.Vector3(0, 1, 0) },
      },
      vertexShader: `uniform mat4 textureMatrix;
        varying vec4 vMirror;
        varying vec3 vWorld;
        void main() {
          vMirror = textureMatrix * vec4(position, 1.0);
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `uniform vec3 color;
        uniform sampler2D tDiffuse;
        uniform sampler2D normalMap;
        uniform float time;
        uniform vec3 sunDirection;
        varying vec4 vMirror;
        varying vec3 vWorld;
        void main() {
          vec2 uv = vWorld.xz / 28.0;
          vec3 wave = (texture2D(normalMap, uv + vec2(time * .025, time * .018)).xyz
            + texture2D(normalMap, uv * .73 + vec2(-time * .014, time * .021)).xyz) - 1.0;
          vec3 n = normalize(wave.xzy);
          vec3 eye = normalize(cameraPosition - vWorld);
          vec2 mirrorUv = vMirror.xy / vMirror.w + n.xz * .003;
          vec3 reflected = texture2D(tDiffuse, clamp(mirrorUv, .001, .999)).rgb;
          float fresnel = .04 + .96 * pow(1.0 - max(dot(n, eye), 0.0), 5.0);
          float specular = pow(max(dot(reflect(-sunDirection, n), eye), 0.0), 100.0);
          gl_FragColor = vec4(mix(color * (.7 + .3 * max(dot(n, sunDirection), 0.0)), reflected, fresnel) + specular * .25, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    },
  })
  surface.rotation.x = -Math.PI / 2
  return { surface, material: surface.material as THREE.ShaderMaterial }
}
