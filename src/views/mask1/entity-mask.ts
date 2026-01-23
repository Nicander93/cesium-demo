import * as Cesium from 'cesium';
import type { MaskOptions, MaskOutlineStyle, MaskPolygonInput } from './mask-types';

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

      const entity = this.viewer.entities.add({ 
        polygon,
        allowPicking: false,
       });
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
        },
        allowPicking: false,
      });
      this.edgeEntities.push(e);
    }
  }

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

  clearMask(): void {
    this.maskEntities.forEach(entity => {
      this.viewer.entities.remove(entity);
    });
    this.maskEntities = [];

    this.edgeEntities.forEach(e => this.viewer.entities.remove(e));
    this.edgeEntities = [];

    this.polygonHierarchies = [];
  }

  destroy(): void {
    this.clearMask();
  }
}
