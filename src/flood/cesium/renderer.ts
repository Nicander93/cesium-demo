import * as Cesium from 'cesium'
import { createDataset, parseFloodDataset, type FloodFrame, type FloodGrid } from '../core/dataset'
import { DynamicFloodSurface } from './dynamic-surface'
import { validateRenderFrame } from './dynamic-state'
import type { FloodBarriers, FloodOutlet } from '../core/hydraulics'
import { getBreachFace, validateDamBreachState, type DamBreachState } from '../core/breach'
import type { InundationResult } from '../core/analysis'
import { sampleWallOverfalls } from '../core/overfall'
import { detailedWaterBody, waterShaderFunctions } from './water-shader'
import { FloodFoam, resolveFloodVisualOptions, type FloodVisualOptions } from './foam'
import { FlowParticles } from './flow-particles'
import { createFloodSurfaceState } from './surface-state'

function vertexShader(modelMatrix: Cesium.Matrix4): string {
  // Primitive may bake modelMatrix into world-space geometry and render with identity.
  // Keep local ENU directions explicit instead of relying on its command's model matrix.
  const axis = (offset: number) => 'vec3(' + [0, 1, 2].map(i => modelMatrix[offset + i].toExponential(16)).join(',') + ')'
  return `
in vec3 position3DHigh;
in vec3 position3DLow;
in vec3 normal;
in vec2 st;
in vec4 color;
in float batchId;
out vec3 v_normalEC;
out vec3 v_positionEC;
out vec2 v_st;
out vec4 v_state;
out vec3 v_eastEC;
out vec3 v_northEC;
out vec3 v_upEC;
void main() {
  vec4 p = czm_computePosition();
  v_normalEC = czm_normal * normal;
  v_positionEC = (czm_modelViewRelativeToEye * p).xyz;
  v_st = st;
  v_state = color;
  v_eastEC = czm_viewRotation * ${axis(0)};
  v_northEC = czm_viewRotation * ${axis(4)};
  v_upEC = czm_viewRotation * ${axis(8)};
  gl_Position = czm_modelViewProjectionRelativeToEye * p;
}`
}

function fragmentShader(water: boolean, depthMode: boolean, detail: boolean, minimumDepth = 0.02): string {
  const discard = `float shoreCoverage = smoothstep(${minimumDepth.toFixed(6)} - max(fwidth(h), 0.001), ${minimumDepth.toFixed(6)} + max(fwidth(h), 0.001), h);
    if (shoreCoverage <= 0.001) discard;
    h = max(h, 0.0);`
  return `
in vec3 v_normalEC;
in vec3 v_positionEC;
in vec2 v_st;
in vec4 v_state;
in vec3 v_eastEC;
in vec3 v_northEC;
in vec3 v_upEC;
${water && detail ? waterShaderFunctions : ''}
void main() {
  vec3 n = normalize(v_normalEC);
  ${water ? detail ? `${detailedWaterBody.replace('if (h < 0.02) discard;', discard)}
  float diagnostic = floodDiagnosticMode();
  if (diagnostic > 0.5) {
    float value = diagnostic < 1.5 ? length(v_state.gb) / 4.0 : diagnostic < 2.5 ? v_state.a / 0.42 : v_state.a;
    rgb = mix(vec3(0.025, 0.18, 0.28), vec3(0.95, 0.65, 0.20), clamp(value, 0.0, 1.0));
    alpha = 1.0;
  }
  ${depthMode ? 'rgb = mix(vec3(0.22, 0.78, 0.9), vec3(0.75, 0.22, 0.12), clamp(h / 5.0, 0.0, 1.0));' : ''}
  out_FragColor = vec4(rgb, ${depthMode ? '1.0' : 'alpha * shoreCoverage'});
  ` : `
  float h = v_state.r;
  ${discard}
  vec2 velocity = v_state.gb;
  float time = floodVisualTime();
  vec2 p = v_st - velocity * time;
  float wave = sin(p.x * 0.33 + p.y * 0.17) * sin(p.y * 0.52 - time * 1.1);
  float speed = length(velocity);
  vec3 view = normalize(-v_positionEC);
  float fresnel = pow(1.0 - abs(dot(view, n)), 4.0);
  vec3 deep = mix(vec3(0.07, 0.48, 0.55), vec3(0.025, 0.15, 0.27), clamp(h / 4.0, 0.0, 1.0));
  vec3 rgb = mix(deep, vec3(0.62, 0.78, 0.82), fresnel * 0.7);
  float spec = pow(max(dot(reflect(-normalize(czm_lightDirectionEC), n), view), 0.0), 70.0);
  float streak = pow(max(0.0, wave), 10.0) * clamp(speed / 3.0, 0.0, 0.6);
  rgb += vec3(0.04 * wave + 0.3 * spec + 0.2 * streak);
  ${depthMode ? 'rgb = mix(vec3(0.22, 0.78, 0.9), vec3(0.75, 0.22, 0.12), clamp(h / 5.0, 0.0, 1.0));' : ''}
  out_FragColor = vec4(rgb, 1.0);
  ` : `
  float light = 0.45 + 0.55 * max(0.0, dot(n, normalize(czm_lightDirectionEC)));
  float contour = smoothstep(0.94, 1.0, cos(v_state.r * 3.14159));
  out_FragColor = vec4(v_state.gba * light * (1.0 - contour * 0.18), 1.0);
  `}
}`
}

export type FloodSurfaceBackend = 'primitive' | 'gpu'

export interface FloodSurfaceDiagnostics {
  requestedBackend: FloodSurfaceBackend
  surfaceBackend: FloodSurfaceBackend
  fallbackReason: string | null
  surfaceUpdates: number
  legacyMeshBuilds: number
  ready: boolean
  geometryCreated: number
  texturesCreated: number
  textureUploads: number
  framesQueued: number
  bytesUploaded: number
  shaderChanges: number
  commandsSubmitted: number
  triangles: number
  frameTime: number
  error: string | null
}

export type FloodDiagnosticMode = 'water' | 'velocity' | 'foam-source' | 'foam'
const diagnosticModes: FloodDiagnosticMode[] = ['water', 'velocity', 'foam-source', 'foam']

export class FloodRenderer {
  private readonly scene: Cesium.Scene
  private dynamicSurface: DynamicFloodSurface | undefined
  private surfaceError: string | null = null
  private surfaceUpdates = 0
  private legacyMeshBuilds = 0
  private legacyPrimitivesCreated = 0
  private lastSurface: { frame: FloodFrame; depthMode: boolean; detail: boolean } | undefined
  private diagnosticMode: FloodDiagnosticMode = 'water'
  private destroyed = false
  private terrain: Cesium.Primitive | undefined
  private water: Cesium.Primitive | undefined
  private overfall: Cesium.Primitive | undefined
  private readonly modelMatrix: Cesium.Matrix4
  private readonly walls: Cesium.Entity[] = []
  private readonly wallSections: { row: number; column: number; bottom: number; crest: number; entity: Cesium.Entity; right?: Cesium.Entity; base?: Cesium.Entity }[] = []
  private breachState: DamBreachState | undefined
  private readonly foam: FloodFoam
  private readonly flowParticles: FlowParticles
  private readonly points: Cesium.PointPrimitiveCollection
  private readonly pointPool: { point: Cesium.PointPrimitive; position: Cesium.Cartesian3; color: Cesium.Color }[] = []
  private lastVisualTime: number | undefined
  private visualWater = false
  private visualOptions = resolveFloodVisualOptions({})
  private readonly waterMaterial = new Cesium.Material({ fabric: {
    type: 'FloodSurfaceClock', uniforms: { visualTime: 0, flowEnabled: 1, foamOpacity: 0.75, diagnosticMode: 0, surfaceStyle: 0 },
    source: `float floodVisualTime() { return visualTime; }
      float floodFlowEnabled() { return flowEnabled; }
      float floodFoamOpacity() { return foamOpacity; }
      float floodDiagnosticMode() { return diagnosticMode; }
      float floodSurfaceStyle() { return surfaceStyle; }
      czm_material czm_getMaterial(czm_materialInput inputValue) { return czm_getDefaultMaterial(inputValue); }`,
  } })

  constructor(private readonly viewer: Cesium.Viewer, readonly grid: FloodGrid, private readonly barriers?: FloodBarriers, showGround = true, visuals: FloodVisualOptions = {}, private surfaceBackend: FloodSurfaceBackend = 'primitive') {
    if (surfaceBackend !== 'primitive' && surfaceBackend !== 'gpu') throw new RangeError('未知洪水水面后端')
    const count = grid.columns * grid.rows
    if (!Number.isInteger(count) || count < 4 || count > 20000) throw new RangeError('渲染网格大小无效')
    const valid = parseFloodDataset(createDataset(grid, [{ time: 0, depth: new Array<number>(count).fill(0) }])).grid
    this.grid = grid = { ...valid, ...(valid.active ? { active: valid.active.slice() } : {}) }
    this.scene = viewer.scene
    this.foam = new FloodFoam(grid, barriers)
    this.flowParticles = new FlowParticles(grid, barriers)
    this.modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(...grid.origin))
    // Keep Cesium's two-pass mode so translucent flecks share the water's OIT pass.
    this.points = new Cesium.PointPrimitiveCollection({ modelMatrix: this.modelMatrix })
    for (let i = 0; i < this.flowParticles.particles.length; i++) {
      const position = new Cesium.Cartesian3()
      const color = new Cesium.Color(0.9, 0.96, 0.94, 0)
      this.pointPool.push({ point: this.points.add({ position, color, show: false, pixelSize: 1.8 + (i % 4) * 0.4, outlineWidth: 0 }), position, color })
    }
    viewer.scene.primitives.add(this.points)
    this.setVisualOptions(visuals)
    if (showGround) {
      this.terrain = this.createMesh(undefined, false)
      viewer.scene.primitives.add(this.terrain)
    }
    if (barriers) {
      for (let y = 1; y < grid.rows; y++) for (let x = 0; x < grid.columns; x++) {
        const i = y * grid.columns + x
        const crest = barriers.north[i]
        if (crest === null || crest === undefined) continue
        const bottom = Math.min(grid.elevation[i], grid.elevation[i - grid.columns])
        const position = Cesium.Matrix4.multiplyByPoint(this.modelMatrix, new Cesium.Cartesian3((x + 0.5) * grid.cellSize, y * grid.cellSize, (bottom + crest) / 2), new Cesium.Cartesian3())
        const entity = viewer.entities.add({ position,
          orientation: Cesium.Transforms.headingPitchRollQuaternion(Cesium.Cartesian3.fromDegrees(...grid.origin), new Cesium.HeadingPitchRoll()),
          box: { dimensions: new Cesium.Cartesian3(grid.cellSize, grid.cellSize, Math.max(0.05, crest - bottom)), material: Cesium.Color.fromCssColorString('#cfad76') },
        })
        this.walls.push(entity)
        this.wallSections.push({ row: y, column: x, bottom, crest, entity })
      }
      for (let y = 0; y < grid.rows; y++) for (let x = 1; x < grid.columns; x++) {
        const crest = barriers.east[y * (grid.columns + 1) + x]
        if (crest == null) continue
        const i = y * grid.columns + x
        const bottom = Math.min(grid.elevation[i], grid.elevation[i - 1])
        const position = Cesium.Matrix4.multiplyByPoint(this.modelMatrix,
          new Cesium.Cartesian3(x * grid.cellSize, (y + .5) * grid.cellSize, (bottom + crest) / 2), new Cesium.Cartesian3())
        this.walls.push(viewer.entities.add({ position,
          orientation: Cesium.Transforms.headingPitchRollQuaternion(Cesium.Cartesian3.fromDegrees(...grid.origin), new Cesium.HeadingPitchRoll()),
          box: { dimensions: new Cesium.Cartesian3(grid.cellSize, grid.cellSize, Math.max(.05, crest - bottom)), material: Cesium.Color.fromCssColorString('#cfad76') },
        }))
      }
    }
  }

  animate(seconds: number): void {
    this.assertAlive()
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('水面动画时间必须非负且有限')
    this.waterMaterial.uniforms.visualTime = seconds
    const dt = this.lastVisualTime === undefined ? 0 : Math.max(0, seconds - this.lastVisualTime)
    this.lastVisualTime = seconds
    this.points.show = this.visualWater && this.visualOptions.flow && this.visualOptions.foam && this.visualOptions.particles
    if (!this.points.show) return
    this.flowParticles.advance(dt)
    this.flowParticles.particles.forEach((particle, i) => {
      const item = this.pointPool[i]
      item.point.show = particle.opacity > 0.01
      if (!item.point.show) return
      item.position.x = particle.x; item.position.y = particle.y; item.position.z = particle.z
      item.color.alpha = particle.opacity * this.visualOptions.foamIntensity * 0.65
      item.point.position = item.position
      item.point.color = item.color
    })
  }

  setVisualOptions(options: FloodVisualOptions): void {
    this.assertAlive()
    const next = resolveFloodVisualOptions(options, this.visualOptions)
    if (next.foam !== this.visualOptions.foam || next.flow !== this.visualOptions.flow || next.surfaceStyle !== this.visualOptions.surfaceStyle) this.resetVisuals()
    this.visualOptions = next
    this.waterMaterial.uniforms.surfaceStyle = next.surfaceStyle === 'flow' ? 1 : 0
    this.waterMaterial.uniforms.flowEnabled = next.flow ? 1 : 0
    this.waterMaterial.uniforms.foamOpacity = next.foam ? next.foamIntensity : 0
  }

  /** Call update with the current frame after changing a diagnostic view. */
  setDiagnosticMode(mode: FloodDiagnosticMode): void {
    this.assertAlive()
    if (!diagnosticModes.includes(mode)) throw new Error('未知水流诊断视图')
    this.diagnosticMode = mode
    this.waterMaterial.uniforms.diagnosticMode = diagnosticModes.indexOf(mode)
  }

  /** Final Cesium-assembled shader, useful for compilation diagnostics. */
  getWaterShaderSource(): string | undefined { return this.dynamicSurface?.getShaderSource() ?? this.water?.appearance?.getFragmentShaderSource() }
  isDestroyed(): boolean { return this.destroyed }

  resetVisuals(): void { this.assertAlive(); this.foam.reset(); this.flowParticles.reset(); this.lastVisualTime = undefined }

  private assertAlive(): void {
    if (this.destroyed) throw new Error('洪水图层已经销毁')
  }

  update(frame: FloodFrame, depthMode = false, detail = true): void {
    this.assertAlive()
    validateRenderFrame(this.grid, frame)
    this.lastSurface = {
      frame: { time: frame.time, depth: frame.depth.slice(), ...(frame.velocityEast ? { velocityEast: frame.velocityEast.slice(), velocityNorth: frame.velocityNorth!.slice() } : {}) },
      depthMode, detail,
    }
    this.surfaceUpdates++
    if (this.visualOptions.foam) this.foam.update(frame, this.visualOptions.foamLifetime, this.breachState, this.visualOptions.surfaceStyle)
    this.flowParticles.setFrame(frame, this.breachState)
    this.visualWater = detail && !depthMode && this.diagnosticMode === 'water'
    this.points.show = this.visualWater && this.visualOptions.flow && this.visualOptions.foam && this.visualOptions.particles
    this.updateWaterSurface(frame, depthMode, detail)
    this.clearOverfall()
    this.overfall = this.createOverfall(frame, depthMode)
    if (this.overfall) this.viewer.scene.primitives.add(this.overfall)
  }

  /** Switch rendering without resetting the hydraulic frame or visual history. */
  setSurfaceBackend(backend: FloodSurfaceBackend): void {
    this.assertAlive()
    if (backend !== 'primitive' && backend !== 'gpu') throw new RangeError('未知洪水水面后端')
    if (backend === this.surfaceBackend && !this.surfaceError) return
    this.removeDynamicSurface()
    this.surfaceBackend = backend
    this.surfaceError = null
    if (this.lastSurface) this.updateWaterSurface(this.lastSurface.frame, this.lastSurface.depthMode, this.lastSurface.detail)
  }

  getDiagnostics(): FloodSurfaceDiagnostics {
    const gpu = this.dynamicSurface?.getDiagnostics()
    return {
      requestedBackend: this.surfaceBackend,
      surfaceBackend: this.dynamicSurface ? 'gpu' : 'primitive',
      fallbackReason: this.surfaceError,
      surfaceUpdates: this.surfaceUpdates,
      legacyMeshBuilds: this.legacyMeshBuilds,
      ...(gpu ?? {
        ready: !!this.water?.ready, geometryCreated: this.legacyPrimitivesCreated,
        texturesCreated: 0, textureUploads: 0, framesQueued: 0, bytesUploaded: 0,
        shaderChanges: 0, commandsSubmitted: 0, triangles: 0,
        frameTime: this.lastSurface?.frame.time ?? 0, error: null,
      }),
    }
  }

  private removeDynamicSurface(): void {
    if (!this.dynamicSurface) return
    if (!this.scene.isDestroyed()) this.scene.primitives.remove(this.dynamicSurface)
    if (!this.dynamicSurface.isDestroyed()) this.dynamicSurface.destroy()
    this.dynamicSurface = undefined
  }

  private updateWaterSurface(frame: FloodFrame, depthMode: boolean, detail: boolean): void {
    if (this.surfaceBackend === 'gpu' && !this.surfaceError) {
      try {
        if (this.barriers) throw new Error('挡墙和溃口暂使用 Primitive 路径，避免跨越水位不连续面')
        if (!this.dynamicSurface) {
          this.dynamicSurface = new DynamicFloodSurface(this.scene, this.grid, this.modelMatrix, this.waterMaterial, error => {
            this.surfaceError = error instanceof Error ? error.message : String(error)
            // Cesium is traversing its collection; replace the failed surface after this render.
            queueMicrotask(() => {
              if (this.destroyed || this.scene.isDestroyed() || !this.lastSurface) return
              this.removeDynamicSurface()
              this.updateWaterSurface(this.lastSurface.frame, this.lastSurface.depthMode, this.lastSurface.detail)
              this.scene.requestRender()
            })
          })
          this.scene.primitives.add(this.dynamicSurface)
        }
        this.dynamicSurface.setFrame(frame, this.foam.coverage, this.foam.sources, {
          fragment: fragmentShader(true, depthMode, detail), translucent: detail && !depthMode,
          foamSource: this.diagnosticMode === 'foam-source',
        })
        if (this.water) { this.scene.primitives.remove(this.water); this.water = undefined }
        return
      } catch (error) {
        this.surfaceError = error instanceof Error ? error.message : String(error)
        this.removeDynamicSurface()
      }
    }
    this.legacyMeshBuilds++
    const next = this.createMesh(frame, depthMode, detail)
    if (next) this.legacyPrimitivesCreated++
    if (this.water) this.scene.primitives.remove(this.water)
    this.water = next
    if (next) this.scene.primitives.add(next)
  }

  updateInundation(result: InundationResult): void {
    this.assertAlive()
    this.removeDynamicSurface()
    this.lastSurface = undefined
    this.visualWater = false
    this.points.show = false
    this.clearOverfall()
    if (result.depth.length !== this.grid.columns * this.grid.rows || result.depth.some(h => !Number.isFinite(h) || h < 0)) throw new Error('淹没结果与网格不一致')
    const next = this.createMesh({ time: 0, depth: result.depth }, true, false, 0)
    if (this.water) this.viewer.scene.primitives.remove(this.water)
    this.water = next
    if (next) this.viewer.scene.primitives.add(next)
  }

  updateDamBreach(state?: DamBreachState): void {
    this.assertAlive()
    if (state) validateDamBreachState(this.grid, this.barriers, state)
    this.breachState = state
    const dx = this.grid.cellSize
    for (const section of this.wallSections) {
      const left = section.column * dx
      const right = left + dx
      if (!state || !this.barriers || section.row !== state.row) {
        this.setWallBox(section.entity, left, right, section.row, section.bottom, section.crest)
        if (section.right) section.right.show = false
        if (section.base) section.base.show = false
        continue
      }
      const opening = getBreachFace(this.grid, this.barriers, state, section.column)
      if (opening.fraction === 0) {
        this.setWallBox(section.entity, left, right, section.row, section.bottom, section.crest)
        if (section.right) section.right.show = false
        if (section.base) section.base.show = false
        continue
      }
      if (!section.right) section.right = this.createWallBox()
      if (!section.base) section.base = this.createWallBox()
      this.setWallBox(section.entity, left, opening.left, section.row, section.bottom, section.crest)
      this.setWallBox(section.right, opening.right, right, section.row, section.bottom, section.crest)
      this.setWallBox(section.base, opening.left, opening.right, section.row, section.bottom, opening.crest)
    }
  }

  private createWallBox(): Cesium.Entity {
    const entity = this.viewer.entities.add({
      orientation: Cesium.Transforms.headingPitchRollQuaternion(Cesium.Cartesian3.fromDegrees(...this.grid.origin), new Cesium.HeadingPitchRoll()),
      box: { dimensions: new Cesium.Cartesian3(1, 1, 1), material: Cesium.Color.fromCssColorString('#cfad76') },
    })
    this.walls.push(entity)
    return entity
  }

  private setWallBox(entity: Cesium.Entity, left: number, right: number, row: number, bottom: number, top: number): void {
    entity.show = right - left > 0.001 && top - bottom > 0.001
    if (!entity.show || !entity.box) return
    const position = Cesium.Matrix4.multiplyByPoint(this.modelMatrix,
      new Cesium.Cartesian3((left + right) / 2, row * this.grid.cellSize, (bottom + top) / 2), new Cesium.Cartesian3())
    entity.position = new Cesium.ConstantPositionProperty(position)
    entity.box.dimensions = new Cesium.ConstantProperty(new Cesium.Cartesian3(right - left, this.grid.cellSize, top - bottom))
  }

  // Cell raster on the sampled ground. null cells are absent, not zero values.
  updateAnalysis(values: readonly (number | null)[], maximum?: number): void {
    this.assertAlive()
    this.removeDynamicSurface()
    this.lastSurface = undefined
    this.visualWater = false
    this.points.show = false
    this.clearOverfall()
    const { columns, rows, cellSize, elevation, active } = this.grid
    if (values.length !== columns * rows || values.some(v => v !== null && (!Number.isFinite(v) || v < 0))) throw new Error('分析值必须与网格一致且非负有限')
    const scale = maximum ?? values.reduce<number>((peak, v) => Math.max(peak, v ?? 0), 0)
    if (!Number.isFinite(scale) || scale < 0) throw new Error('分析色标范围无效')
    const positions: number[] = []
    const color: number[] = []
    const normals: number[] = []
    const st: number[] = []
    const indices: number[] = []
    for (let i = 0; i < values.length; i++) {
      const value = values[i]
      if (value === null || active?.[i] === false) continue
      const x = i % columns
      const y = Math.floor(i / columns)
      const first = positions.length / 3
      for (const [cx, cy] of [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]]) {
        let height = 0
        let samples = 0
        for (const sy of [cy - 1, cy]) for (const sx of [cx - 1, cx]) {
          const neighbour = sy * columns + sx
          if (sx >= 0 && sx < columns && sy >= 0 && sy < rows && active?.[neighbour] !== false) { height += elevation[neighbour]; samples++ }
        }
        positions.push(cx * cellSize, cy * cellSize, height / samples + 0.15)
        normals.push(0, 0, 1)
        st.push(cx * cellSize, cy * cellSize)
        color.push(value / Math.max(0.0001, scale), 0, 0, 1)
      }
      indices.push(first, first + 1, first + 2, first, first + 2, first + 3)
    }
    const next = indices.length ? this.createPrimitive(new Float64Array(positions), new Float32Array(normals), new Float32Array(st), new Float32Array(color), indices,
      `in vec4 v_state;
       void main() {
         float t = clamp(v_state.r, 0.0, 1.0);
         vec3 low = mix(vec3(0.07,0.35,0.72), vec3(0.12,0.77,0.72), min(1.0, t*2.0));
         vec3 rgb = mix(low, vec3(0.95,0.38,0.12), max(0.0,t*2.0-1.0));
         out_FragColor = vec4(rgb,1.0);
       }`, false, false) : undefined
    if (this.water) this.viewer.scene.primitives.remove(this.water)
    this.water = next
    if (next) this.viewer.scene.primitives.add(next)
  }

  focus(options: { padding?: number } = {}): void {
    this.assertAlive()
    const padding = options.padding ?? 1
    if (!Number.isFinite(padding) || padding <= 0) throw new Error('相机视图边距必须大于 0')
    const { columns, rows, cellSize } = this.grid
    // Aim at the valley floor rather than the average elevation of high cliffs.
    let centerX = 0
    let centerZ = 0
    for (let y = 0; y < rows; y++) {
      let lowest = y * columns
      for (let x = 1; x < columns; x++) {
        const i = y * columns + x
        if (this.grid.elevation[i] < this.grid.elevation[lowest]) lowest = i
      }
      centerX += (lowest % columns + 0.5) * cellSize / rows
      centerZ += this.grid.elevation[lowest] / rows
    }
    const center = Cesium.Matrix4.multiplyByPoint(this.modelMatrix, new Cesium.Cartesian3(centerX, rows * cellSize / 2, centerZ), new Cesium.Cartesian3())
    const radius = Math.hypot(columns, rows) * cellSize * 0.52
    this.viewer.camera.lookAt(center, new Cesium.HeadingPitchRange(0.25, -1.05, radius * 2.3 * padding))
    this.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
  }

  focusBreach(state: DamBreachState, outlet: FloodOutlet = 'north'): void {
    this.assertAlive()
    validateDamBreachState(this.grid, this.barriers, state)
    const dx = this.grid.cellSize
    const x = (state.left + state.right) / 2
    const column = Math.min(this.grid.columns - 1, Math.floor(x / dx))
    const i = state.row * this.grid.columns + column
    const ground = Math.max(this.grid.elevation[i], this.grid.elevation[i - this.grid.columns])
    const crest = this.barriers?.north[i] ?? ground
    const target = Cesium.Matrix4.multiplyByPoint(this.modelMatrix,
      new Cesium.Cartesian3(x, state.row * dx, (ground + crest) / 2), new Cesium.Cartesian3())
    this.viewer.camera.lookAt(target, new Cesium.HeadingPitchRange(outlet === 'south' ? .25 : Math.PI + .25, -.5, Math.max(dx * 4, state.width) * 2.8))
    this.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
  }

  private createMesh(frame: FloodFrame | undefined, depthMode: boolean, detail = true, minimumDepth = 0.02): Cesium.Primitive | undefined {
    const { columns, rows, cellSize, elevation } = this.grid
    const count = columns * rows
    const positions = new Float64Array(count * 3)
    const normals = new Float32Array(count * 3)
    const st = new Float32Array(count * 2)
    const color = new Float32Array(count * 4)
    // Wall discontinuities keep their existing geometry path; do not extend through barriers.
    const surface = frame ? createFloodSurfaceState(this.grid, frame, !this.barriers) : undefined
    const heights = surface?.heights ?? elevation
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        const i = y * columns + x
        positions.set([(x + 0.5) * cellSize, (y + 0.5) * cellSize, heights[i]], i * 3)
        st.set([(x + 0.5) * cellSize, (y + 0.5) * cellSize], i * 2)
        const dzdx = (heights[y * columns + Math.min(columns - 1, x + 1)] - heights[y * columns + Math.max(0, x - 1)]) / ((Math.min(columns - 1, x + 1)-Math.max(0,x-1))*cellSize)
        const dzdy = (heights[Math.min(rows - 1, y + 1) * columns + x] - heights[Math.max(0, y - 1) * columns + x]) / ((Math.min(rows - 1, y + 1)-Math.max(0,y-1))*cellSize)
        const length = Math.hypot(dzdx, dzdy, 1)
        normals.set([-dzdx / length, -dzdy / length, 1 / length], i * 3)
        if (frame) color.set([surface?.depths[i] ?? frame.depth[i], frame.velocityEast?.[i] ?? 0, frame.velocityNorth?.[i] ?? 0, this.diagnosticMode === 'foam-source' ? this.foam.sources[i] : this.foam.coverage[i]], i * 4)
        else {
          const t = Math.min(1, Math.max(0, (elevation[i] - 12) / 80))
          color.set([elevation[i], 0.35 + 0.3 * t, 0.43 + 0.15 * t, 0.29 + 0.14 * t], i * 4)
        }
      }
    }
    const indices: number[] = []
    function triangle(a: number, b: number, c: number): void {
      if (thisGrid.active && (!thisGrid.active[a] || !thisGrid.active[b] || !thisGrid.active[c])) return
      // Do not interpolate a water surface across a stage discontinuity at a wall.
      if (frame && barriers) {
        const low = Math.floor(Math.min(a, b, c) / columns)
        const high = Math.floor(Math.max(a, b, c) / columns)
        if (low !== high && [a, b, c].some(i => barriers.north[high * columns + i % columns] != null)) {
          const minX = Math.min(a % columns, b % columns, c % columns)
          const maxX = Math.max(a % columns, b % columns, c % columns)
          const stages = [a, b, c].map(i => elevation[i] + frame.depth[i])
          for (let x = minX; x <= maxX; x++) {
            const crest = barriers.north[high * columns + x]
            if (crest == null) continue
            const whollyOpen = breach?.row === high && (minX + .5) * cellSize >= breach.left && (maxX + .5) * cellSize <= breach.right
            const effective = whollyOpen && breach ? getBreachFace(thisGrid, barriers, breach, x).crest : crest
            if (Math.min(...stages) < effective + .02) return
          }
        }
        const minX = Math.min(a % columns, b % columns, c % columns)
        const maxX = Math.max(a % columns, b % columns, c % columns)
        if (minX !== maxX) for (const i of [a, b, c]) {
          const crest = barriers.east[Math.floor(i / columns) * (columns + 1) + maxX]
          if (crest != null && Math.min(...[a, b, c].map(v => elevation[v] + frame.depth[v])) < crest + .02) return
        }
      }
      // Include shoreline triangles; depth is interpolated and discarded in GLSL.
      const h = frame ? Math.max(frame.depth[a], frame.depth[b], frame.depth[c]) : 0
      if (!frame || (minimumDepth === 0 ? h > 0 : h >= minimumDepth)) indices.push(a, b, c)
    }
    const thisGrid = this.grid
    const barriers = this.barriers
    const breach = this.breachState
    for (let y = 0; y < rows - 1; y++) {
      for (let x = 0; x < columns - 1; x++) {
        const a = y * columns + x
        triangle(a, a + 1, a + columns)
        triangle(a + 1, a + columns + 1, a + columns)
      }
    }
    if (indices.length === 0) return undefined
    return this.createPrimitive(positions, normals, st, color, indices, fragmentShader(!!frame, depthMode, detail, minimumDepth), !!frame, !!frame && detail && !depthMode)
  }

  private clearOverfall(): void {
    if (this.overfall) this.viewer.scene.primitives.remove(this.overfall)
    this.overfall = undefined
  }

  private createOverfall(frame: FloodFrame, depthMode: boolean): Cesium.Primitive | undefined {
    if (!this.barriers) return undefined
    const sections = sampleWallOverfalls(this.grid, this.barriers, frame, this.breachState)
    if (!sections.length) return undefined
    const positions: number[] = []
    const normals: number[] = []
    const st: number[] = []
    const colors: number[] = []
    const indices: number[] = []
    const dx = this.grid.cellSize
    for (const section of sections) {
      const { axis, face, left, right, direction, upstreamLevel, lipLevel, downstreamLevel, speed } = section
      // Crest sheet above the solid dam, then a falling sheet outside its downstream face.
      const steps = [
        [face - direction * dx * .55, upstreamLevel + .06, 0],
        [face + direction * dx * .52, lipLevel + .06, 0],
        [face + direction * dx * .72, downstreamLevel + .09, 1],
        [face + direction * dx * .9, downstreamLevel + .09, 2],
      ]
      for (let segment = 0; segment < steps.length - 1; segment++) {
        const from = steps[segment]
        const to = steps[segment + 1]
        const first = positions.length / 3
        for (const [span, step] of [[left, from], [right, from], [right, to], [left, to]] as [number, number[]][]) {
          positions.push(...(axis === 'north' ? [span, step[0], step[1]] : [step[0], span, step[1]]))
          normals.push(0, 0, 1)
          st.push(span, (step[0] - from[0]) * direction + segment * dx)
          colors.push(segment, Math.min(speed, 30), Math.min(20, upstreamLevel - section.crest), 1)
        }
        indices.push(first, first + 1, first + 2, first, first + 2, first + 3)
      }
    }
    const shader = `in vec2 v_st; in vec4 v_state;
      void main() {
        float time = floodVisualTime();
        float streak = sin(v_st.x * .65 + sin(v_st.x * .19)) * .5 + .5;
        float motion = sin(v_st.y * .9 - time * (4.0 + v_state.g * .4)) * .5 + .5;
        float foam = v_state.r > 1.5 ? .75 + .2 * motion : .15 + .5 * pow(streak * motion, 2.0);
        vec3 rgb = mix(vec3(.04,.36,.43), vec3(.84,.96,.94), foam);
        ${depthMode ? 'rgb = mix(vec3(.22,.78,.9),vec3(.75,.22,.12),clamp(v_state.b/5.0,0.0,1.0));' : ''}
        out_FragColor = vec4(rgb, .93);
      }`
    return this.createPrimitive(new Float64Array(positions), new Float32Array(normals), new Float32Array(st), new Float32Array(colors), indices, shader, true, true)
  }

  private createPrimitive(positions: Float64Array, normals: Float32Array, st: Float32Array, color: Float32Array, indices: number[], shader: string, water: boolean, translucent: boolean): Cesium.Primitive {
    const attribute = (values: Float64Array | Float32Array, componentsPerAttribute: number, componentDatatype: number) => new Cesium.GeometryAttribute({ values, componentsPerAttribute, componentDatatype })
    const attributes = new Cesium.GeometryAttributes()
    attributes.position = attribute(positions, 3, Cesium.ComponentDatatype.DOUBLE)
    attributes.normal = attribute(normals, 3, Cesium.ComponentDatatype.FLOAT)
    attributes.st = attribute(st, 2, Cesium.ComponentDatatype.FLOAT)
    attributes.color = attribute(color, 4, Cesium.ComponentDatatype.FLOAT)
    const geometry = new Cesium.Geometry({
      attributes,
      indices: positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices),
      primitiveType: Cesium.PrimitiveType.TRIANGLES,
      boundingSphere: Cesium.BoundingSphere.fromVertices(Array.from(positions)),
    })
    return new Cesium.Primitive({
      geometryInstances: new Cesium.GeometryInstance({ geometry, modelMatrix: this.modelMatrix }),
      appearance: new Cesium.Appearance({
        vertexShaderSource: vertexShader(this.modelMatrix),
        fragmentShaderSource: shader,
        ...(water ? { material: this.waterMaterial } : {}),
        translucent,
        renderState: { depthTest: { enabled: true }, cull: { enabled: false } },
      }),
      asynchronous: false,
      compressVertices: false,
      allowPicking: false,
    })
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.removeDynamicSurface()
    this.lastSurface = undefined
    if (this.scene.isDestroyed()) { this.waterMaterial.destroy(); return }
    for (const wall of this.walls) this.viewer.entities.remove(wall)
    if (this.terrain) this.viewer.scene.primitives.remove(this.terrain)
    if (this.water) this.viewer.scene.primitives.remove(this.water)
    this.clearOverfall()
    this.terrain = undefined
    this.water = undefined
    this.viewer.scene.primitives.remove(this.points)
    this.waterMaterial.destroy()
  }
}
