import type { Viewer } from "cesium";
import * as Cesium from "cesium";
import { useTooltip } from "./tooltip";

type DrawMode = "default" | "point" | "polyline";
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
        default:
          break;
      }
    }
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

  public handleMouseMoveEvent(
    event: Cesium.ScreenSpaceEventHandler.MotionEvent
  ) {
    const position = this.pickPositon(event.endPosition);
    if (!position) return;
    const { x, y } = Cesium.SceneTransforms.wgs84ToWindowCoordinates(
      this._viewer.scene,
      position!
    );
    this.ToolTip.updateTooltipPosition(x, y);
    switch (this._mode) {
      case "point":
        // 更新预览点位置
      
        this.updatePreviewPoint(position);
        break;
      case "polyline":
        this.updatePreviewPolyline(position);
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

  public clear() {
    this._viewer.entities.removeAll();
    this._currentEntity = null;
    this._previewEntity = null;
    this._polylinePositions = [];

    this.changeDrawMode("default");
    this.initilizePrimitive();
  }
}
