import type * as Cesium from 'cesium'

export function viewerSnapshot(viewer: Cesium.Viewer) {
  const scene = viewer.scene
  const globe = scene.globe
  const saved = {
    highDynamicRange: scene.highDynamicRange,
    depthTest: globe.depthTestAgainstTerrain,
    showGlobe: globe.show,
    showSky: scene.skyAtmosphere?.show,
    groundAtmosphere: globe.showGroundAtmosphere,
    fogRenderable: scene.fog.renderable,
    lighting: globe.enableLighting,
    terrainShadows: globe.shadows,
    requestRenderMode: scene.requestRenderMode,
    useDefaultRenderLoop: viewer.useDefaultRenderLoop,
  }
  let destroyed = false
  return () => {
    if (destroyed) return
    destroyed = true
    scene.highDynamicRange = saved.highDynamicRange
    globe.depthTestAgainstTerrain = saved.depthTest
    globe.show = saved.showGlobe
    globe.showGroundAtmosphere = saved.groundAtmosphere
    scene.fog.renderable = saved.fogRenderable
    globe.enableLighting = saved.lighting
    globe.shadows = saved.terrainShadows
    if (scene.skyAtmosphere && saved.showSky !== undefined) scene.skyAtmosphere.show = saved.showSky
    scene.requestRenderMode = saved.requestRenderMode
    viewer.useDefaultRenderLoop = saved.useDefaultRenderLoop
    scene.requestRender()
  }
}

export function deferBuiltInToneMapping(scene: Cesium.Scene): () => void {
  const collection = scene.postProcessStages as unknown as {
    execute: (...args: unknown[]) => unknown
    _tonemapping?: { enabled: boolean }
  }
  if (!collection._tonemapping) return () => undefined
  const original = collection.execute
  function execute(this: typeof collection, ...args: unknown[]) {
    const tone = this._tonemapping
    if (!tone) return original.apply(this, args)
    const enabled = tone.enabled
    tone.enabled = false
    try { return original.apply(this, args) } finally { tone.enabled = enabled }
  }
  collection.execute = execute
  return () => { if (collection.execute === execute) collection.execute = original }
}
