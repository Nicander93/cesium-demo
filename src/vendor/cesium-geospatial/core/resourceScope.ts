export interface OwnedResource {
  destroy(): void
  isDestroyed?: () => boolean
}

/** Destroy resources already allocated if a later allocation in the same loader fails. */
export async function createWithResourceScope<T>(
  create: (own: <R extends OwnedResource>(resource: R) => R) => T | Promise<T>,
): Promise<T> {
  const resources: OwnedResource[] = []
  const own = <R extends OwnedResource>(resource: R): R => {
    resources.push(resource)
    return resource
  }
  try {
    return await create(own)
  } catch (error) {
    for (let index = resources.length - 1; index >= 0; index--) {
      const resource = resources[index]!
      try {
        if (!resource.isDestroyed?.()) resource.destroy()
      } catch {
        // Preserve the allocation/decode error while best-effort releasing siblings.
      }
    }
    throw error
  }
}
