export interface DestroyableEffect { destroy(): void }
export type EffectFactory<T extends DestroyableEffect> = (signal: AbortSignal) => Promise<T>

/** Runs provider creation serially so stale async setup never overlaps scene mutation. */
export class EffectCoordinator<T extends DestroyableEffect> {
  private generation = 0
  private controller: AbortController | undefined
  private active: T | undefined
  private tail: Promise<void> = Promise.resolve()
  private disposed = false

  get current(): T | undefined { return this.active }

  switchTo(factory: EffectFactory<T>): Promise<boolean> {
    if (this.disposed) return Promise.reject(new Error('Effect coordinator is disposed'))
    const generation = ++this.generation
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    const operation = this.tail.then(async () => {
      if (this.disposed || generation !== this.generation) return false
      this.destroyActive()
      let created: T | undefined
      try {
        created = await factory(controller.signal)
        if (this.disposed || generation !== this.generation || controller.signal.aborted) {
          created.destroy()
          return false
        }
        this.active = created
        return true
      } catch (error) {
        if (created) created.destroy()
        if (generation === this.generation) throw error
        return false
      }
    })
    this.tail = operation.then(() => undefined, () => undefined)
    return operation
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.generation++
    this.controller?.abort()
    await this.tail
    this.destroyActive()
  }

  private destroyActive(): void {
    const active = this.active
    this.active = undefined
    if (active) active.destroy()
  }
}
