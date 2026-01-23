import * as Cesium from 'cesium';

/**
 * 基于预渲染纹理的遮罩实现
 * 
 * 原理：
 * 1. 将多边形预先渲染到一张Canvas纹理上（多边形内部为白色，外部为黑色）
 * 2. 在后处理阶段，根据像素的世界坐标计算经纬度
 * 3. 将经纬度映射到纹理UV坐标，采样纹理判断是否在多边形内
 * 4. 根据采样结果应用遮罩效果
 * 5. 使用GroundPolylinePrimitive绘制贴地边界线
 */

export interface OutlineStyle {
    show?: boolean;
    color?: Cesium.Color | string;
    width?: number;
    opacity?: number;
}

export interface TextureMaskOptions {
    positions: number[][];       // 多边形顶点（用于遮罩区域计算）
    outlinePositions?: number[][][]; // 边界线坐标（多条线段），不传则使用positions
    color?: Cesium.Color | string;
    opacity?: number;
    textureSize?: number;        // 固定纹理尺寸（优先级最高）
    metersPerPixel?: number;     // 不传textureSize时生效：期望的米/像素（越小越清晰）
    maxTextureSize?: number;     // 不传textureSize时生效：最大纹理尺寸（默认4096）
    supersample?: number;        // 生成纹理时的超采样倍数（1/2/4），默认2
    threshold?: number;          // maskValue阈值（默认0.5，调小会“扩张”遮罩）
    feather?: number;            // 边缘羽化(0~0.5)，默认0（配合线性采样更平滑）
    invert?: boolean;
    outline?: OutlineStyle;
    arcType?: Cesium.ArcType;        // primitive模式用
    clampToGround?: boolean;         // primitive模式用
    outlineMode?: 'texture' | 'primitive' | 'hybrid'; // 默认'hybrid'
    outlineSwitchHeight?: number;    // 相机高度阈值(米)，高于显示primitive，低于显示纹理描边
    outlineHysteresis?: number;      // 防抖阈值(米)，默认0
}

export class TextureMask {
    private viewer: Cesium.Viewer;
    private postProcessStage: Cesium.PostProcessStage | null = null;
    private maskTexture: any | null = null;
    private outlinePrimitives: any[] = [];
    private removeCameraListener: (() => void) | null = null;
    private primitiveVisible: boolean | null = null;

    constructor(viewer: Cesium.Viewer) {
        this.viewer = viewer;
    }

    private nextPow2(v: number) {
        let x = 1;
        while (x < v) x <<= 1;
        return x;
    }

    /**
     * 解析颜色值
     */
    private parseColor(color: Cesium.Color | string | undefined, defaultColor: Cesium.Color): Cesium.Color {
        if (!color) return defaultColor;
        if (color instanceof Cesium.Color) return color;
        return Cesium.Color.fromCssColorString(color);
    }

    /**
     * 设置遮罩
     */
    setMask(options: TextureMaskOptions) {
        this.clear();

        const {
            positions,
            outlinePositions,
            color = 'rgb(2,26,79)',
            opacity = 0.9,
            textureSize,
            metersPerPixel = 10,
            maxTextureSize = 4096,
            supersample = 2,
            threshold = 0.5,
            feather = 0.0,
            invert = true,
            outline = {},
            arcType = Cesium.ArcType.GEODESIC,
            clampToGround = true,
            outlineMode = 'hybrid',
            outlineSwitchHeight = 200000,
            outlineHysteresis = 0
        } = options;

        // 解析遮罩颜色
        const maskColor = this.parseColor(color, Cesium.Color.fromCssColorString('rgb(2,26,79)'));
        const finalMaskColor = maskColor.withAlpha(opacity);

        // 边界线默认值
        const outlineStyle = {
            show: outline.show ?? true,
            color: this.parseColor(outline.color, Cesium.Color.fromCssColorString('#39E09B')),
            width: outline.width ?? 8,
            opacity: outline.opacity ?? 0.8
        };

        // 1. 建立局部坐标系（ENU）并计算局部边界
        const local = this.buildLocalFrame(positions);

        // 2. 选择纹理分辨率：优先textureSize，否则按“米/像素”自适应
        const rangeX = local.rect.maxX - local.rect.minX;
        const rangeY = local.rect.maxY - local.rect.minY;
        const desired = Math.ceil(Math.max(rangeX, rangeY) / Math.max(0.001, metersPerPixel));
        const adaptiveSize = Math.min(maxTextureSize, Math.max(256, this.nextPow2(desired)));
        const finalTextureSize = textureSize ?? adaptiveSize;

        // 2. 创建遮罩纹理（在局部平面绘制）
        const canvas = this.createMaskCanvas(local.localPoints, local.rect, finalTextureSize, supersample);
        
        // 3. 创建Cesium纹理
        const context = (this.viewer.scene as any).context;
        this.maskTexture = new (Cesium as any).Texture({
            context,
            source: canvas,
            pixelFormat: Cesium.PixelFormat.RGBA,
            pixelDatatype: Cesium.PixelDatatype.UNSIGNED_BYTE,
            sampler: new (Cesium as any).Sampler({
                wrapS: (Cesium as any).TextureWrap.CLAMP_TO_EDGE,
                wrapT: (Cesium as any).TextureWrap.CLAMP_TO_EDGE,
                minificationFilter: Cesium.TextureMinificationFilter.LINEAR,
                magnificationFilter: Cesium.TextureMagnificationFilter.LINEAR
            })
        });

        // 4. 创建后处理阶段
        this.postProcessStage = this.createPostProcessStage(
            local.inverse,
            local.rect,
            finalMaskColor,
            invert,
            threshold,
            feather,
            outlineStyle,
            finalTextureSize
        );
        this.viewer.scene.postProcessStages.add(this.postProcessStage);

        // primitive描边（可选）
        if (outlineStyle.show && (outlineMode === 'primitive' || outlineMode === 'hybrid')) {
            const lines = outlinePositions && outlinePositions.length ? outlinePositions : [positions];
            this.createOutlinePrimitives(lines, {
                color: outlineStyle.color,
                width: outlineStyle.width,
                opacity: outlineStyle.opacity,
                arcType,
                clampToGround
            });
        }

        // 根据相机高度切换描边模式
        if (outlineStyle.show && outlineMode === 'hybrid') {
            this.installOutlineSwitcher(outlineSwitchHeight, outlineHysteresis);
            this.applyOutlineVisibilityByHeight(outlineSwitchHeight, outlineHysteresis);
        } else if (outlineStyle.show && outlineMode === 'primitive') {
            this.setTextureOutlineVisible(false);
            this.setPrimitiveOutlineVisible(true);
        } else {
            // texture
            this.setTextureOutlineVisible(outlineStyle.show);
            this.setPrimitiveOutlineVisible(false);
        }
    }

    private buildLocalFrame(positions: number[][]) {
        let minLon = Infinity, maxLon = -Infinity;
        let minLat = Infinity, maxLat = -Infinity;
        for (const [lon, lat] of positions) {
            minLon = Math.min(minLon, lon);
            maxLon = Math.max(maxLon, lon);
            minLat = Math.min(minLat, lat);
            maxLat = Math.max(maxLat, lat);
        }

        const centerLon = (minLon + maxLon) * 0.5;
        const centerLat = (minLat + maxLat) * 0.5;
        const origin = Cesium.Cartesian3.fromDegrees(centerLon, centerLat, 0.0);

        const localToWorld = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
        const inverse = Cesium.Matrix4.inverse(localToWorld, new Cesium.Matrix4());

        const localPoints: Array<{ x: number; y: number }> = [];
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        for (const [lon, lat] of positions) {
            const world = Cesium.Cartesian3.fromDegrees(lon, lat, 0.0);
            const pLocal = Cesium.Matrix4.multiplyByPoint(inverse, world, new Cesium.Cartesian3());
            const x = pLocal.x;
            const y = pLocal.y;
            localPoints.push({ x, y });
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }

        // 留一点边距避免边缘采样误差（单位：米）
        const paddingMeters = 5.0;
        const rect = {
            minX: minX - paddingMeters,
            minY: minY - paddingMeters,
            maxX: maxX + paddingMeters,
            maxY: maxY + paddingMeters
        };

        return { inverse, rect, localPoints };
    }

    /**
     * 创建遮罩Canvas纹理
     */
    private createMaskCanvas(
        points: Array<{ x: number; y: number }>,
        rect: { minX: number; minY: number; maxX: number; maxY: number },
        size: number,
        supersample: number
    ): HTMLCanvasElement {
        const ss = Math.max(1, Math.floor(supersample || 1));
        const hiSize = size * ss;

        const hiCanvas = document.createElement('canvas');
        hiCanvas.width = hiSize;
        hiCanvas.height = hiSize;
        const ctx = hiCanvas.getContext('2d')!;

        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, hiSize, hiSize);

        const rangeX = rect.maxX - rect.minX;
        const rangeY = rect.maxY - rect.minY;

        const toCanvasX = (x: number) => ((x - rect.minX) / rangeX) * hiSize;
        // Canvas Y 向下，这里把 north(大) 映射到顶部：y越大越靠上
        const toCanvasY = (y: number) => (1.0 - (y - rect.minY) / rangeY) * hiSize;

        ctx.fillStyle = 'white';
        ctx.beginPath();
        
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const x = toCanvasX(p.x);
            const y = toCanvasY(p.y);
            
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        
        ctx.closePath();
        ctx.fill();

        if (ss === 1) return hiCanvas;

        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const out = canvas.getContext('2d')!;
        out.imageSmoothingEnabled = true;
        out.drawImage(hiCanvas, 0, 0, size, size);
        return canvas;
    }

    /**
     * 创建后处理阶段
     */
    private createPostProcessStage(
        inverseLocalFrame: Cesium.Matrix4,
        rect: { minX: number; minY: number; maxX: number; maxY: number },
        maskColor: Cesium.Color,
        invert: boolean,
        threshold: number,
        feather: number,
        outlineStyle: { show: boolean; color: Cesium.Color; width: number; opacity: number },
        maskTextureSize: number
    ): Cesium.PostProcessStage {
        const fragmentShaderSource = `
            uniform sampler2D colorTexture;
            uniform sampler2D depthTexture;
            uniform sampler2D maskTexture;
            in vec2 v_textureCoordinates;
            
            uniform mat4 inverseLocalFrame;
            uniform vec4 rect; // [minX, minY, maxX, maxY] in meters (ENU)
            uniform vec4 maskColor;
            uniform bool invert;
            uniform float threshold;
            uniform float feather;
            uniform bool outlineShow;
            uniform vec4 outlineColor;
            uniform float outlineWidth;
            uniform float outlineOpacity;
            uniform vec2 maskInvSize; // 1.0 / textureSize
            
            void main() {
                out_FragColor = texture(colorTexture, v_textureCoordinates);
                
                float depth = czm_unpackDepth(texture(depthTexture, v_textureCoordinates));
                if (depth >= 1.0) return;
                
                vec4 eyeCoord = czm_windowToEyeCoordinates(gl_FragCoord.xy, depth);
                vec3 eyeCoord3 = eyeCoord.xyz / eyeCoord.w;
                
                vec4 worldCoord = czm_inverseView * vec4(eyeCoord3, 1.0);
                vec3 worldPos = worldCoord.xyz / worldCoord.w;

                vec4 local4 = inverseLocalFrame * vec4(worldPos, 1.0);
                vec2 localXY = local4.xy;

                if (localXY.x < rect.x || localXY.x > rect.z ||
                    localXY.y < rect.y || localXY.y > rect.w) {
                    if (invert) {
                        out_FragColor = mix(out_FragColor, maskColor, maskColor.a);
                    }
                    return;
                }
                
                float u = (localXY.x - rect.x) / (rect.z - rect.x);
                float v = (localXY.y - rect.y) / (rect.w - rect.y);
                
                float maskValue = texture(maskTexture, vec2(u, v)).r;
                // 自适应AA：用maskValue的屏幕空间梯度做过渡带，减少锯齿且不靠“糊边”
                float aa = max(fwidth(maskValue), max(0.0, feather));
                float inside = smoothstep(threshold - aa, threshold + aa, maskValue);

                float maskAmount = invert ? (1.0 - inside) : inside;
                if (maskAmount > 0.0) {
                    out_FragColor = mix(out_FragColor, maskColor, maskColor.a * maskAmount);
                }

                if (outlineShow) {
                    // 近距离时 maskValue 可能变成 0/1 常量，fwidth 会接近 0 导致描边“消失”
                    // 这里用邻域采样做边缘检测，并保证至少跨 1 个 texel
                    vec2 uv = vec2(u, v);
                    vec2 duv = vec2(fwidth(u), fwidth(v));
                    vec2 stepUv = max(duv, maskInvSize) * max(1.0, outlineWidth);

                    float mL = texture(maskTexture, uv + vec2(-stepUv.x, 0.0)).r;
                    float mR = texture(maskTexture, uv + vec2(stepUv.x, 0.0)).r;
                    float mD = texture(maskTexture, uv + vec2(0.0, -stepUv.y)).r;
                    float mU = texture(maskTexture, uv + vec2(0.0, stepUv.y)).r;

                    float d = 0.0;
                    d = max(d, abs(maskValue - mL));
                    d = max(d, abs(maskValue - mR));
                    d = max(d, abs(maskValue - mD));
                    d = max(d, abs(maskValue - mU));

                    float edge = smoothstep(0.02, 0.20, d);
                    if (edge > 0.0) {
                        out_FragColor = mix(out_FragColor, outlineColor, outlineOpacity * edge);
                    }
                }
            }
        `;

        return new Cesium.PostProcessStage({
            fragmentShader: fragmentShaderSource,
            uniforms: {
                maskTexture: this.maskTexture,
                inverseLocalFrame: inverseLocalFrame,
                rect: new Cesium.Cartesian4(rect.minX, rect.minY, rect.maxX, rect.maxY),
                maskColor: maskColor,
                invert: invert,
                threshold: threshold,
                feather: feather,
                outlineShow: outlineStyle.show,
                outlineColor: outlineStyle.color,
                outlineWidth: outlineStyle.width,
                outlineOpacity: outlineStyle.opacity,
                maskInvSize: new Cesium.Cartesian2(1.0 / maskTextureSize, 1.0 / maskTextureSize)
            }
        });
    }

    private setTextureOutlineVisible(visible: boolean) {
        if (!this.postProcessStage) return;
        (this.postProcessStage.uniforms as any).outlineShow = visible;
    }

    private setPrimitiveOutlineVisible(visible: boolean) {
        for (const p of this.outlinePrimitives) {
            p.show = visible;
        }
        this.primitiveVisible = visible;
    }

    private installOutlineSwitcher(switchHeight: number, hysteresis: number) {
        if (this.removeCameraListener) return;
        const camera = this.viewer.camera;
        const onMoveEnd = () => {
            this.applyOutlineVisibilityByHeight(switchHeight, hysteresis);
        };
        camera.moveEnd.addEventListener(onMoveEnd);
        this.removeCameraListener = () => camera.moveEnd.removeEventListener(onMoveEnd);
    }

    private applyOutlineVisibilityByHeight(switchHeight: number, hysteresis: number) {
        if (!this.viewer || !this.postProcessStage) return;
        const height = this.viewer.camera.positionCartographic.height;
        const h = Math.max(0, hysteresis || 0);

        // 规则（符合你说的）：高视角 -> primitive；近视角 -> 纹理描边
        // 加一点滞回，避免在阈值附近抖动
        let wantPrimitive: boolean;
        if (this.primitiveVisible === null) {
            wantPrimitive = height >= switchHeight;
        } else if (this.primitiveVisible) {
            wantPrimitive = height >= (switchHeight - h);
        } else {
            wantPrimitive = height >= (switchHeight + h);
        }

        this.setPrimitiveOutlineVisible(wantPrimitive);
        this.setTextureOutlineVisible(!wantPrimitive);
    }

    private createOutlinePrimitives(
        lines: number[][][],
        style: { color: Cesium.Color; width: number; opacity: number; arcType: Cesium.ArcType; clampToGround: boolean }
    ) {
        const outlineColor = style.color.withAlpha(style.opacity);

        for (const segment of lines) {
            if (!segment || segment.length < 2) continue;

            const degrees: number[] = [];
            for (const c of segment) {
                degrees.push(c[0], c[1]);
            }
            const positions = Cesium.Cartesian3.fromDegreesArray(degrees);

            if (style.clampToGround) {
                const geometry = new Cesium.GroundPolylineGeometry({
                    positions,
                    width: style.width,
                    arcType: style.arcType
                });
                const instance = new Cesium.GeometryInstance({
                    geometry,
                    attributes: {
                        color: Cesium.ColorGeometryInstanceAttribute.fromColor(outlineColor)
                    }
                });
                const primitive = new Cesium.GroundPolylinePrimitive({
                    geometryInstances: instance,
                    appearance: new Cesium.PolylineColorAppearance()
                });
                this.viewer.scene.groundPrimitives.add(primitive);
                this.outlinePrimitives.push(primitive);
            } else {
                const geometry = new Cesium.PolylineGeometry({
                    positions,
                    width: style.width,
                    arcType: style.arcType
                });
                const instance = new Cesium.GeometryInstance({
                    geometry,
                    attributes: {
                        color: Cesium.ColorGeometryInstanceAttribute.fromColor(outlineColor)
                    }
                });
                const primitive = new Cesium.Primitive({
                    geometryInstances: instance,
                    appearance: new Cesium.PolylineColorAppearance()
                });
                this.viewer.scene.primitives.add(primitive);
                this.outlinePrimitives.push(primitive);
            }
        }
    }

    /**
     * 更新遮罩颜色
     */
    updateMaskColor(color: Cesium.Color | string, opacity?: number) {
        if (this.postProcessStage) {
            let finalColor = this.parseColor(color, Cesium.Color.BLACK);
            if (opacity !== undefined) {
                finalColor = finalColor.withAlpha(opacity);
            }
            (this.postProcessStage.uniforms as any).maskColor = finalColor;
        }
    }

    /**
     * 清除遮罩
     */
    clear() {
        if (this.removeCameraListener) {
            this.removeCameraListener();
            this.removeCameraListener = null;
        }
        if (this.postProcessStage) {
            this.viewer.scene.postProcessStages.remove(this.postProcessStage);
            this.postProcessStage = null;
        }
        if (this.maskTexture) {
            this.maskTexture.destroy();
            this.maskTexture = null;
        }
        for (const p of this.outlinePrimitives) {
            this.viewer.scene.groundPrimitives.remove(p);
            this.viewer.scene.primitives.remove(p);
        }
        this.outlinePrimitives = [];
        this.primitiveVisible = null;
    }

    /**
     * 销毁
     */
    destroy() {
        this.clear();
    }
}
