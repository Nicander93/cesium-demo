import type { Scene } from 'cesium'

type DepthPickingScene = Pick<Scene, 'useDepthPicking' | 'isDestroyed'>

interface DepthPickingLeases {
  previousValue: boolean
  count: number
}

const leasesByScene = new WeakMap<DepthPickingScene, DepthPickingLeases>()

/** Enable depth picking until every overlapping sampling operation releases its lease. */
export function acquireDepthPicking(scene: DepthPickingScene): () => void {
  if (scene.isDestroyed()) return () => {}

  let leases = leasesByScene.get(scene)
  if (!leases) {
    leases = { previousValue: scene.useDepthPicking, count: 0 }
    leasesByScene.set(scene, leases)
    scene.useDepthPicking = true
  }
  leases.count++

  let released = false
  return () => {
    if (released) return
    released = true
    if (leasesByScene.get(scene) !== leases) return

    leases.count--
    if (leases.count > 0) return
    leasesByScene.delete(scene)
    if (!scene.isDestroyed()) scene.useDepthPicking = leases.previousValue
  }
}
