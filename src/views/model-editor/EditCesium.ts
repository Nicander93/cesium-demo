import * as Cesium from 'cesium';
import { EModel, polylineAntialiasingMaterial } from './config';
import AxisPlane from './AxisPlane';
import Event from './Event';
import LonLat from './LonLat';

const _offset = new Cesium.Cartesian3();

class EditCesium {
  /**
   * 模型编辑器-包含倾斜摄影、BIM、点位编辑
   * @param {Viewer} viewer
   * @param {Object} options
   * @param {number} [options.lineWidth = 15] 线宽
   * @param {Cesium.Color} [options.originColor = Cesium.Color.WHITE] 坐标轴原点颜色
   * @param {Cesium.Color} [options.xAxisColor = Cesium.Color.RED] X轴的颜色
   * @param {number} [options.xAxisLength] X轴的长度, 如果未定义将自动计算
   * @param {Cesium.Color} [options.yAxisColor = Cesium.Color.GREEN] Y轴颜色
   * @param {number} [options.yAxisLength] Y轴的长度，如果未定义将自动计算
   * @param {Cesium.Color} [options.zAxisColor = Cesium.Color.BLUE] Z轴颜色
   * @param {number} [options.zAxisLength] Z轴长度，如果未定义将自动计算
   * @param {Cesium.Color} [options.activeAxisColor = Cesium.Color.YELLOW] 被激活的坐标标轴颜色
   * @param {Cesium.Color} [options.scaleAxisColor = Cesium.Color.WHITE] 缩放轴的颜色
   * @param {boolean} [options.translateEnabled = true] 是否创建平移控制器
   * @param {boolean} [options.rotateEnabled = false] 是否创建旋转控制器，仅对模型可用
   * @param {boolean} [options.scaleEnabled = false] 是否创建缩放控制器，仅对模型有效
   * @param {number} [options.scaleAxisLength] 缩放轴的长度，如果未定义将自动计算
   * @param {number} [options.rotatePlaneRadius] 旋转轴的半径，如果未定义将自动计算
   * @param {boolean} [options.sizeInPixel = false] 控制器的大小是否以像素为单位
   * @param {number} [options.radiusRatio = 1] 如果没有为坐标轴指定长度，将使用模型boundingSphere的半径乘该系数作长度
   * @param {Cesium.Cartesian3} [options.originOffset = Cesium.Cartesian3.ZERO] 默认原点在点或模型的中心位置，该值设置相对于默认位置的偏移
   */
  viewer: any;
  originColor: Cesium.Color;
  lineWidth: number;
  xAxisColor: Cesium.Color;
  xAxisLength: number;
  yAxisColor: Cesium.Color;
  yAxisLength: number;
  zAxisColor: Cesium.Color;
  zAxisLength: number;
  activeAxisColor: Cesium.Color;
  scaleAxisColor: Cesium.Color;
  _translateEnabled: boolean;
  _rotateEnabled: boolean;
  _scaleEnabled: boolean;
  scaleAxisLength: number;
  rotatePlaneRadius: number;
  sizeInPixel: boolean;
  radiusRatio: number;
  originOffset: Cesium.Cartesian3;
  hasBindObject: boolean;
  bindObject: any;
  _modelMatrix: any;
  _inverseModelMatrix: any;
  _center: any;
  _radius: number;
  axisRoot: any;
  primitivesList: Cesium.PrimitiveCollection;
  _primitives: any[];
  originPoint: any;
  // 坐标轴
  xAxis: any;
  yAxis: any;
  zAxis: any;
  xNormal: any;
  yNormal: any;
  zNormal: any;
  xAux: any;
  yAux: any;
  zAux: any;
  // 坐标平面
  XOYPlane: any;
  XOZPlane: any;
  YOZPlane: any;
  // 旋转轴
  zRotate: any;
  yRotate: any;
  xRotate: any;
  rAxuStart: any;
  rAxuEnd: any;
  // 缩放轴
  scaleAxis: any;
  // 鼠标操作
  mousedownPixel: any;
  offset: Cesium.Cartesian3;
  angle: number;
  mode: any;
  activePrimitive: any;
  startLocalPosition: any;
  preTranformEvent: Event;
  postTransformEvent: Event;
  _removeEventListener: () => void;

  constructor(viewer: any, options: any) {
    this.viewer = viewer;
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
    this._translateEnabled = options.translateEnabled || true;
    this._rotateEnabled = options.rotateEnabled || false;
    this._scaleEnabled = options.scaleEnabled || false;
    this.scaleAxisLength = options.scaleAxisLength;
    this.rotatePlaneRadius = options.rotatePlaneRadius;
    this.sizeInPixel = options.sizeInPixel || false;
    this.radiusRatio = options.radiusRatio || 1;
    this.originOffset = options.originOffset || Cesium.Cartesian3.ZERO;
    // 其他的参数
    this._modelMatrix = undefined;
    this._inverseModelMatrix = undefined;
    this._center = new Cesium.Cartesian3();
    this._radius = 0;
    this.axisRoot = undefined;
    this.primitivesList = new Cesium.PrimitiveCollection();
    this._primitives = [];
    // 鼠标移动参数
    this.offset = new Cesium.Cartesian3(0, 0, 0);
    this.angle = 0;
    this.mode = EModel.N;
    /**
     * 位置或姿态发生变化前解发的事件
     * @type {Event}
     */
    this.preTranformEvent = new Event();
    /**
     * 位置或姿态发生变化后触发的事件
     * @type {Event}
     */
    this.postTransformEvent = new Event();
  }

  /**
   * 获得或设置平移控件是否显示
   * @type {boolean}
   */
  get translateEnabled() {
    return this._translateEnabled;
  }

  set translateEnabled(val) {
    this._translateEnabled = val;
    for (const primitive of this._primitives) {
      const axis = primitive.axis;
      if (!axis) {
        continue;
      }
      if (!(axis.includes(EModel.R) || axis.includes(EModel.S))) {
        primitive.show = val;
      }
    }
  }

  /**
   * 获得或设置旋转控件是否显示
   * @type {boolean}
   */
  get rotateEnabled() {
    return this._rotateEnabled;
  }

  set rotateEnabled(val) {
    this._rotateEnabled = val;
    for (const primitive of this._primitives) {
      const axis = primitive.axis;
      if (!axis) {
        continue;
      }
      if (axis.includes(EModel.R)) {
        primitive.show = val;
      }
    }
  }

  /**
   * 获得或设置缩放控件是否显示
   * @type {boolean}
   */
  get scaleEnabled() {
    return this._scaleEnabled;
  }

  set scaleEnabled(val) {
    this._scaleEnabled = val;
    for (const primitive of this._primitives) {
      const axis = primitive.axis;
      if (!axis) {
        continue;
      }
      if (axis.includes(EModel.S)) {
        primitive.show = val;
      }
    }
  }

  /**
   * 模型矩阵
   * @type {Cesium.Matrix4}
   */
  get modelMatrix() {
    return this._modelMatrix;
  }

  set modelMatrix(matrix) {
    if (!matrix) {
      this._modelMatrix = undefined;
      this._inverseModelMatrix = undefined;
      return;
    }
    this._modelMatrix = matrix;
    this._inverseModelMatrix = Cesium.Matrix4.inverse(
      matrix,
      new Cesium.Matrix4(),
    );
  }

  /**
   * 中心位置的坐标
   * @type {Cesium.Cartesian3}
   */
  get center() {
    return Cesium.Cartesian3.add(
      this._center,
      this.originOffset,
      new Cesium.Cartesian3(),
    );
  }

  /**
   * 添加到场景
   * @param {Cesium.Viewer} viewer
   */
  addTo(object: any) {
    this.bind(object);
    this.viewer.scene.primitives.add(this.primitivesList);
    this.addEventListener();
  }

  /**
   * 绑定对象
   * @param { Cesium.Model | Cesium.Cesium3DTileset | Cesium.Entity} object
   */
  bind(object: any) {
    if (!this.viewer) {
      throw new Error('please call addTo method to add to viewer');
    }
    this.unbind();
    // 是否重新绑定对象了
    this.hasBindObject = true;
    if (object instanceof Cesium.Cesium3DTileset) {
      this.bindObject = object;
      this.modelMatrix = object.modelMatrix;
      object.allTilesLoaded.addEventListener(() => {
        const center = Cesium.Cartesian3.clone(object.boundingSphere.center);
        Cesium.Matrix4.multiplyByPoint(
          this._inverseModelMatrix,
          center,
          this._center,
        );
        this._radius = object.boundingSphere.radius;
        this.scaleEnabled = false;
        this.createPrimitive(true, false);
      });
    } else if (object instanceof Cesium.Model) {
      this.bindObject = object;
      this.modelMatrix = object.modelMatrix;
      object.readyEvent.addEventListener(() => {
        const center = Cesium.Cartesian3.clone(object.boundingSphere.center);
        Cesium.Matrix4.multiplyByPoint(
          this._inverseModelMatrix,
          center,
          this._center,
        );
        this._radius = object.boundingSphere.radius;
        this.createPrimitive(true, true);
      });
    } else if (object instanceof Cesium.Entity) {
      let position;
      if (typeof object.position.getValue === 'function') {
        position = object.position.getValue(this.viewer.clock.currentTime);
      }
      if (position instanceof Cesium.Cartesian3 === false) {
        throw new Error('position is invalid');
      }
      this.modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(position);
      this._center = new Cesium.Cartesian3();
      Cesium.Cartesian3.clone(this.originOffset, this._center);
      this._radius = 10;
      this.rotateEnabled = false;
      this.scaleEnabled = false;
      this.createPrimitive(false, false);
      this.postTransformEvent.addEventListener((modelMatrix) => {
        const position = new Cesium.Cartesian3();
        Cesium.Matrix4.getTranslation(modelMatrix, position);
        object.position = position;
      });
    }
  }

  /**
   * @private
   * 创建控制器需要的要素
   */
  createPrimitive(isEntity = false, isTiles = false) {
    const polyline = new Cesium.PolylineCollection({
      modelMatrix: this._modelMatrix,
    });
    this.axisRoot = polyline;
    this.primitivesList.add(polyline);
    this.createOrigenPoint();
    this.translateEnabled && this.createMoveAxis();
    this.translateEnabled && this.createAxisPlane();
    isEntity && this.rotateEnabled && this.createRotateAxis();
    isTiles && this.scaleEnabled && this.createScaleAxis();
  }

  /**
   * 创建坐标轴原点
   * @private
   */
  createOrigenPoint() {
    const point = new Cesium.PointPrimitiveCollection({
      modelMatrix: this.modelMatrix,
    });
    this.originPoint = point.add({
      show: true,
      position: this.center,
      pixelSize: this.lineWidth * 1.5,
      color: this.originColor,
    });
    this.originPoint.axis = 'XYZ';
    // point 中已有color属性，因此用pcolor，和其他轴中的color作用一样
    this.originPoint.pcolor = this.originColor;
    this.primitivesList.add(point);
    this._primitives.push(this.originPoint);
  }

  /**
   * 创建XYZ坐标轴
   * @private
   * @param {*} boundingSphere
   */
  createMoveAxis() {
    console.log(this.center);
    if (!this.center) {
      return;
    }
    const lineLength = this._radius * this.radiusRatio;
    const plc = this.axisRoot;
    const center = this.center;
    let positions = [
      center,
      new Cesium.Cartesian3(
        Cesium.defaultValue(this.xAxisLength, lineLength) + center.x,
        center.y,
        center.z,
      ),
    ];
    this.xAxis = plc.add({
      positions: positions,
      width: this.lineWidth,
      material: this.getAxisMaterial(this.xAxisColor),
    });
    this.xNormal = new Cesium.Cartesian3();
    Cesium.Cartesian3.subtract(positions[1], positions[0], this.xNormal);
    Cesium.Cartesian3.normalize(this.xNormal, this.xNormal);
    this.xAux = plc.add({
      positions: [],
      width: this.lineWidth,
      material: this.getAxisMaterial(this.activeAxisColor, true),
    });
    this.xAxis.axis = 'X';
    this.xAxis.color = this.xAxisColor;
    positions = [
      center,
      new Cesium.Cartesian3(
        center.x,
        -Cesium.defaultValue(this.yAxisLength, lineLength) + center.y,
        center.z,
      ),
    ];
    this.yAxis = plc.add({
      positions: positions,
      width: this.lineWidth,
      material: this.getAxisMaterial(this.yAxisColor),
    });
    this.yNormal = new Cesium.Cartesian3();
    Cesium.Cartesian3.subtract(positions[1], positions[0], this.yNormal);
    Cesium.Cartesian3.normalize(this.yNormal, this.yNormal);
    this.yAux = plc.add({
      positions: [],
      width: this.lineWidth,
      material: this.getAxisMaterial(this.activeAxisColor, true),
    });
    this.yAxis.axis = 'Y';
    this.yAxis.color = this.yAxisColor;
    positions = [
      center,
      new Cesium.Cartesian3(
        center.x,
        center.y,
        Cesium.defaultValue(this.zAxisLength, lineLength) + center.z,
      ),
    ];
    this.zAxis = plc.add({
      positions: positions,
      width: this.lineWidth,
      material: this.getAxisMaterial(this.zAxisColor),
    });
    this.zNormal = new Cesium.Cartesian3();
    Cesium.Cartesian3.subtract(positions[1], positions[0], this.zNormal);
    Cesium.Cartesian3.normalize(this.zNormal, this.zNormal);
    this.zAux = plc.add({
      positions: [],
      width: this.lineWidth,
      material: this.getAxisMaterial(this.activeAxisColor, true),
    });
    this.zAxis.axis = 'Z';
    this.zAxis.color = this.zAxisColor;
    this._primitives.push(this.xAxis, this.yAxis, this.zAxis);
  }

  /**
   * 创建坐标轴材质
   * @private
   */
  getAxisMaterial(color, dash = false, dashLength = 16) {
    if (dash) {
      return new Cesium.Material({
        fabric: {
          type: 'dasharrow',
          source: polylineAntialiasingMaterial,
          uniforms: {
            color: color,
            gapColor: Cesium.Color.TRANSPARENT,
            dashLength: dashLength,
            dashPattern: 255,
          },
        },
      });
    } else {
      return new Cesium.Material({
        fabric: {
          type: 'PolylineArrow',
          uniforms: {
            color: color,
          },
        },
      });
    }
  }

  /**
   * 创建坐标平面
   * @private
   */
  createAxisPlane() {
    this.XOYPlane = this.primitivesList.add(
      new AxisPlane({
        color: this.zAxisColor,
        modelMatrix: this.modelMatrix,
        center: this.center,
        radius: this._radius,
        normal: new Cesium.Cartesian3(0, 0, 1),
        axis: 'XY',
      }),
    );
    this.XOYPlane.relativeAxis = [this.xAxis, this.yAxis];
    this.XOZPlane = this.primitivesList.add(
      new AxisPlane({
        color: this.yAxisColor,
        modelMatrix: this.modelMatrix,
        center: this.center,
        radius: this._radius,
        normal: new Cesium.Cartesian3(0, 1, 0),
        axis: 'XZ',
      }),
    );
    this.XOZPlane.relativeAxis = [this.xAxis, this.zAxis];
    this.YOZPlane = this.primitivesList.add(
      new AxisPlane({
        color: this.xAxisColor,
        modelMatrix: this.modelMatrix,
        center: this.center,
        radius: this._radius,
        normal: new Cesium.Cartesian3(1, 0, 0),
        axis: 'YZ',
      }),
    );
    this.YOZPlane.relativeAxis = [this.yAxis, this.zAxis];
    this._primitives.push(this.XOYPlane, this.YOZPlane, this.XOZPlane);
  }

  /**
   * 创建旋转轴
   * @private
   */
  createRotateAxis() {
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
    this.zRotate.axis = 'RZ';
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
    this.yRotate.axis = 'RY';
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
    this.xRotate.axis = 'RX';
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
  createScaleAxis() {
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
    this.scaleAxis.axis = 'SXYZ';
    this.scaleAxis.color = this.scaleAxisColor;
  }

  /**
   * @private
   * 监听鼠标事件
   */
  addEventListener() {
    const viewer = this.viewer;
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
    handler.setInputAction((e) => {
      if (!this.hasBindObject) {
        return;
      }
      const feat = viewer.scene.pick(e.position);
      if (!feat) {
        return;
      }
      if (this._primitives.includes(feat.primitive)) {
        this.mousedownPixel = e.position;
        this.active(feat.primitive);
        this.offset = new Cesium.Cartesian3();
        this.angle = 0;
        handler.setInputAction((e) => {
          const { startPosition, endPosition } = e;
          this.transform(startPosition, endPosition);
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        viewer.scene.screenSpaceCameraController.enableRotate = false;
      }
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN);
    handler.setInputAction((e) => {
      if (!this.hasBindObject) {
        return;
      }
      this.active(null);
      handler.removeInputAction(Cesium.ScreenSpaceEventType.MOUSE_MOVE);
      viewer.scene.screenSpaceCameraController.enableRotate = true;
      if (this.translateEnabled) {
        this.xAux.positions = [];
        this.yAux.positions = [];
        this.zAux.positions = [];
      }
      if (this.rotateEnabled) {
        this.rAxuStart.positions = [];
        this.rAxuEnd.positions = [];
      }
    }, Cesium.ScreenSpaceEventType.LEFT_UP);
    this._removeEventListener = function () {
      handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOWN);
      handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_UP);
    };
  }

  /**
   * 平移
   * @private
   * @param {*} startPosition
   * @param {*} endPosition
   */
  transform(startPosition, endPosition) {
    this.preTranformEvent.raise(Cesium.Matrix4.clone(this.modelMatrix, {}));
    if (this.activePrimitive === this.originPoint) {
      const translation = LonLat.toCartesian(
        LonLat.fromPixel(endPosition, this.viewer),
        this.viewer,
      );
      Cesium.Matrix4.setTranslation(
        this._modelMatrix,
        translation,
        this._modelMatrix,
      );
      this.modelMatrix = this._modelMatrix;
      for (const primitive of this.primitivesList._primitives) {
        primitive.modelMatrix = this.modelMatrix;
      }
    } else if (this.mode === EModel.T) {
      this.computeOffset(this, startPosition, endPosition, _offset);
      this.translate(_offset);
    } else if (this.mode === EModel.R) {
      const startLocalPosition = this.getPositionInPlane(startPosition, this);
      const endLocalPosition = this.getPositionInPlane(endPosition, this);
      const angle = this.computeAngle(
        this,
        startLocalPosition,
        endLocalPosition,
      );
      this.rotate(angle);
    } else if (this.mode === EModel.S) {
      this.computeOffset(this, startPosition, endPosition, _offset);
      const s =
        -_offset.sxyz /
        Cesium.Cartesian3.distance(...this.scaleAxis.positions) +
        1;
      this.scale(new Cesium.Cartesian3(s, s, s));
    }
    this.postTransformEvent.raise(Cesium.Matrix4.clone(this.modelMatrix, {}));
  }

  /**
   * 平移
   * @param {*} offset
   */
  translate(offset) {
    if (!this.activePrimitive) {
      return;
    }
    const axis = this.activePrimitive.axis;
    if (axis.indexOf('X') === -1) {
      offset.x = 0;
    }
    if (axis.indexOf('Y') === -1) {
      offset.y = 0;
    }
    if (axis.indexOf('Z') === -1) {
      offset.z = 0;
    }
    offset.x = -offset.x;
    offset.z = -offset.z;
    Cesium.Cartesian3.add(this.offset, offset, this.offset);
    const matrix = Cesium.Matrix4.fromTranslation(offset);
    Cesium.Matrix4.multiply(this.modelMatrix, matrix, this.modelMatrix);
    for (const primitive of this.primitivesList._primitives) {
      Cesium.Matrix4.multiply(
        primitive.modelMatrix,
        matrix,
        primitive.modelMatrix,
      );
    }
    this.createAux(this.offset);
  }

  computeOffset(helper, startPosition, endPosition, offset) {
    const activeAxis = helper.activePrimitive.relativeAxis || [
      helper.activePrimitive,
    ];
    if (!Array.isArray(activeAxis)) {
      return;
    }
    const cameraHeight = helper.viewer.camera.positionCartographic.height;
    const delta = cameraHeight / 1047;
    for (const axis of activeAxis) {
      const positions = axis.positions;
      const cartList = positions.map((_) =>
        Cesium.Matrix4.multiplyByPoint(
          helper._modelMatrix,
          _,
          new Cesium.Cartesian3(),
        ),
      );
      const pixelList = cartList.map((_) =>
        LonLat.toPixel(_, helper.viewer.scene),
      );
      const length = this.projectInAxis(
        Cesium.Cartesian2.subtract(...pixelList, new Cesium.Cartesian2()),
        Cesium.Cartesian2.subtract(
          endPosition,
          startPosition,
          new Cesium.Cartesian2(),
        ),
      );
      offset[axis.axis.toLowerCase()] = length * delta;
    }
    return offset;
  }

  computeAngle(helper, startPosition, endPosition) {
    const center = helper.center;
    Cesium.Cartesian3.subtract(startPosition, center, startPosition);
    Cesium.Cartesian3.subtract(endPosition, center, endPosition);
    const angle = Cesium.Cartesian3.dot(
      Cesium.Cartesian3.normalize(startPosition, startPosition),
      Cesium.Cartesian3.normalize(endPosition, endPosition),
    );
    // 旋转起点和终点的向量
    const v1 = Cesium.Cartesian3.subtract(
      startPosition,
      endPosition,
      new Cesium.Cartesian3(),
    );
    const v2 = startPosition;
    const cross = Cesium.Cartesian3.cross(v1, v2, new Cesium.Cartesian3());
    const normal = helper.activePrimitive.normal;
    // 旋转平面的法线向量
    // const v2 = Cartesian2.subtract(center, normal, cartesian2_2);
    const sign = Cesium.Math.sign(Cesium.Cartesian3.dot(cross, normal));
    return Math.acos(angle) * sign;
  }

  projectInAxis(normal, vector) {
    Cesium.Cartesian2.normalize(normal, normal);
    return Cesium.Cartesian2.dot(normal, vector);
  }

  /**
   * 旋转
   * @private
   * @param {*} angle
   */
  rotate(angle) {
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
    for (const primitive of this.primitivesList._primitives) {
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
    this.modelMatrix = this._modelMatrix;
    this.createRotateAux(this.startLocalPosition, this.angle);
  }

  /**
   * 缩放
   * @param scale
   */
  scale(scale) {
    const scaleMatrix = Cesium.Matrix4.fromScale(scale, new Cesium.Matrix4());
    // console.log(scaleMatrix);
    Cesium.Matrix4.multiply(this.modelMatrix, scaleMatrix, this.modelMatrix);
    for (const primitive of this.primitivesList._primitives) {
      Cesium.Matrix4.multiply(
        primitive.modelMatrix,
        scaleMatrix,
        primitive.modelMatrix,
      );
    }
  }

  /**
   * 当前操作的坐标轴或坐标平面
   * @private
   * @param {*} axis
   */
  active(geometry) {
    if (!(geometry || this.activePrimitive)) {
      return;
    }
    if (!geometry && this.activePrimitive) {
      this.setColorForPrimitive(
        this.activePrimitive,
        this.activePrimitive.pcolor || this.activePrimitive.color,
      );
      if (this.activePrimitive.isAxisPlane) {
        for (const a of this.activePrimitive.relativeAxis) {
          this.setColorForPrimitive(a, a.color);
        }
      }
      this.activePrimitive = undefined;
      this.mode = EModel.N;
      return;
    }
    // 如果激活的是坐标平面，平面所在的坐标轴也需要高亮
    if (geometry.isAxisPlane) {
      for (const a of geometry.relativeAxis) {
        this.setColorForPrimitive(a, this.activeAxisColor);
      }
    }
    this.activePrimitive = geometry;
    this.setColorForPrimitive(this.activePrimitive, this.activeAxisColor);
    if (!geometry.axis) {
      return;
    }
    if (geometry.axis.includes('R')) {
      this.mode = EModel.R;
      const mousedownCartesian = this.getPositionInPlane(
        this.mousedownPixel,
        this,
      );
      this.rAxuStart.positions = [this.center, mousedownCartesian];
      this.startLocalPosition = mousedownCartesian;
    } else if (geometry.axis.includes('S')) {
      this.mode = EModel.S;
    } else {
      this.mode = EModel.T;
    }
  }

  /**
   * 创建平移辅助线
   * @private
   * @param {*} offset
   */
  createAux(offset) {
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
   * @param {*} startLocalPosition
   * @param {*} angle
   */
  createRotateAux(startLocalPosition, angle) {
    const startPosition = this.startLocalPosition;
    if (!startPosition) {
      return;
    }
    const q = Cesium.Quaternion.fromAxisAngle(
      this.activePrimitive.normal,
      -angle,
    );
    const matrix3 = Cesium.Matrix3.fromQuaternion(q, new Cesium.Matrix3());
    const rotation = Cesium.Matrix4.fromRotation(matrix3, new Cesium.Matrix4());
    const position = Cesium.Cartesian3.subtract(
      startLocalPosition,
      this.center,
      new Cesium.Cartesian3(),
    );
    Cesium.Matrix4.multiplyByPoint(rotation, position, position);
    Cesium.Cartesian3.add(this.center, position, position);
    this.rAxuEnd.positions = [this.center, position];
  }

  /**
   * 设置坐标轴或坐标平面的颜色
   * @param primitive
   * @param color
   */
  setColorForPrimitive(primitive, color) {
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
   * @param pixel
   * @param helper
   * @returns
   */
  getPositionInPlane(pixel, helper) {
    const mousedownCartesian = new Cesium.Cartesian3();
    const ray = helper.viewer.camera.getPickRay(pixel);
    const plane = new Cesium.Plane(Cesium.Cartesian3.UNIT_X, 0.0);
    Cesium.Plane.fromPointNormal(
      helper.center,
      helper.activePrimitive.normal,
      plane,
    );
    Cesium.Plane.transform(plane, helper._modelMatrix, plane);
    Cesium.IntersectionTests.rayPlane(ray, plane, mousedownCartesian);
    Cesium.Matrix4.multiplyByPoint(
      helper._inverseModelMatrix,
      mousedownCartesian,
      mousedownCartesian,
    );
    return mousedownCartesian;
  }

  /**
   * 解绑当前绑定对象
   */
  unbind() {
    console.log('unbind');
    this.bindObject = undefined;
    this.primitivesList.removeAll();
    this.originPoint = undefined;
    this.xAxis = undefined;
    this.yAxis = undefined;
    this.zAxis = undefined;
    this.xAux = undefined;
    this.yAux = undefined;
    this.zAux = undefined;
    this.modelMatrix = undefined;
    this.hasBindObject = false;
  }

  /**
   * 从场景中删除
   */
  remove() {
    this.viewer.scene.primitives.remove(this.primitivesList);
    this._removeEventListener();
    this._primitives.splice(0);
  }
}

export default EditCesium;