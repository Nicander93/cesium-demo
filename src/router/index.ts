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
    path: '/arcgis-mapserver',
    component: () => import('@/views/arcgis-mapserver/index.vue'),
    meta: {
      title: 'ArcGIS地图服务',
      description: '展示ArcGIS地图服务',
      icon: 'fas fa-map',
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
  {
    path: '/cesium-utils-demo',
    component: () => import('@/views/cesium-utils-demo/cesium-utils-demo.vue'),
    meta: {
      title: 'Cesium工具类',
      description: '便于创建各种Cesium数据的工具类演示',
      icon: 'fas fa-toolbox',
    },
  },
  {
    path: '/diffusion-circle',
    component: () => import('@/views/diffusion-circle/index.vue'),
    meta: {
      title: '扩散圆',
    },
  },
  {
    path: '/gradient-box',
    component: () => import('@/views/gradient-box/index.vue'),
    meta: {
      title: '渐变box',
    },
  },
  {
    path: '/shadertoy-simple-demo',
    component: () => import('@/views/shadertoy-simple-demo/index.vue'),
    meta: {
      title: 'ShaderToy简单示例',
    },
  },
  {
    path: '/shadertoy-fluid-water',
    component: () => import('@/views/shadertoy-fluid-water/index.vue'),
    meta: {
      title: 'ShaderToy流体水',
    },
  },
  {
    path: '/shadertoy-water-ripple',
    component: () => import('@/views/shadertoy-water-ripple/index.vue'),
    meta: {
      title: 'ShaderToy水波纹',
    },
  },
  {
    path: '/heatmap-2d',
    component: () => import('@/views/heatmap-2d/index.vue'),
    meta: {
      title: '热力图(2D)',
    },
  },
  {
    path: '/heatmap-3d',
    component: () => import('@/views/heatmap-3d/index.vue'),
    meta: {
      title: '热力图(3D)',
    },
  },
  {
    path: '/globe-material',
    component: () => import('@/views/globe-material/index1.vue'),
    meta: {
      title: '地球材质',
    },
  },
  {
    path: '/globe-material-local',
    component: () => import('@/views/globe-material/index2.vue'),
    meta: {
      title: '局部地球材质',
      description: '局部等高线与高程渲染组合效果',
      icon: 'fas fa-mountain',
    },
  },
  {
    path: '/tile-local-flatten',
    component: () => import('@/views/tile-local-flatten/index.vue'),
    meta: {
      title: '倾斜局部压平',
      description: '倾斜局部压平',
    },
  },
  {
    path: '/draw-util',
    component: () => import('@/views/draw-util/index.vue'),
    meta: {
      title: '绘制工具',
    },
  },
  {
    path: '/fog-post-process',
    component: () => import('@/views/fog-post-process/index.vue'),
    meta: {
      title: '雾化后处理',
    },
  },
  {
    path: '/fog-local-post-process',
    component: () => import('@/views/fog-local-post-process/index.vue'),
    meta: {
      title: '高度雾',
    },
  },
  {
    path: '/snow-local-post-process',
    component: () => import('@/views/snow-local-post-process/index.vue'),
    meta: {
      title: '积雪',
    },
  },
  {
    path: '/model-editor',
    component: () => import('@/views/model-editor/index.vue'),
    meta: {
      title: '模型编辑器',
    },
  },
  {
    path: '/cesium-event-handler',
    component: () => import('@/views/cesium-event-handler/index.vue'),
    meta: {
      title: '自定义Cesium事件处理器',
    },
  },
  {
    path: '/draw-command-primitive',
    component: () => import('@/views/draw-command-primitive/index.vue'),
    meta: {
      title: '绘制命令Primitive',
    },
  },
  {
    path: '/volume-rendering',
    component: () => import('@/views/volume-rendering/index.vue'),
    meta: {
      title: '体渲染',
    },
  },
]

export default createRouter({
  history: createWebHistory(),
  routes,
})
