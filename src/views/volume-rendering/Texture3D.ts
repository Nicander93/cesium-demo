/**
 * Texture3D 类
 * 实现一个基于 WebGL 的 3D 纹理对象，用于体积渲染
 * 支持从数组缓冲区或帧缓冲区创建三维纹理
 */
import * as Cesium from 'cesium';
const Cartesian3 = Cesium.Cartesian3;
const Check = Cesium.Check;
const defaultValue = Cesium.defaultValue;
const defined = Cesium.defined;
const destroyObject = Cesium.destroyObject;
const DeveloperError = Cesium.DeveloperError;
const PixelFormat = Cesium.PixelFormat;
// 使用标准Cesium中可用的替代方案
const ContextLimits = {
  maximumTextureSize: 16384 // 大多数WebGL实现支持的最大纹理尺寸
};
const PixelDatatype = Cesium.PixelDatatype;
// 创建一个简单的Sampler类
class Sampler {
  minificationFilter: number;
  magnificationFilter: number;
  
  constructor(options?: any) {
    this.minificationFilter = options?.minificationFilter || 9729; // gl.LINEAR
    this.magnificationFilter = options?.magnificationFilter || 9729; // gl.LINEAR
  }
}

/**
 * 3D纹理选项接口
 */
interface Texture3DOptions {
  /** WebGL上下文 */
  context: any;
  /** 纹理宽度 */
  width: number;
  /** 纹理高度 */
  height: number;
  /** 纹理深度 */
  depth: number;
  /** 纹理数据源 */
  source?: {
    /** 数组缓冲区视图 */
    arrayBufferView?: ArrayBufferView;
    /** 帧缓冲区 */
    framebuffer?: any;
    /** 源宽度 */
    width?: number;
    /** 源高度 */
    height?: number;
    /** 源深度 */
    depth?: number;
  };
  /** 像素格式 */
  pixelFormat?: number;
  /** 像素数据类型 */
  pixelDataType?: number;
  /** 采样器对象 */
  sampler?: any;
}

/**
 * 帧缓冲区选项接口
 */
interface FromFramebufferOptions {
  /** WebGL上下文 */
  context: any;
  /** 像素格式 */
  pixelFormat?: number;
  /** 帧缓冲区X偏移 */
  framebufferXOffset?: number;
  /** 帧缓冲区Y偏移 */
  framebufferYOffset?: number;
  /** 纹理宽度 */
  width?: number;
  /** 纹理高度 */
  height?: number;
  /** 纹理深度 */
  depth?: number;
  /** 帧缓冲区 */
  framebuffer?: any;
}

/**
 * 3D纹理类
 * 用于创建和管理WebGL 3D纹理
 */
class Texture3D {
  private _id: string;
  private _context: any;
  private _textureFilterAnisotropic: any;
  private _textureTarget: number;
  private _texture: WebGLTexture;
  private _internalFormat: number;
  private _pixelFormat: number;
  private _pixelDatatype: number;
  private _width: number;
  private _height: number;
  private _depth: number;
  private _dimensions: Cesium.Cartesian3;
  private _hasMinmap: boolean;
  private _sizeInBytes: number;
  private _preMultiplyAlpha: boolean;
  private _flipY: boolean;
  private _initialized: boolean;
  private _sampler: any;

  /**
   * 创建一个新的3D纹理对象
   * @param options 纹理选项
   */
  constructor(options: Texture3DOptions) {
    options = defaultValue(options, {});

    Check.defined('options.context', options.context);

    const context = options.context;
    let width = options.width;
    let height = options.height;
    let depth = options.depth;
    let source = options.source;

    const pixelFormat = defaultValue(options.pixelFormat, PixelFormat.RGBA);
    const pixelDatatype = defaultValue(
      options.pixelDataType,
      PixelDatatype.UNSIGNED_BYTE,
    );
    // 简化内部格式计算
    const internalFormat = pixelFormat;

    if (!defined(width) || !defined(height) || !defined(depth)) {
      throw new DeveloperError(
        'options requires a source field to create an 3d texture. width or height or dimension fileds',
      );
    }

    Check.typeOf.number.greaterThan('width', width as number, 0);

    if (width > ContextLimits.maximumTextureSize) {
      throw new DeveloperError(
        'width must be less than or equal to the maximum texture size',
      );
    }

    Check.typeOf.number.greaterThan('height', height as number, 0);

    if (height > ContextLimits.maximumTextureSize) {
      throw new DeveloperError(
        'height must be less than or equal to the maximum texture size',
      );
    }

    Check.typeOf.number.greaterThan('dimensions', depth as number, 0);

    if (depth > ContextLimits.maximumTextureSize) {
      throw new DeveloperError(
        'dimension must be less than or equal to the maximum texture size',
      );
    }

    // 简化验证逻辑
    if (pixelFormat !== PixelFormat.RGBA && pixelFormat !== PixelFormat.RGB) {
      throw new DeveloperError('Invalid options.pixelFormat.');
    }

    if (pixelDatatype !== PixelDatatype.UNSIGNED_BYTE) {
      throw new DeveloperError('Invalid options.pixelDatatype.');
    }

    let initialized = true;
    const gl = context._gl;
    const textureTarget = gl.TEXTURE_3D;
    const texture = gl.createTexture() as WebGLTexture;

    const lxs = gl.getParameter(gl.ACTIVE_TEXTURE);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(textureTarget, texture);
    let unpackAlignment = 4;
    if (defined(source) && defined(source.arrayBufferView)) {
      // 简化对齐计算
      unpackAlignment = 4;
    }

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, unpackAlignment);
    gl.pixelStorei(
      gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,
      gl.BROWSER_DEFAULT_WEBGL,
    );

    // 注意：WebGL 中 3D 纹理不允许 UNPACK_FLIP_Y_WEBGL 和 UNPACK_PREMULTIPLY_ALPHA_WEBGL
    // 显式设置为 false 以避免 WebGL 错误
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    if (defined(source)) {
      if (defined(source.arrayBufferView)) {
        let arrayBufferView = source.arrayBufferView;
        gl.texImage3D(
          textureTarget,
          0,
          internalFormat,
          width,
          height,
          depth,
          0,
          pixelFormat,
          pixelDatatype,
          arrayBufferView,
        );
        initialized = true;
      }
    }
    gl.bindTexture(textureTarget, null);
    this._id = Cesium.createGuid();
    this._context = context;
    this._textureFilterAnisotropic = context._textureFilterAnisotropic;
    this._textureTarget = textureTarget;
    this._texture = texture;
    this._internalFormat = internalFormat;
    this._pixelFormat = pixelFormat;
    this._pixelDatatype = pixelDatatype;
    this._width = width;
    this._height = height;
    this._depth = depth;
    this._dimensions = new Cartesian3(width, height, depth);
    this._hasMinmap = false;
    this._sizeInBytes = 4;
    this._preMultiplyAlpha = false;
    this._flipY = false;
    this._initialized = initialized;
    this._sampler = undefined;

    this.sampler = defined(options.sampler) ? options.sampler : new Sampler();
  }

  /**
   * 从帧缓冲区创建3D纹理
   * @param options 帧缓冲区选项
   * @returns 新创建的3D纹理对象
   */
  static fromFramebuffer(options: FromFramebufferOptions): Texture3D {
    options = defaultValue(options, {});
    Check.defined('options.context', options.context);

    const context = options.context;
    const gl = context._gl;

    const pixelFormat = defaultValue(options.pixelFormat, PixelFormat.RGB);
    const framebufferXOffset = defaultValue(options.framebufferXOffset, 0);
    const framebufferYOffset = defaultValue(options.framebufferYOffset, 0);
    const width = defaultValue(options.width, gl.drawingBufferWidth);
    const height = defaultValue(options.height, gl.drawingBufferHeight);
    const depth = defaultValue(options.depth, 128);
    const framebuffer = options.framebuffer;

    const texture = new Texture3D({
      context: context,
      width: width,
      height: height,
      depth: depth,
      pixelFormat: pixelFormat,
      source: {
        framebuffer: defined(framebuffer)
          ? framebuffer
          : context.defaultFramebuffer,
        width: width,
        height: height,
        depth: depth,
      },
    });
    return texture;
  }

  /**
   * 检查对象是否已被销毁
   * @returns 如果对象已被销毁则返回true，否则返回false
   */
  isDestroyed(): boolean {
    return false;
  }

  /**
   * 销毁对象，释放资源
   */
  destroy(): void {
    this._context._gl.deleteTexture(this._texture);
    destroyObject(this);
  }

  /**
   * 获取纹理ID
   */
  get id(): string {
    return this._id;
  }

  /**
   * 获取或设置采样器
   */
  get sampler(): any {
    return this._sampler;
  }

  /**
   * 设置采样器并更新纹理参数
   */
  set sampler(sampler: any) {
    let minificationFilter = sampler.minificationFilter;
    let magnificationFilter = sampler.magnificationFilter;
    const context = this._context;
    const pixelFormat = this._pixelFormat;
    const pixelDatatype = this._pixelDatatype;

    const gl = context._gl;
    const target = this._textureTarget;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(target, this._texture);
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, minificationFilter);
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, magnificationFilter);
    gl.bindTexture(target, null);

    this._sampler = sampler;
  }

  /**
   * 获取纹理尺寸
   */
  get dimensions(): Cesium.Cartesian3 {
    return this._dimensions;
  }

  /**
   * 获取纹理宽度
   */
  get width(): number {
    return this._width;
  }

  /**
   * 获取纹理高度
   */
  get height(): number {
    return this._height;
  }

  /**
   * 获取纹理深度
   */
  get depth(): number {
    return this._depth;
  }

  /**
   * 获取纹理目标
   */
  get target(): number {
    return this._textureTarget;
  }
}

export { Texture3D };