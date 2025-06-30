<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router'
import { computed } from 'vue'

const router = useRouter()
const route = useRoute()

const isHomePage = computed(() => route.path === '/')

const goHome = () => {
  if (!isHomePage.value) {
    router.push('/')
  }
}
</script>

<template>
  <div class="app">
    <nav v-if="!isHomePage" class="top-nav">  
      <button @click="goHome" class="home-btn">
        <i class="fas fa-home"></i>
        <span>返回主页</span>
      </button>
    </nav>
    
    <main class="main-content" :class="{ 'with-nav': !isHomePage }">
      <router-view />
    </main>
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  overflow: hidden;
}

.app {
  min-height: 100vh;
  overflow: hidden;
}

.top-nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 60px;
  background: transparent;
  border-bottom: 1px solid rgba(0, 0, 0, 0.1);
  display: flex;
  align-items: center;
  padding: 0 24px;
  z-index: 1000;
}

.home-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.3s ease;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
}

.home-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.home-btn:active {
  transform: translateY(0);
}

.main-content {
  min-height: 100vh;
}

</style>
