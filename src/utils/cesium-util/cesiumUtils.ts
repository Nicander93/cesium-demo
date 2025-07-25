import * as Cesium from 'cesium';

// 提取Cesium原生构造函数参数类型
type Cesium3DTilesetOptions = ConstructorParameters<typeof Cesium.Cesium3DTileset>[0];
type EntityOptions = Cesium.Entity.ConstructorOptions;

// 影像提供者构造参数类型
type WebMapServiceImageryProviderOptions = ConstructorParameters<typeof Cesium.WebMapServiceImageryProvider>[0];
type WebMapTileServiceImageryProviderOptions = ConstructorParameters<typeof Cesium.WebMapTileServiceImageryProvider>[0];
type UrlTemplateImageryProviderOptions = ConstructorParameters<typeof Cesium.UrlTemplateImageryProvider>[0];
type BingMapsImageryProviderOptions = ConstructorParameters<typeof Cesium.BingMapsImageryProvider>[0];
type ArcGisMapServerImageryProviderOptions = ConstructorParameters<typeof Cesium.ArcGisMapServerImageryProvider>[0];

// GeoJSON/KML/CZML加载选项类型
type GeoJsonLoadOptions = Parameters<typeof Cesium.GeoJsonDataSource.load>[1];
type KmlLoadOptions = Parameters<typeof Cesium.KmlDataSource.load>[1];
type CzmlLoadOptions = Parameters<typeof Cesium.CzmlDataSource.load>[1];

// 基础配置接口
export interface BaseLayerOptions {
  id?: string;
  name?: string;
  show?: boolean;
}

// GeoJSON图层选项 - 使用Cesium原生选项
export interface GeoJsonLayerOptions extends BaseLayerOptions {
  type: 'geojson';
  url?: string;
  data?: any;
  style?: any;
  clustering?: boolean;
  clampToGround?: boolean;
  options?: GeoJsonLoadOptions;
}

// KML图层选项 - 使用Cesium原生选项
export interface KmlLayerOptions extends BaseLayerOptions {
  type: 'kml';
  url?: string;
  data?: any;
  clampToGround?: boolean;
  options?: KmlLoadOptions;
}

// CZML图层选项 - 使用Cesium原生选项
export interface CzmlLayerOptions extends BaseLayerOptions {
  type: 'czml';
  url?: string;
  data?: any;
  options?: CzmlLoadOptions;
}

// WMS图层选项 - 使用Cesium原生选项
export interface WmsLayerOptions extends BaseLayerOptions {
  type: 'wms';
  options?: WebMapServiceImageryProviderOptions;
}

// WMTS图层选项 - 使用Cesium原生选项
export interface WmtsLayerOptions extends BaseLayerOptions {
  type: 'wmts';
  options?: WebMapTileServiceImageryProviderOptions;
}

// XYZ图层选项 - 使用Cesium原生选项
export interface XyzLayerOptions extends BaseLayerOptions {
  type: 'xyz';
  options?: UrlTemplateImageryProviderOptions;
}

// Bing图层选项 - 使用Cesium原生选项
export interface BingLayerOptions extends BaseLayerOptions {
  type: 'bing';
  options?: BingMapsImageryProviderOptions;
}

// ArcGIS图层选项 - 使用Cesium原生选项
export interface ArcGisLayerOptions extends BaseLayerOptions {
  type: 'arcgis';
  options?: ArcGisMapServerImageryProviderOptions;
}

// 3D瓦片选项 - 使用Cesium原生选项
export interface TilesetLayerOptions extends BaseLayerOptions {
  type: '3dtiles';
  url: string;
  options?: Cesium3DTilesetOptions;
}

// Entity选项 - 使用Cesium原生选项，但支持数组形式的position
export interface EntityLayerOptions extends BaseLayerOptions, Omit<EntityOptions, 'id' | 'name' | 'show' | 'position'> {
  type: 'entity';
  position?: Cesium.Cartesian3 | number[];
}

// Primitive选项
export interface PrimitiveLayerOptions extends BaseLayerOptions {
  type: 'primitive';
  primitiveType: 'point' | 'polyline' | 'polygon' | 'box' | 'cylinder' | 'ellipsoid' | 'sphere' | 'wall';
  positions?: Cesium.Cartesian3[] | number[][];
  position?: Cesium.Cartesian3 | number[];
  dimensions?: Cesium.Cartesian3;
  radii?: Cesium.Cartesian3;
  height?: number;
  extrudedHeight?: number;
  material?: Cesium.Material | Cesium.Color | string;
  outline?: boolean;
  outlineColor?: Cesium.Color | string;
  outlineWidth?: number;
  asynchronous?: boolean;
  releaseGeometryInstances?: boolean;
  allowPicking?: boolean;
  classificationType?: Cesium.ClassificationType;
  appearance?: Cesium.Appearance;
  // Primitive特有属性
  width?: number;
  radius?: number;
  length?: number;
  topRadius?: number;
  bottomRadius?: number;
  maximumHeights?: number[];
  minimumHeights?: number[];
  granularity?: number;
}

// 联合类型 - 根据type字段提供不同的选项类型
export type LayerOptions =
  | GeoJsonLayerOptions
  | KmlLayerOptions
  | CzmlLayerOptions
  | WmsLayerOptions
  | WmtsLayerOptions
  | XyzLayerOptions
  | BingLayerOptions
  | ArcGisLayerOptions
  | TilesetLayerOptions
  | EntityLayerOptions
  | PrimitiveLayerOptions;

// 保持原有的独立配置接口用于直接调用对应方法
export interface TilesetOptions extends BaseLayerOptions {
  type: '3dtiles' | '3dtileset';
  url: string;
  options?: Cesium3DTilesetOptions;
}

// Primitive配置接口
export interface PrimitiveOptions extends BaseLayerOptions {
  type: 'point' | 'polyline' | 'polygon' | 'box' | 'cylinder' | 'ellipsoid' | 'sphere' | 'wall';
  positions?: Cesium.Cartesian3[] | number[];
  position?: Cesium.Cartesian3 | number[];
  dimensions?: Cesium.Cartesian3;
  radii?: Cesium.Cartesian3;
  height?: number;
  extrudedHeight?: number;
  material?: Cesium.Material | Cesium.Color | string;
  outline?: boolean;
  outlineColor?: Cesium.Color | string;
  outlineWidth?: number;
  asynchronous?: boolean;
  releaseGeometryInstances?: boolean;
  allowPicking?: boolean;
  classificationType?: Cesium.ClassificationType;
  appearance?: Cesium.Appearance;
}

// Entity配置接口 - 使用Cesium原生类型
export interface EntityConfig extends BaseLayerOptions, Omit<EntityOptions, 'id' | 'name' | 'show' | 'position'> {
  position?: Cesium.Cartesian3 | number[];
}

// Billboard配置接口
export interface BillboardOptions extends BaseLayerOptions {
  position: Cesium.Cartesian3 | number[];
  image?: string | HTMLCanvasElement | HTMLImageElement;
  text?: string;
  font?: string;
  fillColor?: Cesium.Color | string;
  outlineColor?: Cesium.Color | string;
  outlineWidth?: number;
  style?: Cesium.LabelStyle;
  scale?: number;
  pixelOffset?: Cesium.Cartesian2;
  eyeOffset?: Cesium.Cartesian3;
  horizontalOrigin?: Cesium.HorizontalOrigin;
  verticalOrigin?: Cesium.VerticalOrigin;
  heightReference?: Cesium.HeightReference;
  disableDepthTestDistance?: number;
}

/**
 * Cesium工具类 - 用于便于创建Cesium中各种数据
 * 参考mars3d LayerUtil设计
 */
export class LayerUtil {

  /**
   * 将经纬度数组转换为Cartesian3
   */
  static degreesToCartesian3(degrees: number[]): Cesium.Cartesian3 {
    if (degrees.length === 2) {
      return Cesium.Cartesian3.fromDegrees(degrees[0], degrees[1]);
    } else if (degrees.length === 3) {
      return Cesium.Cartesian3.fromDegrees(degrees[0], degrees[1], degrees[2]);
    }
    throw new Error('Invalid degrees array length');
  }

  /**
   * 将颜色字符串转换为Cesium.Color
   */
  static parseColor(color: string | Cesium.Color, alpha?: number): Cesium.Color {
    if (color instanceof Cesium.Color) {
      return alpha !== undefined ? color.withAlpha(alpha) : color;
    }

    if (typeof color === 'string') {
      try {
        const cesiumColor = Cesium.Color.fromCssColorString(color);
        return alpha !== undefined ? cesiumColor.withAlpha(alpha) : cesiumColor;
      } catch (error) {
        // 如果解析失败，返回默认白色
        return alpha !== undefined ? Cesium.Color.WHITE.withAlpha(alpha) : Cesium.Color.WHITE;
      }
    }

    return Cesium.Color.WHITE;
  }

  /**
   * 生成随机ID
   */
  static generateId(prefix: string = 'cesium'): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // ========================= 图层管理 =========================

  /**
   * 创建图层
   */
  static async createLayer(options: LayerOptions): Promise<any> {
    const id = options.id || LayerUtil.generateId('layer');

    let layer: any;

    switch (options.type) {
      case 'geojson':
        layer = await LayerUtil.createGeoJsonLayer(options as GeoJsonLayerOptions);
        break;
      case 'kml':
        layer = await LayerUtil.createKmlLayer(options as KmlLayerOptions);
        break;
      case 'czml':
        layer = await LayerUtil.createCzmlLayer(options as CzmlLayerOptions);
        break;
      case 'wms':
        layer = LayerUtil.createWmsLayer(options as WmsLayerOptions);
        break;
      case 'wmts':
        layer = LayerUtil.createWmtsLayer(options as WmtsLayerOptions);
        break;
      case 'xyz':
        layer = LayerUtil.createXyzLayer(options as XyzLayerOptions);
        break;
      case 'bing':
        layer = LayerUtil.createBingLayer(options as BingLayerOptions);
        break;
      case 'arcgis':
        layer = LayerUtil.createArcGisLayer(options as ArcGisLayerOptions);
        break;
      case '3dtiles':
        layer = await LayerUtil.create3DTileset({
          ...options,
          url: options.url as any
        } as TilesetOptions);
        break;
      case 'entity':
        layer = LayerUtil.createEntity(options as EntityLayerOptions);
        break;
      case 'primitive':
        const primitiveOptions = options as PrimitiveLayerOptions;
        layer = LayerUtil.createPrimitive(primitiveOptions);
        break;

      default:
        throw new Error(`Unsupported layer type: ${(options as any).type}`);
    }

    if (layer) {
      layer.name = options.name || id;
      layer.show = options.show !== false;
    }

    return layer;
  }

  /**
   * 批量创建图层
   */
  static async createLayers(options: LayerOptions[]): Promise<any[]> {
    return Promise.all(options.map(option => LayerUtil.createLayer(option)));
  }

  /**
   * 创建GeoJSON图层
   */
  static async createGeoJsonLayer(options: GeoJsonLayerOptions): Promise<Cesium.GeoJsonDataSource> {
    const dataSource = await Cesium.GeoJsonDataSource.load(options.url || options.data, {
      clampToGround: options.clampToGround
    });

    // 应用样式
    if (options.style) {
      LayerUtil.applyGeoJsonStyle(dataSource, options.style);
    }

    // 添加聚类
    if (options.clustering) {
      dataSource.clustering.enabled = true;
      dataSource.clustering.pixelRange = 15;
      dataSource.clustering.minimumClusterSize = 3;
    }

    return dataSource;
  }

  /**
   * 创建KML图层
   */
  static async createKmlLayer(options: KmlLayerOptions): Promise<Cesium.KmlDataSource> {
    const dataSource = await Cesium.KmlDataSource.load(options.url || options.data, {
      clampToGround: options.clampToGround
    });

    return dataSource;
  }

  /**
   * 创建CZML图层
   */
  static async createCzmlLayer(options: CzmlLayerOptions): Promise<Cesium.CzmlDataSource> {
    const dataSource = await Cesium.CzmlDataSource.load(options.url || options.data);
    return dataSource;
  }

  /**
   * 创建WMS图层
   */
  static createWmsLayer(options: WmsLayerOptions): Cesium.ImageryLayer {
    const { url, layers, parameters, ...rest } = options as any;

    const provider = new Cesium.WebMapServiceImageryProvider({
      url: url!,
      layers: layers ?? '',
      parameters: parameters ?? {},
      ...rest, // 其余参数原样透传
    } as any);

    return new Cesium.ImageryLayer(provider);
  }

  /**
   * 创建WMTS图层
   */
  static createWmtsLayer(options: WmtsLayerOptions): Cesium.ImageryLayer {
    const { url, layer, style, format, tileMatrixSetID, ...rest } = options as any;

    const provider = new Cesium.WebMapTileServiceImageryProvider({
      url: url!,
      layer: layer ?? '',
      style: style ?? '',
      format: format ?? 'image/jpeg',
      tileMatrixSetID: tileMatrixSetID ?? '',
      ...rest,
    } as any);

    return new Cesium.ImageryLayer(provider);
  }

  /**
   * 创建XYZ图层
   */
  static createXyzLayer(options: XyzLayerOptions): Cesium.ImageryLayer {
    const { url, ...rest } = options as any;

    const provider = new Cesium.UrlTemplateImageryProvider({
      url: url!,
      ...rest,
    } as any);

    const imageryLayer: Cesium.ImageryLayer = new Cesium.ImageryLayer(provider);
    return imageryLayer;
  }

  /**
   * 创建Bing图层
   */
  static createBingLayer(options: BingLayerOptions): Cesium.ImageryLayer {
    const { key, mapStyle, culture, url, ...rest } = options as any;

    const provider = new Cesium.BingMapsImageryProvider({
      key: key ?? '',
      mapStyle: mapStyle ?? Cesium.BingMapsStyle.AERIAL,
      culture,
      url: url ?? 'https://dev.virtualearth.net',
      ...rest,
    } as any);

    const imageryLayer: Cesium.ImageryLayer = new Cesium.ImageryLayer(provider);
    return imageryLayer;
  }

  /**
   * 创建ArcGIS图层
   */
  static createArcGisLayer(options: ArcGisLayerOptions): Cesium.ImageryLayer {
    const { url, ...rest } = options as any;

    const provider = new Cesium.ArcGisMapServerImageryProvider({
      url: url!,
      ...rest,
    } as any);

    const imageryLayer: Cesium.ImageryLayer = new Cesium.ImageryLayer(provider);
    return imageryLayer;
  }

  /**
   * 应用GeoJSON样式
   */
  static applyGeoJsonStyle(dataSource: Cesium.GeoJsonDataSource, style: any): void {
    const entities = dataSource.entities.values;

    for (const entity of entities) {
      if (entity.point && style.point) {
        Object.assign(entity.point, style.point);
      }
      if (entity.polyline && style.polyline) {
        Object.assign(entity.polyline, style.polyline);
      }
      if (entity.polygon && style.polygon) {
        Object.assign(entity.polygon, style.polygon);
      }
      if (entity.billboard && style.billboard) {
        Object.assign(entity.billboard, style.billboard);
      }
      if (entity.label && style.label) {
        Object.assign(entity.label, style.label);
      }
    }
  }

  // ========================= 3D瓦片 =========================

  /**
   * 创建3D瓦片集
   */
  static async create3DTileset(options: TilesetOptions): Promise<Cesium.Cesium3DTileset> {
    // 使用options中的配置，如果没有则使用默认值
    const tilesetOptions = options.options || {};

    const tileset = await Cesium.Cesium3DTileset.fromUrl(options.url, {
      maximumScreenSpaceError: 16,
      skipLevelOfDetail: true,
      baseScreenSpaceError: 1024,
      skipScreenSpaceErrorFactor: 16,
      skipLevels: 1,
      immediatelyLoadDesiredLevelOfDetail: false,
      loadSiblings: false,
      cullWithChildrenBounds: true,
      enableCollision: false,
      debugShowBoundingVolume: false,
      debugShowContentBoundingVolume: false,
      debugShowViewerRequestVolume: false,
      shadows: Cesium.ShadowMode.ENABLED,
      ...tilesetOptions
    });

    tileset.show = options.show !== false;

    return tileset;
  }

  /**
   * 调整3D瓦片集高度
   */
  static adjust3DTilesetHeight(tileset: Cesium.Cesium3DTileset, deltaHeight: number): void {
    const boundingSphere = tileset.boundingSphere;
    const cartographic = Cesium.Cartographic.fromCartesian(boundingSphere.center);

    const surface = Cesium.Cartesian3.fromRadians(
      cartographic.longitude,
      cartographic.latitude,
      cartographic.height
    );

    const offset = Cesium.Cartesian3.fromRadians(
      cartographic.longitude,
      cartographic.latitude,
      cartographic.height + deltaHeight
    );

    const translation = Cesium.Cartesian3.subtract(offset, surface, new Cesium.Cartesian3());
    tileset.modelMatrix = Cesium.Matrix4.fromTranslation(translation);
  }

  // ========================= Primitive =========================

  /**
   * 创建Primitive
   */
  static createPrimitive(options: PrimitiveLayerOptions): Cesium.Primitive | Cesium.GroundPrimitive {
    const id = options.id || LayerUtil.generateId('primitive');
    let primitive: Cesium.Primitive | Cesium.GroundPrimitive;
    const primitiveType = options.primitiveType || 'polygon';

    switch (primitiveType) {
      case 'point':
        primitive = LayerUtil.createPointPrimitive(options);
        break;
      case 'polyline':
        primitive = LayerUtil.createPolylinePrimitive(options);
        break;
      case 'polygon':
        primitive = LayerUtil.createPolygonPrimitive(options);
        break;
      case 'box':
        primitive = LayerUtil.createBoxPrimitive(options);
        break;
      case 'cylinder':
        primitive = LayerUtil.createCylinderPrimitive(options);
        break;
      case 'ellipsoid':
      case 'sphere':
        primitive = LayerUtil.createEllipsoidPrimitive(options);
        break;
      case 'wall':
        primitive = LayerUtil.createWallPrimitive(options);
        break;
      default:
        throw new Error(`Unsupported primitive type: ${primitiveType}`);
    }

    primitive.show = options.show !== false;

    return primitive;
  }

  /**
   * 创建点Primitive
   */
  static createPointPrimitive(options: PrimitiveLayerOptions): Cesium.Primitive {
    const positions = Array.isArray(options.positions) ? options.positions : [options.position!];
    const instances: Cesium.GeometryInstance[] = [];

    positions.forEach((pos, index) => {
      const position = Array.isArray(pos) ? LayerUtil.degreesToCartesian3(pos as number[]) : pos as Cesium.Cartesian3;

      const geometry = new Cesium.SphereGeometry({
        radius: options.radius || 10000,
        vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT
      });

      const instance = new Cesium.GeometryInstance({
        geometry,
        modelMatrix: Cesium.Matrix4.multiplyByTranslation(
          Cesium.Transforms.eastNorthUpToFixedFrame(position),
          new Cesium.Cartesian3(0, 0, 0),
          new Cesium.Matrix4()
        ),
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(
            LayerUtil.parseColor(options.material as string || '#ffffff')
          )
        },
        id: `${options.id || 'point'}_${index}`
      });

      instances.push(instance);
    });

    return new Cesium.Primitive({
      geometryInstances: instances,
      appearance: new Cesium.PerInstanceColorAppearance({
        translucent: false,
        closed: true
      }),
      asynchronous: options.asynchronous !== false,
      releaseGeometryInstances: options.releaseGeometryInstances !== false,
      allowPicking: options.allowPicking !== false
    });
  }

  /**
   * 创建线Primitive
   */
  static createPolylinePrimitive(options: PrimitiveLayerOptions): Cesium.Primitive {
    const positions = options.positions!.map(pos =>
      Array.isArray(pos) ? LayerUtil.degreesToCartesian3(pos as number[]) : pos as Cesium.Cartesian3
    );

    const geometry = new Cesium.PolylineGeometry({
      positions,
      width: options.width || 1.0,
      vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
      granularity: options.granularity || Cesium.Math.RADIANS_PER_DEGREE
    });

    const instance = new Cesium.GeometryInstance({
      geometry,
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
          LayerUtil.parseColor(options.material as string || '#ffffff')
        )
      }
    });

    return new Cesium.Primitive({
      geometryInstances: instance,
      appearance: new Cesium.PolylineColorAppearance({
        translucent: false
      }),
      asynchronous: options.asynchronous !== false,
      releaseGeometryInstances: options.releaseGeometryInstances !== false,
      allowPicking: options.allowPicking !== false
    });
  }

  /**
   * 创建面Primitive
   */
  static createPolygonPrimitive(options: PrimitiveLayerOptions): Cesium.Primitive | Cesium.GroundPrimitive {
    const positions = options.positions!.map(pos =>
      Array.isArray(pos) ? LayerUtil.degreesToCartesian3(pos as number[]) : pos as Cesium.Cartesian3
    );

    const geometry = new Cesium.PolygonGeometry({
      polygonHierarchy: new Cesium.PolygonHierarchy(positions),
      height: options.height,
      extrudedHeight: options.extrudedHeight,
      vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
      granularity: options.granularity || Cesium.Math.RADIANS_PER_DEGREE
    });

    const instance = new Cesium.GeometryInstance({
      geometry,
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
          LayerUtil.parseColor(options.material as string || '#ffffff')
        )
      }
    });

    // 根据是否贴地选择不同的Primitive类型
    const PrimitiveClass = options.height === 0 && !options.extrudedHeight ?
      Cesium.GroundPrimitive : Cesium.Primitive;

    return new PrimitiveClass({
      geometryInstances: instance,
      appearance: new Cesium.PerInstanceColorAppearance({
        translucent: false,
        closed: !!options.extrudedHeight
      }),
      asynchronous: options.asynchronous !== false,
      releaseGeometryInstances: options.releaseGeometryInstances !== false,
      allowPicking: options.allowPicking !== false,
      classificationType: options.classificationType
    });
  }

  /**
   * 创建盒子Primitive
   */
  static createBoxPrimitive(options: PrimitiveLayerOptions): Cesium.Primitive {
    const position = Array.isArray(options.position) ?
      LayerUtil.degreesToCartesian3(options.position as number[]) : options.position!;

    const dimensions = options.dimensions || new Cesium.Cartesian3(100000, 100000, 100000);
    const geometry = new Cesium.BoxGeometry({
      minimum: new Cesium.Cartesian3(-dimensions.x / 2, -dimensions.y / 2, -dimensions.z / 2),
      maximum: new Cesium.Cartesian3(dimensions.x / 2, dimensions.y / 2, dimensions.z / 2),
      vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT
    });

    const instance = new Cesium.GeometryInstance({
      geometry,
      modelMatrix: Cesium.Transforms.eastNorthUpToFixedFrame(position),
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
          LayerUtil.parseColor(options.material as string || '#ffffff')
        )
      }
    });

    return new Cesium.Primitive({
      geometryInstances: instance,
      appearance: new Cesium.PerInstanceColorAppearance({
        translucent: false,
        closed: true
      }),
      asynchronous: options.asynchronous !== false,
      releaseGeometryInstances: options.releaseGeometryInstances !== false,
      allowPicking: options.allowPicking !== false
    });
  }

  /**
   * 创建圆柱Primitive
   */
  static createCylinderPrimitive(options: PrimitiveLayerOptions): Cesium.Primitive {
    const position = Array.isArray(options.position) ?
      LayerUtil.degreesToCartesian3(options.position as number[]) : options.position!;

    const geometry = new Cesium.CylinderGeometry({
      length: options.length || 100000,
      topRadius: options.topRadius || 50000,
      bottomRadius: options.bottomRadius || 50000,
      vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT
    });

    const instance = new Cesium.GeometryInstance({
      geometry,
      modelMatrix: Cesium.Transforms.eastNorthUpToFixedFrame(position),
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
          LayerUtil.parseColor(options.material as string || '#ffffff')
        )
      }
    });

    return new Cesium.Primitive({
      geometryInstances: instance,
      appearance: new Cesium.PerInstanceColorAppearance({
        translucent: false,
        closed: true
      }),
      asynchronous: options.asynchronous !== false,
      releaseGeometryInstances: options.releaseGeometryInstances !== false,
      allowPicking: options.allowPicking !== false
    });
  }

  /**
   * 创建椭球/球体Primitive
   */
  static createEllipsoidPrimitive(options: PrimitiveLayerOptions): Cesium.Primitive {
    const position = Array.isArray(options.position) ?
      LayerUtil.degreesToCartesian3(options.position as number[]) : options.position!;

    const radii = options.radii || new Cesium.Cartesian3(50000, 50000, 50000);

    const geometry = new Cesium.EllipsoidGeometry({
      radii,
      vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT
    });

    const instance = new Cesium.GeometryInstance({
      geometry,
      modelMatrix: Cesium.Transforms.eastNorthUpToFixedFrame(position),
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
          LayerUtil.parseColor(options.material as string || '#ffffff')
        )
      }
    });

    return new Cesium.Primitive({
      geometryInstances: instance,
      appearance: new Cesium.PerInstanceColorAppearance({
        translucent: false,
        closed: true
      }),
      asynchronous: options.asynchronous !== false,
      releaseGeometryInstances: options.releaseGeometryInstances !== false,
      allowPicking: options.allowPicking !== false
    });
  }

  /**
   * 创建墙体Primitive
   */
  static createWallPrimitive(options: PrimitiveLayerOptions): Cesium.Primitive {
    const positions = options.positions!.map(pos =>
      Array.isArray(pos) ? LayerUtil.degreesToCartesian3(pos as number[]) : pos as Cesium.Cartesian3
    );

    const geometry = new Cesium.WallGeometry({
      positions,
      maximumHeights: options.maximumHeights,
      minimumHeights: options.minimumHeights,
      vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
      granularity: options.granularity || Cesium.Math.RADIANS_PER_DEGREE
    });

    const instance = new Cesium.GeometryInstance({
      geometry,
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
          LayerUtil.parseColor(options.material as string || '#ffffff')
        )
      }
    });

    return new Cesium.Primitive({
      geometryInstances: instance,
      appearance: new Cesium.PerInstanceColorAppearance({
        translucent: false,
        closed: false
      }),
      asynchronous: options.asynchronous !== false,
      releaseGeometryInstances: options.releaseGeometryInstances !== false,
      allowPicking: options.allowPicking !== false
    });
  }

  // ========================= Entity =========================

  /**
   * 创建Entity
   */
  static createEntity(options: EntityLayerOptions): Cesium.Entity {
    const id = options.id || LayerUtil.generateId('entity');

    const entityOptions: Cesium.Entity.ConstructorOptions = {
      id,
      name: options.name,
      show: options.show !== false,
      position: Array.isArray(options.position) ?
        LayerUtil.degreesToCartesian3(options.position as number[]) : options.position,
      orientation: options.orientation
    };

    // 添加各种图形属性
    if (options.point) {
      entityOptions.point = new Cesium.PointGraphics(options.point);
    }

    if (options.billboard) {
      entityOptions.billboard = new Cesium.BillboardGraphics(options.billboard);
    }

    if (options.label) {
      entityOptions.label = new Cesium.LabelGraphics(options.label);
    }

    if (options.model) {
      entityOptions.model = new Cesium.ModelGraphics(options.model);
    }

    if (options.polyline) {
      const polylineOptions = { ...options.polyline };
      if (polylineOptions.positions && Array.isArray((polylineOptions.positions as any)[0])) {
        polylineOptions.positions = ((polylineOptions.positions as unknown) as number[][]).map(pos =>
          LayerUtil.degreesToCartesian3(pos)
        );
      }
      entityOptions.polyline = new Cesium.PolylineGraphics(polylineOptions);
    }

    if (options.polygon) {
      const polygonOptions = { ...options.polygon };
      if (polygonOptions.hierarchy && Array.isArray(polygonOptions.hierarchy)) {
        polygonOptions.hierarchy = new Cesium.PolygonHierarchy(
          ((polygonOptions.hierarchy as unknown) as number[][]).map(pos => LayerUtil.degreesToCartesian3(pos))
        );
      }
      entityOptions.polygon = new Cesium.PolygonGraphics(polygonOptions as any);
    }

    if (options.ellipse) {
      entityOptions.ellipse = new Cesium.EllipseGraphics(options.ellipse);
    }

    if (options.box) {
      entityOptions.box = new Cesium.BoxGraphics(options.box);
    }

    if (options.cylinder) {
      entityOptions.cylinder = new Cesium.CylinderGraphics(options.cylinder);
    }

    if (options.ellipsoid) {
      entityOptions.ellipsoid = new Cesium.EllipsoidGraphics(options.ellipsoid);
    }

    if (options.wall) {
      const wallOptions = { ...options.wall };
      if (wallOptions.positions && Array.isArray((wallOptions.positions as any)[0])) {
        wallOptions.positions = ((wallOptions.positions as unknown) as number[][]).map(pos =>
          LayerUtil.degreesToCartesian3(pos)
        );
      }
      entityOptions.wall = new Cesium.WallGraphics(wallOptions);
    }

    if (options.rectangle) {
      entityOptions.rectangle = new Cesium.RectangleGraphics(options.rectangle);
    }

    if (options.corridor) {
      const corridorOptions = { ...options.corridor };
      if (corridorOptions.positions && Array.isArray((corridorOptions.positions as any)[0])) {
        corridorOptions.positions = ((corridorOptions.positions as unknown) as number[][]).map(pos =>
          LayerUtil.degreesToCartesian3(pos)
        );
      }
      entityOptions.corridor = new Cesium.CorridorGraphics(corridorOptions);
    }

    if (options.path) {
      entityOptions.path = new Cesium.PathGraphics(options.path);
    }
    return new Cesium.Entity(entityOptions);
  }

  // ========================= Billboard =========================

  /**
   * 创建Billboard
   */
  static createBillboard(options: BillboardOptions): Cesium.Entity {
    const id = options.id || LayerUtil.generateId('billboard');
    const position = Array.isArray(options.position) ?
      LayerUtil.degreesToCartesian3(options.position as number[]) : options.position;

    const entityOptions: Cesium.Entity.ConstructorOptions = {
      id,
      name: options.name,
      show: options.show !== false,
      position
    };

    // 如果提供了图片，创建Billboard
    if (options.image) {
      entityOptions.billboard = {
        image: options.image as any,
        scale: options.scale || 1.0,
        pixelOffset: options.pixelOffset as any,
        eyeOffset: options.eyeOffset as any,
        horizontalOrigin: options.horizontalOrigin || Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: options.verticalOrigin || Cesium.VerticalOrigin.BOTTOM,
        heightReference: options.heightReference || Cesium.HeightReference.NONE,
        disableDepthTestDistance: options.disableDepthTestDistance
      };
    }

    // 如果提供了文字，创建Label
    if (options.text) {
      entityOptions.label = {
        text: options.text,
        font: options.font || '14pt sans-serif',
        fillColor: LayerUtil.parseColor(options.fillColor as string || '#ffffff'),
        outlineColor: LayerUtil.parseColor(options.outlineColor as string || '#000000'),
        outlineWidth: options.outlineWidth || 2,
        style: options.style || Cesium.LabelStyle.FILL_AND_OUTLINE,
        scale: options.scale || 1.0,
        pixelOffset: options.pixelOffset,
        eyeOffset: options.eyeOffset,
        horizontalOrigin: options.horizontalOrigin || Cesium.HorizontalOrigin.CENTER,
        verticalOrigin: options.verticalOrigin || Cesium.VerticalOrigin.BOTTOM,
        heightReference: options.heightReference || Cesium.HeightReference.NONE,
        disableDepthTestDistance: options.disableDepthTestDistance
      };
    }

    const entity = new Cesium.Entity(entityOptions);

    return entity;
  }

} // ← 结束 LayerUtil class

// ================================= 兼容性导出  =================================

/**
 * 为了与旧代码保持兼容，暴露 CesiumUtils 常量指向 LayerUtil 本身。
 */
export const CesiumUtils = LayerUtil

/**
 * 创建并初始化 CesiumUtils（LayerUtil）。
 */
export function createCesiumUtils(viewer?: Cesium.Viewer) {
  return LayerUtil
}


