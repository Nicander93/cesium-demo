<template>
  <div class="home-container">
    <div class="header">
      <h1>Cesium Demo</h1>
      <p>选择一个演示来开始体验</p>
    </div>

    <div class="nav-cards">
      <div
        v-for="item in navItems"
        :key="item.path"
        class="nav-card"
        @click="navigateTo(item.path)"
      >
        <img class="card-image" :src="item.image" :alt="item.title" />

        <div class="card-title">
          {{ item.title }}
          <span class="card-arrow">▼</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

interface NavItem {
  path: string
  title: string
  description: string
  image: string
}

const navItems = computed<NavItem[]>(() =>
  router
    .getRoutes()
    .filter((r) => r.path !== '/')
    .map((r) => {
      const path = r.path
      const title = (r.meta as any)?.title ?? path
      const description = (r.meta as any)?.description ?? ''
      const image = new URL(`./${path.replace(/^\//, '')}/index.png`, import.meta.url).href
      return { path, title, description, image }
    })
)

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

/* 卡片样式重写为垂直布局 */
.nav-card {
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.3s ease, box-shadow 0.3s ease;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  display: flex;
  flex-direction: column;
}

.nav-card:hover {
  transform: translateY(-6px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.15);
}

.card-image {
  width: 100%;
  height: 180px;
  object-fit: cover;
}

.card-title {
  text-align: center;
  font-size: 1rem;
  font-weight: 600;
  padding: 12px 8px 16px;
  color: #2d3748;
}

.card-arrow {
  margin-left: 4px;
  color: #17c964; /* 绿色箭头 */
  font-size: 0.875rem;
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