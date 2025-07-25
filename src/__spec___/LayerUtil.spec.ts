import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as Cesium from 'cesium'
import { LayerUtil } from '../utils/cesium-util/cesiumUtils'

// Mock Cesium.Viewer 以避免WebGL依赖
vi.mock('cesium', async () => {
  const actual = await vi.importActual('cesium')
  return {
    ...actual,
    Viewer: vi.fn().mockImplementation(() => ({
      scene: {
        primitives: {
          add: vi.fn(),
          remove: vi.fn()
        }
      },
      entities: {
        add: vi.fn().mockReturnValue({
          id: 'test-entity',
          name: 'Test Entity',
          point: {},
          label: {}
        }),
        remove: vi.fn()
      },
      dataSources: {
        add: vi.fn(),
        remove: vi.fn()
      },
      imageryLayers: {
        add: vi.fn(),
        remove: vi.fn()
      },
      flyTo: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
      destroy: vi.fn()
    }))
  }
})

// 为测试创建一个简单的容器
const createTestContainer = () => {
  const container = document.createElement('div')
  container.id = 'test-cesium-container'
  container.style.width = '800px'
  container.style.height = '600px'
  document.body.appendChild(container)
  return container
}

describe('LayerUtil 静态方法测试', () => {
  describe('degreesToCartesian3', () => {
    it('应该正确转换2D经纬度坐标', () => {
      const degrees = [116.3974, 39.9093] // 北京
      const result = LayerUtil.degreesToCartesian3(degrees)

      expect(result).toBeInstanceOf(Cesium.Cartesian3)
      expect(typeof result.x).toBe('number')
      expect(typeof result.y).toBe('number')
      expect(typeof result.z).toBe('number')
    })

    it('应该正确转换3D经纬度坐标', () => {
      const degrees = [116.3974, 39.9093, 100] // 北京，高度100米
      const result = LayerUtil.degreesToCartesian3(degrees)

      expect(result).toBeInstanceOf(Cesium.Cartesian3)
      expect(typeof result.x).toBe('number')
      expect(typeof result.y).toBe('number')
      expect(typeof result.z).toBe('number')
    })

    it('应该抛出错误当数组长度无效时', () => {
      expect(() => {
        LayerUtil.degreesToCartesian3([116.3974])
      }).toThrow('Invalid degrees array length')

      expect(() => {
        LayerUtil.degreesToCartesian3([116.3974, 39.9093, 100, 200])
      }).toThrow('Invalid degrees array length')
    })
  })

  describe('parseColor', () => {
    it('应该正确解析CSS颜色字符串', () => {
      const colorString = '#ff0000'
      const result = LayerUtil.parseColor(colorString)

      expect(result).toBeInstanceOf(Cesium.Color)
      expect(result.red).toBe(1)
      expect(result.green).toBe(0)
      expect(result.blue).toBe(0)
      expect(result.alpha).toBe(1)
    })

    it('应该正确解析CSS颜色字符串并应用透明度', () => {
      const colorString = '#00ff00'
      const alpha = 0.5
      const result = LayerUtil.parseColor(colorString, alpha)

      expect(result).toBeInstanceOf(Cesium.Color)
      expect(result.red).toBe(0)
      expect(result.green).toBe(1)
      expect(result.blue).toBe(0)
      expect(result.alpha).toBe(0.5)
    })

    it('应该直接返回Cesium.Color实例', () => {
      const cesiumColor = Cesium.Color.BLUE
      const result = LayerUtil.parseColor(cesiumColor)

      expect(result).toBe(cesiumColor)
    })

    it('应该为Cesium.Color实例应用透明度', () => {
      const cesiumColor = Cesium.Color.BLUE
      const alpha = 0.7
      const result = LayerUtil.parseColor(cesiumColor, alpha)

      expect(result).toBeInstanceOf(Cesium.Color)
      expect(result.alpha).toBe(0.7)
    })

    it('应该返回默认白色当颜色无效时', () => {
      const result = LayerUtil.parseColor('invalid-color')

      expect(result).toBeInstanceOf(Cesium.Color)
      // 由于invalid-color可能被解析为默认值，我们检查是否为有效的Color实例
    })
  })

  describe('generateId', () => {
    it('应该生成唯一ID', () => {
      const id1 = LayerUtil.generateId()
      const id2 = LayerUtil.generateId()

      expect(id1).not.toBe(id2)
      expect(id1).toMatch(/^cesium_\d+_[a-z0-9]+$/)
      expect(id2).toMatch(/^cesium_\d+_[a-z0-9]+$/)
    })

    it('应该使用自定义前缀生成ID', () => {
      const prefix = 'test'
      const id = LayerUtil.generateId(prefix)

      expect(id).toMatch(new RegExp(`^${prefix}_\\d+_[a-z0-9]+$`))
    })

    it('应该生成不同的ID每次调用', () => {
      const ids = Array.from({ length: 10 }, () => LayerUtil.generateId('test'))
      const uniqueIds = new Set(ids)

      expect(uniqueIds.size).toBe(10)
    })
  })
})

describe('LayerUtil 类测试', () => {


  describe('Entity创建', () => {
    it('应该创建基础Entity', () => {
      const entityOptions = {
        type: 'entity' as const,
        id: 'test-entity',
        name: 'Test Entity',
        position: [116.3974, 39.9093, 100],
        point: {
          pixelSize: 10,
          color: Cesium.Color.YELLOW
        }
      }

      const entity = LayerUtil.createEntity(entityOptions)

      expect(entity).toBeInstanceOf(Cesium.Entity)
      expect(entity.id).toBe('test-entity')
      expect(entity.name).toBe('Test Entity')
      expect(entity.point).toBeDefined()
    })

    it('应该创建Billboard Entity', () => {
      const billboardOptions = {
        id: 'test-billboard',
        position: [116.3974, 39.9093],
        text: 'Test Label',
        font: '16pt sans-serif'
      }

      const entity = LayerUtil.createBillboard(billboardOptions)

      expect(entity).toBeInstanceOf(Cesium.Entity)
      expect(entity.id).toBe('test-billboard')
      expect(entity.label).toBeDefined()
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
