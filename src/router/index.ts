import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/flood-dynamic-lab', component: () => import('@/views/flood-dynamic-lab/index.vue'),
    meta: { title: '泄洪传播与退水', standalone: true, category: 'effect', description: 'GPU 状态纹理与 Primitive 动态水面对照', image: new URL('../views/water-flow-lab/preview.svg', import.meta.url).href } },
  { path: '/water-real-terrain', component: () => import('@/views/water-real-terrain/index.vue'),
    meta: { title: '真实地形与湖岸', standalone: true, category: 'effect', description: '官方水域面、独立地形和影像状态',
      image: new URL('../views/water-flow-lab/preview.svg', import.meta.url).href } },
  {
    path: '/water-flow-lab',
    component: () => import('@/views/water-flow-lab/index.vue'),
    meta: { title: '水流渲染对照', standalone: true, category: 'effect',
      image: new URL('../views/water-flow-lab/preview.svg', import.meta.url).href,
      description: '无网络合成工况、速度场与泡沫诊断' },
  },
  {
    path: '/city-three',
    component: () => import('@/views/city-rendering/three.vue'),
    meta: {
      title: '滨水城市 Three.js 对照', standalone: true,
      description: '同一 GLB 街区、车流、HDR 与模型光照对照',
      image: new URL('../views/city-rendering/preview.svg', import.meta.url).href,
      category: 'render',
    },
  },
  {
    path: '/city-rendering',
    component: () => import('@/views/city-rendering/index.vue'),
    meta: {
      title: '滨水城市环境实验', standalone: true,
      description: '风格化城市模型、反射水面、车流、体积云、光照与降雨',
      image: new URL('../views/city-rendering/preview.svg', import.meta.url).href,
      category: 'render',
    },
  },
  {
    path: '/model-rendering',
    component: () => import('@/views/model-rendering/index.vue'),
    meta: {
      title: '模型渲染对照',
      standalone: true,
      description: '同一 glTF 在 Cesium 与 Three.js 中的光照与材质对照',
      image: new URL('../views/model-rendering/preview.svg', import.meta.url).href,
      category: 'render',
    },
  },
  {
    path: '/flood-valley',
    component: () => import('@/views/flood-valley/index.vue'),
    meta: {
      title: '小山谷泄洪',
      image: new URL('../views/flood-valley/preview.svg', import.meta.url).href,
      description: '内置水动力实验与外部模型成果回放',
      category: 'effect',
    },
  },
  {
    path: '/',
    component: () => import('@/views/Home.vue'),
  },
  {
    path: '/mask-shader',
    component: () => import('@/views/mask/mask.vue'),
    meta: {
      title: '着色器遮罩',
      description: '使用Cesium着色器实现遮罩效果',
      icon: 'fas fa-mask',
      category: 'mask',
    },
  },
  {
    path: '/mask-polygon',
    component: () => import('@/views/mask1/mask.vue'),
    meta: {
      title: '多边形遮罩',
      description: '使用Entity/Primitive实现多边形反选遮罩（支持allowPicking=false）',
      icon: 'fas fa-mask',
      category: 'mask',
    },
  },
  {
    path: '/postprocess-mask',
    component: () => import('@/views/mask1/postProcess-test.vue'),
    meta: {
      title: '后处理遮罩',
      description: '使用PostProcessStage实现遮罩效果',
      icon: 'fas fa-mask',
      category: 'mask',
    },
  },
  {
    path: '/texture-mask',
    component: () => import('@/views/mask1/texture-mask-test.vue'),
    meta: {
      title: '纹理遮罩',
      description: '使用预渲染纹理实现高性能遮罩',
      icon: 'fas fa-mask',
      category: 'mask',
    },
  },
  {
    path: '/off-screen-render',
    component: () => import('@/views/off-screen-render/index.vue'),
    meta: {
      title: '离屏渲染',
      description: '演示Cesium离屏渲染技术',
      icon: 'fas fa-desktop',
      category: 'render',
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
      category: 'effect',
    },
  },
  {
    path: '/draw-command',
    component: () => import('@/views/draw-command/index.vue'),
    meta: {
      title: '绘制命令',
      description: '演示Cesium绘制命令',
      icon: 'fas fa-pencil-ruler',
      category: 'primitive',
    },
  },
  {
    path: '/primitive',
    component: () => import('@/views/primitive/primitive.vue'),
    meta: {
      title: 'Primitive',
      description: '演示Cesium Primitive',
      icon: 'fas fa-cube',
      category: 'primitive',
    },
  },
  {
    path: '/custom-primitive',
    component: () => import('@/views/custom-primitive/custom-primitive.vue'),
    meta: {
      title: '自定义Primitive',
      description: '演示Cesium自定义Primitive',
      icon: 'fas fa-cube',
      category: 'primitive',
    },
  },
  {
    path: '/cesium-utils-demo',
    component: () => import('@/views/cesium-utils-demo/cesium-utils-demo.vue'),
    meta: {
      title: 'Cesium工具类',
      description: '便于创建各种Cesium数据的工具类演示',
      icon: 'fas fa-toolbox',
      category: 'tool',
    },
  },
  {
    path: '/diffusion-circle',
    component: () => import('@/views/diffusion-circle/index.vue'),
    meta: {
      title: '扩散圆',
      category: 'effect',
    },
  },
  {
    path: '/gradient-box',
    component: () => import('@/views/gradient-box/index.vue'),
    meta: {
      title: '渐变box',
      category: 'effect',
    },
  },
  {
    path: '/shadertoy-simple-demo',
    component: () => import('@/views/shadertoy-simple-demo/index.vue'),
    meta: {
      title: 'ShaderToy简单示例',
      category: 'effect',
    },
  },
  {
    path: '/shadertoy-fluid-water',
    component: () => import('@/views/shadertoy-fluid-water/index.vue'),
    meta: {
      title: 'ShaderToy流体水',
      category: 'effect',
    },
  },
  {
    path: '/shadertoy-water-ripple',
    component: () => import('@/views/shadertoy-water-ripple/index.vue'),
    meta: {
      title: 'ShaderToy水波纹',
      category: 'effect',
    },
  },
  {
    path: '/heatmap-2d',
    component: () => import('@/views/heatmap-2d/index.vue'),
    meta: {
      title: '热力图(2D)',
      category: 'effect',
    },
  },
  {
    path: '/heatmap-3d',
    component: () => import('@/views/heatmap-3d/index.vue'),
    meta: {
      title: '热力图(3D)',
      category: 'effect',
    },
  },
  {
    path: '/globe-material',
    component: () => import('@/views/globe-material/index1.vue'),
    meta: {
      title: '地球材质',
      category: 'material',
    },
  },
  {
    path: '/globe-material-local',
    component: () => import('@/views/globe-material/index2.vue'),
    meta: {
      title: '局部地球材质',
      description: '局部等高线与高程渲染组合效果',
      icon: 'fas fa-mountain',
      category: 'material',
    },
  },
  {
    path: '/tile-local-flatten',
    component: () => import('@/views/tile-local-flatten/index.vue'),
    meta: {
      title: '倾斜局部压平',
      description: '倾斜局部压平',
      category: 'tile',
    },
  },
  {
    path: '/draw-util',
    component: () => import('@/views/draw-util/index.vue'),
    meta: {
      title: '绘制工具',
      category: 'tool',
    },
  },
  {
    path: '/fog-post-process',
    component: () => import('@/views/fog-post-process/index.vue'),
    meta: {
      title: '雾化后处理',
      category: 'effect',
    },
  },
  {
    path: '/fog-local-post-process',
    component: () => import('@/views/fog-local-post-process/index.vue'),
    meta: {
      title: '高度雾',
      category: 'effect',
    },
  },
  {
    path: '/snow-local-post-process',
    component: () => import('@/views/snow-local-post-process/index.vue'),
    meta: {
      title: '积雪',
      category: 'effect',
    },
  },
  {
    path: '/model-editor',
    component: () => import('@/views/model-editor/index.vue'),
    meta: {
      title: '模型编辑器',
      category: 'tool',
    },
  },
  {
    path: '/cesium-event-handler',
    component: () => import('@/views/cesium-event-handler/index.vue'),
    meta: {
      title: '自定义Cesium事件处理器',
      category: 'tool',
    },
  },
  {
    path: '/draw-command-primitive',
    component: () => import('@/views/draw-command-primitive/index.vue'),
    meta: {
      title: '绘制命令Primitive',
      category: 'primitive',
    },
  },
  {
    path: '/volume-rendering',
    component: () => import('@/views/volume-rendering/index.vue'),
    meta: {
      title: '体渲染',
      category: 'render',
    },
  },
  {
    path: '/cesium-tdt-ext',
    component: () => import('@/views/cesium-tdt-ext/index.vue'),
    meta: {
      title: '天地图三维地形',
      description: '演示加载天地图影像和三维地形',
      icon: 'fas fa-mountain',
      category: 'ext',
    },
  },
]

export default createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})
