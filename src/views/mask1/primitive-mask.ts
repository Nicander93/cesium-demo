/**
 * 多边形遮罩工具类
 * 
 * 用法示例：
 * ```typescript
 * const mask = new PolygonMaskPrimitive(viewer);
 * 
 * // 基本用法：使用坐标数组创建遮罩
 * mask.setMask({
 *   polygons: Cesium.Cartesian3.fromDegreesArray([
 *     120, 30,
 *     121, 30,
 *     121, 31,
 *     120, 31
 *   ]),
 *   maskColor: Cesium.Color.BLACK.withAlpha(0.7),
 *   clampToGround: true,
 *   outline: {
 *     show: true,
 *     color: Cesium.Color.YELLOW,
 *     width: 2.0
 *   }
 * });
 * 
 * // 更新遮罩颜色
 * mask.updateMaskColor(Cesium.Color.BLUE.withAlpha(0.5));
 * 
 * // 更新轮廓样式
 * mask.updateOutlineStyle({ width: 3.0, color: Cesium.Color.RED });
 * 
 * // 清除遮罩
 * mask.clearMask();
 * 
 * // 销毁实例
 * mask.destroy();
 * ```
 */

import * as Cesium from 'cesium';
import type { MaskOptions, MaskOutlineStyle, MaskPolygonInput } from './mask-types';

type MaskPrimitive = Cesium.Primitive | Cesium.GroundPrimitive;
type OutlinePrimitive = Cesium.Primitive | Cesium.GroundPolylinePrimitive;

/**
 * 多边形遮罩类
 * 通过创建四个象限的全屏遮罩，并在其中挖空指定多边形区域来实现遮罩效果
 */
export class PolygonMaskPrimitive {
  private viewer: Cesium.Viewer;
  /** 遮罩图元数组（四个象限） */
  private maskPrimitives: MaskPrimitive[] = [];
  /** 轮廓图元数组 */
  private outlinePrimitives: OutlinePrimitive[] = [];
  /** 多边形层级数组 */
  private polygonHierarchies: Cesium.PolygonHierarchy[] = [];

  /** 遮罩颜色 */
  private maskColor: Cesium.Color;
  /** 轮廓样式 */
  private outlineStyle: Required<MaskOutlineStyle>;
  /** 是否贴地 */
  private clampToGround: boolean;

  /**
   * 构造函数
   * @param viewer Cesium 视图器实例
   */
  constructor(viewer: Cesium.Viewer) {
    this.viewer = viewer;
    this.maskColor = Cesium.Color.BLACK.withAlpha(0.6);
    this.outlineStyle = {
      show: true,
      color: Cesium.Color.YELLOW,
      width: 2.0,
      clampToGround: false
    };
    this.clampToGround = false;
  }

  /**
   * 将输入转换为多边形层级数组
   * 支持多种输入格式：PolygonHierarchy、坐标数组等
   */
  private createPolygonHierarchies(input: MaskPolygonInput): Cesium.PolygonHierarchy[] {
    if (input instanceof Cesium.PolygonHierarchy) return [input];
    if (Array.isArray(input) && input.length && input[0] instanceof Cesium.PolygonHierarchy) return input as Cesium.PolygonHierarchy[];

    if (Array.isArray(input) && input.length && input[0] instanceof Cesium.Cartesian3) {
      const ring = input as Cesium.Cartesian3[];
      return ring.length >= 3 ? [new Cesium.PolygonHierarchy(ring)] : [];
    }

    if (Array.isArray(input) && input.length && Array.isArray(input[0]) && (input[0] as any)[0] instanceof Cesium.Cartesian3) {
      const rings = input as Cesium.Cartesian3[][];
      return rings.filter(r => r.length >= 3).map(r => new Cesium.PolygonHierarchy(r));
    }

    return [];
  }

  /**
   * 计算多边形中心点的经纬度
   */
  private getHierarchyCenter(h: Cesium.PolygonHierarchy): { lon: number; lat: number } {
    const positions = h.positions;
    let totalLng = 0;
    let totalLat = 0;
    for (const pos of positions) {
      const cartographic = Cesium.Cartographic.fromCartesian(pos);
      totalLng += Cesium.Math.toDegrees(cartographic.longitude);
      totalLat += Cesium.Math.toDegrees(cartographic.latitude);
    }
    return {
      lon: totalLng / positions.length,
      lat: totalLat / positions.length
    };
  }

  /**
   * 创建象限边界坐标
   * 用于生成覆盖整个象限的全屏遮罩多边形
   */
  private createQuadrantPositions(isEast: boolean, isNorth: boolean): Cesium.Cartesian3[] {
    const lonMin = isEast ? 0.1 : -179.9;
    const lonMax = isEast ? 179.9 : -0.1;
    const latMin = isNorth ? 0.1 : -89.9;
    const latMax = isNorth ? 89.9 : -0.1;

    const lonStep = 10;
    const latStep = 10;
    const points: number[] = [];

    for (let lon = lonMin; lon <= lonMax; lon += lonStep) points.push(lon, latMin);
    for (let lat = latMin; lat <= latMax; lat += latStep) points.push(lonMax, lat);
    for (let lon = lonMax; lon >= lonMin; lon -= lonStep) points.push(lon, latMax);
    for (let lat = latMax; lat >= latMin; lat -= latStep) points.push(lonMin, lat);
    points.push(lonMin, latMin);

    return Cesium.Cartesian3.fromDegreesArray(points);
  }

  /**
   * 设置遮罩
   * @param options 遮罩配置选项
   * - polygons: 多边形输入，支持多种格式
   * - maskColor: 遮罩颜色（默认黑色半透明）
   * - clampToGround: 是否贴地（默认false）
   * - outline: 轮廓样式配置
   */
  setMask(options: MaskOptions): void {
    this.clearMask();

    this.polygonHierarchies = this.createPolygonHierarchies(options.polygons);

    if (options.maskColor) this.maskColor = options.maskColor;
    if (options.clampToGround !== undefined) this.clampToGround = options.clampToGround;
    if (options.outline) {
      this.outlineStyle = {
        show: options.outline.show ?? this.outlineStyle.show,
        color: options.outline.color ?? this.outlineStyle.color,
        width: options.outline.width ?? this.outlineStyle.width,
        clampToGround: options.outline.clampToGround ?? this.outlineStyle.clampToGround
      };
    }

    if (!this.polygonHierarchies.length) {
      console.warn('多边形至少需要3个顶点');
      return;
    }

    const holesNE: Cesium.PolygonHierarchy[] = [];
    const holesNW: Cesium.PolygonHierarchy[] = [];
    const holesSE: Cesium.PolygonHierarchy[] = [];
    const holesSW: Cesium.PolygonHierarchy[] = [];

    for (const h of this.polygonHierarchies) {
      const c = this.getHierarchyCenter(h);
      const isEast = c.lon >= 0;
      const isNorth = c.lat >= 0;
      if (isEast && isNorth) holesNE.push(h);
      else if (!isEast && isNorth) holesNW.push(h);
      else if (isEast && !isNorth) holesSE.push(h);
      else holesSW.push(h);
    }

    const makeMaskPrimitive = (id: string, isEast: boolean, isNorth: boolean, holes: Cesium.PolygonHierarchy[]) => {
      const hierarchy = new Cesium.PolygonHierarchy(
        this.createQuadrantPositions(isEast, isNorth),
        holes.length ? holes : undefined
      );

      const geometry = new Cesium.PolygonGeometry({
        polygonHierarchy: hierarchy,
        vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT
      });

      const instance = new Cesium.GeometryInstance({
        id,
        geometry,
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(this.maskColor)
        }
      });

      const appearance = new Cesium.PerInstanceColorAppearance({
        flat: true,
        translucent: true,
        closed: false
      });

      const primitive: MaskPrimitive = this.clampToGround
        ? new Cesium.GroundPrimitive({
            geometryInstances: instance,
            appearance,
            allowPicking: false,
            releaseGeometryInstances: false,
            classificationType: Cesium.ClassificationType.TERRAIN
          })
        : new Cesium.Primitive({
            geometryInstances: instance,
            appearance,
            allowPicking: false,
            releaseGeometryInstances: false
          });

      this.viewer.scene.primitives.add(primitive);
      this.maskPrimitives.push(primitive);
    };

    makeMaskPrimitive('mask_NE', true, true, holesNE);
    makeMaskPrimitive('mask_NW', false, true, holesNW);
    makeMaskPrimitive('mask_SE', true, false, holesSE);
    makeMaskPrimitive('mask_SW', false, false, holesSW);

    if (this.outlineStyle.show) {
      this.createOutline();
    }
  }

  /**
   * 创建多边形轮廓线
   */
  private createOutline(): void {
    if (!this.polygonHierarchies.length) return;

    const instances: Cesium.GeometryInstance[] = [];

    for (let i = 0; i < this.polygonHierarchies.length; i++) {
      const h = this.polygonHierarchies[i];
      const positions = [...h.positions, h.positions[0]];
      if (positions.length < 4) continue;

      if (this.outlineStyle.clampToGround) {
        const geometry = new Cesium.GroundPolylineGeometry({
          positions,
          width: this.outlineStyle.width,
          loop: false
        });
        instances.push(
          new Cesium.GeometryInstance({
            id: `mask_outline_${i}`,
            geometry,
            attributes: {
              color: Cesium.ColorGeometryInstanceAttribute.fromColor(this.outlineStyle.color)
            }
          })
        );
      } else {
        const geometry = new Cesium.PolylineGeometry({
          positions,
          width: this.outlineStyle.width,
          vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT
        });
        instances.push(
          new Cesium.GeometryInstance({
            id: `mask_outline_${i}`,
            geometry,
            attributes: {
              color: Cesium.ColorGeometryInstanceAttribute.fromColor(this.outlineStyle.color)
            }
          })
        );
      }
    }

    if (!instances.length) return;

    const primitive: OutlinePrimitive = this.outlineStyle.clampToGround
      ? new Cesium.GroundPolylinePrimitive({
          geometryInstances: instances,
          appearance: new Cesium.PolylineColorAppearance(),
          allowPicking: false,
          releaseGeometryInstances: false
        })
      : new Cesium.Primitive({
          geometryInstances: instances,
          appearance: new Cesium.PolylineColorAppearance(),
          allowPicking: false,
          releaseGeometryInstances: false
        });

    this.viewer.scene.primitives.add(primitive);
    this.outlinePrimitives.push(primitive);
  }

  /**
   * 更新轮廓样式
   * @param style 轮廓样式配置
   */
  updateOutlineStyle(style: MaskOutlineStyle): void {
    this.outlineStyle = {
      show: style.show ?? this.outlineStyle.show,
      color: style.color ?? this.outlineStyle.color,
      width: style.width ?? this.outlineStyle.width,
      clampToGround: style.clampToGround ?? this.outlineStyle.clampToGround
    };

    this.outlinePrimitives.forEach(p => this.viewer.scene.primitives.remove(p));
    this.outlinePrimitives = [];

    if (this.outlineStyle.show) {
      this.createOutline();
    }
  }

  /**
   * 更新遮罩颜色
   * @param color 新的遮罩颜色
   */
  updateMaskColor(color: Cesium.Color): void {
    this.maskColor = color;
    const ids = ['mask_NE', 'mask_NW', 'mask_SE', 'mask_SW'];

    for (const p of this.maskPrimitives) {
      const anyP = p as any;
      if (!anyP.getGeometryInstanceAttributes) continue;

      for (const id of ids) {
        const attrs = anyP.getGeometryInstanceAttributes(id);
        if (attrs && attrs.color) {
          attrs.color = Cesium.ColorGeometryInstanceAttribute.toValue(color);
        }
      }
    }
  }

  /**
   * 获取当前遮罩配置
   * @returns 当前遮罩的配置选项
   */
  getOptions(): { maskColor: Cesium.Color; clampToGround: boolean; outline: Required<MaskOutlineStyle> } {
    return {
      maskColor: this.maskColor,
      clampToGround: this.clampToGround,
      outline: this.outlineStyle
    };
  }

  /**
   * 清除遮罩
   * 移除所有遮罩和轮廓图元
   */
  clearMask(): void {
    this.maskPrimitives.forEach(p => this.viewer.scene.primitives.remove(p));
    this.maskPrimitives = [];

    this.outlinePrimitives.forEach(p => this.viewer.scene.primitives.remove(p));
    this.outlinePrimitives = [];

    this.polygonHierarchies = [];
  }

  /**
   * 销毁实例
   * 清除所有遮罩并释放资源
   */
  destroy(): void {
    this.clearMask();
  }
}
