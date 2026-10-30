import * as Cesium from 'cesium'

interface GpuTexture {
  destroy(): void
  isDestroyed(): boolean
}
interface SkyCommand {
  shaderProgram: { destroy(): void }
  owner?: unknown
}
interface SkyContext {
  defaultTexture: GpuTexture
  createViewportQuadCommand(
    source: string,
    options: {
      owner: unknown
      uniformMap: Record<string, () => unknown>
      renderState: unknown
    },
  ): SkyCommand
}
interface SkyFrameState {
  context: SkyContext
  mode: number
  passes: {
    render: boolean
    pick?: boolean
    depth?: boolean
    offscreen?: boolean
  }
}
interface RendererApi {
  Texture: new (options: {
    context: SkyContext
    source: HTMLImageElement
    sampler: unknown
  }) => GpuTexture
  Sampler: new (options: {
    wrapS: number
    wrapT: number
    minificationFilter: number
    magnificationFilter: number
  }) => unknown
  RenderState: {
    fromCache(options: {
      depthMask: boolean
      depthTest: { enabled: boolean }
    }): unknown
  }
  TextureWrap: { REPEAT: number; CLAMP_TO_EDGE: number }
  TextureMinificationFilter: { LINEAR: number }
  TextureMagnificationFilter: { LINEAR: number }
}
const renderer = Cesium as unknown as RendererApi

export const panoramaSampling = `
vec3 environmentColor(sampler2D panorama, vec3 direction) {
  vec3 d = normalize(direction);
  vec2 uv = vec2(atan(d.z,d.x) / czm_twoPi + 0.5, asin(clamp(d.y,-1.0,1.0)) / czm_pi + 0.5);
  vec3 encoded = pow(texture(panorama, uv).rgb, vec3(2.2));
  return min(encoded / max(vec3(0.001), 1.0 - encoded), vec3(32.0));
}`

/** Cesium 1.132 skyBox protocol adapter; it draws only the background, never the pick/depth passes. */
export class PanoramaSky {
  show = true
  private command?: SkyCommand
  private texture?: GpuTexture
  private pendingImage?: HTMLImageElement
  private destroyed = false
  private hdr = true
  worldToEnvironment = Cesium.Matrix3.clone(Cesium.Matrix3.IDENTITY)
  constructor(private readonly exposure = () => 1) {}

  setImage(image: HTMLImageElement): void {
    if (!this.destroyed) this.pendingImage = image
  }

  update(frame: SkyFrameState, useHdr = true): SkyCommand | undefined {
    this.hdr = useHdr
    if (
      this.destroyed ||
      !this.show ||
      frame.mode !== Cesium.SceneMode.SCENE3D ||
      !frame.passes.render ||
      frame.passes.pick ||
      frame.passes.depth ||
      frame.passes.offscreen
    )
      return
    if (this.pendingImage) {
      const next = new renderer.Texture({
        context: frame.context,
        source: this.pendingImage,
        sampler: new renderer.Sampler({
          wrapS: renderer.TextureWrap.REPEAT,
          wrapT: renderer.TextureWrap.CLAMP_TO_EDGE,
          minificationFilter: renderer.TextureMinificationFilter.LINEAR,
          magnificationFilter: renderer.TextureMagnificationFilter.LINEAR,
        }),
      })
      this.texture?.destroy()
      this.texture = next
      this.pendingImage = undefined
    }
    if (!this.texture) return
    if (!this.command) {
      this.command = frame.context.createViewportQuadCommand(
        `
uniform sampler2D u_panorama;
uniform mat3 u_worldToEnvironment;
uniform float u_gain;
uniform bool u_hdr;
in vec2 v_textureCoordinates;
${panoramaSampling}
void main() {
  vec4 eye = czm_inverseProjection * vec4(v_textureCoordinates * 2.0 - 1.0, 1.0, 1.0);
  vec3 direction = u_worldToEnvironment * czm_inverseViewRotation * normalize(eye.xyz);
  vec3 color = environmentColor(u_panorama, direction) * u_gain;
  if (!u_hdr) color = pow(color / (1.0 + color), vec3(1.0 / 2.2));
  out_FragColor = vec4(color, 1.0);
}`,
        {
          owner: this,
          uniformMap: {
            u_panorama: () => this.texture ?? frame.context.defaultTexture,
            u_worldToEnvironment: () => this.worldToEnvironment,
            u_gain: this.exposure,
            u_hdr: () => this.hdr,
          },
          renderState: renderer.RenderState.fromCache({
            depthMask: false,
            depthTest: { enabled: false },
          }),
        },
      )
    }
    return this.command
  }

  isDestroyed(): boolean {
    return this.destroyed
  }
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.pendingImage = undefined
    this.command?.shaderProgram.destroy()
    this.texture?.destroy()
    this.command = undefined
    this.texture = undefined
  }
}
