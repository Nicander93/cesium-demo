import * as Cesium from 'cesium';
/**
 * CGCS2000坐标系图形切片方案
 */
export class GeographicTilingScheme4490 extends Cesium.GeographicTilingScheme {
  constructor(options) {
    super(options);
    this.options = options;
    this.init();
  }

  init() {
    const EllipsoidExt = Cesium.Ellipsoid;
    // CGCS2000 椭球参数

    EllipsoidExt.CGCS2000 = Object.freeze(new Cesium.Ellipsoid(6378137.0, 6378137.0, 6356752.31414035585));

    // this.options 赋给 options
    const { options } = this;
    const self = this;
    if (
      Cesium.defined(options.tileInfo) &&
      Cesium.defined(options.tileInfo.spatialReference) &&
      Cesium.defined(options.tileInfo.spatialReference.wkid) &&
      options.tileInfo.spatialReference.wkid === 4490
    ) {
      self._tileInfo = options.tileInfo;
      self._ellipsoid = options.ellipsoid ?? EllipsoidExt.CGCS2000;
      
      // 根据 origin 设置默认 rectangle
      // 如果提供了 rectangle，使用提供的；否则根据 origin 计算
      if (Cesium.defined(options.rectangle)) {
        self._rectangle = options.rectangle;
      } else if (Cesium.defined(options.tileInfo.origin)) {
        const originX = options.tileInfo.origin.x;
        const originY = options.tileInfo.origin.y;
        // 根据 origin 设置默认范围
        // -400, 400 起点：(-400, -320, 320, 400)
        // -180, 90 起点：(-180, -90, 180, 90)
        if (originX === -400 && originY === 400) {
          self._rectangle = Cesium.Rectangle.fromDegrees(-400, -320, 320, 400);
        } else {
          // 默认使用 -180, 90 起点的范围
          self._rectangle = Cesium.Rectangle.fromDegrees(-180, -90, 180, 90);
        }
      } else {
        // 默认使用 -180, 90 起点的范围
        self._rectangle = Cesium.Rectangle.fromDegrees(-180, -90, 180, 90);
      }
      
      // X/Y 方向0级时切片数量
      self._numberOfLevelZeroTilesX = options.numberOfLevelZeroTilesX ?? 4;
      self._numberOfLevelZeroTilesY = options.numberOfLevelZeroTilesY ?? 2;
    }
    self._projection = new Cesium.GeographicProjection(self._ellipsoid);
  }

  /**
   * 获取切片等级包含的切片数
   * @param level 切片等级
   * @returns {number|*}
   */
  getNumberOfXTilesAtLevel(level) {
    const self = this;
    if (!Cesium.defined(self._tileInfo)) {
      return self._numberOfLevelZeroTilesX << level;
    } else {
      const currentMatrix = self._tileInfo.lods.filter(function (item) {
        return item.level === level;
      });
      const currentResolution = currentMatrix[0].resolution;
      // 根据文章，使用公式计算：(右顶点X-左顶点X)/(256*分辨率)
      // 对于 -400,400 起点：范围是 (-400, -320, 320, 400)，所以是 [320-(-400)]/(256*分辨率)
      // 对于 -180,90 起点：范围是 (-180, -90, 180, 90)，所以是 [180-(-180)]/(256*分辨率)
      const rectangle = self._rectangle;
      const extentWidth = Cesium.Math.toDegrees(rectangle.east) - Cesium.Math.toDegrees(rectangle.west);
      return Math.round(extentWidth / (self._tileInfo.rows * currentResolution));
    }
  }

  /**
   * 获取切片等级包含的切片数（Y方向）
   * @param level 切片等级
   * @returns {number|*}
   */
  getNumberOfYTilesAtLevel(level) {
    const self = this;
    if (!Cesium.defined(self._tileInfo)) {
      return self._numberOfLevelZeroTilesY << level;
    } else {
      const currentMatrix = self._tileInfo.lods.filter(function (item) {
        return item.level === level;
      });
      const currentResolution = currentMatrix[0].resolution;
      // 根据文章，使用公式计算：(上顶点Y-下顶点Y)/(256*分辨率)
      const rectangle = self._rectangle;
      const extentHeight = Cesium.Math.toDegrees(rectangle.north) - Cesium.Math.toDegrees(rectangle.south);
      return Math.round(extentHeight / (self._tileInfo.cols * currentResolution));
    }
  }

  rectangleToNativeRectangle(rectangle, result) {
    const west = Cesium.Math.toDegrees(rectangle.west);
    const south = Cesium.Math.toDegrees(rectangle.south);
    const east = Cesium.Math.toDegrees(rectangle.east);
    const north = Cesium.Math.toDegrees(rectangle.north);

    if (!Cesium.defined(result)) {
      return new Cesium.Rectangle(west, south, east, north);
    }

    result.west = west;
    result.south = south;
    result.east = east;
    result.north = north;
    return result;
  }

  /**
   * 获取切片占据的范围（单位：度）
   * @param x
   * @param y
   * @param level
   * @param result
   * @returns {*}
   */
  tileXYToNativeRectangle(x, y, level, result) {
    const rectangleRadians = this.tileXYToRectangle(x, y, level, result);
    rectangleRadians.west = Cesium.Math.toDegrees(rectangleRadians.west);
    rectangleRadians.south = Cesium.Math.toDegrees(rectangleRadians.south);
    rectangleRadians.east = Cesium.Math.toDegrees(rectangleRadians.east);
    rectangleRadians.north = Cesium.Math.toDegrees(rectangleRadians.north);
    return rectangleRadians;
  }

  /**
   * 计算切片占据的范围
   * @param x
   * @param y
   * @param level
   * @param result
   * @returns {*}
   */
  tileXYToRectangle(x, y, level, result) {
    const self = this;
    const rectangle = self._rectangle;

    let west = 0;
    let east = 0;

    let north = 0;
    let south = 0;

    if (Cesium.defined(self._tileInfo)) {
      const currentMatrix = self._tileInfo.lods.filter(function (item) {
        return item.level === level;
      });
      const currentResolution = currentMatrix[0].resolution;

      north = self._tileInfo.origin.y - y * (self._tileInfo.cols * currentResolution);
      west = self._tileInfo.origin.x + x * (self._tileInfo.rows * currentResolution);

      south = self._tileInfo.origin.y - (y + 1) * (self._tileInfo.cols * currentResolution);
      east = self._tileInfo.origin.x + (x + 1) * (self._tileInfo.rows * currentResolution);

      west = Cesium.Math.toRadians(west);
      north = Cesium.Math.toRadians(north);
      east = Cesium.Math.toRadians(east);
      south = Cesium.Math.toRadians(south);
    } else {
      const xTiles = this.getNumberOfXTilesAtLevel(level);
      const yTiles = this.getNumberOfYTilesAtLevel(level);

      const xTileWidth = rectangle.width / xTiles;
      west = x * xTileWidth + rectangle.west;
      east = (x + 1) * xTileWidth + rectangle.west;

      const yTileHeight = rectangle.height / yTiles;
      north = rectangle.north - y * yTileHeight;
      south = rectangle.north - (y + 1) * yTileHeight;
    }

    if (!Cesium.defined(result)) {
      result = new Cesium.Rectangle(west, south, east, north);
    }

    result.west = west;
    result.south = south;
    result.east = east;
    result.north = north;
    return result;
  }

  /**
   * 地理坐标转直角坐标XY
   * @param position
   * @param level
   * @param result
   * @returns {module:cesium.Cartesian2|N|undefined|*}
   */
  positionToTileXY(position, level, result) {
    const self = this;
    const rectangle = self._rectangle;
    // 超出切片方案范围的切片
    if (!Cesium.Rectangle.contains(rectangle, position)) {
      return undefined;
    }

    if (Cesium.defined(self._tileInfo)) {
      const currentMatrix = self._tileInfo.lods.filter(function (item) {
        return item.level === level;
      });
      const currentResolution = currentMatrix[0].resolution;

      const degLon = Cesium.Math.toDegrees(position.longitude);
      const degLat = Cesium.Math.toDegrees(position.latitude);

      const x4490 = Math.floor((degLon - self._tileInfo.origin.x) / (self._tileInfo.rows * currentResolution));
      const y4490 = Math.floor((self._tileInfo.origin.y - degLat) / (self._tileInfo.cols * currentResolution));

      return new Cesium.Cartesian2(x4490, y4490);
    }

    const xTiles = self.getNumberOfXTilesAtLevel(level);
    const yTiles = this.getNumberOfYTilesAtLevel(level);

    const xTileWidth = rectangle.width / xTiles;
    const yTileHeight = rectangle.height / yTiles;

    let longitude = position.longitude;
    if (rectangle.east < rectangle.west) {
      longitude += Cesium.Math.TWO_PI;
    }

    let xTileCoordinate = ((longitude - rectangle.west) / xTileWidth) | 0;
    if (xTileCoordinate >= xTiles) {
      xTileCoordinate = xTiles - 1;
    }

    let yTileCoordinate = ((rectangle.north - position.latitude) / yTileHeight) | 0;
    if (yTileCoordinate >= yTiles) {
      yTileCoordinate = yTiles - 1;
    }

    if (!Cesium.defined(result)) {
      return new Cesium.Cartesian2(xTileCoordinate, yTileCoordinate);
    }

    result.x = xTileCoordinate;
    result.y = yTileCoordinate;
    return result;
  }
}
