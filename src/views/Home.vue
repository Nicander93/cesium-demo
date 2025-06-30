<template>
  <div class="home-container">
    <div class="header">
      <h1>Cesium Demo</h1>
      <p>选择一个演示来开始体验</p>
    </div>

    <div class="nav-cards">
      <div v-for="item in navItems" :key="item.path" class="nav-card" @click="navigateTo(item.path)">
        <div class="card-icon">
          <i :class="item.icon"></i>
        </div>
        <div class="card-content">
          <h3>{{ item.title }}</h3>
          <p>{{ item.description }}</p>
        </div>
        <div class="card-arrow">
          <i class="fas fa-chevron-right"></i>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()

interface NavItem {
  path: string
  title: string
  description: string
  icon: string
}

const navItems: NavItem[] = [
  {
    path: '/mask',
    title: '着色器遮罩',
    description: '使用Cesium着色器实现遮罩效果',
    icon: 'fas fa-mask'
  },
  {
    path: '/off-screen-render',
    title: '离屏渲染',
    description: '演示Cesium离屏渲染技术',
    icon: 'fas fa-desktop'
  },
  {
    path: '/water',
    title: '水面效果',
    description: '展示逼真的水面渲染效果',
    icon: 'fas fa-water'
  },
  {
    path: '/draw-command',
    title: '绘制命令',
    description: '演示Cesium绘制命令',
    icon: 'fas fa-pencil-ruler'
  }
]

const navigateTo = (path: string) => {
  router.push(path)
}
</script>

<style scoped>
.home-container {
  min-height: 100vh;
  overflow: auto  ;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 40px 20px;
}

.header {
  text-align: center;
  margin-bottom: 60px;
  color: white;
}

.header h1 {
  font-size: 3.5rem;
  font-weight: 700;
  margin-bottom: 16px;
  text-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
}

.header p {
  font-size: 1.2rem;
  opacity: 0.9;
  font-weight: 300;
}

.nav-cards {
  max-width: 800px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 24px;
}

.nav-card {
  background: white;
  border-radius: 16px;
  padding: 32px;
  display: flex;
  align-items: center;
  gap: 20px;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.nav-card:hover {
  transform: translateY(-8px);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
}

.card-icon {
  flex-shrink: 0;
  width: 60px;
  height: 60px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 1.5rem;
}

.card-content {
  flex: 1;
}

.card-content h3 {
  font-size: 1.3rem;
  font-weight: 600;
  margin-bottom: 8px;
  color: #2d3748;
}

.card-content p {
  color: #718096;
  font-size: 0.95rem;
  line-height: 1.5;
}

.card-arrow {
  flex-shrink: 0;
  color: #cbd5e0;
  font-size: 1.2rem;
  transition: all 0.3s ease;
}

.nav-card:hover .card-arrow {
  color: #667eea;
  transform: translateX(4px);
}

@media (max-width: 768px) {
  .header h1 {
    font-size: 2.5rem;
  }

  .nav-cards {
    grid-template-columns: 1fr;
    max-width: 400px;
  }

  .nav-card {
    padding: 24px;
  }
}
</style>