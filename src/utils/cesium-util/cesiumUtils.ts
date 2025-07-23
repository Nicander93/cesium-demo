import * as Cesium from 'cesium';

// 基础配置接口
export interface BaseOptions {
  id?: string;
  name?: string;
  show?: boolean;
  [key: string]: any;
}

// 图层配置接口
export interface LayerOptions extends BaseOptions {
  type: 'geojson' | 'kml' | 'czml' | 'wms' | 'wmts' | 'xyz' | 'bing' | 'arcgis';
  url?: string;
  data?: any;
  style?: any;
  clustering?: boolean;
  clampToGround?: boolean;
}

// 3D瓦片配置接口
export interface TilesetOptions extends BaseOptions {
  url: string;
  modelMatrix?: Cesium.Matrix4;
  maximumScreenSpaceError?: number;
  skipLevelOfDetail?: boolean;
  baseScreenSpaceError?: number;
  skipScreenSpaceErrorFactor?: number;
  skipLevels?: number;
  immediatelyLoadDesiredLevelOfDetail?: boolean;
  loadSiblings?: boolean;
  cullWithChildrenBounds?: boolean;
  enableCollision?: boolean;
  debugShowBoundingVolume?: boolean;
  debugShowContentBoundingVolume?: boolean;
  debugShowViewerRequestVolume?: boolean;
  pointCloudShading?: any;
  imageBasedLightingFactor?: Cesium.Cartesian2;
  lightColor?: Cesium.Cartesian3;
  luminanceAtZenith?: number;
  shadows?: Cesium.ShadowMode;
}

// Primitive配置接口
export interface PrimitiveOptions extends BaseOptions {
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

// Entity配置接口
export interface EntityOptions extends BaseOptions {
  position?: Cesium.Cartesian3 | number[];
  orientation?: Cesium.Quaternion;
  point?: Cesium.PointGraphics.ConstructorOptions;
  billboard?: Cesium.BillboardGraphics.ConstructorOptions;
  label?: Cesium.LabelGraphics.ConstructorOptions;
  model?: Cesium.ModelGraphics.ConstructorOptions;
  polyline?: Cesium.PolylineGraphics.ConstructorOptions;
  polygon?: Cesium.PolygonGraphics.ConstructorOptions;
  ellipse?: Cesium.EllipseGraphics.ConstructorOptions;
  box?: Cesium.BoxGraphics.ConstructorOptions;
  cylinder?: Cesium.CylinderGraphics.ConstructorOptions;
  ellipsoid?: Cesium.EllipsoidGraphics.ConstructorOptions;
  wall?: Cesium.WallGraphics.ConstructorOptions;
  rectangle?: Cesium.RectangleGraphics.ConstructorOptions;
  corridor?: Cesium.CorridorGraphics.ConstructorOptions;
  path?: Cesium.PathGraphics.ConstructorOptions;
}

// Billboard配置接口
export interface BillboardOptions extends BaseOptions {
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
export class CesiumUtils {
  private viewer: Cesium.Viewer;
  private layers: Map<string, any> = new Map();
  private primitives: Map<string, Cesium.Primitive> = new Map();
  private entities: Map<string, Cesium.Entity> = new Map();

  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
  }

  // ========================= 工具方法 =========================

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
      const cesiumColor = Cesium.Color.fromCssColorString(color);
      return alpha !== undefined ? cesiumColor.withAlpha(alpha) : cesiumColor;
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
  async createLayer(options: LayerOptions): Promise<any> {
    const id = options.id || CesiumUtils.generateId('layer');
    
    let layer: any;
    
    switch (options.type) {
      case 'geojson':
        layer = await this.createGeoJsonLayer(options);
        break;
      case 'kml':
        layer = await this.createKmlLayer(options);
        break;
      case 'czml':
        layer = await this.createCzmlLayer(options);
        break;
      case 'wms':
        layer = this.createWmsLayer(options);
        break;
      case 'wmts':
        layer = this.createWmtsLayer(options);
        break;
      case 'xyz':
        layer = this.createXyzLayer(options);
        break;
      case 'bing':
        layer = this.createBingLayer(options);
        break;
      case 'arcgis':
        layer = this.createArcGisLayer(options);
        break;
      default:
        throw new Error(`Unsupported layer type: ${options.type}`);
    }

    if (layer) {
      layer.name = options.name || id;
      layer.show = options.show !== false;
      this.layers.set(id, layer);
    }

    return layer;
  }

  /**
   * 创建GeoJSON图层
   */
  private async createGeoJsonLayer(options: LayerOptions): Promise<Cesium.GeoJsonDataSource> {
    const dataSource = await Cesium.GeoJsonDataSource.load(options.url || options.data, {
      clampToGround: options.clampToGround,
      ...options
    });

    // 应用样式
    if (options.style) {
      this.applyGeoJsonStyle(dataSource, options.style);
    }

    // 添加聚类
    if (options.clustering) {
      dataSource.clustering.enabled = true;
      dataSource.clustering.pixelRange = 15;
      dataSource.clustering.minimumClusterSize = 3;
    }

    this.viewer.dataSources.add(dataSource);
    return dataSource;
  }

  /**
   * 创建KML图层
   */
  private async createKmlLayer(options: LayerOptions): Promise<Cesium.KmlDataSource> {
    const dataSource = await Cesium.KmlDataSource.load(options.url || options.data, {
      clampToGround: options.clampToGround,
      ...options
    });

    this.viewer.dataSources.add(dataSource);
    return dataSource;
  }

  /**
   * 创建CZML图层
   */
  private async createCzmlLayer(options: LayerOptions): Promise<Cesium.CzmlDataSource> {
    const dataSource = await Cesium.CzmlDataSource.load(options.url || options.data);
    this.viewer.dataSources.add(dataSource);
    return dataSource;
  }

  /**
   * 创建WMS图层
   */
  private createWmsLayer(options: LayerOptions): Cesium.ImageryLayer {
    const { url, layers, parameters, ...rest } = options as any;

    const provider = new Cesium.WebMapServiceImageryProvider({
      url: url!,
      layers: layers ?? '',
      parameters: parameters ?? {},
      ...rest, // 其余参数原样透传
    } as any);

    const layer: Cesium.ImageryLayer = (this.viewer.imageryLayers as any).addImageryProvider
      ? (this.viewer.imageryLayers as any).addImageryProvider(provider)
      : (this.viewer.imageryLayers.add as any)(provider);
    return layer;
  }

  /**
   * 创建WMTS图层
   */
  private createWmtsLayer(options: LayerOptions): Cesium.ImageryLayer {
    const { url, layer, style, format, tileMatrixSetID, ...rest } = options as any;

    const provider = new Cesium.WebMapTileServiceImageryProvider({
      url: url!,
      layer: layer ?? '',
      style: style ?? '',
      format: format ?? 'image/jpeg',
      tileMatrixSetID: tileMatrixSetID ?? '',
      ...rest,
    } as any);

    const imageryLayer: Cesium.ImageryLayer = (this.viewer.imageryLayers as any).addImageryProvider
      ? (this.viewer.imageryLayers as any).addImageryProvider(provider)
      : (this.viewer.imageryLayers.add as any)(provider);
    return imageryLayer;
  }

  /**
   * 创建XYZ图层
   */
  private createXyzLayer(options: LayerOptions): Cesium.ImageryLayer {
    const { url, ...rest } = options as any;

    const provider = new Cesium.UrlTemplateImageryProvider({
      url: url!,
      ...rest,
    } as any);

    const imageryLayer: Cesium.ImageryLayer = (this.viewer.imageryLayers as any).addImageryProvider
      ? (this.viewer.imageryLayers as any).addImageryProvider(provider)
      : (this.viewer.imageryLayers.add as any)(provider);
    return imageryLayer;
  }

  /**
   * 创建Bing图层
   */
  private createBingLayer(options: LayerOptions): Cesium.ImageryLayer {
    const { key, mapStyle, culture, url, ...rest } = options as any;

    const provider = new Cesium.BingMapsImageryProvider({
      key: key ?? '',
      mapStyle: mapStyle ?? Cesium.BingMapsStyle.AERIAL,
      culture,
      url: url ?? 'https://dev.virtualearth.net',
      ...rest,
    } as any);

    const imageryLayer: Cesium.ImageryLayer = (this.viewer.imageryLayers as any).addImageryProvider
      ? (this.viewer.imageryLayers as any).addImageryProvider(provider)
      : (this.viewer.imageryLayers.add as any)(provider);
    return imageryLayer;
  }

  /**
   * 创建ArcGIS图层
   */
  private createArcGisLayer(options: LayerOptions): Cesium.ImageryLayer {
    const { url, ...rest } = options as any;

    const provider = new Cesium.ArcGisMapServerImageryProvider({
      url: url!,
      ...rest,
    } as any);

    const imageryLayer: Cesium.ImageryLayer = (this.viewer.imageryLayers as any).addImageryProvider
      ? (this.viewer.imageryLayers as any).addImageryProvider(provider)
      : (this.viewer.imageryLayers.add as any)(provider);
    return imageryLayer;
  }

  /**
   * 应用GeoJSON样式
   */
  private applyGeoJsonStyle(dataSource: Cesium.GeoJsonDataSource, style: any): void {
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
  async create3DTileset(options: TilesetOptions): Promise<Cesium.Cesium3DTileset> {
    const tileset = await Cesium.Cesium3DTileset.fromUrl(options.url, {
      maximumScreenSpaceError: options.maximumScreenSpaceError || 16,
      skipLevelOfDetail: options.skipLevelOfDetail !== false,
      baseScreenSpaceError: options.baseScreenSpaceError || 1024,
      skipScreenSpaceErrorFactor: options.skipScreenSpaceErrorFactor || 16,
      skipLevels: options.skipLevels || 1,
      immediatelyLoadDesiredLevelOfDetail: options.immediatelyLoadDesiredLevelOfDetail || false,
      loadSiblings: options.loadSiblings || false,
      cullWithChildrenBounds: options.cullWithChildrenBounds !== false,
      enableCollision: options.enableCollision || false,
      debugShowBoundingVolume: options.debugShowBoundingVolume || false,
      debugShowContentBoundingVolume: options.debugShowContentBoundingVolume || false,
      debugShowViewerRequestVolume: options.debugShowViewerRequestVolume || false,
      shadows: options.shadows || Cesium.ShadowMode.ENABLED,
      ...options
    });

    // 设置模型矩阵（用于位置调整）
    if (options.modelMatrix) {
      tileset.modelMatrix = options.modelMatrix;
    }

    // 设置点云着色
    if (options.pointCloudShading) {
      tileset.pointCloudShading = options.pointCloudShading;
    }

    // 设置基于图像的光照
    if (options.imageBasedLightingFactor) {
      tileset.imageBasedLighting.imageBasedLightingFactor = options.imageBasedLightingFactor;
    }

    if (options.lightColor) {
      tileset.imageBasedLighting.lightColor = options.lightColor;
    }

    if (options.luminanceAtZenith !== undefined) {
      tileset.imageBasedLighting.luminanceAtZenith = options.luminanceAtZenith;
    }

    tileset.show = options.show !== false;
    
    this.viewer.scene.primitives.add(tileset);
    
    const id = options.id || CesiumUtils.generateId('tileset');
    this.layers.set(id, tileset);

    return tileset;
  }

  /**
   * 调整3D瓦片集高度
   */
  adjust3DTilesetHeight(tileset: Cesium.Cesium3DTileset, deltaHeight: number): void {
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
  createPrimitive(options: PrimitiveOptions): Cesium.Primitive | Cesium.GroundPrimitive {
    const id = options.id || CesiumUtils.generateId('primitive');
    let primitive: Cesium.Primitive | Cesium.GroundPrimitive;

    switch (options.type) {
      case 'point':
        primitive = this.createPointPrimitive(options);
        break;
      case 'polyline':
        primitive = this.createPolylinePrimitive(options);
        break;
      case 'polygon':
        primitive = this.createPolygonPrimitive(options);
        break;
      case 'box':
        primitive = this.createBoxPrimitive(options);
        break;
      case 'cylinder':
        primitive = this.createCylinderPrimitive(options);
        break;
      case 'ellipsoid':
      case 'sphere':
        primitive = this.createEllipsoidPrimitive(options);
        break;
      case 'wall':
        primitive = this.createWallPrimitive(options);
        break;
      default:
        throw new Error(`Unsupported primitive type: ${options.type}`);
    }

    primitive.show = options.show !== false;
    
    this.viewer.scene.primitives.add(primitive);
    this.primitives.set(id, primitive);

    return primitive;
  }

  /**
   * 创建点Primitive
   */
  private createPointPrimitive(options: PrimitiveOptions): Cesium.Primitive {
    const positions = Array.isArray(options.positions) ? options.positions : [options.position!];
    const instances: Cesium.GeometryInstance[] = [];

    positions.forEach((pos, index) => {
      const position = Array.isArray(pos) ? CesiumUtils.degreesToCartesian3(pos as number[]) : pos as Cesium.Cartesian3;
      
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
            CesiumUtils.parseColor(options.material as string || '#ffffff')
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
  private createPolylinePrimitive(options: PrimitiveOptions): Cesium.Primitive {
    const positions = options.positions!.map(pos => 
      Array.isArray(pos) ? CesiumUtils.degreesToCartesian3(pos as number[]) : pos as Cesium.Cartesian3
    );

    const geometry = new Cesium.PolylineGeometry({
      positions,
      width: options.width || 1.0,
      vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
      followSurface: options.followSurface !== false,
      granularity: options.granularity || Cesium.Math.RADIANS_PER_DEGREE
    });

    const instance = new Cesium.GeometryInstance({
      geometry,
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
          CesiumUtils.parseColor(options.material as string || '#ffffff')
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
  private createPolygonPrimitive(options: PrimitiveOptions): Cesium.Primitive | Cesium.GroundPrimitive {
    const positions = options.positions!.map(pos => 
      Array.isArray(pos) ? CesiumUtils.degreesToCartesian3(pos as number[]) : pos as Cesium.Cartesian3
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
          CesiumUtils.parseColor(options.material as string || '#ffffff')
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
  private createBoxPrimitive(options: PrimitiveOptions): Cesium.Primitive {
    const position = Array.isArray(options.position) ? 
      CesiumUtils.degreesToCartesian3(options.position as number[]) : options.position!;

    const geometry = new Cesium.BoxGeometry({
      dimensions: options.dimensions || new Cesium.Cartesian3(100000, 100000, 100000),
      vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT
    });

    const instance = new Cesium.GeometryInstance({
      geometry,
      modelMatrix: Cesium.Transforms.eastNorthUpToFixedFrame(position),
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
          CesiumUtils.parseColor(options.material as string || '#ffffff')
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
  private createCylinderPrimitive(options: PrimitiveOptions): Cesium.Primitive {
    const position = Array.isArray(options.position) ? 
      CesiumUtils.degreesToCartesian3(options.position as number[]) : options.position!;

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
          CesiumUtils.parseColor(options.material as string || '#ffffff')
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
  private createEllipsoidPrimitive(options: PrimitiveOptions): Cesium.Primitive {
    const position = Array.isArray(options.position) ? 
      CesiumUtils.degreesToCartesian3(options.position as number[]) : options.position!;

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
          CesiumUtils.parseColor(options.material as string || '#ffffff')
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
  private createWallPrimitive(options: PrimitiveOptions): Cesium.Primitive {
    const positions = options.positions!.map(pos => 
      Array.isArray(pos) ? CesiumUtils.degreesToCartesian3(pos as number[]) : pos as Cesium.Cartesian3
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
          CesiumUtils.parseColor(options.material as string || '#ffffff')
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
  createEntity(options: EntityOptions): Cesium.Entity {
    const id = options.id || CesiumUtils.generateId('entity');
    
    const entityOptions: Cesium.Entity.ConstructorOptions = {
      id,
      name: options.name,
      show: options.show !== false,
      position: Array.isArray(options.position) ? 
        CesiumUtils.degreesToCartesian3(options.position as number[]) : options.position,
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
      if (options.polyline.positions && Array.isArray(options.polyline.positions[0])) {
        options.polyline.positions = (options.polyline.positions as number[][]).map(pos => 
          CesiumUtils.degreesToCartesian3(pos)
        );
      }
      entityOptions.polyline = new Cesium.PolylineGraphics(options.polyline);
    }
    
    if (options.polygon) {
      if (options.polygon.hierarchy && Array.isArray(options.polygon.hierarchy)) {
        options.polygon.hierarchy = new Cesium.PolygonHierarchy(
          (options.polygon.hierarchy as number[][]).map(pos => CesiumUtils.degreesToCartesian3(pos))
        );
      }
      entityOptions.polygon = new Cesium.PolygonGraphics(options.polygon);
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
      if (options.wall.positions && Array.isArray(options.wall.positions[0])) {
        options.wall.positions = (options.wall.positions as number[][]).map(pos => 
          CesiumUtils.degreesToCartesian3(pos)
        );
      }
      entityOptions.wall = new Cesium.WallGraphics(options.wall);
    }
    
    if (options.rectangle) {
      entityOptions.rectangle = new Cesium.RectangleGraphics(options.rectangle);
    }
    
    if (options.corridor) {
      if (options.corridor.positions && Array.isArray(options.corridor.positions[0])) {
        options.corridor.positions = (options.corridor.positions as number[][]).map(pos => 
          CesiumUtils.degreesToCartesian3(pos)
        );
      }
      entityOptions.corridor = new Cesium.CorridorGraphics(options.corridor);
    }
    
    if (options.path) {
      entityOptions.path = new Cesium.PathGraphics(options.path);
    }

    const entity = this.viewer.entities.add(entityOptions);
    this.entities.set(id, entity);

    return entity;
  }

  // ========================= Billboard =========================

  /**
   * 创建Billboard
   */
  createBillboard(options: BillboardOptions): Cesium.Entity {
    const id = options.id || CesiumUtils.generateId('billboard');
    const position = Array.isArray(options.position) ? 
      CesiumUtils.degreesToCartesian3(options.position as number[]) : options.position;

    const entityOptions: Cesium.Entity.ConstructorOptions = {
      id,
      name: options.name,
      show: options.show !== false,
      position
    };

    // 如果提供了图片，创建Billboard
    if (options.image) {
      entityOptions.billboard = {
        image: options.image,
        scale: options.scale || 1.0,
        pixelOffset: options.pixelOffset,
        eyeOffset: options.eyeOffset,
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
        fillColor: CesiumUtils.parseColor(options.fillColor as string || '#ffffff'),
        outlineColor: CesiumUtils.parseColor(options.outlineColor as string || '#000000'),
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

    const entity = this.viewer.entities.add(entityOptions);
    this.entities.set(id, entity);

    return entity;
  }

  // ========================= 管理方法 =========================

  /**
   * 根据ID获取图层
   */
  getLayer(id: string): any {
    return this.layers.get(id);
  }

  /**
   * 根据ID获取Primitive
   */
  getPrimitive(id: string): Cesium.Primitive | undefined {
    return this.primitives.get(id);
  }

  /**
   * 根据ID获取Entity
   */
  getEntity(id: string): Cesium.Entity | undefined {
    return this.entities.get(id);
  }

  /**
   * 移除图层
   */
  removeLayer(id: string): boolean {
    const layer = this.layers.get(id);
    if (layer) {
      if (layer instanceof Cesium.DataSource) {
        this.viewer.dataSources.remove(layer);
      } else if (layer instanceof Cesium.ImageryLayer) {
        this.viewer.imageryLayers.remove(layer);
      } else if (layer instanceof Cesium.Cesium3DTileset) {
        this.viewer.scene.primitives.remove(layer);
      }
      this.layers.delete(id);
      return true;
    }
    return false;
  }

  /**
   * 移除Primitive
   */
  removePrimitive(id: string): boolean {
    const primitive = this.primitives.get(id);
    if (primitive) {
      this.viewer.scene.primitives.remove(primitive);
      this.primitives.delete(id);
      return true;
    }
    return false;
  }

  /**
   * 移除Entity
   */
  removeEntity(id: string): boolean {
    const entity = this.entities.get(id);
    if (entity) {
      this.viewer.entities.remove(entity);
      this.entities.delete(id);
      return true;
    }
    return false;
  }

  /**
   * 清除所有数据
   */
  clear(): void {
    // 清除所有图层
    this.layers.forEach((layer, id) => {
      this.removeLayer(id);
    });

    // 清除所有Primitive
    this.primitives.forEach((primitive, id) => {
      this.removePrimitive(id);
    });

    // 清除所有Entity
    this.entities.forEach((entity, id) => {
      this.removeEntity(id);
    });
  }

  /**
   * 设置图层显示状态
   */
  setLayerVisible(id: string, visible: boolean): void {
    const layer = this.layers.get(id);
    if (layer && 'show' in layer) {
      layer.show = visible;
    }
  }

  /**
   * 飞行到指定对象
   */
  async flyTo(id: string): Promise<void> {
    const layer = this.layers.get(id);
    const primitive = this.primitives.get(id);
    const entity = this.entities.get(id);

    if (layer) {
      await this.viewer.flyTo(layer);
    } else if (primitive) {
      await this.viewer.flyTo(primitive);
    } else if (entity) {
      await this.viewer.flyTo(entity);
    }
  }

  /**
   * 获取所有图层列表
   */
  getLayers(): Array<{id: string, name: string, type: string, visible: boolean}> {
    const result: Array<{id: string, name: string, type: string, visible: boolean}> = [];
    
    this.layers.forEach((layer, id) => {
      let type = 'unknown';
      if (layer instanceof Cesium.GeoJsonDataSource) type = 'geojson';
      else if (layer instanceof Cesium.KmlDataSource) type = 'kml';
      else if (layer instanceof Cesium.CzmlDataSource) type = 'czml';
      else if (layer instanceof Cesium.ImageryLayer) type = 'imagery';
      else if (layer instanceof Cesium.Cesium3DTileset) type = '3dtiles';

      result.push({
        id,
        name: layer.name || id,
        type,
        visible: layer.show !== false
      });
    });

    return result;
  }
}

// 导出默认实例创建函数
export function createCesiumUtils(viewer: Cesium.Viewer): CesiumUtils {
  return new CesiumUtils(viewer);
}
