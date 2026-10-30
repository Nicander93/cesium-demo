import type { AtmosphereLUTs } from '../../vendor/cesium-geospatial/core/cesium/lutLoader'
import type { WeatherTextures } from '../../vendor/cesium-geospatial/clouds/weatherTextures'

interface ResourceLoaders {
  luts(signal: AbortSignal): Promise<AtmosphereLUTs>
  weather(shapeMipmaps: boolean, signal: AbortSignal): Promise<WeatherTextures>
  destroyLuts(value: AtmosphereLUTs): void
  destroyWeather(value: WeatherTextures): void
}

export interface CommunityResources {
  get(shapeMipmaps: boolean, signal?: AbortSignal): Promise<{ luts: AtmosphereLUTs; weather: WeatherTextures }>
  stats(): { lutLoads: number; weatherLoads: number; cacheHits: number }
  destroy(): Promise<void>
}

function aborted(): DOMException { return new DOMException('Resource request aborted', 'AbortError') }

/** One Viewer owns the prepared textures; provider rebuilds only borrow them. */
export function createCommunityResources(loaders: ResourceLoaders): CommunityResources {
  const controller = new AbortController()
  let destroyed = false
  let disposal: Promise<void> | undefined
  let lutTask: Promise<AtmosphereLUTs> | undefined
  const weatherTasks = new Map<boolean, Promise<WeatherTextures>>()
  let readyLuts: AtmosphereLUTs | undefined
  const readyWeather = new Set<WeatherTextures>()
  const counts = { lutLoads: 0, weatherLoads: 0, cacheHits: 0 }

  function getLuts(): Promise<AtmosphereLUTs> {
    if (!lutTask) {
      counts.lutLoads++
      lutTask = loaders.luts(controller.signal).then(value => {
        if (destroyed) { loaders.destroyLuts(value); throw aborted() }
        readyLuts = value
        return value
      }).catch(error => { lutTask = undefined; throw error })
    }
    return lutTask
  }

  function getWeather(mipmaps: boolean): Promise<WeatherTextures> {
    let task = weatherTasks.get(mipmaps)
    if (!task) {
      counts.weatherLoads++
      task = loaders.weather(mipmaps, controller.signal).then(value => {
        if (destroyed) { loaders.destroyWeather(value); throw aborted() }
        readyWeather.add(value)
        return value
      }).catch(error => { weatherTasks.delete(mipmaps); throw error })
      weatherTasks.set(mipmaps, task)
    }
    return task
  }

  return {
    async get(mipmaps, signal) {
      if (destroyed || signal?.aborted) throw aborted()
      if (lutTask && weatherTasks.has(mipmaps)) counts.cacheHits++
      // Begin independent downloads/preparation together, including the first mount.
      const prepared = Promise.all([getLuts(), getWeather(mipmaps)])
        .then(([luts, weather]) => ({ luts, weather }))
      if (!signal) return prepared
      let rejectAbort: (() => void) | undefined
      const cancelled = new Promise<never>((_, reject) => {
        rejectAbort = () => reject(aborted())
        signal.addEventListener('abort', rejectAbort, { once: true })
      })
      try { return await Promise.race([prepared, cancelled]) }
      finally { if (rejectAbort) signal.removeEventListener('abort', rejectAbort) }
    },
    stats: () => ({ ...counts }),
    destroy() {
      if (disposal) return disposal
      destroyed = true
      controller.abort()
      if (readyLuts) loaders.destroyLuts(readyLuts)
      for (const weather of readyWeather) loaders.destroyWeather(weather)
      readyLuts = undefined
      readyWeather.clear()
      // Wait for late PNG decoding/uploads before the owner destroys Context.
      disposal = Promise.allSettled([...(lutTask ? [lutTask] : []), ...weatherTasks.values()]).then(() => undefined)
      weatherTasks.clear()
      return disposal
    },
  }
}
