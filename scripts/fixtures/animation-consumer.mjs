import {
  createAnimation,
  parseAnimationDefinition,
} from '@gis-animation/cesium'

const C = globalThis.Cesium
const viewer = new C.Viewer('viewer', {
  baseLayer: false,
  terrainProvider: new C.EllipsoidTerrainProvider(),
  animation: false,
  timeline: false,
  baseLayerPicker: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  navigationHelpButton: false,
  fullscreenButton: false,
  infoBox: false,
  selectionIndicator: false,
  skyBox: false,
  skyAtmosphere: false,
  requestRenderMode: true,
  maximumRenderTimeChange: Infinity,
  shouldAnimate: false,
})
const errors = []
viewer.scene.renderError.addEventListener((_scene, error) =>
  errors.push(String(error)),
)
const sentinelEntity = viewer.entities.add({ id: 'consumer-owned-entity' })
const sentinelPrimitive = viewer.scene.primitives.add(
  new C.PolylineCollection(),
)
const clock = C.JulianDate.toIso8601(viewer.clock.currentTime)
const points = [
  { lon: 106.63, lat: 26.647, height: 100 },
  { lon: 106.635, lat: 26.65, height: 250 },
  { lon: 106.64, lat: 26.647, height: 100 },
]
const definition = parseAnimationDefinition({
  schemaVersion: 1,
  duration: 10,
  tracks: [
    {
      id: 'fly',
      kind: 'fly-line',
      at: 0,
      duration: 10,
      fill: 'hold',
      options: { positions: points },
    },
    {
      id: 'arrow',
      kind: 'flow-arrow',
      at: 0,
      duration: 8,
      options: { positions: points, direction: 'backward' },
    },
    {
      id: 'water',
      kind: 'fountain',
      at: 1,
      duration: 8,
      options: { position: points[0], quality: 'basic', emissionRate: 120 },
    },
    {
      id: 'camera',
      kind: 'camera',
      at: 0,
      duration: 10,
      fill: 'hold',
      options: {
        keyframes: [
          {
            time: 0,
            position: { lon: 106.63, lat: 26.64, height: 1200 },
            heading: 0,
            pitch: -45,
            roll: 0,
          },
          {
            time: 10,
            position: { lon: 106.64, lat: 26.64, height: 900 },
            heading: -10,
            pitch: -40,
            roll: 0,
          },
        ],
      },
    },
  ],
})
await new Promise((resolve) => {
  let count = 10
  function frame() {
    if (--count === 0) resolve()
    else requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
})
const baseline = {
  primitives: viewer.scene.primitives.length,
  entities: viewer.entities.values.length,
  listeners: viewer.scene.preRender.numberOfListeners,
}
let animation = createAnimation(viewer, definition)
function getState() {
  const alive = !viewer.isDestroyed()
  return {
    ready: alive,
    timeline: animation
      ? {
          state: animation.timeline.state,
          timeSeconds: animation.timeline.timeSeconds,
          driver: animation.timeline.driver,
        }
      : undefined,
    effects: animation
      ? [...animation.effects.entries()].map(([id, effect]) => ({
          id,
          state: effect.state,
          timeSeconds: effect.timeSeconds,
        }))
      : [],
    baseline,
    resources: alive
      ? {
          primitives: viewer.scene.primitives.length,
          entities: viewer.entities.values.length,
          listeners: viewer.scene.preRender.numberOfListeners,
        }
      : undefined,
    hostResourcesPreserved:
      alive &&
      viewer.entities.contains(sentinelEntity) &&
      viewer.scene.primitives.contains(sentinelPrimitive),
    clockUnchanged:
      alive &&
      C.JulianDate.toIso8601(viewer.clock.currentTime) === clock &&
      viewer.clock.shouldAnimate === false,
    camera: alive
      ? {
          x: viewer.camera.positionWC.x,
          y: viewer.camera.positionWC.y,
          z: viewer.camera.positionWC.z,
          heading: viewer.camera.heading,
          pitch: viewer.camera.pitch,
          roll: viewer.camera.roll,
        }
      : undefined,
    errors: [...errors],
  }
}
window.__animationConsumer = {
  getState,
  play: () => animation.timeline.play(),
  pause: () => animation.timeline.pause(),
  resume: () => animation.timeline.resume(),
  stop: () => animation.timeline.stop(),
  seek: (time) => animation.timeline.seek(time),
  setTime: (time) => animation.timeline.setTime(time),
  setExternal() {
    animation?.destroy()
    animation = createAnimation(viewer, definition, { driver: 'external' })
  },
  destroy() {
    animation?.destroy()
    animation = undefined
  },
  viewerFirstDestroy() {
    viewer.destroy()
    animation?.destroy()
  },
}
