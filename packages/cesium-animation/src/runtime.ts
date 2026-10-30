import type { Viewer } from 'cesium'
import type { EffectCapabilities, EffectHandle, EffectState } from './types.js'

interface AnimationTask {
  advance(now: number): void
  destroy(): void
  onError?(error: unknown): void
}

interface ViewerRuntime {
  viewer: Viewer
  effects: Set<EffectControl>
  timelines: Set<AnimationTask>
  active: Set<AnimationTask>
  frame: number | undefined
  errors: string[]
}

const runtimes = new WeakMap<Viewer, ViewerRuntime>()
const controls = new WeakMap<object, EffectControl>()

function getRuntime(viewer: Viewer): ViewerRuntime {
  if (viewer.isDestroyed()) throw new Error('Host Viewer has been destroyed')
  let runtime = runtimes.get(viewer)
  if (!runtime) {
    runtime = {
      viewer,
      effects: new Set(),
      timelines: new Set(),
      active: new Set(),
      frame: undefined,
      errors: [],
    }
    runtimes.set(viewer, runtime)
  }
  return runtime
}

function releaseRuntime(runtime: ViewerRuntime): void {
  if (runtime.effects.size === 0 && runtime.timelines.size === 0)
    runtimes.delete(runtime.viewer)
}

function requestFrame(runtime: ViewerRuntime): void {
  if (runtime.frame !== undefined || runtime.active.size === 0) return
  runtime.frame = requestAnimationFrame(() => {
    runtime.frame = undefined
    if (runtime.viewer.isDestroyed()) {
      for (const task of [...runtime.timelines, ...runtime.effects]) {
        try {
          task.destroy()
        } catch (error) {
          runtime.errors.push(String(error))
        }
      }
      return
    }
    const now = performance.now()
    for (const task of [...runtime.active]) {
      if (!runtime.active.has(task)) continue
      try {
        task.advance(now)
      } catch (error) {
        runtime.active.delete(task)
        runtime.errors.push(String(error))
        try {
          if (task.onError) task.onError(error)
          else task.destroy()
        } catch (cleanupError) {
          runtime.errors.push(String(cleanupError))
        }
      }
    }
    if (!runtime.viewer.isDestroyed()) runtime.viewer.scene.requestRender()
    requestFrame(runtime)
  })
}

function stopUnusedFrame(runtime: ViewerRuntime): void {
  if (runtime.active.size === 0 && runtime.frame !== undefined) {
    cancelAnimationFrame(runtime.frame)
    runtime.frame = undefined
  }
}

function renderOnce(viewer: Viewer): void {
  if (!viewer.isDestroyed()) viewer.scene.requestRender()
}

/** Timeline and independent effects share the same per-Viewer render demand. */
export function registerTimelineTask(viewer: Viewer, task: AnimationTask) {
  const runtime = getRuntime(viewer)
  runtime.timelines.add(task)
  return {
    start() {
      runtime.active.add(task)
      renderOnce(viewer)
      requestFrame(runtime)
    },
    stop() {
      runtime.active.delete(task)
      stopUnusedFrame(runtime)
    },
    destroy() {
      runtime.active.delete(task)
      runtime.timelines.delete(task)
      stopUnusedFrame(runtime)
      releaseRuntime(runtime)
    },
  }
}

export interface EffectRenderer<TOptions> {
  kind: 'fly' | 'arrow' | 'fountain' | 'camera'
  sample(timeSeconds: number): void
  start(timeSeconds: number): void
  pause(): void
  stop(): void
  setVisible(visible: boolean): void
  update(options: Partial<TOptions>, timeSeconds: number): void
  destroy(): void
  inspect?(): object
}

/** Internal ownership bridge; no renderer/driver hooks are exported by the package. */
export interface EffectControl {
  readonly viewer: Viewer
  readonly kind: EffectRenderer<unknown>['kind']
  readonly handle: EffectHandle<unknown>
  claim(owner: object): void
  release(owner: object): void
  evaluate(
    owner: object,
    time: number,
    visible: boolean,
    running: boolean,
    reset: boolean,
    hold?: boolean,
  ): boolean
  destroy(): void
  inspect(): object
}

export function getEffectControl(effect: object): EffectControl {
  const control = controls.get(effect)
  if (!control) throw new Error('Effect must be created by this SDK instance')
  return control
}

/** Lifecycle and one demand-render scheduler per host Viewer; never writes its Clock. */
export function createEffectHandle<TOptions>(
  viewer: Viewer,
  capabilities: EffectCapabilities,
  renderer: EffectRenderer<TOptions>,
): EffectHandle<TOptions> {
  const runtime = getRuntime(viewer)
  let state: EffectState = 'idle'
  let elapsed = 0
  let startedAt = 0
  let startTime = 0
  let timelineOwner: object | undefined
  let visible = true
  let failure: Error | undefined
  let resourcesDisposed = false

  function assertUsable(): void {
    if (state === 'destroyed') throw new Error('Effect has been destroyed')
    if (viewer.isDestroyed()) {
      handle.destroy()
      throw new Error('Host Viewer has been destroyed')
    }
  }

  function assertIndependent(): void {
    assertUsable()
    if (timelineOwner) throw new Error('Effect is controlled by a Timeline')
  }

  function sampleNow(now = performance.now()): void {
    if (state !== 'playing' || timelineOwner) return
    elapsed = startTime + Math.max(0, now - startedAt) / 1000
    renderer.sample(elapsed)
  }

  function start(): void {
    renderer.setVisible(true)
    visible = true
    try {
      renderer.start(elapsed)
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error))
      try {
        renderer.pause()
      } catch {
        /* Preserve the original initialization failure. */
      }
      throw error
    }
    state = 'playing'
    startedAt = performance.now()
    startTime = elapsed
    runtime.active.add(task)
    renderOnce(viewer)
    requestFrame(runtime)
  }

  const task: AnimationTask = {
    advance: sampleNow,
    destroy: () => handle.destroy(),
    onError(error) {
      failure = error instanceof Error ? error : new Error(String(error))
      handle.destroy()
    },
  }
  const handle: EffectHandle<TOptions> = {
    get state() {
      return state
    },
    get error() {
      return failure
    },
    capabilities: Object.freeze({ ...capabilities }),
    get timeSeconds() {
      return elapsed
    },
    play() {
      assertIndependent()
      if (state !== 'idle' && state !== 'stopped') return
      elapsed = 0
      start()
    },
    pause() {
      assertIndependent()
      if (state !== 'playing') return
      sampleNow()
      renderer.pause()
      state = 'paused'
      runtime.active.delete(task)
      stopUnusedFrame(runtime)
      renderOnce(viewer)
    },
    resume() {
      assertIndependent()
      if (state === 'paused') start()
    },
    stop() {
      assertIndependent()
      runtime.active.delete(task)
      stopUnusedFrame(runtime)
      renderer.stop()
      elapsed = 0
      state = 'stopped'
      renderOnce(viewer)
    },
    update(options) {
      assertUsable()
      sampleNow()
      renderer.update(options, elapsed)
      renderOnce(viewer)
    },
    destroy() {
      if (state === 'destroyed' && resourcesDisposed) return
      state = 'destroyed'
      runtime.active.delete(task)
      runtime.effects.delete(control)
      stopUnusedFrame(runtime)
      try {
        renderer.destroy()
        resourcesDisposed = true
      } finally {
        releaseRuntime(runtime)
        renderOnce(viewer)
      }
    },
  }

  const control: EffectControl = {
    viewer,
    kind: renderer.kind,
    handle,
    claim(owner) {
      assertUsable()
      if (timelineOwner) throw new Error('Effect already belongs to a Timeline')
      if (state !== 'idle' && state !== 'stopped')
        throw new Error('Stop an effect before adding it to a Timeline')
      timelineOwner = owner
      visible = false
      renderer.stop()
      renderer.setVisible(false)
    },
    release(owner) {
      if (timelineOwner !== owner) return
      timelineOwner = undefined
      if (state === 'destroyed') return
      if (viewer.isDestroyed()) {
        elapsed = 0
        state = 'stopped'
        visible = false
        return
      }
      try {
        renderer.stop()
        renderer.setVisible(true)
      } finally {
        visible = true
        elapsed = 0
        state = 'stopped'
      }
    },
    evaluate(owner, time, shown, running, reset, hold = false) {
      if (state === 'destroyed') return false
      assertUsable()
      if (timelineOwner !== owner)
        throw new Error('Timeline does not own this effect')
      if (!shown) {
        if (renderer.kind === 'camera' && visible && !reset && time > 0)
          renderer.sample(time)
        if (visible || reset) renderer.stop()
        renderer.setVisible(false)
        visible = false
        elapsed = time
        state = 'stopped'
        return capabilities.seek === 'reset' && reset
      }
      let didReset = false
      if (capabilities.seek === 'reset') {
        if (reset || !visible || (running && state !== 'playing')) {
          renderer.stop()
          if (running) renderer.start(time)
          didReset = true
        } else if (!running && state === 'playing' && !hold) renderer.pause()
      } else if (reset) renderer.stop()
      renderer.setVisible(true)
      renderer.sample(time)
      visible = true
      elapsed = time
      state = running ? 'playing' : 'paused'
      return didReset
    },
    destroy: () => handle.destroy(),
    inspect: () => ({
      state,
      timeSeconds: elapsed,
      error: failure?.message,
      visible,
      controlled: Boolean(timelineOwner),
      ...renderer.inspect?.(),
    }),
  }
  controls.set(handle, control)
  runtime.effects.add(control)
  renderOnce(viewer)
  return handle
}

/** Lab diagnostics only. This is not part of the proposed SDK public surface. */
export function inspectAnimations(viewer: Viewer) {
  const runtime = runtimes.get(viewer)
  const effects = runtime
    ? [...runtime.effects].map((effect) => effect.inspect())
    : []
  return {
    effectCount: effects.length,
    activeEffects: runtime
      ? [...runtime.effects].filter(
          (effect) => effect.handle.state === 'playing',
        ).length
      : 0,
    timelineCount: runtime?.timelines.size ?? 0,
    schedulerPending: runtime?.frame !== undefined,
    effects,
    errors: runtime ? [...runtime.errors] : [],
  }
}
