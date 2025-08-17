import * as Cesium from "cesium";
import { EModel, polylineAntialiasingMaterial } from "./config";
import AxisPlane from "./AxisPlane";
import Event from "./Event";
import LonLat from "./LonLat";

// 全局偏移量缓存，用于避免频繁创建新对象
const _offset = new Cesium.Cartesian3();

// 定义编辑器选项接口
interface EditCesiumOptions {
  lineWidth?: number;              // 坐标轴线宽
  originColor?: Cesium.Color;      // 原点颜色
  xAxisColor?: Cesium.Color;       // X轴颜色
  xAxisLength?: number;            // X轴长度
  yAxisColor?: Cesium.Color;       // Y轴颜色
  yAxisLength?: number;            // Y轴长度
  zAxisColor?: Cesium.Color;       // Z轴颜色
  zAxisLength?: number;            // Z轴长度
  activeAxisColor?: Cesium.Color;  // 激活轴的颜色
  scaleAxisColor?: Cesium.Color;   // 缩放轴颜色
  translateEnabled?: boolean;      // 是否启用平移功能
  rotateEnabled?: boolean;         // 是否启用旋转功能
  scaleEnabled?: boolean;          // 是否启用缩放功能
  scaleAxisLength?: number;        // 缩放轴长度
  rotatePlaneRadius?: number;      // 旋转平面半径
  sizeInPixel?: boolean;           // 是否以像素为单位
  radiusRatio?: number;            // 半径比例系数
  originOffset?: Cesium.Cartesian3; // 原点偏移量
}

// 定义支持的编辑对象类型：模型、3D瓦片集、实体
type EditableObject = Cesium.Model | Cesium.Cesium3DTileset | Cesium.Entity;

// 定义带轴信息的图元接口，扩展Cesium.Polyline以包含轴相关属性
interface AxisPrimitive extends Cesium.Polyline {
  axis?: string;                    // 轴标识符 (X, Y, Z, XY, XZ, YZ, RX, RY, RZ, SXYZ等)
  color?: Cesium.Color;             // 轴的原始颜色
  pcolor?: Cesium.Color;            // 点图元的颜色属性
  normal?: Cesium.Cartesian3;       // 轴的法向量，用于旋转计算
  isAxisPlane?: boolean;            // 是否为坐标平面
  relativeAxis?: AxisPrimitive[];   // 相关联的轴，用于坐标平面操作
}

// 定义偏移量扩展类型，用于缩放操作
interface OffsetCartesian3 extends Cesium.Cartesian3 {
  sxyz?: number;                    // 缩放偏移量
  [key: string]: any;               // 允许其他动态属性
}

/**
 * Cesium模型编辑器类
 * 支持对Cesium模型、3D瓦片集和实体进行交互式编辑
 * 包括平移、旋转、缩放等变换操作
 */
class EditCesium {
  /**
   * 构造函数 - 创建模型编辑器实例
   * 支持编辑倾斜摄影、BIM模型、点位等各种类型的对象
   * 
   * @param {Viewer} viewer Cesium视图器实例
   * @param {Object} options 配置选项
   * @param {number} [options.lineWidth = 15] 坐标轴线宽，影响坐标轴的粗细程度
   * @param {Cesium.Color} [options.originColor = Cesium.Color.WHITE] 坐标轴原点颜色
   * @param {Cesium.Color} [options.xAxisColor = Cesium.Color.RED] X轴颜色，默认红色
   * @param {number} [options.xAxisLength] X轴长度，如果未定义将根据模型包围球自动计算
   * @param {Cesium.Color} [options.yAxisColor = Cesium.Color.GREEN] Y轴颜色，默认绿色
   * @param {number} [options.yAxisLength] Y轴长度，如果未定义将根据模型包围球自动计算
   * @param {Cesium.Color} [options.zAxisColor = Cesium.Color.BLUE] Z轴颜色，默认蓝色
   * @param {number} [options.zAxisLength] Z轴长度，如果未定义将根据模型包围球自动计算
   * @param {Cesium.Color} [options.activeAxisColor = Cesium.Color.YELLOW] 激活状态下坐标轴的高亮颜色
   * @param {Cesium.Color} [options.scaleAxisColor = Cesium.Color.WHITE] 缩放轴的颜色
   * @param {boolean} [options.translateEnabled = true] 是否启用平移控制器
   * @param {boolean} [options.rotateEnabled = false] 是否启用旋转控制器，仅对模型有效
   * @param {boolean} [options.scaleEnabled = false] 是否启用缩放控制器，仅对模型有效
   * @param {number} [options.scaleAxisLength] 缩放轴长度，如果未定义将根据模型包围球自动计算
   * @param {number} [options.rotatePlaneRadius] 旋转圆的半径，如果未定义将根据模型包围球自动计算
   * @param {boolean} [options.sizeInPixel = false] 控制器大小是否以像素为单位（屏幕空间固定大小）
   * @param {number} [options.radiusRatio = 1] 轴长度计算系数，最终长度 = 模型包围球半径 × 该系数
   * @param {Cesium.Cartesian3} [options.originOffset = Cesium.Cartesian3.ZERO] 原点相对于模型中心的偏移量
   */
  // === 基础配置属性 ===
  /** Cesium Viewer实例，用于场景操作和事件处理 */
  viewer: Cesium.Viewer;
  /** 坐标轴原点颜色 */
  originColor: Cesium.Color;
  /** 坐标轴线宽，影响视觉粗细 */
  lineWidth: number;
  /** X轴颜色，通常为红色 */
  xAxisColor: Cesium.Color;
  /** X轴长度，可自定义或自动计算 */
  xAxisLength?: number;
  /** Y轴颜色，通常为绿色 */
  yAxisColor: Cesium.Color;
  /** Y轴长度，可自定义或自动计算 */
  yAxisLength?: number;
  /** Z轴颜色，通常为蓝色 */
  zAxisColor: Cesium.Color;
  /** Z轴长度，可自定义或自动计算 */
  zAxisLength?: number;
  /** 激活状态下轴的高亮颜色 */
  activeAxisColor: Cesium.Color;
  /** 缩放轴的颜色 */
  scaleAxisColor: Cesium.Color;
  
  // === 功能开关 ===
  /** 是否启用平移功能（私有属性，通过getter/setter访问） */
  _translateEnabled: boolean;
  /** 是否启用旋转功能（私有属性，通过getter/setter访问） */
  _rotateEnabled: boolean;
  /** 是否启用缩放功能（私有属性，通过getter/setter访问） */
  _scaleEnabled: boolean;
  
  // === 尺寸配置 ===
  /** 缩放轴长度 */
  scaleAxisLength?: number;
  /** 旋转操作时圆形控制器的半径 */
  rotatePlaneRadius?: number;
  /** 控制器是否以像素为单位（屏幕空间固定大小） */
  sizeInPixel: boolean;
  /** 轴长度相对于模型包围球半径的比例系数 */
  radiusRatio: number;
  /** 坐标轴原点相对于模型中心的偏移量 */
  originOffset: Cesium.Cartesian3;
  
  // === 状态管理 ===
  /** 是否已绑定编辑对象 */
  hasBindObject: boolean = false;
  /** 当前绑定的编辑对象（模型、3D瓦片集或实体） */
  bindObject?: EditableObject;
  
  // === 变换矩阵 ===
  /** 模型的变换矩阵，用于控制对象的位置、旋转、缩放 */
  _modelMatrix?: Cesium.Matrix4;
  /** 模型矩阵的逆矩阵，用于坐标变换计算 */
  _inverseModelMatrix?: Cesium.Matrix4;
  
  // === 几何信息 ===
  /** 编辑对象的中心点位置（局部坐标） */
  _center: Cesium.Cartesian3;
  /** 编辑对象的包围球半径 */
  _radius: number;
  
  // === 图元管理 ===
  /** 坐标轴的根容器，管理所有线性图元 */
  axisRoot?: Cesium.PolylineCollection;
  /** 编辑器的图元集合，包含所有可视化元素 */
  primitivesList: Cesium.PrimitiveCollection;
  /** 所有轴图元的数组，用于事件处理和状态管理 */
  _primitives: AxisPrimitive[];
  /** 坐标轴原点的点图元 */
  originPoint?: Cesium.PointPrimitive & AxisPrimitive;
  // === 坐标轴图元 ===
  /** X轴线条图元 */
  xAxis?: AxisPrimitive;
  /** Y轴线条图元 */
  yAxis?: AxisPrimitive;
  /** Z轴线条图元 */
  zAxis?: AxisPrimitive;
  /** X轴的单位法向量，用于方向计算 */
  xNormal?: Cesium.Cartesian3;
  /** Y轴的单位法向量，用于方向计算 */
  yNormal?: Cesium.Cartesian3;
  /** Z轴的单位法向量，用于方向计算 */
  zNormal?: Cesium.Cartesian3;
  /** X轴辅助线，在拖拽时显示移动轨迹 */
  xAux?: AxisPrimitive;
  /** Y轴辅助线，在拖拽时显示移动轨迹 */
  yAux?: AxisPrimitive;
  /** Z轴辅助线，在拖拽时显示移动轨迹 */
  zAux?: AxisPrimitive;
  
  // === 坐标平面图元 ===
  /** XOY平面（Z轴垂直的平面），用于XY方向的平移操作 */
  XOYPlane?: AxisPrimitive;
  /** XOZ平面（Y轴垂直的平面），用于XZ方向的平移操作 */
  XOZPlane?: AxisPrimitive;
  /** YOZ平面（X轴垂直的平面），用于YZ方向的平移操作 */
  YOZPlane?: AxisPrimitive;
  
  // === 旋转控制器 ===
  /** 绕Z轴的旋转圆，用于Z轴旋转操作 */
  zRotate?: AxisPrimitive;
  /** 绕Y轴的旋转圆，用于Y轴旋转操作 */
  yRotate?: AxisPrimitive;
  /** 绕X轴的旋转圆，用于X轴旋转操作 */
  xRotate?: AxisPrimitive;
  /** 旋转操作时的起始辅助线 */
  rAxuStart?: AxisPrimitive;
  /** 旋转操作时的结束辅助线，显示旋转角度 */
  rAxuEnd?: AxisPrimitive;
  
  // === 缩放控制器 ===
  /** 对角线缩放轴，用于等比例缩放操作 */
  scaleAxis?: AxisPrimitive;
  
  // === 鼠标交互状态 ===
  /** 鼠标按下时的屏幕像素坐标 */
  mousedownPixel?: Cesium.Cartesian2;
  /** 当前操作的累积偏移量 */
  offset: Cesium.Cartesian3;
  /** 当前操作的累积旋转角度（弧度） */
  angle: number;
  /** 当前操作模式：N(无)、T(平移)、R(旋转)、S(缩放) */
  mode: string;
  /** 当前被激活（高亮）的图元对象 */
  activePrimitive?: AxisPrimitive;
  /** 旋转操作开始时在平面上的局部坐标 */
  startLocalPosition?: Cesium.Cartesian3;
  
  // === 事件系统 ===
  /** 变换操作开始前触发的事件 */
  preTranformEvent: Event;
  /** 变换操作完成后触发的事件 */
  postTransformEvent: Event;
  /** 移除事件监听器的清理函数 */
  _removeEventListener: () => void = () => {};

  constructor(viewer: Cesium.Viewer, options: EditCesiumOptions = {}) {
    // 保存Viewer实例
    this.viewer = viewer;
    
    // === 初始化样式配置 ===
    this.lineWidth = options.lineWidth || 15;
    this.originColor = options.originColor || Cesium.Color.WHITE;
    this.xAxisColor = options.xAxisColor || Cesium.Color.RED;
    this.xAxisLength = options.xAxisLength;
    this.yAxisColor = options.yAxisColor || Cesium.Color.GREEN;
    this.yAxisLength = options.yAxisLength;
    this.zAxisColor = options.zAxisColor || Cesium.Color.BLUE;
    this.zAxisLength = options.zAxisLength;
    this.activeAxisColor = options.activeAxisColor || Cesium.Color.YELLOW;
    this.scaleAxisColor = options.scaleAxisColor || Cesium.Color.WHITE;
    
    // === 初始化功能开关 ===
    this._translateEnabled = options.translateEnabled || true;
    this._rotateEnabled = options.rotateEnabled || false;
    this._scaleEnabled = options.scaleEnabled || false;
    
    // === 初始化尺寸配置 ===
    this.scaleAxisLength = options.scaleAxisLength;
    this.rotatePlaneRadius = options.rotatePlaneRadius;
    this.sizeInPixel = options.sizeInPixel || false;
    this.radiusRatio = options.radiusRatio || 1;
    this.originOffset = options.originOffset || Cesium.Cartesian3.ZERO;
    
    // === 初始化变换矩阵 ===
    this._modelMatrix = undefined;
    this._inverseModelMatrix = undefined;
    
    // === 初始化几何信息 ===
    this._center = new Cesium.Cartesian3();
    this._radius = 0;
    
    // === 初始化图元管理 ===
    this.axisRoot = undefined;
    this.primitivesList = new Cesium.PrimitiveCollection();
    this._primitives = [];
    
    // === 初始化交互状态 ===
    this.offset = new Cesium.Cartesian3(0, 0, 0);
    this.angle = 0;
    this.mode = EModel.N; // 默认为无操作模式
    this.hasBindObject = false;
    
    // === 初始化事件系统 ===
    /**
     * 变换操作开始前触发的事件
     * 传递当前的模型矩阵作为参数
     */
    this.preTranformEvent = new Event();
    /**
     * 变换操作完成后触发的事件
     * 传递更新后的模型矩阵作为参数
     */
    this.postTransformEvent = new Event();
  }

  /**
   * 获取或设置平移控制器的显示状态
   * 当设置为false时，隐藏所有平移相关的控制器（X/Y/Z轴和坐标平面）
   * 但保留旋转和缩放控制器的显示状态
   */
  get translateEnabled() {
    return this._translateEnabled;
  }

  set translateEnabled(val) {
    this._translateEnabled = val;
    // 遍历所有图元，控制平移相关控制器的显示
    for (const primitive of this._primitives) {
      const axis = primitive.axis;
      if (!axis) {
        continue;
      }
      // 如果不是旋转轴(R)或缩放轴(S)，则为平移相关的控制器
      if (!(axis.includes(EModel.R) || axis.includes(EModel.S))) {
        primitive.show = val;
      }
    }
  }

  /**
   * 获取或设置旋转控制器的显示状态
   * 当设置为false时，隐藏所有旋转相关的控制器（旋转圆和辅助线）
   * 旋转功能仅对模型(Model)有效，对3D瓦片集和实体无效
   */
  get rotateEnabled() {
    return this._rotateEnabled;
  }

  set rotateEnabled(val) {
    this._rotateEnabled = val;
    // 遍历所有图元，控制旋转相关控制器的显示
    for (const primitive of this._primitives) {
      const axis = primitive.axis;
      if (!axis) {
        continue;
      }
      // 检查是否为旋转轴（轴名包含'R'）
      if (axis.includes(EModel.R)) {
        primitive.show = val;
      }
    }
  }

  /**
   * 获取或设置缩放控制器的显示状态
   * 当设置为false时，隐藏所有缩放相关的控制器
   * 缩放功能仅对模型(Model)有效，对3D瓦片集和实体无效
   */
  get scaleEnabled() {
    return this._scaleEnabled;
  }

  set scaleEnabled(val) {
    this._scaleEnabled = val;
    // 遍历所有图元，控制缩放相关控制器的显示
    for (const primitive of this._primitives) {
      const axis = primitive.axis;
      if (!axis) {
        continue;
      }
      // 检查是否为缩放轴（轴名包含'S'）
      if (axis.includes(EModel.S)) {
        primitive.show = val;
      }
    }
  }

  /**
   * 获取或设置模型的变换矩阵
   * 模型矩阵定义了对象在世界坐标系中的位置、旋转和缩放
   * 同时会自动计算并缓存逆矩阵用于坐标变换
   */
  get modelMatrix() {
    return this._modelMatrix;
  }

  set modelMatrix(matrix) {
    if (!matrix) {
      // 如果传入null或undefined，清空矩阵
      this._modelMatrix = undefined;
      this._inverseModelMatrix = undefined;
      return;
    }
    this._modelMatrix = matrix;
    // 计算并缓存逆矩阵，用于世界坐标到局部坐标的转换
    this._inverseModelMatrix = Cesium.Matrix4.inverse(
      matrix,
      new Cesium.Matrix4(),
    );
  }

  /**
   * 获取编辑器坐标轴的中心位置（世界坐标）
   * 中心位置 = 对象几何中心 + 用户设置的偏移量
   * 这个位置是所有坐标轴和控制器的原点
   */
  get center() {
    return Cesium.Cartesian3.add(
      this._center,
      this.originOffset,
      new Cesium.Cartesian3(),
    );
  }

  /**
   * 将编辑器添加到Cesium场景并绑定编辑对象
   * 这是启动编辑器的主要入口方法
   * @param object 要编辑的对象（模型、3D瓦片集或实体）
   */
  addTo(object: EditableObject): void {
    // 绑定编辑对象并初始化控制器
    this.bind(object);
    // 将编辑器的图元集合添加到场景中
    this.viewer.scene.primitives.add(this.primitivesList);
    // 注册鼠标事件监听器
    this.addEventListener();
  }

  /**
   * 绑定编辑对象并初始化相应的控制器
   * 根据对象类型（模型、3D瓦片集、实体）创建不同的控制器组合
   * @param object 要绑定的对象（模型、3D瓦片集或实体）
   */
  bind(object: EditableObject): void {
    if (!this.viewer) {
      throw new Error("请先调用addTo方法将编辑器添加到viewer");
    }
    // 清理之前绑定的对象
    this.unbind();
    // 标记已绑定对象
    this.hasBindObject = true;
    
    // === 处理3D瓦片集对象 ===
    if (object instanceof Cesium.Cesium3DTileset) {
      this.bindObject = object;
      this.modelMatrix = object.modelMatrix;
      // 等待瓦片集加载完成后初始化控制器
      object.allTilesLoaded.addEventListener(() => {
        // 获取瓦片集的几何中心（世界坐标）
        const center = Cesium.Cartesian3.clone(object.boundingSphere.center);
        if (this._inverseModelMatrix) {
          // 将世界坐标中心转换为局部坐标
          Cesium.Matrix4.multiplyByPoint(
            this._inverseModelMatrix,
            center,
            this._center,
          );
        }
        this._radius = object.boundingSphere.radius;
        // 3D瓦片集不支持缩放操作
        this.scaleEnabled = false;
        // 创建控制器：支持实体功能，不支持瓦片功能
        this.createPrimitive(true, false);
      });
    } 
    // === 处理模型对象 ===
    else if (object instanceof Cesium.Model) {
      this.bindObject = object;
      this.modelMatrix = object.modelMatrix;
      // 等待模型加载完成后初始化控制器
      object.readyEvent.addEventListener(() => {
        // 获取模型的几何中心（世界坐标）
        const center = Cesium.Cartesian3.clone(object.boundingSphere.center);
        if (this._inverseModelMatrix) {
          // 将世界坐标中心转换为局部坐标
          Cesium.Matrix4.multiplyByPoint(
            this._inverseModelMatrix,
            center,
            this._center,
          );
        }
        this._radius = object.boundingSphere.radius;
        // 创建控制器：支持实体功能和瓦片功能（包括缩放）
        this.createPrimitive(true, true);
      });
    } 
    // === 处理实体对象 ===
    else if (object instanceof Cesium.Entity) {
      // 获取实体的位置信息
      let position: Cesium.Cartesian3 | undefined;
      if (object.position) {
        if (typeof object.position.getValue === "function") {
          // 处理动态位置属性
          position = object.position.getValue(this.viewer.clock.currentTime);
        } else if (object.position instanceof Cesium.Cartesian3) {
          // 处理静态位置属性
          position = object.position;
        }
      }
      
      if (!position || !(position instanceof Cesium.Cartesian3)) {
        throw new Error("实体位置无效或未定义");
      }
      
      // 创建以实体位置为原点的东北天坐标系变换矩阵
      this.modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(position);
      // 实体的几何中心就是原点偏移
      this._center = new Cesium.Cartesian3();
      Cesium.Cartesian3.clone(this.originOffset, this._center);
      // 实体使用固定半径
      this._radius = 10;
      // 实体不支持旋转和缩放操作
      this.rotateEnabled = false;
      this.scaleEnabled = false;
      // 创建控制器：不支持实体功能和瓦片功能
      this.createPrimitive(false, false);
      
      // 监听变换事件，同步更新实体位置
      this.postTransformEvent.addEventListener((modelMatrix: Cesium.Matrix4) => {
        const newPosition = new Cesium.Cartesian3();
        // 从变换矩阵中提取新的位置
        Cesium.Matrix4.getTranslation(modelMatrix, newPosition);
        // 更新实体的位置属性
        object.position = new Cesium.ConstantPositionProperty(newPosition);
      });
    }
  }

  /**
   * 创建编辑器的所有控制器图元
   * 根据对象类型创建不同的控制器组合
   * @private
   * @param isEntity 是否为实体对象，影响旋转控制器的创建
   * @param isTiles 是否为瓦片集对象，影响缩放控制器的创建
   */
  private createPrimitive(isEntity: boolean = false, isTiles: boolean = false): void {
    // 创建坐标轴的根容器，使用模型矩阵进行变换
    const polyline = new Cesium.PolylineCollection({
      modelMatrix: this._modelMatrix,
    });
    this.axisRoot = polyline;
    this.primitivesList.add(polyline);
    
    // === 创建基础控制器 ===
    // 创建坐标轴原点
    this.createOrigenPoint();
    // 根据配置创建平移控制器（XYZ轴）
    this.translateEnabled && this.createMoveAxis();
    // 根据配置创建坐标平面控制器
    this.translateEnabled && this.createAxisPlane();
    
    // === 根据对象类型创建特定控制器 ===
    // 仅对实体对象创建旋转控制器
    isEntity && this.rotateEnabled && this.createRotateAxis();
    // 仅对瓦片集对象创建缩放控制器
    isTiles && this.scaleEnabled && this.createScaleAxis();
  }

  /**
   * 创建坐标轴原点的点图元
   * 原点是所有坐标轴的交汇处，可以拖拽来移动整个对象
   * @private
   */
  private createOrigenPoint(): void {
    // 创建点图元集合
    const point = new Cesium.PointPrimitiveCollection({
      modelMatrix: this.modelMatrix,
    });
    
    // 添加原点图元
    const originPoint = point.add({
      show: true,
      position: this.center,                     // 原点位置
      pixelSize: this.lineWidth * 1.5,          // 点的像素大小，略大于线宽
      color: this.originColor,                   // 原点颜色
    }) as any; // 类型断言，因为PointPrimitive不完全匹配AxisPrimitive接口
    
    // 设置轴标识符，XYZ表示可以进行全方向移动
    originPoint.axis = "XYZ";
    // 由于PointPrimitive已有color属性，使用pcolor存储原始颜色用于恢复
    originPoint.pcolor = this.originColor;
    
    this.originPoint = originPoint;
    this.primitivesList.add(point);
    
    // 将原点添加到图元数组中，用于事件处理
    if (this.originPoint) {
      this._primitives.push(this.originPoint);
    }
  }

  /**
   * 创建XYZ三个坐标轴的线条图元
   * 每个轴都可以单独拖拽来实现单方向的平移操作
   * @private
   */
  private createMoveAxis(): void {
    console.log(this.center);
    if (!this.center || !this.axisRoot) {
      return;
    }
    
    // 计算轴的长度：用户指定长度或根据包围球半径自动计算
    const lineLength = this._radius * this.radiusRatio;
    const plc = this.axisRoot;  // 坐标轴容器
    const center = this.center; // 坐标轴原点
    // === 创建X轴 ===
    let positions = [
      center,
      new Cesium.Cartesian3(
        Cesium.defaultValue(this.xAxisLength, lineLength) + center.x,
        center.y,
        center.z,
      ),
    ];
    // 创建X轴线条图元
    this.xAxis = plc.add({
      positions: positions,
      width: this.lineWidth,
      material: this.getAxisMaterial(this.xAxisColor),
    });
    // 计算并存储X轴的单位法向量
    this.xNormal = new Cesium.Cartesian3();
    Cesium.Cartesian3.subtract(positions[1], positions[0], this.xNormal);
    Cesium.Cartesian3.normalize(this.xNormal, this.xNormal);
    // 创建X轴的辅助线（拖拽时显示）
    this.xAux = plc.add({
      positions: [],  // 初始为空，拖拽时动态更新
      width: this.lineWidth,
      material: this.getAxisMaterial(this.activeAxisColor, true),
    });
    // 设置轴属性
    this.xAxis.axis = "X";
    this.xAxis.color = this.xAxisColor;
    // === 创建Y轴 ===
    positions = [
      center,
      new Cesium.Cartesian3(
        center.x,
        -Cesium.defaultValue(this.yAxisLength, lineLength) + center.y,  // Y轴向负方向延伸
        center.z,
      ),
    ];
    // 创建Y轴线条图元
    this.yAxis = plc.add({
      positions: positions,
      width: this.lineWidth,
      material: this.getAxisMaterial(this.yAxisColor),
    });
    // 计算并存储Y轴的单位法向量
    this.yNormal = new Cesium.Cartesian3();
    Cesium.Cartesian3.subtract(positions[1], positions[0], this.yNormal);
    Cesium.Cartesian3.normalize(this.yNormal, this.yNormal);
    // 创建Y轴的辅助线（拖拽时显示）
    this.yAux = plc.add({
      positions: [],  // 初始为空，拖拽时动态更新
      width: this.lineWidth,
      material: this.getAxisMaterial(this.activeAxisColor, true),
    });
    // 设置轴属性
    this.yAxis.axis = "Y";
    this.yAxis.color = this.yAxisColor;
    // === 创建Z轴 ===
    positions = [
      center,
      new Cesium.Cartesian3(
        center.x,
        center.y,
        Cesium.defaultValue(this.zAxisLength, lineLength) + center.z,  // Z轴向正方向延伸
      ),
    ];
    // 创建Z轴线条图元
    this.zAxis = plc.add({
      positions: positions,
      width: this.lineWidth,
      material: this.getAxisMaterial(this.zAxisColor),
    });
    // 计算并存储Z轴的单位法向量
    this.zNormal = new Cesium.Cartesian3();
    Cesium.Cartesian3.subtract(positions[1], positions[0], this.zNormal);
    Cesium.Cartesian3.normalize(this.zNormal, this.zNormal);
    // 创建Z轴的辅助线（拖拽时显示）
    this.zAux = plc.add({
      positions: [],  // 初始为空，拖拽时动态更新
      width: this.lineWidth,
      material: this.getAxisMaterial(this.activeAxisColor, true),
    });
    // 设置轴属性
    this.zAxis.axis = "Z";
    this.zAxis.color = this.zAxisColor;
    
    // 将三个坐标轴添加到图元数组中，用于事件处理
    this._primitives.push(this.xAxis, this.yAxis, this.zAxis);
  }

  /**
   * 创建坐标轴的材质
   * 支持实线箭头和虚线箭头两种类型
   * @private
   * @param color 材质颜色
   * @param dash 是否为虚线样式，用于辅助线和旋转控制器
   * @param dashLength 虚线的段长度
   * @returns 配置好的材质对象
   */
  private getAxisMaterial(color: Cesium.Color, dash: boolean = false, dashLength: number = 16): Cesium.Material {
    if (dash) {
      // 创建虚线箭头材质，用于辅助线和旋转控制器
      return new Cesium.Material({
        fabric: {
          type: "dasharrow",
          source: polylineAntialiasingMaterial,  // 使用自定义的抗锯齿虚线材质
          uniforms: {
            color: color,                         // 线条颜色
            gapColor: Cesium.Color.TRANSPARENT,   // 间隙颜色（透明）
            dashLength: dashLength,               // 虚线段长度
            dashPattern: 255,                     // 虚线模式
          },
        },
      });
    } else {
      // 创建实线箭头材质，用于主要的坐标轴
      return new Cesium.Material({
        fabric: {
          type: "PolylineArrow",
          uniforms: {
            color: color,  // 箭头颜色
          },
        },
      });
    }
  }

  /**
   * 创建坐标平面
   * @private
   */
  private createAxisPlane(): void {
    if (!this.xAxis || !this.yAxis || !this.zAxis) {
      return;
    }
    
    this.XOYPlane = this.primitivesList.add(
      new AxisPlane({
        color: this.zAxisColor,
        modelMatrix: this.modelMatrix,
        center: this.center,
        radius: this._radius,
        normal: new Cesium.Cartesian3(0, 0, 1),
        axis: "XY",
      }),
    ) as AxisPrimitive;
    this.XOYPlane.relativeAxis = [this.xAxis, this.yAxis];
    
    this.XOZPlane = this.primitivesList.add(
      new AxisPlane({
        color: this.yAxisColor,
        modelMatrix: this.modelMatrix,
        center: this.center,
        radius: this._radius,
        normal: new Cesium.Cartesian3(0, 1, 0),
        axis: "XZ",
      }),
    ) as AxisPrimitive;
    this.XOZPlane.relativeAxis = [this.xAxis, this.zAxis];
    
    this.YOZPlane = this.primitivesList.add(
      new AxisPlane({
        color: this.xAxisColor,
        modelMatrix: this.modelMatrix,
        center: this.center,
        radius: this._radius,
        normal: new Cesium.Cartesian3(1, 0, 0),
        axis: "YZ",
      }),
    ) as AxisPrimitive;
    this.YOZPlane.relativeAxis = [this.yAxis, this.zAxis];
    
    this._primitives.push(this.XOYPlane, this.YOZPlane, this.XOZPlane);
  }

  /**
   * 创建旋转轴
   * @private
   */
  private createRotateAxis(): void {
    if (!this.axisRoot) {
      return;
    }
    const pts = [];
    const radius = this.rotatePlaneRadius || this._radius * this.radiusRatio;
    const center = this.center;
    for (let i = 0; i <= 360; i++) {
      const rad = (i / 180) * Math.PI;
      pts.push(
        new Cesium.Cartesian3(
          center.x + radius * Math.cos(rad),
          center.y + radius * Math.sin(rad),
          center.z,
        ),
      );
    }
    this.zRotate = this.axisRoot.add({
      positions: [...pts],
      width: this.lineWidth,
      material: this.getAxisMaterial(this.zAxisColor, true, 0),
    });
    this.zRotate.axis = "RZ";
    this.zRotate.color = this.zAxisColor;
    this.zRotate.normal = new Cesium.Cartesian3(0, 0, 1);
    pts.splice(0);
    for (let i = 0; i <= 360; i++) {
      const rad = (i / 180) * Math.PI;
      pts.push(
        new Cesium.Cartesian3(
          center.x + radius * Math.cos(rad),
          center.y,
          center.z + radius * Math.sin(rad),
        ),
      );
    }
    this.yRotate = this.axisRoot.add({
      positions: [...pts],
      width: this.lineWidth,
      material: this.getAxisMaterial(this.yAxisColor, true, 0),
    });
    this.yRotate.axis = "RY";
    this.yRotate.color = this.yAxisColor;
    this.yRotate.normal = new Cesium.Cartesian3(0, 1, 0);
    pts.splice(0);
    for (let i = 0; i <= 360; i++) {
      const rad = (i / 180) * Math.PI;
      pts.push(
        new Cesium.Cartesian3(
          center.x,
          center.y + radius * Math.cos(rad),
          center.z + radius * Math.sin(rad),
        ),
      );
    }
    this.xRotate = this.axisRoot.add({
      positions: [...pts],
      width: this.lineWidth,
      material: this.getAxisMaterial(this.xAxisColor, true, 0),
    });
    this.xRotate.axis = "RX";
    this.xRotate.color = this.xAxisColor;
    this.xRotate.normal = new Cesium.Cartesian3(-1, 0, 0);

    this.rAxuStart = this.axisRoot.add({
      positions: [],
      width: this.lineWidth / 2,
      material: this.getAxisMaterial(this.activeAxisColor, true, 0),
    });
    this.rAxuEnd = this.axisRoot.add({
      positions: [],
      width: this.lineWidth / 2,
      material: this.getAxisMaterial(this.activeAxisColor, true, 0),
    });
    this._primitives.push(
      this.xRotate,
      this.yRotate,
      this.zRotate,
      this.rAxuStart,
      this.rAxuEnd,
    );
  }

  /**
   * 创建缩放轴
   * @private
   */
  private createScaleAxis(): void {
    if (!this.axisRoot) {
      return;
    }
    const lineLength = this._radius * this.radiusRatio;
    const normal = new Cesium.Cartesian3(1, 1, 1);
    if (this.xNormal && this.yNormal && this.zNormal) {
      Cesium.Cartesian3.add(this.xNormal, this.yNormal, normal);
      Cesium.Cartesian3.add(normal, this.zNormal, normal);
    }
    Cesium.Cartesian3.normalize(normal, normal);
    const l = Cesium.defaultValue(this.scaleAxisLength, lineLength);
    // 对角线顶点
    const v = new Cesium.Cartesian3();
    Cesium.Cartesian3.multiplyByScalar(normal, l, v);
    Cesium.Cartesian3.add(this._center, v, v);
    this.scaleAxis = this.axisRoot.add({
      positions: [this._center, v],
      width: this.lineWidth,
      material: this.getAxisMaterial(this.scaleAxisColor),
    });
    this._primitives.push(this.scaleAxis);
    this.scaleAxis.axis = "SXYZ";
    this.scaleAxis.color = this.scaleAxisColor;
  }

  /**
   * 注册鼠标事件监听器
   * 处理鼠标按下、移动、释放事件来实现拖拽编辑功能
   * @private
   */
  private addEventListener(): void {
    const viewer = this.viewer;
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
    
    // === 鼠标按下事件 ===
    handler.setInputAction((e: any) => {
      if (!this.hasBindObject) {
        return;
      }
      // 检测鼠标点击的对象
      const feat = viewer.scene.pick(e.position);
      if (!feat) {
        return;
      }
      // 如果点击的是编辑器的控制器
      if (this._primitives.includes(feat.primitive)) {
        this.mousedownPixel = e.position;              // 记录按下位置
        this.active(feat.primitive);                   // 激活被点击的控制器
        this.offset = new Cesium.Cartesian3();         // 重置偏移量
        this.angle = 0;                                // 重置旋转角度
        
        // 注册鼠标移动事件监听器
        handler.setInputAction((e: any) => {
          const { startPosition, endPosition } = e;
          this.transform(startPosition, endPosition);   // 执行变换操作
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        
        // 禁用相机旋转，避免与编辑操作冲突
        viewer.scene.screenSpaceCameraController.enableRotate = false;
      }
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN);
    // === 鼠标释放事件 ===
    handler.setInputAction((_e: any) => {
      if (!this.hasBindObject) {
        return;
      }
      // 取消激活状态，恢复原始颜色
      this.active(undefined);
      // 移除鼠标移动事件监听器
      handler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
      // 重新启用相机旋转
      viewer.scene.screenSpaceCameraController.enableRotate = true;
      
      // 清空平移辅助线
      if (this.translateEnabled && this.xAux && this.yAux && this.zAux) {
        this.xAux.positions = [];
        this.yAux.positions = [];
        this.zAux.positions = [];
      }
      // 清空旋转辅助线
      if (this.rotateEnabled && this.rAxuStart && this.rAxuEnd) {
        this.rAxuStart.positions = [];
        this.rAxuEnd.positions = [];
      }
    }, Cesium.ScreenSpaceEventType.LEFT_UP);
    // 保存事件清理函数，用于编辑器销毁时清理事件监听器
    this._removeEventListener = function () {
      handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOWN);
      handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_UP);
    };
  }

  /**
   * 执行变换操作（平移、旋转、缩放）
   * 根据当前激活的控制器类型和鼠标移动距离计算并应用变换
   * @private
   * @param startPosition 鼠标开始位置（屏幕坐标）
   * @param endPosition 鼠标结束位置（屏幕坐标）
   */
  private transform(startPosition: Cesium.Cartesian2, endPosition: Cesium.Cartesian2): void {
    // 触发变换前事件
    if (this.modelMatrix) {
      this.preTranformEvent.raise(Cesium.Matrix4.clone(this.modelMatrix, new Cesium.Matrix4()));
    }
    
    // === 处理原点拖拽（整体移动） ===
    if (this.activePrimitive === this.originPoint) {
      // 将屏幕坐标转换为地理坐标
      const lonlat = LonLat.fromPixel(endPosition, this.viewer);
      if (lonlat) {
        const translation = LonLat.toCartesian(lonlat, this.viewer);
        if (translation && this._modelMatrix) {
          // 直接设置模型矩阵的平移部分
          Cesium.Matrix4.setTranslation(
            this._modelMatrix,
            translation,
            this._modelMatrix,
          );
          this.modelMatrix = this._modelMatrix;
          // 同步更新所有图元的模型矩阵
          const primitives = this.primitivesList as any;
          if (primitives._primitives) {
            for (const primitive of primitives._primitives) {
              primitive.modelMatrix = this.modelMatrix;
            }
          }
        }
      }
    } 
    // === 处理平移操作 ===
    else if (this.mode === EModel.T) {
      this.computeOffset(startPosition, endPosition, _offset as OffsetCartesian3);
      this.translate(_offset);
    } 
    // === 处理旋转操作 ===
    else if (this.mode === EModel.R) {
      const startLocalPosition = this.getPositionInPlane(startPosition);
      const endLocalPosition = this.getPositionInPlane(endPosition);
      if (startLocalPosition && endLocalPosition) {
        const angle = this.computeAngle(startLocalPosition, endLocalPosition);
        this.rotate(angle);
      }
    } 
    // === 处理缩放操作 ===
    else if (this.mode === EModel.S && this.scaleAxis) {
      this.computeOffset(startPosition, endPosition, _offset as OffsetCartesian3);
      const offsetExtended = _offset as OffsetCartesian3;
      if (offsetExtended.sxyz !== undefined) {
        // 根据拖拽距离计算缩放比例
        const distance = Cesium.Cartesian3.distance(this.scaleAxis.positions[0], this.scaleAxis.positions[1]);
        const s = -offsetExtended.sxyz / distance + 1;
        this.scale(new Cesium.Cartesian3(s, s, s));
      }
    }
    
    // 触发变换后事件
    if (this.modelMatrix) {
      this.postTransformEvent.raise(Cesium.Matrix4.clone(this.modelMatrix, new Cesium.Matrix4()));
    }
  }

  /**
   * 平移变换
   * @param offset 偏移量
   */
  private translate(offset: Cesium.Cartesian3): void {
    if (!this.activePrimitive || !this.activePrimitive.axis) {
      return;
    }
    const axis = this.activePrimitive.axis;
    if (axis.indexOf("X") === -1) {
      offset.x = 0;
    }
    if (axis.indexOf("Y") === -1) {
      offset.y = 0;
    }
    if (axis.indexOf("Z") === -1) {
      offset.z = 0;
    }
    offset.x = -offset.x;
    offset.z = -offset.z;
    Cesium.Cartesian3.add(this.offset, offset, this.offset);
    const matrix = Cesium.Matrix4.fromTranslation(offset);
    if (this.modelMatrix) {
      Cesium.Matrix4.multiply(this.modelMatrix, matrix, this.modelMatrix);
    }
    // 使用正确的方式访问图元集合
    const primitives = this.primitivesList as any;
    if (primitives._primitives) {
      for (const primitive of primitives._primitives) {
        Cesium.Matrix4.multiply(
          primitive.modelMatrix,
          matrix,
          primitive.modelMatrix,
        );
      }
    }
    this.createAux(this.offset);
  }

  /**
   * 计算偏移量
   * @param startPosition 开始位置
   * @param endPosition 结束位置
   * @param offset 偏移量输出
   */
  private computeOffset(startPosition: Cesium.Cartesian2, endPosition: Cesium.Cartesian2, offset: OffsetCartesian3): OffsetCartesian3 {
    if (!this.activePrimitive) {
      return offset;
    }
    const activeAxis = this.activePrimitive.relativeAxis || [
      this.activePrimitive,
    ];
    if (!Array.isArray(activeAxis)) {
      return offset;
    }
    const cameraHeight = this.viewer.camera.positionCartographic.height;
    const delta = cameraHeight / 1047;
    for (const axis of activeAxis) {
      if (!axis.positions || !axis.axis || !this._modelMatrix) {
        continue;
      }
      const positions = axis.positions;
      const cartList = positions.map((pos: Cesium.Cartesian3) =>
        Cesium.Matrix4.multiplyByPoint(
          this._modelMatrix!,
          pos,
          new Cesium.Cartesian3(),
        ),
      );
      const pixelList = cartList.map((cart: Cesium.Cartesian3) =>
        LonLat.toPixel(cart, this.viewer.scene),
      ).filter(pixel => pixel !== undefined) as Cesium.Cartesian2[];
      
      if (pixelList.length >= 2) {
        const axisVector = Cesium.Cartesian2.subtract(pixelList[1], pixelList[0], new Cesium.Cartesian2());
        const moveVector = Cesium.Cartesian2.subtract(endPosition, startPosition, new Cesium.Cartesian2());
        const length = this.projectInAxis(axisVector, moveVector);
        offset[axis.axis.toLowerCase()] = length * delta;
      }
    }
    return offset;
  }

  /**
   * 计算旋转角度
   * @param startPosition 开始位置
   * @param endPosition 结束位置
   * @returns 旋转角度（弧度）
   */
  private computeAngle(startPosition: Cesium.Cartesian3, endPosition: Cesium.Cartesian3): number {
    if (!this.activePrimitive || !this.activePrimitive.normal) {
      return 0;
    }
    const center = this.center;
    const startVec = Cesium.Cartesian3.subtract(startPosition, center, new Cesium.Cartesian3());
    const endVec = Cesium.Cartesian3.subtract(endPosition, center, new Cesium.Cartesian3());
    
    const normalizedStart = Cesium.Cartesian3.normalize(startVec, new Cesium.Cartesian3());
    const normalizedEnd = Cesium.Cartesian3.normalize(endVec, new Cesium.Cartesian3());
    
    const angle = Cesium.Cartesian3.dot(normalizedStart, normalizedEnd);
    
    // 计算旋转方向
    const v1 = Cesium.Cartesian3.subtract(startVec, endVec, new Cesium.Cartesian3());
    const cross = Cesium.Cartesian3.cross(v1, startVec, new Cesium.Cartesian3());
    const normal = this.activePrimitive.normal;
    
    const sign = Cesium.Math.sign(Cesium.Cartesian3.dot(cross, normal));
    return Math.acos(Cesium.Math.clamp(angle, -1, 1)) * sign;
  }

  /**
   * 计算向量在轴上的投影
   * @param normal 轴的法向量
   * @param vector 要投影的向量
   * @returns 投影长度
   */
  private projectInAxis(normal: Cesium.Cartesian2, vector: Cesium.Cartesian2): number {
    const normalizedNormal = Cesium.Cartesian2.normalize(normal, new Cesium.Cartesian2());
    return Cesium.Cartesian2.dot(normalizedNormal, vector);
  }

  /**
   * 旋转变换
   * @private
   * @param angle 旋转角度（弧度）
   */
  private rotate(angle: number): void {
    if (!this.activePrimitive || !this.activePrimitive.normal || !this.modelMatrix) {
      return;
    }
    this.angle += angle;
    const axis = this.activePrimitive.normal;
    const translation = Cesium.Matrix4.fromTranslation(
      this.center,
      new Cesium.Matrix4(),
    );
    const q = Cesium.Quaternion.fromAxisAngle(
      axis,
      angle,
      new Cesium.Quaternion(),
    );
    const roateMatrix = Cesium.Matrix3.fromQuaternion(q, new Cesium.Matrix3());
    const inverseTranslation = Cesium.Matrix4.fromTranslation(
      Cesium.Cartesian3.negate(this.center, new Cesium.Cartesian3()),
      new Cesium.Matrix4(),
    );
    Cesium.Matrix4.multiply(this.modelMatrix, translation, this.modelMatrix);
    Cesium.Matrix4.multiplyByMatrix3(
      this.modelMatrix,
      roateMatrix,
      this.modelMatrix,
    );
    Cesium.Matrix4.multiply(
      this.modelMatrix,
      inverseTranslation,
      this.modelMatrix,
    );
    
    // 使用正确的方式访问图元集合
    const primitives = this.primitivesList as any;
    if (primitives._primitives) {
      for (const primitive of primitives._primitives) {
        Cesium.Matrix4.multiply(
          primitive.modelMatrix,
          translation,
          primitive.modelMatrix,
        );
        Cesium.Matrix4.multiplyByMatrix3(
          primitive.modelMatrix,
          roateMatrix,
          primitive.modelMatrix,
        );
        Cesium.Matrix4.multiply(
          primitive.modelMatrix,
          inverseTranslation,
          primitive.modelMatrix,
        );
      }
    }
    this.modelMatrix = this._modelMatrix;
    this.createRotateAux(this.startLocalPosition, this.angle);
  }

  /**
   * 缩放变换
   * @param scale 缩放比例
   */
  private scale(scale: Cesium.Cartesian3): void {
    if (!this.modelMatrix) {
      return;
    }
    const scaleMatrix = Cesium.Matrix4.fromScale(scale, new Cesium.Matrix4());
    Cesium.Matrix4.multiply(this.modelMatrix, scaleMatrix, this.modelMatrix);
    
    // 使用正确的方式访问图元集合
    const primitives = this.primitivesList as any;
    if (primitives._primitives) {
      for (const primitive of primitives._primitives) {
        Cesium.Matrix4.multiply(
          primitive.modelMatrix,
          scaleMatrix,
          primitive.modelMatrix,
        );
      }
    }
  }

  /**
   * 激活当前操作的坐标轴或坐标平面
   * @private
   * @param geometry 要激活的几何体
   */
  private active(geometry?: AxisPrimitive): void {
    if (!(geometry || this.activePrimitive)) {
      return;
    }
    if (!geometry && this.activePrimitive) {
      const color = this.activePrimitive.pcolor || this.activePrimitive.color;
      if (color) {
        this.setColorForPrimitive(this.activePrimitive, color);
      }
      if (this.activePrimitive.isAxisPlane && this.activePrimitive.relativeAxis) {
        for (const a of this.activePrimitive.relativeAxis) {
          if (a.color) {
            this.setColorForPrimitive(a, a.color);
          }
        }
      }
      this.activePrimitive = undefined;
      this.mode = EModel.N;
      return;
    }
    // 如果激活的是坐标平面，平面所在的坐标轴也需要高亮
    if (geometry && geometry.isAxisPlane && geometry.relativeAxis) {
      for (const a of geometry.relativeAxis) {
        this.setColorForPrimitive(a, this.activeAxisColor);
      }
    }
    this.activePrimitive = geometry;
    if (geometry) {
      this.setColorForPrimitive(geometry, this.activeAxisColor);
      if (!geometry.axis) {
        return;
      }
      if (geometry.axis.includes("R")) {
        this.mode = EModel.R;
        if (this.mousedownPixel && this.rAxuStart) {
          const mousedownCartesian = this.getPositionInPlane(this.mousedownPixel);
          if (mousedownCartesian) {
            this.rAxuStart.positions = [this.center, mousedownCartesian];
            this.startLocalPosition = mousedownCartesian;
          }
        }
      } else if (geometry.axis.includes("S")) {
        this.mode = EModel.S;
      } else {
        this.mode = EModel.T;
      }
    }
  }

  /**
   * 创建平移辅助线
   * @private
   * @param offset 偏移量
   */
  private createAux(offset: Cesium.Cartesian3): void {
    if (!this.xAxis || !this.yAxis || !this.zAxis || !this.xAux || !this.yAux || !this.zAux) {
      return;
    }
    
    if (offset.x > 0) {
      const p1 = Cesium.Cartesian3.clone(this.xAxis.positions[0]);
      const p2 = Cesium.Cartesian3.clone(this.xAxis.positions[0]);
      p2.x += -offset.x;
      this.xAux.positions = [p1, p2];
    } else {
      const p1 = Cesium.Cartesian3.clone(this.xAxis.positions[1]);
      const p2 = Cesium.Cartesian3.clone(this.xAxis.positions[1]);
      p2.x += -offset.x;
      this.xAux.positions = [p1, p2];
    }
    if (offset.y < 0) {
      const p1 = Cesium.Cartesian3.clone(this.yAxis.positions[0]);
      const p2 = Cesium.Cartesian3.clone(this.yAxis.positions[0]);
      p2.y += -offset.y;
      this.yAux.positions = [p1, p2];
    } else {
      const p1 = Cesium.Cartesian3.clone(this.yAxis.positions[1]);
      const p2 = Cesium.Cartesian3.clone(this.yAxis.positions[1]);
      p2.y += -offset.y;
      this.yAux.positions = [p1, p2];
    }
    if (offset.z > 0) {
      const p1 = Cesium.Cartesian3.clone(this.zAxis.positions[0]);
      const p2 = Cesium.Cartesian3.clone(this.zAxis.positions[0]);
      p2.z += -offset.z;
      this.zAux.positions = [p1, p2];
    } else {
      const p1 = Cesium.Cartesian3.clone(this.zAxis.positions[1]);
      const p2 = Cesium.Cartesian3.clone(this.zAxis.positions[1]);
      p2.z += -offset.z;
      this.zAux.positions = [p1, p2];
    }
  }

  /**
   * 创建旋转辅助线
   * @private
   * @param startLocalPosition 开始本地位置
   * @param angle 旋转角度
   */
  private createRotateAux(startLocalPosition?: Cesium.Cartesian3, angle?: number): void {
    const startPosition = this.startLocalPosition;
    if (!startPosition || !this.activePrimitive || !this.activePrimitive.normal || !this.rAxuEnd || angle === undefined) {
      return;
    }
    const q = Cesium.Quaternion.fromAxisAngle(
      this.activePrimitive.normal,
      -angle,
      new Cesium.Quaternion(),
    );
    const matrix3 = Cesium.Matrix3.fromQuaternion(q, new Cesium.Matrix3());
    const rotation = Cesium.Matrix4.fromRotation(matrix3, new Cesium.Matrix4());
    const position = Cesium.Cartesian3.subtract(
      startLocalPosition || startPosition,
      this.center,
      new Cesium.Cartesian3(),
    );
    Cesium.Matrix4.multiplyByPoint(rotation, position, position);
    Cesium.Cartesian3.add(this.center, position, position);
    this.rAxuEnd.positions = [this.center, position];
  }

  /**
   * 设置坐标轴或坐标平面的颜色
   * @param primitive 图元对象
   * @param color 颜色
   */
  private setColorForPrimitive(primitive: any, color: Cesium.Color): void {
    if (primitive instanceof Cesium.Polyline) {
      primitive.material.uniforms.color = color;
    } else if (primitive instanceof Cesium.Primitive) {
      primitive.appearance.material.uniforms.color = color;
    } else if (primitive instanceof Cesium.PointPrimitive) {
      primitive.color = color;
    }
  }

  /**
   * 获取鼠标在平面上的位置
   * @param pixel 像素坐标
   * @returns 平面上的位置
   */
  private getPositionInPlane(pixel: Cesium.Cartesian2): Cesium.Cartesian3 | undefined {
    if (!this.activePrimitive || !this.activePrimitive.normal || !this._modelMatrix || !this._inverseModelMatrix) {
      return undefined;
    }
    const mousedownCartesian = new Cesium.Cartesian3();
    const ray = this.viewer.camera.getPickRay(pixel);
    if (!ray) {
      return undefined;
    }
    const plane = new Cesium.Plane(Cesium.Cartesian3.UNIT_X, 0.0);
    Cesium.Plane.fromPointNormal(
      this.center,
      this.activePrimitive.normal,
      plane,
    );
    Cesium.Plane.transform(plane, this._modelMatrix, plane);
    const intersection = Cesium.IntersectionTests.rayPlane(ray, plane, mousedownCartesian);
    if (!intersection) {
      return undefined;
    }
    Cesium.Matrix4.multiplyByPoint(
      this._inverseModelMatrix,
      mousedownCartesian,
      mousedownCartesian,
    );
    return mousedownCartesian;
  }

  /**
   * 解绑当前编辑对象
   * 清理所有控制器图元和相关引用，但保留编辑器实例
   */
  unbind(): void {
    console.log("unbind");
    // 清除对象引用
    this.bindObject = undefined;
    // 移除所有图元
    this.primitivesList.removeAll();
    
    // === 清空图元引用 ===
    this.originPoint = undefined;
    this.xAxis = undefined;
    this.yAxis = undefined;
    this.zAxis = undefined;
    this.xAux = undefined;
    this.yAux = undefined;
    this.zAux = undefined;
    
    // 清空变换矩阵
    this.modelMatrix = undefined;
    // 标记为未绑定状态
    this.hasBindObject = false;
  }

  /**
   * 从场景中完全移除编辑器
   * 清理所有资源，包括图元、事件监听器等
   * 调用后编辑器实例将不可再使用
   */
  remove(): void {
    // 从场景中移除图元集合
    this.viewer.scene.primitives.remove(this.primitivesList);
    // 移除事件监听器
    this._removeEventListener();
    // 清空图元数组
    this._primitives.splice(0);
  }
}

export default EditCesium;
