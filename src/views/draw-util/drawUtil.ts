import type { Viewer } from "cesium";
import * as Cesium from "cesium";
import { useTooltip } from "./tooltip";

type DrawMode = "default" | "point" | "polyline" | "polygon";
/**
 * 实现绘制Util
 * 绘制模式：点、线、面
 */
export class DrawUtil {
  private _mode: DrawMode = "default";
  // TODO: 这里要解决变量初始化问题
  // 存储绘制的所有entity
  private _drawEntitys: Cesium.Entity[] | null = null;
  // 用于指代当前绘制的entity
  private _currentEntity: Cesium.Entity | null = null;
  private _currentPositions: Cesium.Cartesian3[] = [];
  private _previewEntity: Cesium.Entity | null = null;
  private ToolTip = useTooltip();

  private _viewer: Viewer;

  constructor(viewer: Viewer) {
    this._viewer = viewer;
    this.initilizePrimitive();
    this.initilizeEvent();
  }

  public changeDrawMode(mode: DrawMode = "point") {
    this._mode = mode;
  }

  private initilizePrimitive() {
    this._drawEntitys = [];
  }

  private initilizeEvent() {
    // TODO: 后续解决绘制事件与其他绑定事件的关系
    this._viewer.screenSpaceEventHandler.setInputAction(
      this.handleDrawEvent.bind(this),
      Cesium.ScreenSpaceEventType.LEFT_CLICK
    );
    this._viewer.screenSpaceEventHandler.setInputAction(
      this.handleMouseMoveEvent.bind(this),
      Cesium.ScreenSpaceEventType.MOUSE_MOVE
    );
    this._viewer.screenSpaceEventHandler.setInputAction(
      this.completeDraw.bind(this),
      Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK
    );
  }

  public drawPoint(position: Cesium.Cartesian3) {
    if (position) {
      const entity = this._viewer.entities.add(this.createPoint(position));
      this._drawEntitys?.push(entity);
    }
  }

  public drawPolyline(position: Cesium.Cartesian3) {
    // 这里添加两次是因为第二次添加的点作为预览点（鼠标当前位置）
    this._currentPositions.push(position);
    this._currentPositions.push(position);

    if (!this._currentEntity) {
      this._currentEntity = this._viewer.entities.add(
        this.createPolyline(
          new Cesium.CallbackProperty(() => {
            return this._currentPositions;
          }, false)
        )
      );
    }
  }

  public drawPolygon(position: Cesium.Cartesian3) {
    // 这里添加两次是因为第二次添加的点作为预览点（鼠标当前位置）
    this._currentPositions.push(position);
    this._currentPositions.push(position);

    if (!this._currentEntity) {
      this._currentEntity = this._viewer.entities.add(
        this.createPolygon(
          new Cesium.CallbackProperty(() => {
            return new Cesium.PolygonHierarchy(this._currentPositions);
          }, false)
        )
      );
    }
  }

  public completeDraw() {
    switch (this._mode) {
      case "point":
        //
        break;
      case "polyline":
        if (this._currentEntity) {
          const positions = [...this._currentPositions];
          const newEntity = this._viewer.entities.add(
            this.createPolyline(positions)
          );
          this._drawEntitys?.push(newEntity);
          this._viewer.entities.remove(this._currentEntity);
        }

        break;
      case "polygon":
        if (this._currentEntity) {
          const positions = [...this._currentPositions];
          const newEntity = this._viewer.entities.add(
            this.createPolygon(positions)
          );
          this._drawEntitys?.push(newEntity);
          this._viewer.entities.remove(this._currentEntity);
        }
        break;
      default:
        break;
    }
    this._previewEntity && this._viewer.entities.remove(this._previewEntity);
    this._currentEntity = null;
    this._previewEntity = null;
    this._currentPositions = [];
    this.changeDrawMode("default");
    this.ToolTip.destroyTooltip();
  }
  /**
   * 多帧稳定拾取
   * @param windowPosition 屏幕坐标
   * @param maxFrames 最大帧数
   * @returns Promise<Cesium.Cartesian3 | undefined>
   */
  private pickPositionStabilized(
    windowPosition: Cesium.Cartesian2,
    maxFrames: number = 6
  ): Promise<Cesium.Cartesian3 | undefined> {
    return new Promise((resolve) => {
      let frameCount = 0;
      const scene = this._viewer.scene;

      const cb = () => {
        frameCount++;
        const position = this.pickPositon(windowPosition);
        if (position || frameCount >= maxFrames) {
          scene.postRender.removeEventListener(cb);
          resolve(position);
        }
      };

      scene.postRender.addEventListener(cb);
    });
  }

  public handleDrawEvent(
    event: Cesium.ScreenSpaceEventHandler.PositionedEvent
  ) {
    const clickPos = event.position.clone();
    this._viewer.scene.requestRender();
    this.pickPositionStabilized(clickPos, 6).then((position) => {
      if (position) {
        const cartographic = Cesium.Cartographic.fromCartesian(position);
        const lon = Cesium.Math.toDegrees(cartographic.longitude);
        const lat = Cesium.Math.toDegrees(cartographic.latitude);
        const height = cartographic.height;

        // 检查是否拾取到了3D对象
        const pickedObject = this._viewer.scene.pick(event.position);
        const isOn3DTile =
          pickedObject &&
          pickedObject.primitive instanceof Cesium.Cesium3DTileset;

        console.log(
          `经度: ${lon.toFixed(6)}, 纬度: ${lat.toFixed(6)}, 高度: ${height.toFixed(
            2
          )}, 3D瓦片: ${isOn3DTile}`
        );
      }
      if (Cesium.defined(position)) {
        switch (this._mode) {
          case "point":
            this.drawPoint(position);
            break;
          case "polyline":
            this.drawPolyline(position);
            break;
          case "polygon":
            this.drawPolygon(position);
            break;
          default:
            break;
        }
      }
    });
  }

  public handleMouseMoveEvent(
    event: Cesium.ScreenSpaceEventHandler.MotionEvent
  ) {
    const position = this.pickPositon(event.endPosition);
    if (!position) return;
    if (position) {
      const cartographic = Cesium.Cartographic.fromCartesian(position);
      const lon = Cesium.Math.toDegrees(cartographic.longitude);
      const lat = Cesium.Math.toDegrees(cartographic.latitude);
      const height = cartographic.height;

      // 检查是否拾取到了3D对象
      const pickedObject = this._viewer.scene.pick(event.endPosition);
      const isOn3DTile = pickedObject && pickedObject.primitive instanceof Cesium.Cesium3DTileset;

      console.log(`经度: ${lon.toFixed(6)}, 纬度: ${lat.toFixed(6)}, 高度: ${height.toFixed(2)}, 3D瓦片: ${isOn3DTile}`);
    }
    switch (this._mode) {
      case "point":
        // 更新预览点位置
        this.updatePreviewPoint(position);
        break;
      case "polyline":
        const { x, y } = Cesium.SceneTransforms.wgs84ToWindowCoordinates(
          this._viewer.scene,
          position!
        );
        this.ToolTip.updateTooltipPosition(x, y);
        this.updatePreviewPolyline(position);
        break;
      case "polygon":
        const { x: x1, y: y1 } =
          Cesium.SceneTransforms.wgs84ToWindowCoordinates(
            this._viewer.scene,
            position!
          );
        this.ToolTip.updateTooltipPosition(x1, y1);
        this.updatePreviewPolygon(position);
        break;
      default:
        break;
    }
  }

  private createPoint(position: Cesium.Cartesian3) {
    return new Cesium.Entity({
      position,
      point: {
        pixelSize: 5,
        color: Cesium.Color.RED,
        disableDepthTestDistance: 50000,
        outlineColor: Cesium.Color.YELLOW,
        outlineWidth: 2,
      },
    });
  }

  private createPolyline(
    positions: Cesium.Cartesian3[] | Cesium.CallbackProperty
  ) {
    return new Cesium.Entity({
      polyline: {
        positions: positions,
        width: 5,
        clampToGround: true,
        classificationType: Cesium.ClassificationType.BOTH, // 同时支持地形和3DTiles
        zIndex: 1000, // 确保polyline在最上层显示
        material: new Cesium.PolylineOutlineMaterialProperty({
          color: Cesium.Color.ORANGE,
          outlineWidth: 2,
          outlineColor: Cesium.Color.BLACK,
        }),
      },
    });
  }

  private createPolygon(
    hierarchy:
      | Cesium.PolygonHierarchy
      | Cesium.CallbackProperty
      | Cesium.Cartesian3[]
  ) {
    return new Cesium.Entity({
      polygon: {
        hierarchy: hierarchy,
        material: Cesium.Color.RED,
        classificationType: Cesium.ClassificationType.BOTH,
        perPositionHeight: true,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });
  }
  /**
   * 更新预览点位置
   */
  private updatePreviewPoint(position: Cesium.Cartesian3) {
    if (!this._previewEntity) {
      // 创建预览点
      this._previewEntity = this._viewer.entities.add({
        position,
        point: {
          pixelSize: 8,
          color: Cesium.Color.CYAN,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
        },
      });
    } else {
      // 更新预览点位置
      if (this._previewEntity.position) {
        (this._previewEntity.position as any).setValue(position);
      }
    }
  }

  private updatePreviewPolyline(position: Cesium.Cartesian3) {
    if (!this._previewEntity) {
      // 创建预览点
      this._previewEntity = this._viewer.entities.add({
        position,
        point: {
          pixelSize: 8,
          color: Cesium.Color.CYAN,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
        },
      });
    } else {
      // 更新预览点位置
      if (this._previewEntity.position) {
        (this._previewEntity.position as any).setValue(position);
      }
    }
    if (this._currentEntity) {
      this._currentPositions[this._currentPositions.length - 1] = position;
    }
  }

  private updatePreviewPolygon(position: Cesium.Cartesian3) {
    if (!this._previewEntity) {
      // 创建预览点
      this._previewEntity = this._viewer.entities.add({
        position,
        point: {
          pixelSize: 8,
          color: Cesium.Color.CYAN,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 2,
        },
      });
    } else {
      // 更新预览点位置
      if (this._previewEntity.position) {
        (this._previewEntity.position as any).setValue(position);
      }
    }
    if (this._currentEntity) {
      this._currentPositions[this._currentPositions.length - 1] = position;
    }
  }

  public clear() {
    this._viewer.entities.removeAll();
    this._currentEntity = null;
    this._previewEntity = null;
    this._currentPositions = [];
    this.ToolTip.destroyTooltip();
    this.changeDrawMode("default");
    this.initilizePrimitive();
  }

  /**
   * 根据屏幕坐标，获取场景中点击的位置
   * @param windowPosition 屏幕坐标
   * @returns
   */
  private pickPositon(windowPosition: Cesium.Cartesian2) {
    // 1. 先检查是否拾取到对象
    const pickedObject = this._viewer.scene.pick(windowPosition);

    // 2. 如果拾取到3D瓦片，使用pickPosition
    if (Cesium.defined(pickedObject) && pickedObject.primitive instanceof Cesium.Cesium3DTileset) {
      if (this._viewer.scene.pickPositionSupported) {
        const position = this._viewer.scene.pickPosition(windowPosition);
        if (Cesium.defined(position)) {
          return position;
        }
      }
    }

    // 3. 如果没有拾取到3D瓦片或pickPosition失败，使用globe.pick
    const ray = this._viewer.camera.getPickRay(windowPosition);
    if (ray) {
      return this._viewer.scene.globe.pick(ray, this._viewer.scene);
    }

    return undefined;
  }
}
