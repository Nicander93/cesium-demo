import * as Cesium from 'cesium'

const TDT_SUBDOMAINS = ['0', '1', '2', '3', '4', '5', '6', '7']

export const TDT_WMTS = {
  img: 'https://t{s}.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={TileMatrix}&TILEROW={TileRow}&TILECOL={TileCol}&tk=',
  cia: 'https://t{s}.tianditu.gov.cn/cia_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cia&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={TileMatrix}&TILEROW={TileRow}&TILECOL={TileCol}&tk=',
}

const TDT_PLUGIN_SCRIPTS = [
  'https://api.tianditu.gov.cn/cdn/plugins/cesium/Cesium_ext_min.js',
  'https://api.tianditu.gov.cn/cdn/plugins/cesium/long.min.js',
  'https://api.tianditu.gov.cn/cdn/plugins/cesium/bytebuffer.min.js',
  'https://api.tianditu.gov.cn/cdn/plugins/cesium/protobuf.min.js',
  'https://api.tianditu.gov.cn/cdn/plugins/cesium/cesiumTdt.js',
]

type TdtNamespace = {
  GeoTerrainProvider?: any
  GeoWTFS?: any
}

declare global {
  interface Window {
    __TDT_NS?: TdtNamespace
    __TDT_PLUGIN_PROMISE?: Promise<TdtNamespace | null>
  }
}

function loadScriptOnce(url: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(
      `script[data-tdt-plugin="${url}"]`,
    ) as HTMLScriptElement | null
    if (existing) {
      if ((existing as any).__loaded) resolve()
      else existing.addEventListener('load', () => resolve(), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = url
    script.async = false
    script.defer = false
    script.setAttribute('data-tdt-plugin', url)
    script.addEventListener('load', () => {
      ;(script as any).__loaded = true
      resolve()
    })
    script.addEventListener('error', () =>
      reject(new Error(`Failed to load script: ${url}`)),
    )
    document.head.appendChild(script)
  })
}

export async function ensureTdtPluginLoaded() {
  if (window.__TDT_PLUGIN_PROMISE) return window.__TDT_PLUGIN_PROMISE
  window.__TDT_PLUGIN_PROMISE = (async () => {
    const prevCesium = (window as any).Cesium
    ;(window as any).Cesium = Cesium
    for (const url of TDT_PLUGIN_SCRIPTS) {
      await loadScriptOnce(url)
    }
    const ns: TdtNamespace = {
      GeoTerrainProvider: (window as any).Cesium?.GeoTerrainProvider,
      GeoWTFS: (window as any).Cesium?.GeoWTFS,
    }
    window.__TDT_NS = ns
    if (prevCesium === undefined) {
      delete (window as any).Cesium
    } else {
      ;(window as any).Cesium = prevCesium
    }
    if (!ns.GeoTerrainProvider) return null
    return ns
  })()
  return window.__TDT_PLUGIN_PROMISE
}

export function createTdtWmtsImageryProvider(
  type: 'img' | 'cia',
  token: string,
) {
  const url = TDT_WMTS[type] + token
  return new Cesium.WebMapTileServiceImageryProvider({
    url,
    layer: type,
    style: 'default',
    format: 'tiles',
    tileMatrixSetID: 'w',
    subdomains: TDT_SUBDOMAINS,
    maximumLevel: 18,
  })
}

export async function createTdtTerrainProvider(token: string) {
  const ns = await ensureTdtPluginLoaded().catch(() => null)
  if (!ns || !ns.GeoTerrainProvider) return null
  const urls = TDT_SUBDOMAINS.map(
    (s) => `https://t${s}.tianditu.gov.cn/mapservice/swdx?T=elv_c&tk=${token}`,
  )
  return new ns.GeoTerrainProvider({ urls })
}
