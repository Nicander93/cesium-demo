import * as Cesium from 'cesium';
import { compareNumber } from './config';

class Event {
  listeners: any[];
  scopes: any[];
  toRemove: any[];
  insideRaiseEvent: boolean;
  constructor() {
    this.listeners = [];
    this.scopes = [];
    this.toRemove = [];
    this.insideRaiseEvent = false;
  }

  /**
     * 当前订阅事件的侦听器个数
     * @type {Number}
     */
  getnumberOfListeners() {
    return this.listeners.length - this.toRemove.length;
  }

  /**
     * 注册事件触发时执行的回调函数
     * @param {Function} listener 事件触发时执行的回调函数
     * @param {Object} [scope] 侦听器函数中this的指针
     * @return {Function} 用于取消侦听器监测的函数
     *
     * @see Event#removeEventListener
     * @see Event#raise
     */
  addEventListener(listener, scope) {
    if (typeof listener !== 'function') {
      throw new Error('侦听器应该是一个函数');
    }

    this.listeners.push(listener);
    this.scopes.push(scope);

    return function () {
      this.removeEventListener(listener, scope);
    };
  }

  /**
     * 注销事件触发时的回调函数
     * @param {Function} listener 将要被注销的函数
     * @param {Object} [scope] 侦听器函数中this的指针
     * @return {Boolean} 如果为真，事件被成功注销，否则，事件注销失败
     *
     * @see Event#addEventListener
     * @see Event#raise
     */
  removeEventListener(listener, scope) {
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
        this.toRemove.push(index);
        listeners[index] = undefined;
        scopes[index] = undefined;
      } else {
        listeners.splice(index, 1);
        scopes.splice(index, 1);
      }
      return true;
    }

    return false;
  }

  /**
     * 触发事件
     * @param {*} arguments 此方法接受任意数据的参数并传递给侦听器函数
     *
     * @see Event#addEventListener
     * @see Event#removeEventListener
     */
  raise(...args) {
    this.insideRaiseEvent = true;
    let i;
    const listeners = this.listeners;
    const scopes = this.scopes;
    let { length } = listeners;
    for (i = 0; i < length; i++) {
      const listener = listeners[i];
      if (Cesium.defined(listener)) {
        listeners[i].apply(scopes[i], args);
      }
    }
    const toRemove = this.toRemove;
    length = toRemove.length;
    // 降序排列，从后往前删
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
  raiseEvent(...args) {
    this.raise(...args);
  }
}
export default Event;