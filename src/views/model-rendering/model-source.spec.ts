import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalModel } from './model-source'

function file(name: string, document = '{}'): File {
  const result = new File([document], name)
  Object.defineProperty(result, 'text', { value: async () => document })
  return result
}

describe('local glTF resource loading', () => {
  const created: Blob[] = []
  const revoke = vi.fn()
  beforeEach(() => {
    created.length = 0; revoke.mockClear()
    vi.stubGlobal('URL', { createObjectURL: (blob: Blob) => { created.push(blob); return `blob:test-${created.length}` }, revokeObjectURL: revoke })
  })
  afterEach(() => vi.unstubAllGlobals())
  it('keeps an embedded GLB alive until explicitly disposed', async () => {
    const source = await createLocalModel([file('scene.GLB')])
    expect(source.url).toBe('blob:test-1')
    expect(revoke).not.toHaveBeenCalled()
    source.dispose()
    expect(revoke).toHaveBeenCalledWith('blob:test-1')
  })
  it('resolves encoded nested buffer/image paths, preserving data URIs', async () => {
    const source = await createLocalModel([
      file('scene.gltf', JSON.stringify({ buffers: [{ uri: 'mesh/data.bin' }], images: [{ uri: 'textures/base%20color.png' }, { uri: 'data:image/png;base64,AA==' }] })),
      file('data.bin'), file('base color.png'),
    ])
    expect(created).toHaveLength(3)
    expect(source.url).toBe('blob:test-3')
    source.dispose()
    expect(revoke).toHaveBeenCalledTimes(3)
  })
  it('revokes already resolved resources when a later texture is missing', async () => {
    await expect(createLocalModel([file('scene.gltf', '{"buffers":[{"uri":"data.bin"}],"images":[{"uri":"missing.png"}]}'), file('data.bin')])).rejects.toThrow('missing.png')
    expect(revoke).toHaveBeenCalledWith('blob:test-1')
  })
  it('rejects ambiguous file names instead of binding the wrong texture', async () => {
    await expect(createLocalModel([file('scene.gltf', '{"images":[{"uri":"a.png"}]}'), file('a.png'), file('a.png')])).rejects.toThrow('a.png')
  })
  it('rejects multiple root models', async () => {
    await expect(createLocalModel([file('a.glb'), file('b.gltf')])).rejects.toThrow('请选择一个')
  })
})
