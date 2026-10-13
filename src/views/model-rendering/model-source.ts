export interface ModelSource {
  url: string
  name: string
  dispose: () => void
}

/** Resolve a local glTF's buffers and images before either renderer loads it. */
export async function createLocalModel(files: File[]): Promise<ModelSource> {
  const roots = files.filter(file => /\.(glb|gltf)$/i.test(file.name))
  if (roots.length !== 1) throw new Error('请选择一个 GLB，或一个 glTF 及其配套的 bin、贴图文件。')
  const root = roots[0]!
  const urls: string[] = []
  function createUrl(blob: Blob): string {
    const url = URL.createObjectURL(blob)
    urls.push(url)
    return url
  }
  function dispose(): void { urls.forEach(url => URL.revokeObjectURL(url)) }
  try {
    if (/\.glb$/i.test(root.name)) return { url: createUrl(root), name: root.name, dispose }
    const document: unknown = JSON.parse(await root.text())
    function rewrite(value: unknown): void {
      if (!value || typeof value !== 'object') return
      if (Array.isArray(value)) { value.forEach(rewrite); return }
      const object = value as Record<string, unknown>
      if (typeof object.uri === 'string' && !/^(data:|https?:|blob:)/i.test(object.uri)) {
        const name = decodeURIComponent(object.uri).replace(/\\/g, '/').split('/').pop()
        const matches = files.filter(file => file.name === name)
        if (matches.length !== 1) throw new Error(`缺少或重复的依赖文件：${object.uri}。请连同模型一起选择。`)
        object.uri = createUrl(matches[0]!)
      }
      Object.values(object).forEach(rewrite)
    }
    rewrite(document)
    return { url: createUrl(new Blob([JSON.stringify(document)], { type: 'model/gltf+json' })), name: root.name, dispose }
  } catch (error) { dispose(); throw error }
}
