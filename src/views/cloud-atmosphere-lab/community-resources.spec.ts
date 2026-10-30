import { describe, expect, it, vi } from 'vitest'
import { createCommunityResources } from './community-resources'
import type { AtmosphereLUTs } from '../../vendor/cesium-geospatial/core/cesium/lutLoader'
import type { WeatherTextures } from '../../vendor/cesium-geospatial/clouds/weatherTextures'
const luts={} as AtmosphereLUTs, weather={} as WeatherTextures
function fixture(){return {luts:vi.fn(async()=>luts),weather:vi.fn(async()=>weather),destroyLuts:vi.fn(),destroyWeather:vi.fn()}}
describe('Viewer-owned community resources',()=>{
  it('starts independent resource preparation concurrently and reuses it on rebuild',async()=>{
    let finishLuts:(value:AtmosphereLUTs)=>void=()=>undefined
    const loaders=fixture()
    loaders.luts.mockImplementation(()=>new Promise(resolve=>{finishLuts=resolve}))
    const cache=createCommunityResources(loaders), pending=cache.get(true)
    expect(loaders.weather).toHaveBeenCalledOnce()
    finishLuts(luts)
    expect(await pending).toEqual({luts,weather})
    await cache.get(true)
    expect(loaders.luts).toHaveBeenCalledOnce()
    expect(loaders.weather).toHaveBeenCalledOnce()
    cache.destroy();cache.destroy()
    expect(loaders.destroyLuts).toHaveBeenCalledOnce()
    expect(loaders.destroyWeather).toHaveBeenCalledOnce()
  })
  it('does not cancel shared assets when one provider is superseded',async()=>{
    let finish:(value:AtmosphereLUTs)=>void=()=>undefined
    const loaders=fixture();loaders.luts.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
    const cache=createCommunityResources(loaders), controller=new AbortController()
    const pending=cache.get(true,controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({name:'AbortError'})
    finish(luts)
    await cache.get(true)
    expect(loaders.luts).toHaveBeenCalledOnce()
    cache.destroy()
  })
  it('releases late arrivals after Viewer teardown',async()=>{
    let finish:(value:AtmosphereLUTs)=>void=()=>undefined
    const loaders=fixture();loaders.luts.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
    const cache=createCommunityResources(loaders), pending=cache.get(true)
    await Promise.resolve()
    cache.destroy();finish(luts)
    await expect(pending).rejects.toMatchObject({name:'AbortError'})
    expect(loaders.destroyLuts).toHaveBeenCalledOnce()
    expect(loaders.destroyWeather).toHaveBeenCalledOnce()
    await expect(cache.get(true)).rejects.toMatchObject({name:'AbortError'})
  })
  it('retries failed assets without discarding other successful preparations',async()=>{
    const loaders=fixture();loaders.weather.mockRejectedValueOnce(new Error('network'))
    const cache=createCommunityResources(loaders)
    await expect(cache.get(true)).rejects.toThrow('network')
    await cache.get(true)
    expect(loaders.luts).toHaveBeenCalledOnce()
    expect(loaders.weather).toHaveBeenCalledTimes(2)
    cache.destroy()
  })
})
