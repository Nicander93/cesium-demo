import type { Viewer } from "cesium";
import * as Cesium from 'cesium';

type DrawMode = 'defaullt' | 'point'
/**
 * 实现绘制Util
 * 绘制模式：点、线、面
 */
export class DrawUtil {
  private _mode: DrawMode = 'defaullt';
  // TODO: 这里要解决变量初始化问题
  private _drawPrimitives: Cesium.PrimitiveCollection;
  private _pointPrimitives: Cesium.PointPrimitiveCollection;
  private _polylinePrimitives: Cesium.PrimitiveCollection;
  private _previewPoint: Cesium.PointPrimitive | null = null; // 预览点

  private _viewer: Viewer;

  constructor(viewer: Viewer) {
    this._viewer = viewer;
    this.initilizePrimitive()
    this.initilizeEvent()
  }

  public changeDrawMode(mode: DrawMode = 'point') {
    this._mode = mode
  }

  private initilizePrimitive() {
    this._drawPrimitives = new Cesium.PrimitiveCollection();
    this._pointPrimitives = new Cesium.PointPrimitiveCollection();
    this._polylinePrimitives = new Cesium.PrimitiveCollection();

    this._drawPrimitives.add(this._pointPrimitives);
    this._drawPrimitives.add(this._polylinePrimitives);
    this._viewer.scene.primitives.add(this._drawPrimitives);
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
    )
  }

  public drawPolyline(position: Cesium.Cartesian3) {
    if (position) {
      this.
    }

  }

  public drawPoint(position: Cesium.Cartesian3) {
    if (position) {
      this._pointPrimitives.add({
        position,
        pixelSize: 5,
        color: Cesium.Color.RED,
        disableDepthTestDistance: 5000,
        outlineColor: Cesium.Color.YELLOW,
        outlineWidth: 2
      });
      this.addActivePrimitive(position)
    }
  }

  /**
   * 添加当前激活的Primitve，用于当鼠标移动时，绘制要素也跟着移动
   */
  public addActivePrimitive(position: Cesium.Cartesian3) {
    switch (this._mode) {
      case 'point':
        this._pointPrimitives.add({
          position,
          color: Cesium.Color.YELLOW
        });
        break;
      default:
        break
    }
  }

  /**
   * 处理点击函数
   * @param event 
   */
  public handleDrawEvent(event: Cesium.ScreenSpaceEventHandler.PositionedEvent) {
    const position = this.pickPositon(event.position)

    if (Cesium.defined(position)) {
      switch (this._mode) {
        case 'point':
          this.drawPoint(position)
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
      position = this._viewer.scene.pickPosition(windowPosition)
    }
    if (!Cesium.defined(position)) {
      const pickObject = this._viewer.scene.pick(windowPosition)
      if (Cesium.defined(pickObject)) {
        position = pickObject.position
      }
    }
    if (!Cesium.defined(position)) {
      const ray = this._viewer.camera.getPickRay(windowPosition);
      position = this._viewer.scene.globe.pick(ray!, this._viewer.scene);
    }
    return position
  }


  public handleMouseMoveEvent(event: Cesium.ScreenSpaceEventHandler.MotionEvent) {
    const position = this.pickPositon(event.endPosition)
    if (!position) return

    switch (this._mode) {
      case 'point':
        // 更新预览点位置
        this.updatePreviewPoint(position);
        break
      default:
        break
    }
  }

  /**
   * 更新预览点位置
   */
  private updatePreviewPoint(position: Cesium.Cartesian3) {
    if (!this._previewPoint) {
      // 创建预览点
      this._previewPoint = this._pointPrimitives.add({
        position,
        pixelSize: 8,
        color: Cesium.Color.CYAN,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2
      });
    } else {
      // 更新预览点位置
      this._previewPoint.position = position;
    }
  }

  public clear() {
    this._drawPrimitives.removeAll();
    this._drawPrimitives && this._viewer.scene.primitives.remove(this._drawPrimitives);
    this._previewPoint = null;
    this.changeDrawMode('defaullt')
    this.initilizePrimitive()
  }

}