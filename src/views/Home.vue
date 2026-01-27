<template>
  <div class="home-container">
    <div class="header">
      <h1>Cesium Demo</h1>
      <p>选择一个演示来开始体验</p>
    </div>

    <!-- 搜索框 -->
    <div class="search-container">
      <input
        v-model="searchQuery"
        type="text"
        placeholder="搜索演示..."
        class="search-input"
      />
    </div>

    <!-- 按分类分组展示 -->
    <div class="content">
      <div
        v-for="group in filteredGroups"
        :key="group.categoryKey"
        class="category-group"
      >
        <div class="category-header">
          <h2>{{ group.categoryLabel }}</h2>
          <div class="category-count">{{ group.items.length }} 个演示</div>
        </div>

        <div class="nav-cards">
          <div
            v-for="item in group.items"
            :key="item.path"
            class="nav-card"
            @click="navigateTo(item.path)"
          >
            <img class="card-image" :src="item.image" :alt="item.title" />

            <div class="card-title">
              {{ item.title }}
              <span class="card-arrow">▼</span>
            </div>
            <div v-if="item.description" class="card-description">
              {{ item.description }}
            </div>
          </div>
        </div>

        <div v-if="group.items.length === 0" class="no-results">
          没有找到匹配的演示
        </div>
      </div>
    </div>

    <div v-if="hasNoResults" class="global-no-results">
      没有找到匹配的演示
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const searchQuery = ref('')

interface NavItem {
  path: string
  title: string
  description: string
  image: string
  category?: string
}

interface CategoryGroup {
  categoryKey: string
  categoryLabel: string
  items: NavItem[]
}

const categoryMap = {
  effect: '特效',
  mask: '遮罩',
  primitive: 'Primitive',
  material: '地球材质',
  tile: '3DTile',
  tool: '工具',
  render: '渲染技术',
  ext: '扩展',
}

const navItems = computed<NavItem[]>(() =>
  router
    .getRoutes()
    .filter((r) => r.path !== '/')
    .map((r) => {
      const path = r.path
      const meta = r.meta as any
      const title = meta?.title ?? path
      const description = meta?.description ?? ''
      const category = meta?.category ?? 'other'
      const image = new URL(`./${path.replace(/^\//, '')}/index.png`, import.meta.url).href
      return { path, title, description, image, category }
    })
)

// 搜索过滤后的items
const filteredNavItems = computed<NavItem[]>(() => {
  const searchLower = searchQuery.value.toLowerCase()
  if (searchLower === '') {
    return navItems.value
  }
  return navItems.value.filter(
    (item) =>
      item.title.toLowerCase().includes(searchLower) ||
      item.description.toLowerCase().includes(searchLower)
  )
})

// 按分类分组
const groupedNavItems = computed<CategoryGroup[]>(() => {
  const groups: Map<string, NavItem[]> = new Map()

  // 初始化所有分类
  Object.keys(categoryMap).forEach((key) => {
    groups.set(key, [])
  })

  // 将items分配到对应分类
  filteredNavItems.value.forEach((item) => {
    const category = item.category || 'other'
    if (!groups.has(category)) {
      groups.set(category, [])
    }
    groups.get(category)!.push(item)
  })

  // 转换为数组并过滤空分类
  return Object.entries(categoryMap)
    .filter(([key]) => groups.get(key) && groups.get(key)!.length > 0)
    .map(([key, label]) => ({
      categoryKey: key,
      categoryLabel: label,
      items: groups.get(key)!,
    }))
})

const filteredGroups = computed(() => {
  if (searchQuery.value === '') {
    return groupedNavItems.value
  }
  // 搜索时只显示有结果的分类
  return groupedNavItems.value.filter((group) => group.items.length > 0)
})

const hasNoResults = computed(() => {
  return searchQuery.value !== '' && filteredGroups.value.length === 0
})

const navigateTo = (path: string) => {
  router.push(path)
}
</script>

<style scoped>
.home-container {
  height: 100vh;
  overflow-y: auto;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 40px 20px;
  box-sizing: border-box;
}

/* 滚动条样式美化 */
.home-container::-webkit-scrollbar {
  width: 8px;
}

.home-container::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
}

.home-container::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.3);
  border-radius: 4px;
}

.home-container::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.5);
}

.header {
  text-align: center;
  margin-bottom: 40px;
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

/* 搜索框 */
.search-container {
  max-width: 600px;
  margin: 0 auto 40px;
}

.search-input {
  width: 100%;
  padding: 16px 24px;
  font-size: 1.1rem;
  border: none;
  border-radius: 50px;
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  transition: all 0.3s ease;
  outline: none;
}

.search-input:focus {
  background: white;
  box-shadow: 0 6px 30px rgba(0, 0, 0, 0.2);
}

.search-input::placeholder {
  color: #a0aec0;
}

/* 内容区域 */
.content {
  max-width: 1400px;
  margin: 0 auto;
  padding-bottom: 40px;
}

/* 分类组 */
.category-group {
  margin-bottom: 50px;
}

.category-group:last-child {
  margin-bottom: 0;
}

/* 分类标题 */
.category-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 2px solid rgba(255, 255, 255, 0.3);
}

.category-header h2 {
  font-size: 2rem;
  font-weight: 700;
  color: white;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  margin: 0;
}

.category-count {
  font-size: 1rem;
  color: rgba(255, 255, 255, 0.85);
  font-weight: 500;
  background: rgba(255, 255, 255, 0.15);
  padding: 6px 16px;
  border-radius: 20px;
  backdrop-filter: blur(10px);
}

.nav-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 24px;
}

/* 卡片样式 */
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
  padding: 12px 8px 8px;
  color: #2d3748;
}

.card-arrow {
  margin-left: 4px;
  color: #17c964; /* 绿色箭头 */
  font-size: 0.875rem;
}

.card-description {
  padding: 4px 12px 12px;
  text-align: center;
  font-size: 0.85rem;
  color: #718096;
  line-height: 1.4;
}

.no-results {
  text-align: center;
  padding: 40px 20px;
  color: rgba(255, 255, 255, 0.8);
  font-size: 1.1rem;
}

.global-no-results {
  text-align: center;
  padding: 80px 20px;
  color: rgba(255, 255, 255, 0.85);
  font-size: 1.3rem;
}

@media (max-width: 768px) {
  .header h1 {
    font-size: 2.5rem;
  }

  .search-input {
    padding: 14px 20px;
    font-size: 1rem;
  }

  .category-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .category-header h2 {
    font-size: 1.6rem;
  }

  .category-count {
    font-size: 0.9rem;
    padding: 4px 12px;
  }

  .nav-cards {
    grid-template-columns: 1fr;
    max-width: 400px;
  }

  .nav-card {
    padding: 0;
  }
}
</style>