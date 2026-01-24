import * as Cesium from 'cesium';

/**
 * 基于 Shader + 纹理 的 Cesium 遮罩实现
 * 支持任意多边形，通过将多边形渲染到纹理来实现
 */

interface MaskOptions {
    maskColor?: number[];
    fadeDistance?: number;
    textureSize?: number; // 纹理分辨率，默认 2048
}

export class ShaderMask {
    private viewer: Cesium.Viewer;
    private options: {
        maskColor: number[];
        fadeDistance: number;
        textureSize: number;
    };
    private maskPolygons: number[][][] = [];
    public globalMaskPrimitive: Cesium.Primitive | null = null;
    private maskMaterial: Cesium.Material | null = null;
    private maskCanvas: HTMLCanvasElement | null = null;
    private maskCtx: CanvasRenderingContext2D | null = null;

    constructor(viewer: Cesium.Viewer, options: MaskOptions = {}) {
        this.viewer = viewer;
        this.options = {
            maskColor: options.maskColor || [0.0, 0.0, 0.0, 0.5],
            fadeDistance: options.fadeDistance || 1.0,
            textureSize: options.textureSize || 2048,
        };
        
        this.initCanvas();
        this.initializeShaderMaterial();
    }

    private initCanvas(): void {
        this.maskCanvas = document.createElement('canvas');
        this.maskCanvas.width = this.options.textureSize;
        this.maskCanvas.height = this.options.textureSize;
        this.maskCtx = this.maskCanvas.getContext('2d');
    }

    private initializeShaderMaterial(): void {
        const materialType = 'PolygonMaskMaterial_' + Date.now();
        
        // 创建初始空白纹理
        this.updateMaskTexture();

        (Cesium.Material as any)._materialCache?.addMaterial(materialType, {
            fabric: {
                type: materialType,
                uniforms: {
                    maskColor: new Cesium.Color(0.0, 0.0, 0.0, 0.5),
                    fadeDistance: 1.0,
                    enableMask: false,
                    maskTexture: this.maskCanvas
                },
                source: this.getFragmentShader()
            }
        });

        this.maskMaterial = new Cesium.Material({
            fabric: {
                type: materialType,
                uniforms: {
                    maskColor: new Cesium.Color(...this.options.maskColor),
                    fadeDistance: this.options.fadeDistance,
                    enableMask: false,
                    maskTexture: this.maskCanvas
                }
            }
        });

        const rectangleInstance = new Cesium.GeometryInstance({
            geometry: new Cesium.RectangleGeometry({
                rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90),
                vertexFormat: Cesium.MaterialAppearance.MaterialSupport.ALL.vertexFormat
            })
        });

        this.globalMaskPrimitive = this.viewer.scene.primitives.add(
            new Cesium.Primitive({
                geometryInstances: rectangleInstance,
                appearance: new Cesium.MaterialAppearance({
                    material: this.maskMaterial,
                    translucent: true,
                    flat: true
                }),
                asynchronous: false
            })
        );
    }

    private getFragmentShader(): string {
        return `
            uniform vec4 maskColor;
            uniform float fadeDistance;
            uniform bool enableMask;
            uniform sampler2D maskTexture;
            
            czm_material czm_getMaterial(czm_materialInput materialInput) {
                czm_material material = czm_getDefaultMaterial(materialInput);
                
                vec2 st = materialInput.st;
                float maskAlpha = 0.0;
                
                if (enableMask) {
                    // 采样蒙版纹理 (R通道: 1.0=透明区域, 0.0=遮罩区域)
                    float maskValue = texture(maskTexture, st).r;
                    
                    // maskValue = 1.0 表示在多边形内部（透明），0.0 表示外部（遮罩）
                    float isOutside = 1.0 - maskValue;
                    
                    if (fadeDistance > 0.0) {
                        // 使用 G 通道存储的距离信息实现边缘渐变
                        float distValue = texture(maskTexture, st).g;
                        float fadeRatio = clamp(distValue / fadeDistance, 0.0, 1.0);
                        maskAlpha = isOutside * maskColor.a * fadeRatio;
                    } else {
                        maskAlpha = isOutside * maskColor.a;
                    }
                }
                
                material.diffuse = maskColor.rgb;
                material.alpha = maskAlpha;
                
                return material;
            }
        `;
    }

    /**
     * 将经纬度坐标转换为纹理坐标
     */
    private lngLatToTextureCoord(lng: number, lat: number): [number, number] {
        const x = ((lng + 180) / 360) * this.options.textureSize;
        const y = ((90 - lat) / 180) * this.options.textureSize; // Y轴翻转
        return [x, y];
    }

    /**
     * 更新蒙版纹理
     */
    private updateMaskTexture(): void {
        if (!this.maskCtx || !this.maskCanvas) return;

        const ctx = this.maskCtx;
        const size = this.options.textureSize;

        // 清空画布 - 黑色表示遮罩区域
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, size, size);

        // 绘制所有多边形 - 白色表示透明区域
        ctx.fillStyle = 'white';
        ctx.strokeStyle = 'white';

        for (const polygon of this.maskPolygons) {
            if (polygon.length < 3) continue;

            ctx.beginPath();
            const [startX, startY] = this.lngLatToTextureCoord(polygon[0][0], polygon[0][1]);
            ctx.moveTo(startX, startY);

            for (let i = 1; i < polygon.length; i++) {
                const [x, y] = this.lngLatToTextureCoord(polygon[i][0], polygon[i][1]);
                ctx.lineTo(x, y);
            }

            ctx.closePath();
            ctx.fill();
        }

        // 生成距离场用于边缘渐变
        this.generateDistanceField();
    }

    /**
     * 生成简化的距离场（用于边缘渐变效果）
     */
    private generateDistanceField(): void {
        if (!this.maskCtx || !this.maskCanvas) return;

        const ctx = this.maskCtx;
        const size = this.options.textureSize;
        const imageData = ctx.getImageData(0, 0, size, size);
        const data = imageData.data;

        // 简化的距离场：基于采样点到边界的曼哈顿距离
        const maxDist = Math.min(size * 0.1, 100); // 最大渐变距离

        // 找到边界像素并计算距离
        const isInside = new Uint8Array(size * size);
        for (let i = 0; i < size * size; i++) {
            isInside[i] = data[i * 4] > 127 ? 1 : 0;
        }

        // 简化的距离计算：只检查周围像素
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const idx = y * size + x;
                const pixelIdx = idx * 4;

                if (isInside[idx] === 0) {
                    // 外部像素：计算到最近内部像素的距离
                    let minDist = maxDist;
                    const searchRadius = Math.ceil(maxDist);

                    for (let dy = -searchRadius; dy <= searchRadius && minDist > 0; dy++) {
                        for (let dx = -searchRadius; dx <= searchRadius; dx++) {
                            const nx = x + dx;
                            const ny = y + dy;
                            if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
                                if (isInside[ny * size + nx] === 1) {
                                    const dist = Math.sqrt(dx * dx + dy * dy);
                                    minDist = Math.min(minDist, dist);
                                }
                            }
                        }
                    }

                    // 将距离存储在 G 通道，归一化到 0-1
                    data[pixelIdx + 1] = Math.floor((minDist / maxDist) * 255);
                } else {
                    // 内部像素
                    data[pixelIdx + 1] = 0;
                }
            }
        }

        ctx.putImageData(imageData, 0, 0);
    }

    /**
     * 添加遮罩多边形（支持任意多边形）
     * @param coordinates 多边形坐标数组 [[lng, lat], [lng, lat], ...]
     */
    addMaskPolygon(coordinates: number[][]): void {
        if (!coordinates || coordinates.length < 3) {
            console.warn('多边形至少需要3个顶点');
            return;
        }

        this.maskPolygons.push([...coordinates]);
        this.updateMaskTexture();
        this.refreshMaterialTexture();
        this.enableMask();
    }

    /**
     * 添加多个遮罩多边形
     */
    addMaskPolygons(polygons: number[][][]): void {
        for (const polygon of polygons) {
            if (polygon && polygon.length >= 3) {
                this.maskPolygons.push([...polygon]);
            }
        }
        this.updateMaskTexture();
        this.refreshMaterialTexture();
        this.enableMask();
    }

    /**
     * 刷新材质纹理
     */
    private refreshMaterialTexture(): void {
        if (this.maskMaterial && this.maskCanvas) {
            (this.maskMaterial as any).uniforms.maskTexture = this.maskCanvas;
        }
    }

    /**
     * 移除所有遮罩多边形
     */
    clearMaskPolygons(): void {
        this.maskPolygons = [];
        this.updateMaskTexture();
        this.refreshMaterialTexture();
        this.disableMask();
    }

    enableMask(): void {
        if (this.maskMaterial) {
            (this.maskMaterial as any).uniforms.enableMask = true;
        }
    }

    disableMask(): void {
        if (this.maskMaterial) {
            (this.maskMaterial as any).uniforms.enableMask = false;
        }
    }

    setMaskColor(color: number[]): void {
        if (this.maskMaterial) {
            (this.maskMaterial as any).uniforms.maskColor = new Cesium.Color(...color);
        }
    }

    setFadeDistance(distance: number): void {
        this.options.fadeDistance = distance;
        if (this.maskMaterial) {
            (this.maskMaterial as any).uniforms.fadeDistance = distance;
        }
    }

    /**
     * 设置纹理分辨率（需要重新初始化）
     */
    setTextureSize(size: number): void {
        this.options.textureSize = size;
        if (this.maskCanvas) {
            this.maskCanvas.width = size;
            this.maskCanvas.height = size;
        }
        this.updateMaskTexture();
        this.refreshMaterialTexture();
    }

    /**
     * 获取当前蒙版纹理的 Canvas（用于调试）
     */
    getMaskCanvas(): HTMLCanvasElement | null {
        return this.maskCanvas;
    }

    destroy(): void {
        if (this.globalMaskPrimitive) {
            this.viewer.scene.primitives.remove(this.globalMaskPrimitive);
            this.globalMaskPrimitive = null;
        }
        this.maskMaterial = null;
        this.maskPolygons = [];
        this.maskCanvas = null;
        this.maskCtx = null;
    }
}

// 使用示例
export class MaskExample {
    private viewer!: Cesium.Viewer;
    private shaderMask!: ShaderMask;

    constructor() {
        this.initViewer();
    }

    private async initViewer(): Promise<void> {
        this.viewer = new Cesium.Viewer('cesiumContainer', {
            terrainProvider: await Cesium.createWorldTerrainAsync(),
            timeline: false,
            animation: false
        });

        this.setupMask();
        this.addTestData();
    }

    private setupMask(): void {
        this.shaderMask = new ShaderMask(this.viewer, {
            maskColor: [0.0, 0.0, 0.0, 0.6],
            fadeDistance: 0.5,
            textureSize: 2048 // 纹理分辨率，越大越精细
        });

        // 添加矩形区域（北京周边）
        const beijingArea: number[][] = [
            [116.0, 39.5],
            [117.0, 39.5],
            [117.0, 40.5],
            [116.0, 40.5]
        ];

        // 添加圆形区域（上海周边）
        const shanghaiArea = this.generateCircleCoordinates([121.5, 31.2], 0.5, 32);

        // 添加不规则多边形（广东省简化边界示例）
        const guangdongArea: number[][] = [
            [109.5, 21.5],
            [110.5, 20.5],
            [113.0, 21.0],
            [115.5, 22.5],
            [117.0, 23.5],
            [116.5, 25.0],
            [114.0, 25.5],
            [111.0, 25.0],
            [110.0, 23.5]
        ];

        // 添加星形区域（成都）
        const chengduStar = this.generateStarCoordinates([104.0, 30.6], 1.0, 0.4, 5);

        // 批量添加多个多边形
        this.shaderMask.addMaskPolygons([beijingArea, shanghaiArea, guangdongArea, chengduStar]);
    }

    /**
     * 生成圆形坐标
     */
    private generateCircleCoordinates(center: [number, number], radius: number, segments: number = 32): number[][] {
        const coordinates: number[][] = [];
        for (let i = 0; i < segments; i++) {
            const angle = (i / segments) * 2 * Math.PI;
            const lng = center[0] + radius * Math.cos(angle);
            const lat = center[1] + radius * Math.sin(angle);
            coordinates.push([lng, lat]);
        }
        return coordinates;
    }

    /**
     * 生成星形坐标（演示复杂多边形）
     */
    private generateStarCoordinates(center: [number, number], outerRadius: number, innerRadius: number, points: number = 5): number[][] {
        const coordinates: number[][] = [];
        for (let i = 0; i < points * 2; i++) {
            const angle = (i / (points * 2)) * 2 * Math.PI - Math.PI / 2;
            const radius = i % 2 === 0 ? outerRadius : innerRadius;
            const lng = center[0] + radius * Math.cos(angle);
            const lat = center[1] + radius * Math.sin(angle);
            coordinates.push([lng, lat]);
        }
        return coordinates;
    }

    private addTestData(): void {
        const testPoints = [
            { name: '北京', position: [116.4, 39.9] },
            { name: '上海', position: [121.5, 31.2] },
            { name: '广州', position: [113.3, 23.1] },
            { name: '深圳', position: [114.1, 22.5] }
        ];

        testPoints.forEach(point => {
            this.viewer.entities.add({
                position: Cesium.Cartesian3.fromDegrees(point.position[0], point.position[1]),
                point: {
                    pixelSize: 10,
                    color: Cesium.Color.YELLOW,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2
                },
                label: {
                    text: point.name,
                    font: '14pt sans-serif',
                    pixelOffset: new Cesium.Cartesian2(0, -50),
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE
                }
            });
        });

        this.viewer.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(116.4, 39.9, 2000000)
        });
    }

    toggleMask(): void {
        if (this.shaderMask.globalMaskPrimitive) {
            this.shaderMask.globalMaskPrimitive.show = !this.shaderMask.globalMaskPrimitive.show;
        }
    }

    changeMaskColor(r: number, g: number, b: number, a: number): void {
        this.shaderMask.setMaskColor([r, g, b, a]);
    }

    changeFadeDistance(distance: number): void {
        this.shaderMask.setFadeDistance(distance);
    }

    /**
     * 动态添加新的多边形
     */
    addPolygon(coordinates: number[][]): void {
        this.shaderMask.addMaskPolygon(coordinates);
    }

    /**
     * 清除所有多边形
     */
    clearAllPolygons(): void {
        this.shaderMask.clearMaskPolygons();
    }

    /**
     * 调试：显示蒙版纹理
     */
    debugShowMaskTexture(): void {
        const canvas = this.shaderMask.getMaskCanvas();
        if (canvas) {
            const win = window.open('', '_blank');
            if (win) {
                win.document.body.appendChild(canvas.cloneNode(true) as HTMLCanvasElement);
            }
        }
    }
}