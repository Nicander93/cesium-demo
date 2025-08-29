// 全局类型定义
declare global {
  // 这里可以定义全局类型
}

// 模块类型定义
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

// 导出类型
export {} 