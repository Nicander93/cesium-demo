import * as Cesium from 'cesium';

export type MaskPolygonInput =
  | Cesium.PolygonHierarchy
  | Cesium.PolygonHierarchy[]
  | Cesium.Cartesian3[]
  | Cesium.Cartesian3[][];

export interface MaskOutlineStyle {
  show?: boolean;
  color?: Cesium.Color;
  width?: number;
  clampToGround?: boolean;
}

export interface MaskOptions {
  polygons: MaskPolygonInput;
  maskColor?: Cesium.Color;
  clampToGround?: boolean;
  outline?: MaskOutlineStyle;
}
