import * as Cesium from 'cesium';
import { GeographicTilingScheme4490 } from './GeographicTilingScheme4490';

export class ArcGisMapServerImageryProviderExt extends Cesium.ArcGisMapServerImageryProvider {
  options = Cesium.ArcGisMapServerImageryProvider.ConstructorOptionsScene;

  static normalizeMapServerUrl(url) {
    if (!url) return url;
    const urlStr = url.toString().split(/[?#]/)[0].replace(/\/$/, '');
    const lower = urlStr.toLowerCase();
    const restIndex = lower.indexOf('/rest/services/');
    if (restIndex !== -1) {
      const mapServerIndex = lower.indexOf('/mapserver', restIndex);
      if (mapServerIndex !== -1) {
        return urlStr.substring(0, mapServerIndex + '/MapServer'.length);
      }
      return urlStr + '/MapServer';
    }
    const mapServerIndex = lower.lastIndexOf('/mapserver');
    if (mapServerIndex !== -1) {
      const suffixIndex = mapServerIndex + '/MapServer'.length;
      return urlStr.substring(0, suffixIndex);
    }
    return urlStr + '/MapServer';
  }

  constructor(options) {
    const originalOptions = options ?? {};
    const rawUrl = originalOptions.url;
    const skipInit = originalOptions._skipInit || false;
    delete originalOptions._skipInit;
    super(originalOptions);
    this.options = originalOptions;
    this._rawUrl = rawUrl ?? originalOptions.url ?? null;
    this._metadata = null;
    this._baseUrl = this._rawUrl
      ? ArcGisMapServerImageryProviderExt.normalizeMapServerUrl(this._rawUrl)
      : null;
    if (!this._resource && this._baseUrl) {
      this._resource = Cesium.Resource.createIfNeeded(this._baseUrl);
      this._resource.appendForwardSlash();
    }
    if (!skipInit) {
      this.init();
    }
    this.show = undefined;
  }

  static fromUrl(url, options = {}) {
    const resource = Cesium.Resource.createIfNeeded(url);
    const metadataPromise = resource
      .getDerivedResource({
        queryParameters: {
          f: 'json'
        }
      })
      .fetchJsonp();

    return metadataPromise
      .then((metadata) => {
        if (metadata.spatialReference && metadata.spatialReference.wkid === 4490) {
          const providerOptions = options ?? {};
          providerOptions.url = url;
          providerOptions._skipInit = true;
          const provider = new ArcGisMapServerImageryProviderExt(providerOptions);
          provider._rawUrl = url;
          provider._metadata = metadata;
          provider._baseUrl = ArcGisMapServerImageryProviderExt.normalizeMapServerUrl(url);
          provider._resource = Cesium.Resource.createIfNeeded(provider._baseUrl);
          provider._resource.appendForwardSlash();
          provider.metadata4490Success(metadata);
          return provider;
        } else {
          return Cesium.ArcGisMapServerImageryProvider.fromUrl(url, options);
        }
      })
      .catch((error) => {
        console.error('Failed to load ArcGIS metadata:', error);
        throw error;
      });
  }

  init() {
    if (this._metadata) {
      this.metadata4490Success(this._metadata);
      return;
    }

    const self = this;

    function requestMetadata() {
      const resource = self._resource.getDerivedResource({
        queryParameters: {
          f: 'json'
        }
      });
      const metadata = resource.fetchJsonp();
      metadata
        .then((data) => {
          self.metadata4490Success(data);
        })
        .catch((error) => {
          console.error('Failed to load ArcGIS metadata:', error);
        });
    }

    requestMetadata();
  }

  metadata4490Success(data) {
    const tileInfo = data.tileInfo;
    // 切片地图服务
    if (data.spatialReference.wkid === 4490 && tileInfo) {
      const self = this;
      // this.options 赋给 options
      const { options } = this;
      if (options) {
        if (data.tileInfo.spatialReference.wkid === 4490) {
          const geoTilingScheme = new GeographicTilingScheme4490({
            ellipsoid: options.ellipsoid,
            tileInfo: tileInfo,
            rectangle: options.rectangle,
            numberOfLevelZeroTilesX: options.numberOfLevelZeroTilesX,
            numberOfLevelZeroTilesY: options.numberOfLevelZeroTilesY
          });
          self._tilingScheme = geoTilingScheme;
        }
        self._maximumLevel = tileInfo.lods.length - 1;
        self._useTiles = true;
        // 解析extent
        // 如果提供了 rectangle 选项，优先使用；否则使用 fullExtent 或 tilingScheme 的 rectangle
        if (Cesium.defined(options.rectangle)) {
          self._rectangle = options.rectangle;
        } else if (Cesium.defined(data.fullExtent)) {
          if (
            Cesium.defined(data.fullExtent.spatialReference) &&
            Cesium.defined(data.fullExtent.spatialReference.wkid)
          ) {
            if (data.fullExtent.spatialReference.wkid === 4490) {
              self._rectangle = Cesium.Rectangle.fromDegrees(
                data.fullExtent.xmin,
                data.fullExtent.ymin,
                data.fullExtent.xmax,
                data.fullExtent.ymax
              );
            }
          }
        } else {
          self._rectangle = self._tilingScheme.rectangle;
        }

        // 配置需要忽略（缺失的）的切片
        if (!Cesium.defined(self._tileDiscardPolicy) && self._resource) {
          try {
            const imageResource = self.buildImageResource(self, 0, 0, self._maximumLevel);
            if (imageResource && imageResource.url) {
              self._tileDiscardPolicy = new Cesium.DiscardMissingTileImagePolicy({
                missingImageUrl: imageResource.url,
                pixelsToCheck: [
                  new Cesium.Cartesian2(0, 0),
                  new Cesium.Cartesian2(200, 20),
                  new Cesium.Cartesian2(20, 200),
                  new Cesium.Cartesian2(80, 110),
                  new Cesium.Cartesian2(160, 130)
                ],
                disableCheckIfAllPixelsAreTransparent: true
              });
            }
          } catch (error) {
            console.warn('Failed to create DiscardMissingTileImagePolicy:', error);
          }
        }
      }

      // 解析版权信息
      if (Cesium.defined(data.copyrightText) && data.copyrightText.length > 0) {
        self._credit = new Cesium.Credit(data.copyrightText);
      }
      self._ready = true;
      // self._readyPromise.resolve(true)
    }
  }

  buildImageResource(imageryProvider, x, y, level, request) {
    if (!imageryProvider._resource) {
      let baseUrl =
        imageryProvider._baseUrl ||
        imageryProvider._rawUrl ||
        imageryProvider.options?.url ||
        imageryProvider._url;
      if (baseUrl) {
        baseUrl = ArcGisMapServerImageryProviderExt.normalizeMapServerUrl(baseUrl);
        imageryProvider._resource = Cesium.Resource.createIfNeeded(baseUrl);
        imageryProvider._resource.appendForwardSlash();
      } else {
        throw new Error('Resource is not initialized and URL is not available');
      }
    }

    let resource;
    // 请求切片
    if (imageryProvider._useTiles) {
      resource = imageryProvider._resource.getDerivedResource({
        url: 'tile/' + level + '/' + y + '/' + x,
        request: request
      });

      // 请求动态地图
    } else {
      const nativeRectangle = imageryProvider._tilingScheme.tileXYToNativeRectangle(x, y, level);
      const bbox =
        nativeRectangle.west + ',' + nativeRectangle.south + ',' + nativeRectangle.east + ',' + nativeRectangle.north;

      const query = {
        bbox: bbox,
        size: imageryProvider._tileWidth + ',' + imageryProvider._tileHeight,
        format: 'png32',
        transparent: true,
        f: 'image'
      };

      if (imageryProvider._tilingScheme.projection instanceof Cesium.GeographicProjection) {
        query.bboxSR = 4490;
        query.imageSR = 4490;
      } else {
        query.bboxSR = 3857;
        query.imageSR = 3857;
      }
      if (imageryProvider.layers) {
        query.layers = 'show:' + imageryProvider.layers;
      }
      if (imageryProvider.gtoken) {
        query.gtoken = imageryProvider.gtoken;
      }

      resource = imageryProvider._resource.getDerivedResource({
        url: 'export',
        request: request,
        queryParameters: query
      });
    }

    return resource;
  }
}
