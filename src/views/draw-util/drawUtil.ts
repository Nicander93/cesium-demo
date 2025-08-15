import type { Viewer } from "cesium";
import * as Cesium from "cesium";
import { useTooltip } from "./tooltip";

type DrawMode = "default" | "point" | "polyline" | "polygon";
/**
 * 实现绘制Util
 * 绘制模式：点、线、面
 */
export default class DrawUtil {
  private _mode: DrawMode = "default";
  // TODO: 这里要解决变量初始化问题
  // 存储绘制的所有entity
  private _drawEntitys: Cesium.Entity[] | null = null;
  // 用于指代当前绘制的entity
  private _currentEntity: Cesium.Entity | null = null;
  private _currentPositions: Cesium.Cartesian3[] = [];
  private ToolTip = useTooltip();
  // 用于钩子函数
  private _completeDrawCallback: ((entitys: Cesium.Entity[]) => void)[] = []

  private _viewer: Viewer;

  constructor(viewer: Viewer) {
    this._viewer = viewer;
    this.initilizePrimitive();
    this.initilizeEvent();
  }

  public changeDrawMode(mode: DrawMode = "point") {
    this._mode = mode;
    // 根据模式更新鼠标样式
    this.updateMouseCursor(mode);
    this.updateTooltip(mode);
  }

  private initilizePrimitive() {
    this._drawEntitys = [];
  }

  private initilizeEvent() {
    const handler = new Cesium.ScreenSpaceEventHandler(this._viewer.scene.canvas);

    // TODO: 后续解决绘制事件与其他绑定事件的关系
    handler.setInputAction(
      this.handleDrawEvent.bind(this),
      Cesium.ScreenSpaceEventType.LEFT_CLICK
    );

    handler.setInputAction(
      this.handleMouseMoveEvent.bind(this),
      Cesium.ScreenSpaceEventType.MOUSE_MOVE
    );

    handler.setInputAction(
      this.completeDraw.bind(this),
      Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK
    );
  }

  public registerCompleteDrawCallback(callback: (entitys: Cesium.Entity[]) => void) {
    this._completeDrawCallback.push(callback);
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
    // 触发钩子函数
    this._completeDrawCallback.forEach((callback) => callback(this._drawEntitys ?? []));
    // 不再需要清理预览点实体
    this._currentEntity = null;
    this._currentPositions = [];
    this.changeDrawMode("default");
    this.ToolTip && this.ToolTip.destroyTooltip();

  }
  /**
   * 多帧稳定拾取
   * @param windowPosition 屏幕坐标
   * @param maxFrames 最大帧数
   * @returns Promise<Cesium.Cartesian3 | undefined>
   */
  private pickPositionStabilized(
    windowPosition: Cesium.Cartesian2
  ): Promise<Cesium.Cartesian3 | undefined> {
    return new Promise((resolve) => {
      // 让场景尽快渲染新的一帧
      this._viewer.scene.requestRender();

      // 只执行一次的 postRender 回调
      const listener = () => {
        // 使用完整的坐标获取逻辑
        const cartesian = this.pickPositon(windowPosition);

        if (Cesium.defined(cartesian)) {
          // 清除监听，防止每帧都执行
          this._viewer.scene.postRender.removeEventListener(listener);
          resolve(cartesian);
        } else {
          // 如果没有获取到坐标，也清除监听
          this._viewer.scene.postRender.removeEventListener(listener);
          resolve(undefined);
        }
      };

      this._viewer.scene.postRender.addEventListener(listener);
    });
  }

  public handleDrawEvent(
    event: Cesium.ScreenSpaceEventHandler.PositionedEvent
  ) {
    const clickPos = event.position.clone();
    this._viewer.scene.requestRender();
    const position = this.pickPositon(clickPos)
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
    // 只在绘制模式下处理鼠标移动事件
    if (this._mode === "default") {
      return;
    }
    const position = this.pickPositon(event.endPosition);
    if (!position) return;

    switch (this._mode) {
      case "point":
        // 点模式：只显示鼠标样式，不需要预览点
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
        perPositionHeight: false,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });
  }


  private updateTooltip(mode: DrawMode) {
    switch (mode) {
      case "polygon":
        this.ToolTip = useTooltip();
        break;
      case "polyline":
        this.ToolTip = useTooltip();
        break;
      default:
        this.ToolTip && this.ToolTip.destroyTooltip();
        break;
    }
  }
  /**
   * 更新鼠标样式
   */
  private updateMouseCursor(mode: DrawMode) {
    const canvas = this._viewer.scene.canvas;

    switch (mode) {
      case "point":
        canvas.style.cursor = "crosshair";
        // 添加自定义样式提示
        this.addCursorStyle(canvas, "point");
        break;
      case "polyline":
        canvas.style.cursor = "crosshair";
        this.addCursorStyle(canvas, "polyline");
        break;
      case "polygon":
        canvas.style.cursor = "crosshair";
        this.addCursorStyle(canvas, "polygon");
        break;
      default:
        canvas.style.cursor = "default";
        this.removeCursorStyle(canvas);
        break;
    }
  }

  /**
   * 添加自定义鼠标样式
   */
  private addCursorStyle(canvas: HTMLCanvasElement, mode: string) {
    // 移除之前的样式
    this.removeCursorStyle(canvas);

    // 添加新的样式类
    canvas.classList.add(`draw-mode-${mode}`);

    // 可以在这里添加更多的视觉提示
    if (mode === "point") {
      canvas.title = "点击绘制点";
    } else if (mode === "polyline") {
      canvas.title = "点击绘制线，双击完成";
    } else if (mode === "polygon") {
      canvas.title = "点击绘制多边形，双击完成";
    }
  }

  /**
   * 移除自定义鼠标样式
   */
  private removeCursorStyle(canvas: HTMLCanvasElement) {
    canvas.classList.remove("draw-mode-point", "draw-mode-polyline", "draw-mode-polygon");
    canvas.title = "";
  }

  private updatePreviewPolyline(position: Cesium.Cartesian3) {
    // 只更新当前绘制线的最后一个点位置
    if (this._currentEntity) {
      this._currentPositions[this._currentPositions.length - 1] = position;
    }
  }

  private updatePreviewPolygon(position: Cesium.Cartesian3) {
    // 只更新当前绘制多边形的最后一个点位置
    if (this._currentEntity) {
      this._currentPositions[this._currentPositions.length - 1] = position;
    }
  }

  public clear() {
    this._viewer.entities.removeAll();
    this._currentEntity = null;
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
    // 方法1：直接使用pickPosition，忽略所有拾取的对象
    if (this._viewer.scene.pickPositionSupported) {
      const position = this._viewer.scene.pickPosition(windowPosition);
      if (Cesium.defined(position)) {
        return position;
      }
    }

    // 方法2：如果pickPosition失败，使用globe.pick
    const ray = this._viewer.camera.getPickRay(windowPosition);
    if (ray) {
      return this._viewer.scene.globe.pick(ray, this._viewer.scene);
    }

    return undefined;
  }
}
