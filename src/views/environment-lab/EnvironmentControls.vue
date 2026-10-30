<script setup lang="ts">
import { computed, ref } from 'vue'
import { environmentPresets } from '../../environment'
import type { SceneConfiguration } from './configuration'
import type { DemoScene } from './landscape'

type Group =
  | 'environment'
  | 'shadows'
  | 'water'
  | 'quality'
  | 'source'
  | 'presentation'
type Field = {
  key: string
  label: string
  min?: number
  max?: number
  step?: number
  unit?: string
}

const props = defineProps<{
  modelValue: SceneConfiguration
  scene: DemoScene
  sourceKind: 'terrain' | 'tileset' | null
  waterAvailable: boolean
  screen: boolean
  copied: boolean
  error: string
}>()
const emit = defineEmits<{
  'update:modelValue': [value: SceneConfiguration]
  weather: [value: SceneConfiguration['weather']]
  view: [value: SceneConfiguration['view']]
  reset: []
  loadModel: []
  restoreSource: []
  export: []
  import: [value: string]
  share: []
}>()
const fileInput = ref<HTMLInputElement>()

function cloneConfig<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const environmentFields: Field[] = [
  { key: 'exposure', label: '画面曝光', min: 0.25, max: 2.5, step: 0.01 },
  { key: 'fog', label: '远景空气感', min: 0, max: 1, step: 0.01, unit: '%' },
  {
    key: 'skyRotation',
    label: '天空旋转',
    min: -180,
    max: 180,
    step: 1,
    unit: '°',
  },
  { key: 'rain', label: '雨量', min: 0, max: 1, step: 0.01, unit: '%' },
  { key: 'skyIntensity', label: '天空亮度', min: 0, max: 3, step: 0.01 },
  { key: 'sunIntensity', label: '太阳强度', min: 0, max: 8, step: 0.01 },
  {
    key: 'sunHeading',
    label: '太阳方位',
    min: 0,
    max: 360,
    step: 1,
    unit: '°',
  },
  {
    key: 'sunElevation',
    label: '太阳高度角',
    min: 1,
    max: 89,
    step: 1,
    unit: '°',
  },
  {
    key: 'diffuseIntensity',
    label: '漫反射环境光',
    min: 0,
    max: 1,
    step: 0.01,
  },
  { key: 'specularIntensity', label: '镜面环境光', min: 0, max: 1, step: 0.01 },
  { key: 'fogBrightness', label: '雾亮度', min: 0, max: 1, step: 0.01 },
  { key: 'rainSpeed', label: '雨速', min: 0, max: 4, step: 0.01 },
  { key: 'rainAngle', label: '雨倾角', min: -45, max: 45, step: 1, unit: '°' },
  { key: 'rainLength', label: '雨丝长度', min: 0.25, max: 3, step: 0.01 },
]
const visibleEnvironmentFields = computed(() =>
  environmentFields.filter(
    (field) =>
      props.scene === 'city' ||
      !['diffuseIntensity', 'specularIntensity'].includes(field.key),
  ),
)
const shadowFields: Field[] = [
  {
    key: 'distance',
    label: '阴影距离',
    min: 200,
    max: 10000,
    step: 50,
    unit: 'm',
  },
  { key: 'darkness', label: '阴影亮度', min: 0, max: 1, step: 0.01, unit: '%' },
  {
    key: 'depthBias',
    label: '深度偏移',
    min: 0.000001,
    max: 0.003,
    step: 0.000001,
  },
  { key: 'normalOffset', label: '法线偏移', min: 0, max: 3, step: 0.01 },
]
const waterFields: Field[] = [
  { key: 'level', label: '水位', min: -2, max: 42, step: 0.1, unit: 'm' },
  { key: 'waveStrength', label: '波浪强度', min: 0, max: 4, step: 0.01 },
  { key: 'waveScale', label: '波纹尺度', min: 0.25, max: 4, step: 0.01 },
  { key: 'waveSpeed', label: '波浪速度', min: 0, max: 4, step: 0.01 },
  {
    key: 'reflection',
    label: '反射强度',
    min: 0,
    max: 1,
    step: 0.01,
    unit: '%',
  },
  { key: 'flow', label: '水流强度', min: 0, max: 1, step: 0.01, unit: '%' },
]
const visibleWaterFields = computed(() =>
  waterFields.map((field) =>
    field.key === 'level' && props.scene !== 'city'
      ? { ...field, label: '水位偏移', min: 0, max: 20 }
      : field,
  ),
)
const qualityFields: Field[] = [
  { key: 'resolutionScale', label: '绘制比例', min: 0.5, max: 1, step: 0.01 },
  { key: 'terrainError', label: '地形细节', min: 1, max: 16, step: 0.5 },
  { key: 'tilesetError', label: '模型细节', min: 2, max: 64, step: 1 },
  {
    key: 'cacheMB',
    label: '模型缓存',
    min: 32,
    max: 512,
    step: 16,
    unit: 'MB',
  },
]
const presentationFields: Field[] = [
  {
    key: 'maskOpacity',
    label: '遮罩强度',
    min: 0,
    max: 1,
    step: 0.01,
    unit: '%',
  },
  {
    key: 'vignette',
    label: '边缘暗角',
    min: 0,
    max: 0.7,
    step: 0.01,
    unit: '%',
  },
]
const visibleQualityFields = computed(() =>
  qualityFields.filter((field) => {
    if (field.key === 'terrainError') return props.scene !== 'city'
    if (field.key === 'tilesetError' || field.key === 'cacheMB')
      return props.sourceKind === 'tileset'
    return true
  }),
)
const treeModes = [
  { value: 'off', label: '关闭' },
  { value: 'cast', label: '只投射' },
  { value: 'both', label: '投射并接收' },
] as const
const environmentShadows = computed(() => props.modelValue.environment.shadows)

function value(group: Group, key: string): unknown {
  return (props.modelValue[group] as unknown as Record<string, unknown>)[key]
}
function update(group: Group, key: string, nextValue: unknown): void {
  const next = cloneConfig(props.modelValue)
  ;(next[group] as unknown as Record<string, unknown>)[key] = nextValue
  emit('update:modelValue', next)
}
function updateNumber(group: Group, key: string, event: Event): void {
  update(group, key, Number((event.target as HTMLInputElement).value))
}
function formatted(group: Group, field: Field): string {
  const current = Number(value(group, field.key))
  return field.unit === '%'
    ? `${Math.round(current * 100)}%`
    : `${current}${field.unit ?? ''}`
}
function applyCityRenderingLook(): void {
  const next = cloneConfig(props.modelValue)
  next.environment.modelLighting = 'studio'
  next.environment.diffuseIntensity = 0.8
  next.environment.specularIntensity = 0.8
  next.environment.tonemapper = 'neutral'
  if (next.weather === 'day') next.environment.sunIntensity = 1.8
  next.shadows.buildingShadows = 'cast'
  emit('update:modelValue', next)
}

function chooseFile(): void {
  fileInput.value?.click()
}
async function importFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    emit('import', await file.text())
  } finally {
    input.value = ''
  }
}
</script>

<template>
  <div class="controls">
    <div class="controls__heading">
      <div>
        <p class="eyebrow">LIGHT / WEATHER / QUALITY</p>
        <h2>场景效果配置</h2>
      </div>
      <span class="ready-dot" aria-label="场景就绪"></span>
    </div>

    <details open class="group">
      <summary>天空与光照</summary>
      <div class="weather">
        <button
          v-for="(preset, id) in environmentPresets"
          :key="id"
          :aria-pressed="modelValue.weather === id"
          @click="emit('weather', id)"
        >
          {{ preset.name }}
        </button>
      </div>
      <label
        v-for="field in visibleEnvironmentFields"
        :key="field.key"
        class="range-row"
      >
        <span
          >{{ field.label
          }}<output>{{ formatted('environment', field) }}</output></span
        >
        <input
          type="range"
          :min="field.min"
          :max="field.max"
          :step="field.step"
          :value="value('environment', field.key)"
          :disabled="
            field.key === 'sunHeading' || field.key === 'sunElevation'
              ? Boolean(value('environment', 'sunAuto'))
              : false
          "
          :aria-label="field.label"
          @input="updateNumber('environment', field.key, $event)"
        />
      </label>
      <label class="check-row"
        ><input
          type="checkbox"
          :checked="Boolean(value('environment', 'sunAuto'))"
          @change="
            update(
              'environment',
              'sunAuto',
              ($event.target as HTMLInputElement).checked,
            )
          "
        />太阳自动跟随场景</label
      >
      <label class="color-row"
        >太阳颜色<input
          type="color"
          :value="value('environment', 'sunColor')"
          @input="
            update(
              'environment',
              'sunColor',
              ($event.target as HTMLInputElement).value,
            )
          "
      /></label>
      <label v-if="scene === 'city'" class="select-row"
        >模型环境光<select
          :value="value('environment', 'modelLighting')"
          aria-label="模型环境光"
          @change="
            update(
              'environment',
              'modelLighting',
              ($event.target as HTMLSelectElement).value,
            )
          "
        >
          <option value="weather">天空环境光</option>
          <option value="studio">城市展示补光</option>
        </select></label
      >
      <button
        v-if="scene === 'city'"
        class="action"
        @click="applyCityRenderingLook"
      >
        采用城市展示光照
      </button>
      <p v-if="scene === 'city'" class="note">
        复用城市渲染页的模型补光；天空与水面继续使用当前天气。
      </p>
      <label class="check-row"
        ><input
          type="checkbox"
          :checked="Boolean(value('environment', 'hdr'))"
          @change="
            update(
              'environment',
              'hdr',
              ($event.target as HTMLInputElement).checked,
            )
          "
        />HDR 环境光</label
      >
      <label class="select-row"
        >色调映射<select
          :value="value('environment', 'tonemapper')"
          @change="
            update(
              'environment',
              'tonemapper',
              ($event.target as HTMLSelectElement).value,
            )
          "
        >
          <option value="aces">ACES</option>
          <option value="neutral">Neutral</option>
          <option value="reinhard">Reinhard</option>
        </select></label
      >
      <label class="check-row"
        ><input
          type="checkbox"
          :checked="environmentShadows"
          @change="
            update(
              'environment',
              'shadows',
              ($event.target as HTMLInputElement).checked,
            )
          "
        />启用环境阴影</label
      >
    </details>

    <details open class="group">
      <summary>阴影</summary>
      <label class="select-row"
        >贴图尺寸<select
          :value="value('shadows', 'size')"
          @change="
            update(
              'shadows',
              'size',
              Number(($event.target as HTMLSelectElement).value),
            )
          "
        >
          <option :value="1024">1024</option>
          <option :value="2048">2048</option>
          <option :value="4096">4096</option>
        </select></label
      >
      <label v-for="field in shadowFields" :key="field.key" class="range-row"
        ><span
          >{{ field.label
          }}<output>{{ formatted('shadows', field) }}</output></span
        ><input
          type="range"
          :min="field.min"
          :max="field.max"
          :step="field.step"
          :value="value('shadows', field.key)"
          :aria-label="field.label"
          @input="updateNumber('shadows', field.key, $event)"
      /></label>
      <label class="check-row"
        ><input
          type="checkbox"
          :checked="Boolean(value('shadows', 'soft'))"
          @change="
            update(
              'shadows',
              'soft',
              ($event.target as HTMLInputElement).checked,
            )
          "
        />柔和阴影</label
      >
      <label v-if="scene === 'city'" class="check-row"
        ><input
          type="checkbox"
          :checked="value('shadows', 'buildingShadows') === 'both'"
          aria-label="建筑接收自阴影"
          @change="
            update(
              'shadows',
              'buildingShadows',
              ($event.target as HTMLInputElement).checked ? 'both' : 'cast',
            )
          "
        />建筑接收自阴影</label
      >
      <label v-if="scene === 'city'" class="check-row"
        ><input
          type="checkbox"
          :checked="Boolean(value('shadows', 'backgroundReceives'))"
          @change="
            update(
              'shadows',
              'backgroundReceives',
              ($event.target as HTMLInputElement).checked,
            )
          "
        />背景接收阴影</label
      >
      <label v-if="scene === 'city'" class="select-row"
        >树木阴影<select
          :value="value('shadows', 'treeShadows')"
          @change="
            update(
              'shadows',
              'treeShadows',
              ($event.target as HTMLSelectElement).value,
            )
          "
        >
          <option
            v-for="mode in treeModes"
            :key="mode.value"
            :value="mode.value"
          >
            {{ mode.label }}
          </option>
        </select></label
      >
    </details>

    <details open class="group">
      <summary>水面</summary>
      <label class="check-row"
        ><input
          type="checkbox"
          :checked="Boolean(value('water', 'visible'))"
          @change="
            update(
              'water',
              'visible',
              ($event.target as HTMLInputElement).checked,
            )
          "
        />显示水面</label
      >
      <label
        v-for="field in visibleWaterFields"
        :key="field.key"
        class="range-row"
        ><span
          >{{ field.label
          }}<output>{{ formatted('water', field) }}</output></span
        ><input
          type="range"
          :min="field.min"
          :max="field.max"
          :step="field.step"
          :value="value('water', field.key)"
          :disabled="
            field.key === 'level' && scene !== 'city' && !waterAvailable
          "
          :aria-label="field.key === 'level' ? '演示水位' : field.label"
          @input="updateNumber('water', field.key, $event)"
      /></label>
      <label class="color-row"
        >水面颜色<input
          type="color"
          :value="value('water', 'color')"
          @input="
            update('water', 'color', ($event.target as HTMLInputElement).value)
          "
      /></label>
      <label class="check-row"
        ><input
          type="checkbox"
          :checked="Boolean(value('water', 'receiveShadows'))"
          @change="
            update(
              'water',
              'receiveShadows',
              ($event.target as HTMLInputElement).checked,
            )
          "
        />水面接收阴影</label
      >
    </details>

    <details open class="group">
      <summary>画质与细节</summary>
      <label
        v-for="field in visibleQualityFields"
        :key="field.key"
        class="range-row"
        ><span
          >{{ field.label
          }}<output>{{ formatted('quality', field) }}</output></span
        ><input
          type="range"
          :min="field.min"
          :max="field.max"
          :step="field.step"
          :value="value('quality', field.key)"
          :aria-label="field.label"
          @input="updateNumber('quality', field.key, $event)"
      /></label>
      <label class="select-row"
        >目标像素预算<select
          :value="value('quality', 'pixelBudget')"
          @change="
            update(
              'quality',
              'pixelBudget',
              ($event.target as HTMLSelectElement).value,
            )
          "
        >
          <option value="720">720p</option>
          <option value="1080">1080p</option>
          <option value="1440">1440p</option>
        </select></label
      >
      <label class="check-row"
        ><input
          type="checkbox"
          :checked="Boolean(value('quality', 'fxaa'))"
          @change="
            update(
              'quality',
              'fxaa',
              ($event.target as HTMLInputElement).checked,
            )
          "
        />抗锯齿</label
      >
    </details>

    <details v-if="scene !== 'city'" open class="group">
      <summary>真实数据与模型</summary>
      <label class="text-row"
        >Tileset URL<input
          :value="value('source', 'modelUrl')"
          type="url"
          placeholder="https://…/tileset.json"
          @change="
            update(
              'source',
              'modelUrl',
              ($event.target as HTMLInputElement).value,
            )
          "
      /></label>
      <button class="action" @click="emit('loadModel')">应用模型地址</button>
      <button class="action" @click="emit('restoreSource')">
        恢复公开实景示例
      </button>
      <template v-if="sourceKind === 'tileset'">
        <label class="range-row"
          ><span
            >模型高度偏移<output
              >{{ value('source', 'modelHeightOffset') }} m</output
            ></span
          ><input
            type="range"
            min="-200"
            max="200"
            step="1"
            :value="value('source', 'modelHeightOffset')"
            @input="updateNumber('source', 'modelHeightOffset', $event)"
        /></label>
        <label class="select-row"
          >模型阴影<select
            :value="value('source', 'modelShadows')"
            @change="
              update(
                'source',
                'modelShadows',
                ($event.target as HTMLSelectElement).value,
              )
            "
          >
            <option value="off">关闭</option>
            <option value="cast">只投射</option>
            <option value="both">投射并接收</option>
          </select></label
        >
      </template>
      <label
        v-for="field in [
          {
            key: 'imageryBrightness',
            label: '影像亮度',
            min: 0.2,
            max: 2,
            step: 0.01,
          },
          {
            key: 'imagerySaturation',
            label: '影像饱和度',
            min: 0,
            max: 2,
            step: 0.01,
          },
          {
            key: 'imageryContrast',
            label: '影像对比度',
            min: 0.2,
            max: 2,
            step: 0.01,
          },
        ] as Field[]"
        :key="field.key"
        class="range-row"
        ><span
          >{{ field.label
          }}<output>{{
            Number(value('source', field.key)).toFixed(2)
          }}</output></span
        ><input
          type="range"
          :min="field.min"
          :max="field.max"
          :step="field.step"
          :value="value('source', field.key)"
          @input="updateNumber('source', field.key, $event)"
      /></label>
      <label class="check-row"
        ><input
          type="checkbox"
          :checked="Boolean(value('source', 'terrainLighting'))"
          @change="
            update(
              'source',
              'terrainLighting',
              ($event.target as HTMLInputElement).checked,
            )
          "
        />地形受光照</label
      >
      <label class="check-row"
        ><input
          type="checkbox"
          :checked="Boolean(value('source', 'terrainShadows'))"
          @change="
            update(
              'source',
              'terrainShadows',
              ($event.target as HTMLInputElement).checked,
            )
          "
        />地形接收阴影</label
      >
      <p v-if="error" class="error">{{ error }}</p>
    </details>

    <details class="group">
      <summary>大屏构图</summary>
      <label
        v-for="field in presentationFields"
        :key="field.key"
        class="range-row"
        ><span
          >{{ field.label
          }}<output>{{ formatted('presentation', field) }}</output></span
        ><input
          type="range"
          :min="field.min"
          :max="field.max"
          :step="field.step"
          :value="value('presentation', field.key)"
          @input="updateNumber('presentation', field.key, $event)"
      /></label>
      <label class="check-row"
        ><input
          type="checkbox"
          :checked="Boolean(value('presentation', 'showLabels'))"
          @change="
            update(
              'presentation',
              'showLabels',
              ($event.target as HTMLInputElement).checked,
            )
          "
        />显示场景标签</label
      >
    </details>

    <details class="group">
      <summary>机位与配置文件</summary>
      <div class="actions">
        <button
          v-for="(label, id) in {
            overview: '总览',
            near: '近景',
            low: '低空',
          } as const"
          :key="id"
          :aria-pressed="modelValue.view === id"
          @click="emit('view', id)"
        >
          {{ label }}
        </button>
      </div>
      <div class="actions">
        <button @click="emit('reset')">重置本场景</button
        ><button @click="emit('export')">导出 JSON</button
        ><button @click="chooseFile">导入 JSON</button>
      </div>
      <input
        ref="fileInput"
        class="visually-hidden"
        type="file"
        accept="application/json,.json"
        @change="importFile"
      />
      <button class="share" @click="emit('share')">
        {{ copied ? '链接已复制' : '复制完整场景链接' }}　↗
      </button>
      <p class="note">
        {{ screen ? '大屏构图已启用' : '每个场景独立保存设置' }}
      </p>
    </details>
  </div>
</template>

<style scoped>
.controls {
  color: #edf1e9;
}
.controls__heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.eyebrow {
  margin: 0 0 6px;
  color: #adbbb5;
  font-size: 9px;
  letter-spacing: 0.18em;
}
.controls h2 {
  font-size: 17px;
  font-weight: 500;
  margin: 0;
}
.ready-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #a8cbb5;
}
.group {
  border-top: 1px solid #ffffff20;
  padding: 13px 0;
}
.group summary {
  cursor: pointer;
  list-style: none;
  font-size: 13px;
  color: #f0d6a7;
}
.group summary::-webkit-details-marker {
  display: none;
}
.group summary:after {
  content: '＋';
  float: right;
  color: #aebcba;
}
.group[open] summary {
  margin-bottom: 13px;
}
.group[open] summary:after {
  content: '−';
}
.weather,
.actions {
  display: flex;
  gap: 6px;
  margin: 8px 0 14px;
}
.weather button,
.actions button,
.action {
  flex: 1;
  padding: 8px 5px;
  border: 1px solid #ffffff20;
  border-radius: 5px;
  background: #ffffff08;
  color: inherit;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.weather button[aria-pressed='true'],
.actions button[aria-pressed='true'] {
  background: #e6dfca;
  color: #253438;
}
.range-row {
  display: block;
  margin: 12px 0;
}
.range-row > span {
  display: flex;
  justify-content: space-between;
  color: #cad4cf;
  font-size: 11px;
}
.range-row output {
  color: #d8c29d;
  font-variant-numeric: tabular-nums;
}
.range-row input {
  display: block;
  width: 100%;
  margin: 7px 0 0;
  accent-color: #d4b47f;
}
.check-row,
.color-row,
.select-row,
.text-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 10px 0;
  color: #cad4cf;
  font-size: 11px;
}
.check-row input {
  accent-color: #d4b47f;
}
.color-row input {
  width: 46px;
  height: 26px;
  border: 0;
  background: transparent;
}
.select-row select,
.text-row input {
  max-width: 58%;
  padding: 7px;
  border: 1px solid #ffffff30;
  border-radius: 4px;
  background: #10232b;
  color: #edf1e9;
}
.text-row {
  align-items: flex-start;
  flex-direction: column;
}
.text-row input {
  box-sizing: border-box;
  width: 100%;
  max-width: none;
}
.action {
  width: 100%;
  margin: 3px 0 9px;
}
.share {
  width: 100%;
  padding: 12px 0;
  border: 0;
  border-top: 1px solid #ffffff20;
  background: transparent;
  color: #e8d5b3;
  text-align: left;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.note,
.error {
  font-size: 10px;
  line-height: 1.7;
  color: #9eafaf;
}
.error {
  color: #ffc6a9;
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}
</style>
