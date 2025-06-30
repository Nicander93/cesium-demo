import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('@/views/Home.vue'),
  },
  {
    path: '/mask',
    component: () => import('@/views//mask/mask.vue'),
  },
  {
    path: '/off-screen-render',
    component: () => import('@/views/off-screen-render/index.vue'),
  },
  {
    path: '/water',
    component: () => import('@/views/water/water.vue'),
  },
  {
    path: '/draw-command',
    component: () => import('@/views/draw-command/index.vue'),
  },
]

export default createRouter({
  history: createWebHistory(),
  routes,
})