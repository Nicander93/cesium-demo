/**
 * Texture3D 类
 * 实现一个基于 WebGL 的 3D 纹理对象，用于体积渲染
 * 支持从数组缓冲区或帧缓冲区创建三维纹理
 */
import * as Cesium from 'cesium'

const Cartesian3 = Cesium.Cartesian3
const Check = Cesium.Check
const defaultValue = Cesium.defaultValue
const defined = Cesium.defined
const destroyObject = Cesium.destroyObject
const DeveloperError = Cesium.DeveloperError
const PixelFormat = Cesium.PixelFormat
const ContextLimits = Cesium.ContextLimits
const PixelDatatype = Cesium.PixelDatatype
const Sampler = Cesium.Sampler

/**
 * 3D纹理选项接口
 */
interface Texture3DOptions {
  /** WebGL上下文 */
  context: any
  /** 纹理宽度 */
  width: number
  /** 纹理高度 */
  height: number
  /** 纹理深度 */
  depth: number
  /** 纹理数据源 */
  source?: {
    /** 数组缓冲区视图 */
    arrayBufferView?: ArrayBufferView
    /** 帧缓冲区 */
    framebuffer?: any
    /** 源宽度 */
    width?: number
    /** 源高度 */
    height?: number
    /** 源深度 */
    depth?: number
  }
  /** 像素格式 */
  pixelFormat?: number
  /** 像素数据类型 */
  pixelDataType?: number
  /** 采样器对象 */
  sampler?: any
}

/**
 * 帧缓冲区选项接口
 */
interface FromFramebufferOptions {
  /** WebGL上下文 */
  context: any
  /** 像素格式 */
  pixelFormat?: number
  /** 帧缓冲区X偏移 */
  framebufferXOffset?: number
  /** 帧缓冲区Y偏移 */
  framebufferYOffset?: number
  /** 纹理宽度 */
  width?: number
  /** 纹理高度 */
  height?: number
  /** 纹理深度 */
  depth?: number
  /** 帧缓冲区 */
  framebuffer?: any
}

/**
 * 3D纹理类
 * 用于创建和管理WebGL 3D纹理，支持体积渲染应用
 */
class Texture3D {
  /** 纹理唯一标识符 */
  private _id: string
  /** WebGL上下文引用 */
  private _context: any
  /** 各向异性过滤扩展 */
  private _textureFilterAnisotropic: any
  /** WebGL纹理目标类型 */
  private _textureTarget: number
  /** WebGL纹理对象 */
  private _texture: WebGLTexture
  /** 内部格式 */
  private _internalFormat: number
  /** 像素格式 */
  private _pixelFormat: number
  /** 像素数据类型 */
  private _pixelDatatype: number
  /** 纹理宽度 */
  private _width: number
  /** 纹理高度 */
  private _height: number
  /** 纹理深度 */
  private _depth: number
  /** 纹理三维尺寸 */
  private _dimensions: Cesium.Cartesian3
  /** 是否包含mipmap */
  private _hasMinmap: boolean
  /** 纹理大小（字节） */
  private _sizeInBytes: number
  /** 是否预乘alpha通道 */
  private _preMultiplyAlpha: boolean
  /** 是否翻转Y轴 */
  private _flipY: boolean
  /** 是否已初始化 */
  private _initialized: boolean
  /** 采样器对象 */
  private _sampler: any

  /**
   * 创建一个新的3D纹理对象
   * @param options 纹理选项，包含尺寸、格式、数据源等信息
   */
  constructor(options: Texture3DOptions) {
    options = defaultValue(options, defaultValue.EMPTY_OBJECT)

    // 验证必需参数
    Check.defined('options.context', options.context)

    const context = options.context
    let width = options.width
    let height = options.height
    let depth = options.depth
    let source = options.source

    // 设置默认像素格式和数据类型
    const pixelFormat = defaultValue(options.pixelFormat, PixelFormat.RGBA)
    const pixelDatatype = defaultValue(
      options.pixelDataType,
      PixelDatatype.UNSIGNED_BYTE,
    )
    // 根据像素格式和数据类型确定内部格式
    const internalFormat = PixelFormat.toInternalFormat(
      pixelFormat,
      pixelDatatype,
      context,
    )

    // 验证尺寸参数
    if (!defined(width) || !defined(height) || !defined(depth)) {
      throw new DeveloperError(
        'options requires a source field to create an 3d texture. width or height or dimension fileds',
      )
    }

    // 验证宽度参数
    Check.typeOf.number.greaterThan('width', width, 0)
    if (width > ContextLimits.maximumTextureSize) {
      throw new DeveloperError(
        'width must be less than or equal to the maximum texture size',
      )
    }

    // 验证高度参数
    Check.typeOf.number.greaterThan('height', height, 0)
    if (height > ContextLimits.maximumTextureSize) {
      throw new DeveloperError(
        'height must be less than or equal to the maximum texture size',
      )
    }

    // 验证深度参数
    Check.typeOf.number.greaterThan('dimensions', depth, 0)
    if (depth > ContextLimits.maximumTextureSize) {
      throw new DeveloperError(
        'dimension must be less than or equal to the maximum texture size',
      )
    }

    // 验证像素格式和数据类型
    if (!PixelFormat.validate(pixelFormat)) {
      throw new DeveloperError('Invalid options.pixelFormat.')
    }
    if (!PixelDatatype.validate(pixelDatatype)) {
      throw new DeveloperError('Invalid options.pixelDatatype.')
    }

    // 初始化纹理
    let initialized = true
    const gl = context._gl
    const textureTarget = gl.TEXTURE_3D
    const texture = gl.createTexture() as WebGLTexture

    // 保存当前激活的纹理单元
    const lxs = gl.getParameter(gl.ACTIVE_TEXTURE)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(textureTarget, texture)
    
    // 设置像素存储参数
    let unpackAlignment = 4
    if (defined(source) && defined(source.arrayBufferView)) {
      // 根据像素格式计算对齐字节数
      unpackAlignment = PixelFormat.alignmentInBytes(
        pixelFormat,
        pixelDatatype,
        width,
      )
    }

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, unpackAlignment)
    gl.pixelStorei(
      gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,
      gl.BROWSER_DEFAULT_WEBGL,
    )

    // 注意：WebGL 中 3D 纹理不允许 UNPACK_FLIP_Y_WEBGL 和 UNPACK_PREMULTIPLY_ALPHA_WEBGL
    // 显式设置为 false 以避免 WebGL 错误
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)

    // 如果有数据源，则上传纹理数据
    if (defined(source)) {
      if (defined(source.arrayBufferView)) {
        let arrayBufferView = source.arrayBufferView
        // 使用texImage3D上传3D纹理数据
        gl.texImage3D(
          textureTarget,
          0, // mipmap级别
          internalFormat, // 内部格式
          width, // 宽度
          height, // 高度
          depth, // 深度
          0, // 边框
          pixelFormat, // 像素格式
          PixelDatatype.toWebGLConstant(pixelDatatype, context), // 数据类型
          arrayBufferView, // 数据源
        )
        initialized = true
      }
    }
    
    // 解绑纹理
    gl.bindTexture(textureTarget, null)
    
    // 初始化实例属性
    this._id = Cesium.createGuid()
    this._context = context
    this._textureFilterAnisotropic = context._textureFilterAnisotropic
    this._textureTarget = textureTarget
    this._texture = texture
    this._internalFormat = internalFormat
    this._pixelFormat = pixelFormat
    this._pixelDatatype = pixelDatatype
    this._width = width
    this._height = height
    this._depth = depth
    this._dimensions = new Cartesian3(width, height, depth)
    this._hasMinmap = false
    this._sizeInBytes = 4
    this._preMultiplyAlpha = false
    this._flipY = false
    this._initialized = initialized
    this._sampler = undefined

    // 这里为什么使用this.sampler，而不是this._sampler
    // 是因为这样其实是调用了set sampler
    this.sampler = defined(options.sampler) ? options.sampler : new Sampler()
  }

  /**
   * 从帧缓冲区创建3D纹理
   * 用于从渲染结果创建纹理，常用于后处理效果
   * @param options 帧缓冲区选项
   * @returns 新创建的3D纹理对象
   */
  static fromFramebuffer(options: FromFramebufferOptions): Texture3D {
    options = defaultValue(options, defaultValue.EMPTY_OBJECT)
    Check.defined('options.context', options.context)

    const context = options.context
    const gl = context._gl

    // 设置默认参数
    const pixelFormat = defaultValue(options.pixelFormat, PixelFormat.RGB)
    const framebufferXOffset = defaultValue(options.framebufferXOffset, 0)
    const framebufferYOffset = defaultValue(options.framebufferYOffset, 0)
    const width = defaultValue(options.width, gl.drawingBufferWidth)
    const height = defaultValue(options.height, gl.drawingBufferHeight)
    const depth = defaultValue(options.depth, 128) // 默认深度为128
    const framebuffer = options.framebuffer

    // 创建纹理对象
    const texture = new Texture3D({
      context: context,
      width: width,
      height: height,
      depth: depth,
      pixelFormat: pixelFormat,
      source: {
        framebuffer: defined(framebuffer)
          ? framebuffer
          : context.defaultFramebuffer, // 使用默认帧缓冲区
        width: width,
        height: height,
        depth: depth,
      },
    })
    return texture
  }

  /**
   * 检查对象是否已被销毁
   * @returns 如果对象已被销毁则返回true，否则返回false
   */
  isDestroyed(): boolean {
    return false
  }

  /**
   * 销毁对象，释放WebGL资源
   * 删除WebGL纹理对象并清理引用
   * @returns undefined
   */
  destroy() {
    this._context._gl.deleteTexture(this._texture)
    return destroyObject(this)
  }

  /**
   * 获取纹理唯一标识符
   */
  get id(): string {
    return this._id
  }

  /**
   * 获取当前采样器对象
   */
  get sampler(): any {
    return this._sampler
  }

  /**
   * 设置采样器并更新纹理参数
   * 包括最小化和放大过滤器的设置
   */
  set sampler(sampler: any) {
    let minificationFilter = sampler.minificationFilter
    let magnificationFilter = sampler.magnificationFilter
    const context = this._context
    const pixelFormat = this._pixelFormat
    const pixelDatatype = this._pixelDatatype

    const gl = context._gl
    const target = this._textureTarget

    // 绑定纹理并设置过滤参数
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(target, this._texture)
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, minificationFilter)
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, magnificationFilter)
    gl.bindTexture(target, null)

    this._sampler = sampler
  }

  /**
   * 获取纹理的三维尺寸
   * @returns Cartesian3对象，包含width、height、depth
   */
  get dimensions(): Cesium.Cartesian3 {
    return this._dimensions
  }

  /**
   * 获取纹理宽度
   */
  get width(): number {
    return this._width
  }

  /**
   * 获取纹理高度
   */
  get height(): number {
    return this._height
  }

  /**
   * 获取纹理深度
   */
  get depth(): number {
    return this._depth
  }

  /**
   * 获取WebGL纹理目标类型
   * 对于3D纹理，通常是gl.TEXTURE_3D
   */
  get _target(): number {
    return this._textureTarget
  }
}

export { Texture3D }
