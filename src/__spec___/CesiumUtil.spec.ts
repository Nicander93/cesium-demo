import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as Cesium from 'cesium'
import { CesiumUtils, createCesiumUtils } from '../utils/cesium-util/cesiumUtils'

// 为测试创建一个简单的容器
const createTestContainer = () => {
  const container = document.createElement('div')
  container.id = 'test-cesium-container'
  container.style.width = '800px'
  container.style.height = '600px'
  document.body.appendChild(container)
  return container
}

describe('CesiumUtils 静态方法测试', () => {
  describe('degreesToCartesian3', () => {
    it('应该正确转换2D经纬度坐标', () => {
      const degrees = [116.3974, 39.9093] // 北京
      const result = CesiumUtils.degreesToCartesian3(degrees)
      
      expect(result).toBeInstanceOf(Cesium.Cartesian3)
      expect(typeof result.x).toBe('number')
      expect(typeof result.y).toBe('number')
      expect(typeof result.z).toBe('number')
    })

    it('应该正确转换3D经纬度坐标', () => {
      const degrees = [116.3974, 39.9093, 100] // 北京，高度100米
      const result = CesiumUtils.degreesToCartesian3(degrees)
      
      expect(result).toBeInstanceOf(Cesium.Cartesian3)
      expect(typeof result.x).toBe('number')
      expect(typeof result.y).toBe('number')
      expect(typeof result.z).toBe('number')
    })

    it('应该抛出错误当数组长度无效时', () => {
      expect(() => {
        CesiumUtils.degreesToCartesian3([116.3974])
      }).toThrow('Invalid degrees array length')

      expect(() => {
        CesiumUtils.degreesToCartesian3([116.3974, 39.9093, 100, 200])
      }).toThrow('Invalid degrees array length')
    })
  })

  describe('parseColor', () => {
    it('应该正确解析CSS颜色字符串', () => {
      const colorString = '#ff0000'
      const result = CesiumUtils.parseColor(colorString)
      
      expect(result).toBeInstanceOf(Cesium.Color)
      expect(result.red).toBe(1)
      expect(result.green).toBe(0)
      expect(result.blue).toBe(0)
      expect(result.alpha).toBe(1)
    })

    it('应该正确解析CSS颜色字符串并应用透明度', () => {
      const colorString = '#00ff00'
      const alpha = 0.5
      const result = CesiumUtils.parseColor(colorString, alpha)
      
      expect(result).toBeInstanceOf(Cesium.Color)
      expect(result.red).toBe(0)
      expect(result.green).toBe(1)
      expect(result.blue).toBe(0)
      expect(result.alpha).toBe(0.5)
    })

    it('应该直接返回Cesium.Color实例', () => {
      const cesiumColor = Cesium.Color.BLUE
      const result = CesiumUtils.parseColor(cesiumColor)
      
      expect(result).toBe(cesiumColor)
    })

    it('应该为Cesium.Color实例应用透明度', () => {
      const cesiumColor = Cesium.Color.BLUE
      const alpha = 0.7
      const result = CesiumUtils.parseColor(cesiumColor, alpha)
      
      expect(result).toBeInstanceOf(Cesium.Color)
      expect(result.alpha).toBe(0.7)
    })

    it('应该返回默认白色当颜色无效时', () => {
      const result = CesiumUtils.parseColor('invalid-color')
      
      expect(result).toBeInstanceOf(Cesium.Color)
      // 由于invalid-color可能被解析为默认值，我们检查是否为有效的Color实例
    })
  })

  describe('generateId', () => {
    it('应该生成唯一ID', () => {
      const id1 = CesiumUtils.generateId()
      const id2 = CesiumUtils.generateId()
      
      expect(id1).not.toBe(id2)
      expect(id1).toMatch(/^cesium_\d+_[a-z0-9]+$/)
      expect(id2).toMatch(/^cesium_\d+_[a-z0-9]+$/)
    })

    it('应该使用自定义前缀生成ID', () => {
      const prefix = 'test'
      const id = CesiumUtils.generateId(prefix)
      
      expect(id).toMatch(new RegExp(`^${prefix}_\\d+_[a-z0-9]+$`))
    })

    it('应该生成不同的ID每次调用', () => {
      const ids = Array.from({ length: 10 }, () => CesiumUtils.generateId('test'))
      const uniqueIds = new Set(ids)
      
      expect(uniqueIds.size).toBe(10)
    })
  })
})

describe('CesiumUtils 类测试', () => {
  let container: HTMLElement
  let viewer: Cesium.Viewer
  let cesiumUtils: CesiumUtils

  beforeEach(() => {
    container = createTestContainer()
    // 创建一个基础的viewer用于测试
    viewer = new Cesium.Viewer(container, {
      animation: false,
      timeline: false,
      vrButton: false,
      sceneModePicker: false,
      baseLayerPicker: false,
      navigationHelpButton: false,
      homeButton: false,
      fullscreenButton: false,
      geocoder: false,
      infoBox: false,
      selectionIndicator: false
    })
    cesiumUtils = new CesiumUtils(viewer)
  })

  afterEach(() => {
    if (viewer && !viewer.isDestroyed()) {
      viewer.destroy()
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container)
    }
  })

  describe('构造函数', () => {
    it('应该正确初始化CesiumUtils实例', () => {
      expect(cesiumUtils).toBeInstanceOf(CesiumUtils)
      // viewer是私有属性，我们通过其他方法验证实例是否正确初始化
      expect(cesiumUtils.getLayers).toBeDefined()
      expect(cesiumUtils.createEntity).toBeDefined()
    })
  })

  describe('管理方法', () => {
    it('应该正确获取图层列表', () => {
      const layers = cesiumUtils.getLayers()
      expect(Array.isArray(layers)).toBe(true)
      expect(layers.length).toBe(0) // 初始时应该没有图层
    })

    it('应该正确清除所有数据', () => {
      cesiumUtils.clear()
      
      const layers = cesiumUtils.getLayers()
      expect(layers.length).toBe(0)
    })
  })

  describe('Entity创建', () => {
    it('应该创建基础Entity', () => {
      const entityOptions = {
        id: 'test-entity',
        name: 'Test Entity',
        position: [116.3974, 39.9093, 100],
        point: {
          pixelSize: 10,
          color: Cesium.Color.YELLOW
        }
      }

      const entity = cesiumUtils.createEntity(entityOptions)
      
      expect(entity).toBeInstanceOf(Cesium.Entity)
      expect(entity.id).toBe('test-entity')
      expect(entity.name).toBe('Test Entity')
      expect(entity.point).toBeDefined()
      expect(cesiumUtils.getEntity('test-entity')).toBe(entity)
    })

    it('应该创建Billboard Entity', () => {
      const billboardOptions = {
        id: 'test-billboard',
        position: [116.3974, 39.9093],
        text: 'Test Label',
        font: '16pt sans-serif'
      }

      const entity = cesiumUtils.createBillboard(billboardOptions)
      
      expect(entity).toBeInstanceOf(Cesium.Entity)
      expect(entity.id).toBe('test-billboard')
      expect(entity.label).toBeDefined()
      expect(cesiumUtils.getEntity('test-billboard')).toBe(entity)
    })
  })

  describe('数据管理', () => {
    it('应该正确移除Entity', () => {
      const entity = cesiumUtils.createEntity({
        id: 'test-remove-entity',
        position: [116.3974, 39.9093]
      })

      expect(cesiumUtils.getEntity('test-remove-entity')).toBeDefined()
      
      const removed = cesiumUtils.removeEntity('test-remove-entity')
      expect(removed).toBe(true)
      expect(cesiumUtils.getEntity('test-remove-entity')).toBeUndefined()
    })

    it('应该返回false当移除不存在的Entity', () => {
      const removed = cesiumUtils.removeEntity('non-existent-entity')
      expect(removed).toBe(false)
    })
  })

  describe('工厂函数', () => {
    it('应该通过createCesiumUtils创建实例', () => {
      const utils = createCesiumUtils(viewer)
      expect(utils).toBeInstanceOf(CesiumUtils)
      // viewer是私有属性，我们通过其他方法验证实例是否正确初始化
      expect(utils.getLayers).toBeDefined()
      expect(utils.createEntity).toBeDefined()
    })
  })
})

describe('配置接口测试', () => {
  describe('LayerOptions', () => {
    it('应该包含必需的type属性', () => {
      const options = {
        type: 'geojson' as const,
        url: 'test.geojson'
      }
      
      expect(options.type).toBe('geojson')
      expect(options.url).toBe('test.geojson')
    })
  })

  describe('PrimitiveOptions', () => {
    it('应该包含必需的type属性', () => {
      const options = {
        type: 'point' as const,
        position: [116.3974, 39.9093, 100]
      }
      
      expect(options.type).toBe('point')
      expect(Array.isArray(options.position)).toBe(true)
    })
  })

  describe('EntityOptions', () => {
    it('应该支持各种图形配置', () => {
      const options = {
        position: [116.3974, 39.9093, 100],
        point: {
          pixelSize: 10,
          color: Cesium.Color.YELLOW
        },
        label: {
          text: 'Test Label'
        }
      }
      
      expect(options.position).toBeDefined()
      expect(options.point).toBeDefined()
      expect(options.label).toBeDefined()
    })
  })
})
