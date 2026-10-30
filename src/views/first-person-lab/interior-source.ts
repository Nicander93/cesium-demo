import { createMeshWalkingWorld } from './mesh-walking'

export interface InteriorSpawn {
  id: string
  label: string
  position: [number, number, number]
  heading: number
  pitch: number
}
export interface InteriorManifest {
  schemaVersion: number
  name: string
  author: string
  sourceUrl: string
  license: string
  model: string
  collision: string
  triangleCount: number
  bounds: { min: [number, number, number]; max: [number, number, number] }
  spawns: InteriorSpawn[]
}

const vector = (value: unknown): value is [number, number, number] => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)

/** Validate the asset contract before allocating a collision world or moving the camera. */
export function parseInteriorManifest(input: unknown): InteriorManifest {
  if (!input || typeof input !== 'object') throw new Error('室内模型清单格式无效')
  const data = input as Record<string, unknown>
  const bounds = data.bounds as InteriorManifest['bounds'] | undefined
  if (data.schemaVersion !== 1 || !['name', 'author', 'sourceUrl', 'license', 'model', 'collision'].every(key => typeof data[key] === 'string' && data[key])) throw new Error('室内模型清单字段无效')
  if (!Number.isInteger(data.triangleCount) || (data.triangleCount as number) < 1 || (data.triangleCount as number) > 1_000_000) throw new Error('碰撞三角形数量超出限制')
  if (!bounds || !vector(bounds.min) || !vector(bounds.max) || bounds.min.some((v, i) => v > bounds.max[i]!)) throw new Error('模型范围无效')
  if (!Array.isArray(data.spawns) || !data.spawns.length || !data.spawns.every((point: unknown) => {
    if (!point || typeof point !== 'object') return false
    const spawn = point as InteriorSpawn
    return typeof spawn.id === 'string' && typeof spawn.label === 'string' && vector(spawn.position) && Number.isFinite(spawn.heading) && Number.isFinite(spawn.pitch)
  })) throw new Error('室内视点无效')
  if (new Set(data.spawns.map(point => point.id)).size !== data.spawns.length) throw new Error('室内视点编号重复')
  return input as InteriorManifest
}

/** Cesium renders the GLB; collision is extracted offline from the same normalized static mesh. */
export async function loadInteriorSource(manifestUrl: string, stage: (message: string) => void, isDisposed: () => boolean) {
  const url = new URL(manifestUrl, location.href)
  stage('读取室内模型清单')
  const response = await fetch(url)
  if (!response.ok) throw new Error(`室内模型清单加载失败 (${response.status})`)
  const manifest = parseInteriorManifest(await response.json())
  const collision = await fetch(new URL(manifest.collision, url))
  if (!collision.ok) throw new Error(`模型碰撞数据加载失败 (${collision.status})`)
  const buffer = await collision.arrayBuffer()
  if (buffer.byteLength !== manifest.triangleCount * 9 * 4) throw new Error('碰撞三角形数量与模型清单不符')
  if (isDisposed()) return undefined
  stage(`构建模型碰撞 · ${manifest.triangleCount.toLocaleString()} 个三角形`)
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  if (isDisposed()) return undefined
  const world = createMeshWalkingWorld(new Float32Array(buffer))
  return { manifest, world, modelUrl: new URL(manifest.model, url).href }
}
