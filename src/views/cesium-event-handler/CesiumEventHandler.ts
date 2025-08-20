import {
  ScreenSpaceEventHandler,
  type Cesium3DTileset,
  type Entity,
  type Primitive,
  ScreenSpaceEventType,
  type Viewer,
} from 'cesium'
import * as Cesium from 'cesium'

type HandlerKey = Primitive | Entity | Cesium3DTileset | string
type HandlerMap<T> = Map<HandlerKey, T>
type EventMap = {
  [ScreenSpaceEventType.LEFT_CLICK]: HandlerMap<Cesium.ScreenSpaceEventHandler.PositionedEventCallback>
  [ScreenSpaceEventType.RIGHT_CLICK]: HandlerMap<Cesium.ScreenSpaceEventHandler.PositionedEventCallback>
  [ScreenSpaceEventType.MOUSE_MOVE]: HandlerMap<Cesium.ScreenSpaceEventHandler.MotionEventCallback>
  [ScreenSpaceEventType.WHEEL]: HandlerMap<Cesium.ScreenSpaceEventHandler.WheelEventCallback>
}

/**
 * 代理Cesium事件处理器，作为一个统一的注册入口
 */
export default class CesiumEventHandler {
  private viewer: Viewer
  private handlerMap: EventMap

  constructor(viewer: Viewer) {
    this.viewer = viewer
    this.handlerMap = {
      [Cesium.ScreenSpaceEventType.LEFT_CLICK]: new Map(),
      [Cesium.ScreenSpaceEventType.RIGHT_CLICK]: new Map(),
      [Cesium.ScreenSpaceEventType.MOUSE_MOVE]: new Map(),
      [Cesium.ScreenSpaceEventType.WHEEL]: new Map(),
    }
    this.initEventMap()
  }

  /**
   * 全局注册事件
   */
  private initEventMap() {
    // TODO: 先简要实现
    this.viewer.screenSpaceEventHandler.setInputAction((e: any) => {
      const pickObj = this.viewer.scene.pick(e.position)
      const primitive =
        pickObj.id instanceof Cesium.Entity ? pickObj.id : pickObj.primitive
      this.triggerHandler(ScreenSpaceEventType.LEFT_CLICK, primitive, e)
    }, ScreenSpaceEventType.LEFT_CLICK)

    this.viewer.screenSpaceEventHandler.setInputAction((e: any) => {
      const pickObj = this.viewer.scene.pick(e.position)
      const primitive =
        pickObj.id instanceof Cesium.Entity ? pickObj.id : pickObj.primitive
      this.triggerHandler(ScreenSpaceEventType.RIGHT_CLICK, primitive, e)
    }, ScreenSpaceEventType.RIGHT_CLICK)
  }

  public registerHandler(
    eventType: keyof EventMap,
    primitive: Primitive | Entity | Cesium3DTileset,
    handler: Function,
  ) {
    if (eventType in this.handlerMap) {
      if (this.handlerMap[eventType].get(primitive)) {
        console.warn(`primitive 已注册${eventType} 事件处理函数`)
        return
      }
      this.handlerMap[eventType].set(primitive, handler)
    }
  }

  public unregisterHandler(
    eventType: keyof EventMap,
    primitive: Primitive | Entity | Cesium3DTileset,
  ) {
    this.handlerMap[eventType].delete(primitive)
  }

  public triggerHandler(
    eventType: keyof EventMap,
    primitive: Primitive | Entity | Cesium3DTileset,
    e: any,
  ) {
    const handler = this.handlerMap[eventType].get(primitive)
    if (handler) {
      handler(e)
    }
  }
}
