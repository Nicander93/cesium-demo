import { describe, expect, it, vi } from 'vitest'
import { ShaderProgram, type Context } from 'cesium'
import { createVolumetricPrimitive } from './VolumetricPrimitive'

vi.mock('cesium', async (importOriginal) => {
  const actual = await importOriginal<typeof import('cesium')>()
  return {
    ...actual,
    ShaderProgram: { fromCache: vi.fn(() => ({ destroy: vi.fn() })) },
    Framebuffer: class { destroy = vi.fn() },
    RenderState: { fromCache: vi.fn(() => ({ id: 1 })) },
  }
})

describe('volumetric rendering suspension', () => {
  it('keeps picking, depth and offscreen views out of color/history targets', () => {
    const command = { shaderProgram: { destroy: vi.fn() } }
    const primitive = createVolumetricPrimitive({ context: { createViewportQuadCommand: () => command } as unknown as Context,
      fragmentShaderSource: '', uniformMap: {}, mrtColorTextures: [] })
    for (const passes of [
      { render: false, pick: true }, { render: false, depth: true },
      { render: false, pickVoxel: true }, { render: false },
      { render: true, pick: true }, { render: true, depth: true }, { render: true, offscreen: true },
    ]) {
      const frame = { commandList: [] as unknown[], passes }
      primitive.update(frame)
      expect(frame.commandList).toHaveLength(0)
    }
    const colorFrame = { commandList: [] as unknown[], passes: { render: true } }
    primitive.update(colorFrame)
    expect(colorFrame.commandList).toEqual([command])
    primitive.destroy()
  })
  it('releases both the replaced default shader and the custom vertex shader', () => {
    const original = { destroy: vi.fn() }, command = { shaderProgram: original }
    const primitive = createVolumetricPrimitive({ context: { createViewportQuadCommand: () => command } as unknown as Context,
      fragmentShaderSource: 'fragment', vertexShaderSource: 'vertex', uniformMap: {}, mrtColorTextures: [] })
    expect(original.destroy).toHaveBeenCalledTimes(1)
    expect(ShaderProgram.fromCache).toHaveBeenCalledWith(expect.objectContaining({ vertexShaderSource: 'vertex', fragmentShaderSource: 'fragment' }))
    const replacement = command.shaderProgram
    primitive.destroy(); primitive.destroy()
    expect(replacement.destroy).toHaveBeenCalledTimes(1)
  })
  it('omits draw commands while hidden and resumes with the same GPU command', () => {
    const shader = { destroy: vi.fn() }
    const command = { shaderProgram: shader }
    const createViewportQuadCommand = vi.fn(() => command)
    const primitive = createVolumetricPrimitive({
      context: { createViewportQuadCommand } as unknown as Context,
      fragmentShaderSource: '', uniformMap: {}, mrtColorTextures: [],
    })
    const frame = { commandList: [] as unknown[], passes: { render: true } }
    primitive.show = false
    primitive.update(frame)
    primitive.update(frame)
    expect(frame.commandList).toHaveLength(0)
    primitive.show = true
    primitive.update(frame)
    expect(frame.commandList).toEqual([command])
    expect(createViewportQuadCommand).toHaveBeenCalledTimes(1)
    primitive.destroy()
    primitive.update(frame)
    expect(frame.commandList).toHaveLength(1)
    expect(primitive.isDestroyed()).toBe(true)
    primitive.destroy()
    expect(shader.destroy).toHaveBeenCalledTimes(1)
  })
})
