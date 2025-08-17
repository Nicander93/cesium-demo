// @ts-nocheck
import AxisPlaneGeometry from "./AxisPlaneGeometry";
import { VertexFormat, Primitive, MaterialAppearance, Material } from "cesium";
import * as Cesium from "cesium";

class AxisPlane {
  _center: any;
  _modelMatrix: any;
  _color: any;
  _normal: any;

  constructor(options: any) {
    this._center = options.center;
    this._modelMatrix = options.modelMatrix;
    this._color = options.color;
    const radius = options.radius;
    this._normal = options.normal;
    const planeGeometry = new AxisPlaneGeometry({
      normal: this._normal,
      radius: radius,
      vertexFormat: VertexFormat.DEFAULT,
      center: this._center,
    });
    const instance = new Cesium.GeometryInstance({
      geometry: AxisPlaneGeometry.createGeometry(planeGeometry),
    });
    const primitive = new Primitive({
      asynchronous: false,
      geometryInstances: instance,
      modelMatrix: this._modelMatrix,
      appearance: new MaterialAppearance({
        material: Material.fromType("Color", {
          color: this._color,
        }),
      }),
    });

    primitive.isAxisPlane = true;
    primitive.normal = this._normal;
    primitive.axis = options.axis;
    primitive.color = this._color;
    return primitive;
  }
}
export default AxisPlane;
