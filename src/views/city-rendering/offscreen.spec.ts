import { describe, expect, it } from 'vitest'
// @ts-expect-error The vendor boundary is JavaScript.
import { withOffscreenState } from '../../vendor/cesium-clouds-atmosphere/gl-state.js'

function createGL() {
  const state: Record<string, unknown> = {
    CURRENT_PROGRAM: 'scene-program',
    VERTEX_ARRAY_BINDING: 'scene-vao',
    ARRAY_BUFFER_BINDING: 'scene-buffer',
    ACTIVE_TEXTURE: 102,
    READ_FRAMEBUFFER_BINDING: 'read-fbo',
    DRAW_FRAMEBUFFER_BINDING: 'draw-fbo',
    VIEWPORT: [1, 2, 800, 600],
    COLOR_WRITEMASK: [true, false, true, false],
    COLOR_CLEAR_VALUE: [0.1, 0.2, 0.3, 1],
    DEPTH_WRITEMASK: true,
  }
  const textures = Array.from({ length: 5 }, (_, unit) => ({
    two: `2d-${unit}`,
    three: `3d-${unit}`,
    sampler: `sampler-${unit}`,
  }))
  const caps = new Set(['DEPTH_TEST', 'CULL_FACE', 'SCISSOR_TEST'])
  const constants = [
    ...Object.keys(state),
    'TEXTURE_BINDING_2D',
    'TEXTURE_BINDING_3D',
    'SAMPLER_BINDING',
    'TEXTURE_2D',
    'TEXTURE_3D',
    'READ_FRAMEBUFFER',
    'DRAW_FRAMEBUFFER',
    'ARRAY_BUFFER',
    'DEPTH_TEST',
    'BLEND',
    'CULL_FACE',
    'SCISSOR_TEST',
  ]
  const gl = {
    ...Object.fromEntries(constants.map((name) => [name, name])),
    TEXTURE0: 100,
    getParameter: (key: string) => {
      const unit = textures[Number(state.ACTIVE_TEXTURE) - 100]!
      return key === 'TEXTURE_BINDING_2D'
        ? unit.two
        : key === 'TEXTURE_BINDING_3D'
          ? unit.three
          : key === 'SAMPLER_BINDING'
            ? unit.sampler
            : state[key]
    },
    isEnabled: (cap: string) => caps.has(cap),
    enable: (cap: string) => caps.add(cap),
    disable: (cap: string) => caps.delete(cap),
    activeTexture: (value: number) => {
      state.ACTIVE_TEXTURE = value
    },
    bindTexture: (target: string, value: string) => {
      textures[Number(state.ACTIVE_TEXTURE) - 100]![
        target === 'TEXTURE_2D' ? 'two' : 'three'
      ] = value
    },
    bindSampler: (unit: number, sampler: string) => {
      textures[unit]!.sampler = sampler
    },
    bindVertexArray: (value: string) => {
      state.VERTEX_ARRAY_BINDING = value
    },
    createVertexArray: () => 'private-vao',
    deleteVertexArray: () => undefined,
    bindBuffer: (_target: string, value: string) => {
      state.ARRAY_BUFFER_BINDING = value
    },
    bindFramebuffer: (target: string, value: string) => {
      state[`${target}_BINDING`] = value
    },
    useProgram: (value: string) => {
      state.CURRENT_PROGRAM = value
    },
    viewport: (...value: number[]) => {
      state.VIEWPORT = value
    },
    colorMask: (...value: boolean[]) => {
      state.COLOR_WRITEMASK = value
    },
    clearColor: (...value: number[]) => {
      state.COLOR_CLEAR_VALUE = value
    },
    depthMask: (value: boolean) => {
      state.DEPTH_WRITEMASK = value
    },
  }
  return { gl, state, textures, caps }
}

describe('raw cloud passes sharing Cesium GL context', () => {
  it.each([false, true])(
    'restores five texture units and VAO even if drawing fails: %s',
    (fails) => {
      const { gl, state, textures, caps } = createGL()
      const before = JSON.stringify({ state, textures, caps: [...caps].sort() })
      const draw = () =>
        withOffscreenState(
          gl,
          () => {
            expect(state.VERTEX_ARRAY_BINDING).toBe('private-vao')
            gl.useProgram('cloud-program')
            gl.bindBuffer('ARRAY_BUFFER', 'cloud-buffer')
            gl.bindFramebuffer('DRAW_FRAMEBUFFER', 'cloud-fbo')
            gl.viewport(0, 0, 1024, 1024)
            gl.clearColor(0, 0, 0, 0)
            for (let unit = 0; unit < 5; unit++) {
              gl.activeTexture(100 + unit)
              gl.bindTexture('TEXTURE_2D', 'cloud-2d')
              gl.bindTexture('TEXTURE_3D', 'cloud-3d')
            }
            if (fails) throw new Error('draw failed')
            return 42
          },
          5,
        )
      if (fails) expect(draw).toThrow('draw failed')
      else expect(draw()).toBe(42)
      expect(JSON.stringify({ state, textures, caps: [...caps].sort() })).toBe(
        before,
      )
    },
  )
})
