import * as Cesium from "cesium";
import {
  defaultValue,
  VertexFormat,
  Cartesian3,
  Check,
  PlaneGeometry,
  Geometry,
  GeometryAttributes,
  GeometryAttribute,
  PrimitiveType,
  BoundingSphere,
  ComponentDatatype,
} from "cesium";

// 轴平面几何体的选项接口
interface AxisPlaneGeometryOptions {
  normal: Cartesian3;
  radius: number;
  center: Cartesian3;
  vertexFormat?: VertexFormat;
}

// 打包数据的接口
interface PackedAxisPlaneGeometry {
  _vertexFormat: VertexFormat;
  _normal: Cartesian3;
  _radius: number;
}

const scratchVertexFormat$1 = new VertexFormat();
const scratchNormal = new Cartesian3();

/**
 * 轴平面几何体类
 * 用于创建沿坐标轴方向的平面几何体
 */
class AxisPlaneGeometry {
  private _normal: Cartesian3;
  private _radius: number;
  private _center: Cartesian3;
  private _vertexFormat: VertexFormat;

  constructor(options: AxisPlaneGeometryOptions) {
    this._normal = options.normal;
    this._radius = options.radius;
    this._center = options.center;
    const vertexFormat = defaultValue(
      options.vertexFormat,
      VertexFormat.DEFAULT,
    );
    this._vertexFormat = vertexFormat;
  }

  /** 打包后的数据长度 */
  static packedLength = VertexFormat.packedLength + Cartesian3.packedLength + 1;

  /**
   * 将几何体数据打包到数组中
   * @param value 要打包的几何体对象
   * @param array 目标数组
   * @param startingIndex 开始索引
   * @returns 打包后的数组
   */
  static pack(
    value: PackedAxisPlaneGeometry,
    array: number[],
    startingIndex?: number,
  ): number[] {
    Check.typeOf.object("value", value);
    Check.defined("array", array);

    const startIndex = defaultValue(startingIndex, 0);

    if (!value?._vertexFormat || !value?._normal || !value?._radius) {
      throw new Error("Required properties missing from value object");
    }

    VertexFormat.pack(value._vertexFormat, array, startIndex);
    let currentIndex = startIndex + VertexFormat.packedLength;
    Cartesian3.pack(value._normal, array, currentIndex);
    currentIndex += Cartesian3.packedLength;
    array[currentIndex++] = value._radius;
    return array;
  }

  /**
   * 从数组中解包几何体数据
   * @param array 源数组
   * @param startingIndex 开始索引
   * @param result 结果对象
   * @returns 解包后的几何体
   */
  static unpack(
    array: number[],
    startingIndex?: number,
    result?: any,
  ): PlaneGeometry {
    Check.defined("array", array);

    const startIndex = defaultValue(startingIndex, 0);

    const vertexFormat = VertexFormat.unpack(
      array,
      startIndex,
      scratchVertexFormat$1,
    );
    let currentIndex = startIndex + VertexFormat.packedLength;
    const normal = Cartesian3.unpack(array, currentIndex, scratchNormal);
    currentIndex += Cartesian3.packedLength;
    const radius = array[currentIndex];

    if (!Cesium.defined(result)) {
      return new PlaneGeometry({
        vertexFormat,
        normal,
        radius,
      });
    }

    // 如果result存在，尝试设置其属性
    if (result._vertexFormat !== undefined) {
      result._vertexFormat = VertexFormat.clone(
        vertexFormat,
        result._vertexFormat,
      );
    }
    if (result._normal !== undefined) {
      result._normal = Cartesian3.clone(normal, result._normal);
    }
    if (result._radius !== undefined) {
      result._radius = radius;
    }

    return result;
  }

  /**
   * 创建几何体
   * @param planeGeometry 平面几何体对象
   * @returns 创建的几何体
   */
  static createGeometry(planeGeometry: AxisPlaneGeometry): Geometry {
    const v1 = Math.max(1, planeGeometry._radius * 0.02);
    const v2 = Math.max(planeGeometry._radius * 0.2, v1 * 2);
    let positions: number[] = [];
    let normal: number[] = [];
    const { x, y, z } = planeGeometry._center;
    let center: Cartesian3 = new Cartesian3(x, y, z); // 默认值

    // 根据法向量方向创建不同方向的平面
    if (Cartesian3.equals(planeGeometry._normal, Cartesian3.UNIT_X)) {
      positions = [
        x,
        -v1 + y,
        v1 + z,
        x,
        -v2 + y,
        v1 + z,
        x,
        -v2 + y,
        v2 + z,
        x,
        -v1 + y,
        v2 + z,
      ];
      center = new Cartesian3(x, -(v1 + v2) / 2 + y, (v1 + v2) / 2 + z);
      normal = [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0];
    } else if (Cartesian3.equals(planeGeometry._normal, Cartesian3.UNIT_Y)) {
      positions = [
        v1 + x,
        y,
        v1 + z,
        v2 + x,
        y,
        v1 + z,
        v2 + x,
        y,
        v2 + z,
        v1 + x,
        y,
        v2 + z,
      ];
      center = new Cartesian3((v1 + v2) / 2 + x, y, (v1 + v2) / 2 + z);
      normal = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
    } else if (Cartesian3.equals(planeGeometry._normal, Cartesian3.UNIT_Z)) {
      positions = [
        v1 + x,
        -v1 + y,
        z,
        v2 + x,
        -v1 + y,
        z,
        v2 + x,
        -v2 + y,
        z,
        v1 + x,
        -v2 + y,
        z,
      ];
      center = new Cartesian3((v1 + v2) / 2 + x, -(v1 + v2) / 2 + y, z);
      normal = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
    }

    const positionsArray = new Float32Array(positions);
    const sts = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    const indices = new Uint16Array([0, 1, 2, 2, 3, 0]);

    const attributes = new GeometryAttributes();
    attributes.position = new GeometryAttribute({
      componentDatatype: ComponentDatatype.DOUBLE,
      componentsPerAttribute: 3,
      values: positionsArray,
    });
    attributes.normal = new GeometryAttribute({
      componentDatatype: ComponentDatatype.FLOAT,
      componentsPerAttribute: 3,
      values: normal,
    });
    attributes.st = new GeometryAttribute({
      componentDatatype: ComponentDatatype.FLOAT,
      componentsPerAttribute: 2,
      values: sts,
    });

    return new Geometry({
      attributes: attributes,
      indices: indices,
      primitiveType: PrimitiveType.TRIANGLES,
      boundingSphere: new BoundingSphere(center, (v1 + v2) / 2),
    });
  }
}

export default AxisPlaneGeometry;
