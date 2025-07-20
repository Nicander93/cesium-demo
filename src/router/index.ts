import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('@/views/Home.vue'),
  },
  {
    path: '/mask',
    component: () => import('@/views/mask/mask.vue'),
    meta: {
      title: '着色器遮罩',
      description: '使用Cesium着色器实现遮罩效果',
      icon: 'fas fa-mask',
    },
  },
  {
    path: '/off-screen-render',
    component: () => import('@/views/off-screen-render/index.vue'),
    meta: {
      title: '离屏渲染',
      description: '演示Cesium离屏渲染技术',
      icon: 'fas fa-desktop',
    },
  },
  {
    path: '/water',
    component: () => import('@/views/water/water.vue'),
    meta: {
      title: '水面效果',
      description: '展示逼真的水面渲染效果',
      icon: 'fas fa-water',
    },
  },
  {
    path: '/draw-command',
    component: () => import('@/views/draw-command/index.vue'),
    meta: {
      title: '绘制命令',
      description: '演示Cesium绘制命令',
      icon: 'fas fa-pencil-ruler',
    },
  },
  {
    path: '/primitive',
    component: () => import('@/views/primitive/primitive.vue'),
    meta: {
      title: 'Primitive',
      description: '演示Cesium Primitive',
      icon: 'fas fa-cube',
    },
  },
  {
    path: '/custom-primitive',
    component: () => import('@/views/custom-primitive/custom-primitive.vue'),
    meta: {
      title: '自定义Primitive',
      description: '演示Cesium自定义Primitive',
      icon: 'fas fa-cube',
    },
  },
]

export default createRouter({
  history: createWebHistory(),
  routes,
})