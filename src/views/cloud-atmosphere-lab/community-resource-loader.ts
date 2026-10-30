import type { Context, Viewer } from 'cesium'
import { loadAtmosphereLUTs } from '../../vendor/cesium-geospatial/core/cesium/lutLoader'
import { loadWeatherTextures } from '../../vendor/cesium-geospatial/clouds/weatherTextures'
import { createCommunityResources, type CommunityResources } from './community-resources'

/** Prepare assets without importing cloud/atmosphere shader implementations. */
export function createCommunityResourceCache(viewer: Viewer): CommunityResources {
  const context = (viewer.scene as unknown as { context: Context }).context
  const root = `${import.meta.env.BASE_URL}city-rendering/atmosphere`
  return createCommunityResources({
    luts: signal => loadAtmosphereLUTs(context, `${root}/lut`, signal),
    weather: (shapeMipmaps, signal) => loadWeatherTextures(context, `${root}/clouds-assets`, signal, { shapeMipmaps }),
    destroyLuts: value => { for (const texture of [value.transmittance,value.scattering,value.irradiance,value.higherOrderScattering]) if (!texture.isDestroyed()) texture.destroy() },
    destroyWeather: value => { for (const texture of [value.shape,value.shapeDetail,value.stbn,value.localWeather]) if (!texture.isDestroyed()) texture.destroy() },
  })
}
