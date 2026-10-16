import * as Cesium from 'cesium'
import type { FloodFrame, FloodGrid } from '../core/dataset'
import { createDynamicTopology, DynamicFloodState } from './dynamic-state'

// Private Cesium 1.132 rendering access stays in this adapter; no GPU objects enter the public API.
const engine = Cesium as unknown as Record<string, any>
const vertexShader = `
in float cellIndex;
in vec3 triangleCells;
uniform sampler2D u_surfaceState;
uniform sampler2D u_foamState;
uniform vec2 u_gridSize;
uniform float u_cellSize;
uniform float u_foamSource;
out vec3 v_normalEC;
out vec3 v_positionEC;
out vec2 v_st;
out vec4 v_state;
out vec3 v_eastEC;
out vec3 v_northEC;
out vec3 v_upEC;
vec2 stateUV(float index) {
  return (vec2(mod(index,u_gridSize.x),floor(index/u_gridSize.x))+0.5)/u_gridSize;
}
float heightAt(vec2 cell) {
  return texture(u_surfaceState,(cell+0.5)/u_gridSize).r;
}
void main() {
  float wetTriangle=max(texture(u_foamState,stateUV(triangleCells.x)).b,
    max(texture(u_foamState,stateUV(triangleCells.y)).b,texture(u_foamState,stateUV(triangleCells.z)).b));
  // Every vertex of a triangle makes the same decision. Dry triangles produce no fragments.
  if(wetTriangle<0.5) { gl_Position=vec4(2.0,2.0,2.0,1.0); return; }
  vec2 cell=vec2(mod(cellIndex,u_gridSize.x),floor(cellIndex/u_gridSize.x));
  vec4 state=texture(u_surfaceState,stateUV(cellIndex));
  vec2 left=vec2(max(cell.x-1.0,0.0),cell.y),right=vec2(min(cell.x+1.0,u_gridSize.x-1.0),cell.y);
  vec2 bottom=vec2(cell.x,max(cell.y-1.0,0.0)),top=vec2(cell.x,min(cell.y+1.0,u_gridSize.y-1.0));
  float dx=(heightAt(right)-heightAt(left))/((right.x-left.x)*u_cellSize);
  float dy=(heightAt(top)-heightAt(bottom))/((top.y-bottom.y)*u_cellSize);
  vec3 normal=normalize(vec3(-dx,-dy,1.0));
  vec3 local=vec3((cell+0.5)*u_cellSize,state.r);
  v_st=local.xy;
  vec4 foam=texture(u_foamState,stateUV(cellIndex));
  v_state=vec4(state.gba,mix(foam.r,foam.g,u_foamSource));
  v_normalEC=czm_normal*normal;
  v_positionEC=(czm_modelView*vec4(local,1.0)).xyz;
  v_eastEC=czm_normal*vec3(1.0,0.0,0.0);
  v_northEC=czm_normal*vec3(0.0,1.0,0.0);
  v_upEC=czm_normal*vec3(0.0,0.0,1.0);
  gl_Position=czm_modelViewProjection*vec4(local,1.0);
}`

interface SurfaceStyle {
  fragment: string
  translucent: boolean
  foamSource: boolean
}

export class DynamicFloodSurface {
  private readonly state: DynamicFloodState
  private readonly vertices: Float32Array
  private readonly gridSize: Cesium.Cartesian2
  private readonly boundingSphere = new Cesium.BoundingSphere()
  private readonly localSphere = new Cesium.BoundingSphere()
  private vertexBuffer: any
  private vertexArray: any
  private surfaceTexture: any
  private foamTexture: any
  private program: any
  private command: any
  private style: SurfaceStyle | undefined
  private programStyle = ''
  private dirty = false
  private destroyed = false
  private error: string | null = null
  private queued = 0
  private uploads = 0
  private texturesCreated = 0
  private geometryCreated = 0
  private shaderChanges = 0
  private commands = 0
  private bytes = 0
  show = true

  constructor(
    private readonly scene: Cesium.Scene,
    private readonly grid: FloodGrid,
    private readonly modelMatrix: Cesium.Matrix4,
    private readonly material: Cesium.Material,
    private readonly onFailure: (error: unknown) => void,
  ) {
    this.state = new DynamicFloodState(grid)
    this.vertices = createDynamicTopology(grid)
    this.gridSize = new Cesium.Cartesian2(grid.columns, grid.rows)
    const version = engine.VERSION
    if (typeof version !== 'string' || !/^1\.132(?:\.|$)/.test(version))
      throw new Error('GPU 洪水适配仅验证 Cesium 1.132')
    const context = (scene as unknown as { context: any }).context,
      gl = context?._gl
    if (
      !context?.webgl2 ||
      !context.floatingPointTexture ||
      !gl ||
      gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) < 2
    )
      throw new Error('GPU 洪水需要 WebGL2、浮点纹理和顶点纹理采样')
    if (
      Math.max(grid.columns, grid.rows) > gl.getParameter(gl.MAX_TEXTURE_SIZE)
    )
      throw new Error('网格超过 GPU 纹理尺寸限制')
    if (
      !engine.Buffer ||
      !engine.DrawCommand ||
      !engine.VertexArray ||
      !engine.Texture
    )
      throw new Error('Cesium 渲染适配能力缺失')
  }

  setFrame(
    frame: FloodFrame,
    coverage: ArrayLike<number>,
    sources: ArrayLike<number>,
    style: SurfaceStyle,
  ): void {
    if (this.destroyed) throw new Error('GPU 洪水水面已销毁')
    this.state.update(frame, coverage, sources)
    this.style = style
    this.dirty = true
    this.queued++
    const width = (this.grid.columns - 1) * this.grid.cellSize,
      height = (this.grid.rows - 1) * this.grid.cellSize
    this.localSphere.center = new Cesium.Cartesian3(
      (this.grid.columns * this.grid.cellSize) / 2,
      (this.grid.rows * this.grid.cellSize) / 2,
      (this.state.minimumHeight + this.state.maximumHeight) / 2,
    )
    this.localSphere.radius =
      Math.hypot(
        width,
        height,
        this.state.maximumHeight - this.state.minimumHeight,
      ) /
        2 +
      0.1
    Cesium.BoundingSphere.transform(
      this.localSphere,
      this.modelMatrix,
      this.boundingSphere,
    )
    this.scene.requestRender()
  }

  update(frameState: any): void {
    if (
      this.destroyed ||
      this.error ||
      !this.show ||
      !this.style ||
      !frameState.passes.render
    )
      return
    try {
      if (frameState.mode !== Cesium.SceneMode.SCENE3D)
        throw new Error('GPU 洪水暂只支持三维场景')
      const context = frameState.context
      if (!this.vertexArray) this.initialize(context)
      if (this.dirty) {
        this.surfaceTexture.copyFrom({
          source: {
            width: this.grid.columns,
            height: this.grid.rows,
            arrayBufferView: this.state.surface,
          },
        })
        this.foamTexture.copyFrom({
          source: {
            width: this.grid.columns,
            height: this.grid.rows,
            arrayBufferView: this.state.foam,
          },
        })
        this.uploads++
        this.bytes += this.state.surface.byteLength + this.state.foam.byteLength
        this.dirty = false
      }
      ;(
        this.material as unknown as { update: (context: unknown) => void }
      ).update(context)
      const key = this.style.fragment + '\n' + this.style.translucent
      if (key !== this.programStyle) {
        const previous = this.program
        const next = engine.ShaderProgram.fromCache({
          context,
          vertexShaderSource: vertexShader,
          fragmentShaderSource:
            this.material.shaderSource + '\n' + this.style.fragment,
          attributeLocations: { cellIndex: 0, triangleCells: 1 },
        })
        try {
          void next.vertexAttributes
        } catch (error) {
          next.destroy()
          throw error
        }
        this.program = next
        previous?.destroy()
        this.programStyle = key
        this.shaderChanges++
        this.command.shaderProgram = this.program
        this.command.pass = this.style.translucent
          ? engine.Pass.TRANSLUCENT
          : engine.Pass.OPAQUE
        this.command.renderState = engine.RenderState.fromCache({
          depthTest: { enabled: true },
          depthMask: !this.style.translucent,
          cull: { enabled: false },
          blending: this.style.translucent
            ? Cesium.BlendingState.ALPHA_BLEND
            : Cesium.BlendingState.DISABLED,
        })
      }
      if (this.vertices.length) {
        frameState.commandList.push(this.command)
        this.commands++
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
      this.onFailure(error)
    }
  }

  private initialize(context: any): void {
    // Texture contents are uploaded once below; a zero frame does not create a second set of targets.
    const options = {
      context,
      width: this.grid.columns,
      height: this.grid.rows,
      pixelFormat: Cesium.PixelFormat.RGBA,
      pixelDatatype: Cesium.PixelDatatype.FLOAT,
      flipY: false,
      sampler: new engine.Sampler({
        minificationFilter: Cesium.TextureMinificationFilter.NEAREST,
        magnificationFilter: Cesium.TextureMagnificationFilter.NEAREST,
      }),
    }
    this.surfaceTexture = new engine.Texture(options)
    this.texturesCreated++
    this.foamTexture = new engine.Texture(options)
    this.texturesCreated++
    this.vertexBuffer = engine.Buffer.createVertexBuffer({
      context,
      typedArray: this.vertices.length ? this.vertices : new Float32Array(4),
      usage: engine.BufferUsage.STATIC_DRAW,
    })
    this.vertexArray = new engine.VertexArray({
      context,
      attributes: [
        {
          index: 0,
          vertexBuffer: this.vertexBuffer,
          componentsPerAttribute: 1,
          componentDatatype: Cesium.ComponentDatatype.FLOAT,
          offsetInBytes: 0,
          strideInBytes: 16,
        },
        {
          index: 1,
          vertexBuffer: this.vertexBuffer,
          componentsPerAttribute: 3,
          componentDatatype: Cesium.ComponentDatatype.FLOAT,
          offsetInBytes: 4,
          strideInBytes: 16,
        },
      ],
    })
    this.geometryCreated++
    this.command = new engine.DrawCommand({
      owner: this,
      vertexArray: this.vertexArray,
      count: this.vertices.length / 4,
      primitiveType: Cesium.PrimitiveType.TRIANGLES,
      modelMatrix: this.modelMatrix,
      boundingVolume: this.boundingSphere,
      uniformMap: {
        ...(this.material as unknown as { _uniforms: Record<string, unknown> })
          ._uniforms,
        u_surfaceState: () => this.surfaceTexture,
        u_foamState: () => this.foamTexture,
        u_gridSize: () => this.gridSize,
        u_cellSize: () => this.grid.cellSize,
        u_foamSource: () => (this.style?.foamSource ? 1 : 0),
      },
    })
  }

  getShaderSource(): string | undefined {
    return this.program?._fragmentShaderText
  }
  getDiagnostics() {
    return {
      ready: !!this.command && !this.error,
      geometryCreated: this.geometryCreated,
      texturesCreated: this.texturesCreated,
      textureUploads: this.uploads,
      framesQueued: this.queued,
      bytesUploaded: this.bytes,
      shaderChanges: this.shaderChanges,
      commandsSubmitted: this.commands,
      triangles: this.vertices.length / 12,
      frameTime: this.state.time,
      error: this.error,
    }
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    for (const resource of [
      this.program,
      this.vertexArray,
      this.vertexBuffer,
      this.surfaceTexture,
      this.foamTexture,
    ])
      if (resource && !resource.isDestroyed()) resource.destroy()
    this.command =
      this.program =
      this.vertexArray =
      this.vertexBuffer =
      this.surfaceTexture =
      this.foamTexture =
        undefined
  }
}
