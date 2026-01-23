import * as Cesium from 'cesium';

/**
 * 反选遮罩（mask + hole）实现。
 * 思路：用 4 个象限面（NE/NW/SE/SW）覆盖全球，再把用户传入的 polygon 当作 hole 挂到对应象限上，
 * 这样能避免跨 180°/跨极点时的大面三角化问题，并且在范围较大时视觉更稳定。
 *
 * 输入建议：优先传 `Cesium.Cartesian3`（一个或多个闭合 ring；不强制你手动闭合，内部画 outline 时会自动补回起点）。
 *
 * 用法示例：
 * ```ts
 * const mask = new PolygonMask(viewer);
 * const ring = Cesium.Cartesian3.fromDegreesArray([
 *   116.0, 39.5,
 *   117.0, 39.5,
 *   117.0, 40.5,
 *   116.0, 40.5
 * ]);
 * mask.setMask({
 *   polygons: ring, // 或者 polygons: [ring1, ring2]
 *   maskColor: Cesium.Color.fromCssColorString('rgb(2,26,79)').withAlpha(0.7),
 *   clampToGround: true,
 *   outline: { show: true, color: Cesium.Color.fromCssColorString('#39E09B'), width: 2, clampToGround: true }
 * });
 * ```
 */
export type MaskPolygonInput =
  | Cesium.PolygonHierarchy
  | Cesium.PolygonHierarchy[]
  | Cesium.Cartesian3[]
  | Cesium.Cartesian3[][];

export interface MaskOutlineStyle {
  /** 是否显示轮廓线 */
  show?: boolean;
  /** 轮廓线颜色 */
  color?: Cesium.Color;
  /** 轮廓线宽度（像素） */
  width?: number;
  /** 轮廓线是否贴地 */
  clampToGround?: boolean;
}

export interface MaskOptions {
  /** 一个或多个 polygon ring（推荐 Cartesian3）；多个 ring 会生成多个 hole */
  polygons: MaskPolygonInput;
  /** 遮罩颜色（hole 以外区域的颜色） */
  maskColor?: Cesium.Color;
  /** 遮罩面是否贴地（使用 classificationType） */
  clampToGround?: boolean;
  /** 轮廓线样式 */
  outline?: MaskOutlineStyle;
}

export class PolygonMask {
  private viewer: Cesium.Viewer;
  private maskEntities: Cesium.Entity[] = [];
  private edgeEntities: Cesium.Entity[] = [];
  private polygonHierarchies: Cesium.PolygonHierarchy[] = [];
  private maskColor: Cesium.Color;
  private outlineStyle: Required<MaskOutlineStyle>;
  private clampToGround: boolean;

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

  /** 将外部输入统一转为 `PolygonHierarchy[]`（每个 hierarchy 对应一个 hole） */
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

  /** 计算一个 hole 的中心点，用于把 hole 分配到哪个象限面上 */
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

  /** 生成某个象限的外环（用经纬度构造，避开 0/±180/±90 的边界） */
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
   * 设置/更新遮罩。
   * - `polygons`：一个或多个 ring（每个 ring >= 3 个点）
   * - `outline`：可选；`show=false` 时不创建轮廓线
   */
  setMask(options: MaskOptions): void {
    this.clearMask();

    this.polygonHierarchies = this.createPolygonHierarchies(options.polygons);
    
    if (options.maskColor) {
      this.maskColor = options.maskColor;
    }

    if (options.clampToGround !== undefined) {
      this.clampToGround = options.clampToGround;
    }

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

    const makePolygonEntity = (isEast: boolean, isNorth: boolean, holes: Cesium.PolygonHierarchy[]) => {
      const hierarchy = new Cesium.PolygonHierarchy(
        this.createQuadrantPositions(isEast, isNorth),
        holes.length ? holes : undefined
      );

      const polygon: any = {
        hierarchy,
        material: this.maskColor,
        perPositionHeight: false,
        heightReference: this.clampToGround ? Cesium.HeightReference.CLAMP_TO_GROUND : undefined,
        classificationType: this.clampToGround ? Cesium.ClassificationType.TERRAIN : undefined
      };

      const entity = this.viewer.entities.add({ polygon });
      this.maskEntities.push(entity);
    };

    makePolygonEntity(true, true, holesNE);
    makePolygonEntity(false, true, holesNW);
    makePolygonEntity(true, false, holesSE);
    makePolygonEntity(false, false, holesSW);

    if (this.outlineStyle.show) {
      this.createOutline();
    }
  }

  /** 为每个 hole 生成一条 polyline 作为轮廓线 */
  private createOutline(): void {
    if (!this.polygonHierarchies.length) return;

    for (const h of this.polygonHierarchies) {
      const positions = [...h.positions, h.positions[0]];
      if (positions.length < 4) continue;

      const e = this.viewer.entities.add({
        polyline: {
          positions,
          width: this.outlineStyle.width,
          material: new Cesium.ColorMaterialProperty(this.outlineStyle.color),
          clampToGround: this.outlineStyle.clampToGround
        }
      });
      this.edgeEntities.push(e);
    }
  }

  /** 更新轮廓线样式（会重建轮廓线） */
  updateOutlineStyle(style: MaskOutlineStyle): void {
    this.outlineStyle = {
      show: style.show ?? this.outlineStyle.show,
      color: style.color ?? this.outlineStyle.color,
      width: style.width ?? this.outlineStyle.width,
      clampToGround: style.clampToGround ?? this.outlineStyle.clampToGround
    };

    this.edgeEntities.forEach(e => this.viewer.entities.remove(e));
    this.edgeEntities = [];

    if (this.outlineStyle.show) {
      this.createOutline();
    }
  }

  /** 更新遮罩颜色（不重建几何） */
  updateMaskColor(color: Cesium.Color): void {
    this.maskColor = color;
    this.maskEntities.forEach(entity => {
      if (entity.polygon) {
        entity.polygon.material = color as any;
      }
    });
  }

  getOptions(): { maskColor: Cesium.Color; clampToGround: boolean; outline: Required<MaskOutlineStyle> } {
    return {
      maskColor: this.maskColor,
      clampToGround: this.clampToGround,
      outline: this.outlineStyle
    };
  }

  /** 清理当前遮罩（可重复调用 setMask 重新生成） */
  clearMask(): void {
    this.maskEntities.forEach(entity => {
      this.viewer.entities.remove(entity);
    });
    this.maskEntities = [];

    this.edgeEntities.forEach(e => this.viewer.entities.remove(e));
    this.edgeEntities = [];

    this.polygonHierarchies = [];
  }

  /** 销毁（等价于 clearMask） */
  destroy(): void {
    this.clearMask();
  }
}
