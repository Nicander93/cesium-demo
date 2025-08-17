import * as Cesium from 'cesium';
import { compareNumber } from './config';

/**
 * 事件管理类，用于处理事件的注册、注销和触发
 */
class Event {
  /** 事件监听器数组 */
  listeners: Array<Function | undefined>;
  /** 监听器作用域数组 */
  scopes: Array<any>;
  /** 待删除的监听器索引数组 */
  toRemove: number[];
  /** 是否正在触发事件 */
  insideRaiseEvent: boolean;

  constructor() {
    this.listeners = [];
    this.scopes = [];
    this.toRemove = [];
    this.insideRaiseEvent = false;
  }

  /**
   * 获取当前订阅事件的侦听器个数
   * @returns {number} 当前活跃的监听器数量
   */
  getnumberOfListeners(): number {
    return this.listeners.length - this.toRemove.length;
  }

  /**
   * 注册事件触发时执行的回调函数
   * @param {Function} listener 事件触发时执行的回调函数
   * @param {any} [scope] 侦听器函数中this的指针
   * @returns {Function} 用于取消侦听器监测的函数
   *
   * @see Event#removeEventListener
   * @see Event#raise
   */
  addEventListener(listener: Function, scope?: any): Function {
    if (typeof listener !== 'function') {
      throw new Error('侦听器应该是一个函数');
    }

    this.listeners.push(listener);
    this.scopes.push(scope);

    // 返回取消订阅的函数
    return () => {
      this.removeEventListener(listener, scope);
    };
  }

  /**
   * 注销事件触发时的回调函数
   * @param {Function} listener 将要被注销的函数
   * @param {any} [scope] 侦听器函数中this的指针
   * @returns {boolean} 如果为真，事件被成功注销，否则，事件注销失败
   *
   * @see Event#addEventListener
   * @see Event#raise
   */
  removeEventListener(listener: Function, scope?: any): boolean {
    if (typeof listener !== 'function') {
      throw new Error('侦听器应该是一个函数');
    }
    const listeners = this.listeners;
    const scopes = this.scopes;

    let index = -1;
    for (let i = 0; i < listeners.length; i++) {
      if (listeners[i] === listener && scopes[i] === scope) {
        index = i;
        break;
      }
    }

    if (index !== -1) {
      if (this.insideRaiseEvent) {
        // 如果正在触发事件，标记为待删除
        this.toRemove.push(index);
        listeners[index] = undefined;
        scopes[index] = undefined;
      } else {
        // 直接删除监听器
        listeners.splice(index, 1);
        scopes.splice(index, 1);
      }
      return true;
    }

    return false;
  }

  /**
   * 触发事件
   * @param {...any[]} args 此方法接受任意数据的参数并传递给侦听器函数
   *
   * @see Event#addEventListener
   * @see Event#removeEventListener
   */
  raise(...args: any[]): void {
    this.insideRaiseEvent = true;
    let i: number;
    const listeners = this.listeners;
    const scopes = this.scopes;
    let { length } = listeners;
    
    // 遍历所有监听器并执行
    for (i = 0; i < length; i++) {
      const listener = listeners[i];
      if (Cesium.defined(listener)) {
        listeners[i]!.apply(scopes[i], args);
      }
    }
    
    // 处理待删除的监听器
    const toRemove = this.toRemove;
    length = toRemove.length;
    // 降序排列，从后往前删，避免索引变化
    if (length > 0) {
      toRemove.sort(compareNumber);
      for (i = 0; i < length; i++) {
        const index = toRemove[i];
        listeners.splice(index, 1);
        scopes.splice(index, 1);
      }
      toRemove.length = 0;
    }

    this.insideRaiseEvent = false;
  }

  /**
   * 触发事件的别名方法
   * @param {...any[]} args 传递给监听器的参数
   */
  raiseEvent(...args: any[]): void {
    this.raise(...args);
  }
}

export default Event;