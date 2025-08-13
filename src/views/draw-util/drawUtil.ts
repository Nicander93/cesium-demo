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
  private _drawEntitys: Cesium.Entity[] | null = null;
  // 用于指代当前绘制的entity
  private _currentEntity: Cesium.Entity | null = null;
  private _previewEntity: Cesium.Entity | null = null;
  private _polylinePositions: Cesium.Cartesian3[] = [];
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
      const entity = this._viewer.entities.add({
        position,
        point: {
          pixelSize: 5,
          color: Cesium.Color.RED,
          disableDepthTestDistance: 50000,
          outlineColor: Cesium.Color.YELLOW,
          outlineWidth: 2,
        },
      });
      this._drawEntitys?.push(entity);
    }
  }

  public drawPolyline(
    position: Cesium.Cartesian3,
    state: "append" | "complete" = "append"
  ) {
    // 这里添加两次是因为第二次添加的点作为预览点（鼠标当前位置）
    this._polylinePositions.push(position);
    this._polylinePositions.push(position);
    if (!this._currentEntity) {
      this._currentEntity = this._viewer.entities.add({
        polyline: {
          positions: new Cesium.CallbackProperty(() => {
            return this._polylinePositions;
          }, false),
          width: 5,
          clampToGround: true,
          material: new Cesium.PolylineOutlineMaterialProperty({
            color: Cesium.Color.ORANGE,
            outlineWidth: 2,
            outlineColor: Cesium.Color.BLACK,
          }),
        },
      });
    }
    switch (state) {
      case "append":
      // this._currentEntity.polyline;
    }
  }

  public drawPolygon(position: Cesium.Cartesian3) {
    // 这里添加两次是因为第二次添加的点作为预览点（鼠标当前位置）
    this._polylinePositions.push(position);
    this._polylinePositions.push(position);

    if (!this._currentEntity) {
      this._currentEntity = this._viewer.entities.add({
        polygon: {
          hierarchy: new Cesium.CallbackProperty(() => {
            return new Cesium.PolygonHierarchy(this._polylinePositions);
          }, false),
          // perPositionHeight: true,
          // heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          material: Cesium.Color.RED,
          // 解决某些角度看不到的问题
          classificationType: Cesium.ClassificationType.BOTH,
          // 双面渲染
          perPositionHeight: false,
          // 设置高度参考
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
      });
    }
  }

  public completeDraw() {
    switch (this._mode) {
      case "point":
        this._viewer.entities.remove(this._previewEntity!);
        this._currentEntity = null;
        this._previewEntity = null;
        break;
      case "polyline":
        if (this._currentEntity) {
          const positions = [...this._polylinePositions];
          const newEntity = this._viewer.entities.add({
            polyline: {
              positions: positions,
              width: 5,
              clampToGround: true,
              material: new Cesium.PolylineOutlineMaterialProperty({
                color: Cesium.Color.ORANGE,
                outlineWidth: 2,
                outlineColor: Cesium.Color.BLACK,
              }),
            },
          });
          this._drawEntitys?.push(newEntity);
          this._viewer.entities.remove(this._currentEntity);
        }
        this._currentEntity = null;
        this._previewEntity = null;
        this._polylinePositions = [];
        break;
      case "polygon":
        if (this._currentEntity) {
          const positions = [...this._polylinePositions];
          const newEntity = this._viewer.entities.add({
            polygon: {
              hierarchy: new Cesium.PolygonHierarchy(positions),
              // 解决某些角度看不到的问题
              classificationType: Cesium.ClassificationType.BOTH,
              // 双面渲染
              perPositionHeight: false,
              // 设置高度参考
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              material: new Cesium.ColorMaterialProperty(Cesium.Color.RED.withAlpha(0.8)),
            },
          });
          this._drawEntitys?.push(newEntity);
          this._viewer.entities.remove(this._currentEntity);
        }
        this._currentEntity = null;
        this._previewEntity = null;
        this._polylinePositions = [];
        break;
      default:
        break;
    }
    this.changeDrawMode("default");
    this.ToolTip.destroyTooltip();
  }
  /**
   * 处理点击函数
   * @param event
   */
  public handleDrawEvent(
    event: Cesium.ScreenSpaceEventHandler.PositionedEvent
  ) {
    const position = this.pickPositon(event.position);
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
  }

  public handleMouseMoveEvent(
    event: Cesium.ScreenSpaceEventHandler.MotionEvent
  ) {
    const position = this.pickPositon(event.endPosition);
    if (!position) return;

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
      this._polylinePositions[this._polylinePositions.length - 1] = position;
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
      this._polylinePositions[this._polylinePositions.length - 1] = position;
    }
  }

  public clear() {
    this._viewer.entities.removeAll();
    this._currentEntity = null;
    this._previewEntity = null;
    this._polylinePositions = [];
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
    let position: Cesium.Cartesian3 | undefined;

    if (this._viewer.scene.pickPositionSupported) {
      position = this._viewer.scene.pickPosition(windowPosition);
    }
    if (!Cesium.defined(position)) {
      const pickObject = this._viewer.scene.pick(windowPosition);
      if (Cesium.defined(pickObject)) {
        position = pickObject.position;
      }
    }
    if (!Cesium.defined(position)) {
      const ray = this._viewer.camera.getPickRay(windowPosition);
      position = this._viewer.scene.globe.pick(ray!, this._viewer.scene);
    }
    return position;
  }
}
