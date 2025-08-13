<template>
  <button :class="buttonClasses" :disabled="disabled || loading" @click="handleClick" v-bind="$attrs">
    <slot name="icon" />
    <span v-if="!loading" class="btn-text">
      <slot />
    </span>
    <span v-else class="btn-loading-text">
      <slot name="loading" />
    </span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  variant?: 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'outline'
  size?: 'sm' | 'md' | 'lg'
  round?: boolean
  loading?: boolean
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'primary',
  size: 'md',
  round: false,
  loading: false,
  disabled: false
})

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()

const buttonClasses = computed(() => [
  'btn',
  `btn-${props.variant}`,
  props.size !== 'md' && `btn-${props.size}`,
  props.round && 'btn-round',
  props.loading && 'btn-loading'
].filter(Boolean))

const handleClick = (event: MouseEvent) => {
  if (!props.disabled && !props.loading) {
    emit('click', event)
  }
}
</script>

<style scoped>
/* Button 基础样式 */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 4px 8px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;
  text-decoration: none;
  outline: none;
  position: relative;
  overflow: hidden;
  min-width: 40px;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none !important;
}

.btn:focus {
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.3);
}

/* 主要按钮 - 使用项目主题渐变色 */
.btn-primary {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: white;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(102, 126, 234, 0.4);
}

.btn-primary:active:not(:disabled) {
  transform: translateY(0);
}

/* 次要按钮 */
.btn-secondary {
  background: rgba(255, 255, 255, 0.1);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(10px);
}

.btn-secondary:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.3);
  transform: translateY(-1px);
}

/* 成功按钮 */
.btn-success {
  background: linear-gradient(135deg, #17c964, #0ea5e9);
  color: white;
  box-shadow: 0 2px 8px rgba(23, 201, 100, 0.3);
}

.btn-success:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(23, 201, 100, 0.4);
}

/* 危险按钮 */
.btn-danger {
  background: linear-gradient(135deg, #f31260, #e11d48);
  color: white;
  box-shadow: 0 2px 8px rgba(243, 18, 96, 0.3);
}

.btn-danger:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(243, 18, 96, 0.4);
}

/* 警告按钮 */
.btn-warning {
  background: linear-gradient(135deg, #f5a524, #f59e0b);
  color: white;
  box-shadow: 0 2px 8px rgba(245, 165, 36, 0.3);
}

.btn-warning:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(245, 165, 36, 0.4);
}

/* 轮廓按钮 */
.btn-outline {
  background: transparent;
  color: #667eea;
  border: 2px solid #667eea;
}

.btn-outline:hover:not(:disabled) {
  background: #667eea;
  color: white;
  transform: translateY(-1px);
}

/* 按钮尺寸 */
.btn-sm {
  padding: 8px 16px;
  font-size: 12px;
  min-height: 36px;
  min-width: 80px;
}

.btn-lg {
  padding: 16px 32px;
  font-size: 16px;
  min-height: 52px;
  min-width: 160px;
}

/* 圆形按钮 */
.btn-round {
  border-radius: 50px;
}

/* 加载状态 */
.btn-loading {
  position: relative;
  color: transparent;
}

.btn-loading::after {
  content: '';
  position: absolute;
  width: 16px;
  height: 16px;
  border: 2px solid transparent;
  border-top: 2px solid currentColor;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
}

/* 按钮组 */
.btn-group {
  display: inline-flex;
  gap: 1px;
}

.btn-group .btn {
  border-radius: 0;
  min-width: auto;
}

.btn-group .btn:first-child {
  border-top-left-radius: 8px;
  border-bottom-left-radius: 8px;
}

.btn-group .btn:last-child {
  border-top-right-radius: 8px;
  border-bottom-right-radius: 8px;
}

.btn-text,
.btn-loading-text {
  display: inline-block;
}
</style>
