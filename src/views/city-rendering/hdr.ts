export interface TonePass {
  enabled: boolean
}
export interface PostProcessExecution {
  _tonemapping: TonePass
  execute: (...args: unknown[]) => unknown
}

/** Cesium applies its built-in tone pass before custom stages; the cloud pipeline needs linear input. */
export function moveToneMappingToEnd(
  collection: PostProcessExecution,
  active: () => boolean,
): () => void {
  const original = collection.execute
  function execute(this: PostProcessExecution, ...args: unknown[]): unknown {
    if (!active()) return original.apply(this, args)
    const tone = this._tonemapping
    const enabled = tone.enabled
    tone.enabled = false
    try {
      return original.apply(this, args)
    } finally {
      tone.enabled = enabled
    }
  }
  collection.execute = execute
  return () => {
    if (collection.execute === execute) collection.execute = original
  }
}
