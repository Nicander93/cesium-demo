import type {
  Cesium3DTileset,
  Entity,
  Primitive,
  ScreenSpaceEventType,
  ScreenSpaceEventHandler,
  Viewer,
} from "cesium";
import * as Cesium from "cesium";

type HandlerMap<T> = Map<Primitive | Entity | Cesium3DTileset, T>;
type EventMap = {
  [ScreenSpaceEventType.LEFT_CLICK]: HandlerMap<Cesium.ScreenSpaceEventHandler.PositionedEventCallback>;
  [ScreenSpaceEventType.RIGHT_CLICK]: HandlerMap<Cesium.ScreenSpaceEventHandler.PositionedEventCallback>;
  [ScreenSpaceEventType.MOUSE_MOVE]: HandlerMap<Cesium.ScreenSpaceEventHandler.MotionEventCallback>;
  [ScreenSpaceEventType.WHEEL]: HandlerMap<Cesium.ScreenSpaceEventHandler.WheelEventCallback>;
};

/**
 * 代理Cesium事件处理器，作为一个统一的注册入口
 */
class CesiumEventHandler {
  private viewer: Viewer;
  private handlerMap: EventMap;

  constructor(viewer: Viewer) {
    this.viewer = viewer;
    this.handlerMap = {
      [Cesium.ScreenSpaceEventType.LEFT_CLICK]: new Map(),
      [Cesium.ScreenSpaceEventType.RIGHT_CLICK]: new Map(),
      [Cesium.ScreenSpaceEventType.MOUSE_MOVE]: new Map(),
      [Cesium.ScreenSpaceEventType.WHEEL]: new Map(),
    };
  }

  private initEventMap() {
    // this.viewer.screenSpaceEventHandler.setInputAction()
  }

  public registerHandler(
    primitive: Primitive | Entity | Cesium3DTileset,
    handler: Function,
  ) {
    this.handlerMap.set(primitive, handler);
  }

  public unregisterHandler(primitive: Primitive | Entity | Cesium3DTileset) {
    this.handlerMap.delete(primitive);
  }

  public triggerHandler(primitive: Primitive | Entity | Cesium3DTileset) {
    const handler = this.handlerMap.get(primitive);
    if (handler) {
      handler();
    }
  }
}
